package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"codex-server/backend/internal/appserver"
)

const scannerMaxTokenSize = 10 * 1024 * 1024

type Handler interface {
	HandleNotification(method string, params json.RawMessage)
	HandleRequest(id json.RawMessage, method string, params json.RawMessage)
	HandleStderr(line string)
	HandleClosed(err error)
}

type Config struct {
	Command                   string
	Cwd                       string
	ClientName                string
	ClientVersion             string
	ExperimentalAPI           bool
	OptOutNotificationMethods []string
}

type Client struct {
	handler Handler

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser

	writeMu sync.Mutex
	waitMu  sync.Mutex
	waiters map[string]chan rpcMessage

	nextID atomic.Int64

	closeOnce sync.Once
	closed    chan struct{}
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

type outboundRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type outboundNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type outboundResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("json-rpc error %d: %s", e.Code, e.Message)
}

func Start(ctx context.Context, cfg Config, handler Handler) (*Client, error) {
	if strings.TrimSpace(cfg.Command) == "" {
		return nil, errors.New("bridge command is required")
	}

	cmd := shellCommand(context.Background(), cfg.Command)
	cmd.Dir = cfg.Cwd

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open stdin: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open stdout: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("open stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start app-server: %w", err)
	}

	client := &Client{
		handler: handler,
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		waiters: make(map[string]chan rpcMessage),
		closed:  make(chan struct{}),
	}

	go client.readStdout()
	go client.readStderr()
	go client.waitProcess()

	var initializeResult appserver.InitializeResponse
	if err := client.Call(ctx, "initialize", buildInitializeRequest(cfg), &initializeResult); err != nil {
		client.Close()
		return nil, err
	}

	if err := client.Notify("initialized", map[string]any{}); err != nil {
		client.Close()
		return nil, err
	}

	return client, nil
}

func buildInitializeRequest(cfg Config) appserver.InitializeRequest {
	request := appserver.InitializeRequest{
		ClientInfo: appserver.ClientInfo{
			Name:    cfg.ClientName,
			Version: cfg.ClientVersion,
		},
		Capabilities: appserver.InitializeCapabilities{
			ExperimentalAPI: cfg.ExperimentalAPI,
		},
	}

	if len(cfg.OptOutNotificationMethods) > 0 {
		request.Capabilities.OptOutNotificationMethods = append([]string(nil), cfg.OptOutNotificationMethods...)
	}

	return request
}

func (c *Client) Call(ctx context.Context, method string, params any, result any) error {
	requestID := c.nextID.Add(1)
	responseCh := make(chan rpcMessage, 1)
	waitKey := normalizeID(mustMarshalID(requestID))

	c.waitMu.Lock()
	c.waiters[waitKey] = responseCh
	c.waitMu.Unlock()

	if err := c.write(outboundRequest{
		JSONRPC: "2.0",
		ID:      requestID,
		Method:  method,
		Params:  params,
	}); err != nil {
		c.waitMu.Lock()
		delete(c.waiters, waitKey)
		c.waitMu.Unlock()
		return err
	}

	select {
	case <-ctx.Done():
		c.waitMu.Lock()
		delete(c.waiters, waitKey)
		c.waitMu.Unlock()
		return ctx.Err()
	case <-c.closed:
		return errors.New("app-server bridge closed")
	case response := <-responseCh:
		if response.Error != nil {
			return response.Error
		}

		if result == nil || len(response.Result) == 0 {
			return nil
		}

		if err := json.Unmarshal(response.Result, result); err != nil {
			return fmt.Errorf("decode %s response: %w", method, err)
		}

		return nil
	}
}

func (c *Client) Notify(method string, params any) error {
	return c.write(outboundNotification{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	})
}

func (c *Client) Respond(id json.RawMessage, result any) error {
	return c.write(outboundResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	})
}

func (c *Client) Close() {
	c.closeWithError(nil)
}

func (c *Client) write(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal json-rpc payload: %w", err)
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	select {
	case <-c.closed:
		return errors.New("app-server bridge closed")
	default:
	}

	if _, err := c.stdin.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write app-server payload: %w", err)
	}

	return nil
}

func (c *Client) readStdout() {
	scanner := bufio.NewScanner(c.stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), scannerMaxTokenSize)

	for scanner.Scan() {
		var message rpcMessage
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			continue
		}

		switch {
		case message.Method != "" && len(message.ID) > 0:
			c.handler.HandleRequest(message.ID, message.Method, message.Params)
		case message.Method != "":
			c.handler.HandleNotification(message.Method, message.Params)
		case len(message.ID) > 0:
			c.dispatchResponse(message)
		}
	}

	if err := scanner.Err(); err != nil {
		c.closeWithError(fmt.Errorf("read app-server stdout: %w", err))
		return
	}

	c.closeWithError(nil)
}

func (c *Client) readStderr() {
	scanner := bufio.NewScanner(c.stderr)
	scanner.Buffer(make([]byte, 0, 16*1024), scannerMaxTokenSize)

	for scanner.Scan() {
		c.handler.HandleStderr(scanner.Text())
	}
}

func (c *Client) waitProcess() {
	err := c.cmd.Wait()
	c.closeWithError(err)
}

func (c *Client) dispatchResponse(message rpcMessage) {
	key := normalizeID(message.ID)

	c.waitMu.Lock()
	waiter, ok := c.waiters[key]
	if ok {
		delete(c.waiters, key)
	}
	c.waitMu.Unlock()

	if ok {
		waiter <- message
		close(waiter)
	}
}

func (c *Client) closeWithError(err error) {
	c.closeOnce.Do(func() {
		close(c.closed)

		c.waitMu.Lock()
		for key, waiter := range c.waiters {
			delete(c.waiters, key)
			close(waiter)
		}
		c.waitMu.Unlock()

		_ = c.stdin.Close()
		if c.cmd != nil && c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
		}
		c.handler.HandleClosed(err)
	})
}

func shellCommand(ctx context.Context, command string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.CommandContext(ctx, "cmd.exe", "/C", command)
	}

	return exec.CommandContext(ctx, "sh", "-lc", command)
}

func mustMarshalID(id int64) json.RawMessage {
	data, _ := json.Marshal(id)
	return data
}

func normalizeID(id json.RawMessage) string {
	return strings.TrimSpace(string(id))
}
