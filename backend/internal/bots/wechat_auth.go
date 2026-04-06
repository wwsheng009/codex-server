package bots

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"
)

const (
	wechatLoginStatusWait      = "wait"
	wechatLoginStatusScanned   = "scaned"
	wechatLoginStatusConfirmed = "confirmed"
	wechatLoginStatusExpired   = "expired"
	wechatLoginSessionTTL      = 8 * time.Minute
	wechatLoginHTTPTimeout     = 40 * time.Second
	wechatLoginBotType         = 3
)

var ErrWeChatLoginNotFound = errors.New("wechat login session was not found")

type StartWeChatLoginInput struct {
	BaseURL string `json:"baseUrl"`
}

type WeChatLoginView struct {
	LoginID         string    `json:"loginId"`
	Status          string    `json:"status"`
	BaseURL         string    `json:"baseUrl,omitempty"`
	QRCodeContent   string    `json:"qrCodeContent,omitempty"`
	AccountID       string    `json:"accountId,omitempty"`
	UserID          string    `json:"userId,omitempty"`
	BotToken        string    `json:"botToken,omitempty"`
	CredentialReady bool      `json:"credentialReady"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	ExpiresAt       time.Time `json:"expiresAt,omitempty"`
}

type wechatQRCodeResponse struct {
	wechatAPIResponse
	QRCode          string `json:"qrcode"`
	QRCodeImg       string `json:"qrcode_img_content"`
	QRCodeImgString string `json:"qrcode_img_string"`
}

type wechatQRCodeStatusResponse struct {
	wechatAPIResponse
	Status    string `json:"status"`
	BotToken  string `json:"bot_token"`
	AccountID string `json:"ilink_bot_id"`
	BaseURL   string `json:"baseurl"`
	OwnerUser string `json:"ilink_user_id"`
	QRCode    string `json:"qrcode"`
}

type wechatLoginSession struct {
	id            string
	workspaceID   string
	baseURL       string
	qrCode        string
	qrCodeContent string
	status        string
	accountID     string
	userID        string
	botToken      string
	createdAt     time.Time
	updatedAt     time.Time
	expiresAt     time.Time
}

type wechatAuthService struct {
	clients httpClientSource
	now     func() time.Time

	mu       sync.Mutex
	sessions map[string]wechatLoginSession
}

func newWeChatAuthService(clients httpClientSource) *wechatAuthService {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}
	return &wechatAuthService{
		clients:  clients,
		now:      func() time.Time { return time.Now().UTC() },
		sessions: make(map[string]wechatLoginSession),
	}
}

func (s *wechatAuthService) StartLogin(ctx context.Context, workspaceID string, baseURL string) (WeChatLoginView, error) {
	if strings.TrimSpace(workspaceID) == "" {
		return WeChatLoginView{}, store.ErrWorkspaceNotFound
	}
	parsedBaseURL, err := parseWeChatBaseURL(baseURL)
	if err != nil {
		return WeChatLoginView{}, err
	}

	qrCode, qrCodeContent, err := s.fetchQRCode(ctx, parsedBaseURL.String())
	if err != nil {
		return WeChatLoginView{}, err
	}

	now := s.now()
	session := wechatLoginSession{
		id:            randomWeChatLoginID(),
		workspaceID:   strings.TrimSpace(workspaceID),
		baseURL:       parsedBaseURL.String(),
		qrCode:        qrCode,
		qrCodeContent: qrCodeContent,
		status:        wechatLoginStatusWait,
		createdAt:     now,
		updatedAt:     now,
		expiresAt:     now.Add(wechatLoginSessionTTL),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)
	s.sessions[session.id] = session
	return session.view(), nil
}

func (s *wechatAuthService) GetLoginStatus(ctx context.Context, workspaceID string, loginID string) (WeChatLoginView, error) {
	s.mu.Lock()
	now := s.now()
	session, ok := s.sessions[strings.TrimSpace(loginID)]
	if !ok || session.workspaceID != strings.TrimSpace(workspaceID) {
		s.mu.Unlock()
		return WeChatLoginView{}, ErrWeChatLoginNotFound
	}
	if now.After(session.expiresAt) {
		session.status = wechatLoginStatusExpired
		session.updatedAt = now
		s.sessions[session.id] = session
		s.mu.Unlock()
		return session.view(), nil
	}
	if session.status == wechatLoginStatusConfirmed || session.status == wechatLoginStatusExpired {
		s.mu.Unlock()
		return session.view(), nil
	}
	s.mu.Unlock()

	status, err := s.fetchQRCodeStatus(ctx, session.baseURL, session.qrCode)
	if err != nil {
		if isWeChatLoginPollTimeout(err) {
			return session.view(), nil
		}
		return WeChatLoginView{}, err
	}

	now = s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.sessions[session.id]
	if !ok || current.workspaceID != strings.TrimSpace(workspaceID) {
		return WeChatLoginView{}, ErrWeChatLoginNotFound
	}
	current.updatedAt = now

	switch normalizeWeChatLoginStatus(status.Status) {
	case wechatLoginStatusScanned:
		current.status = wechatLoginStatusScanned
	case wechatLoginStatusConfirmed:
		current.status = wechatLoginStatusConfirmed
		current.botToken = strings.TrimSpace(status.BotToken)
		current.accountID = strings.TrimSpace(status.AccountID)
		current.userID = strings.TrimSpace(status.OwnerUser)
		if parsedBaseURL, err := parseWeChatBaseURL(firstNonEmpty(strings.TrimSpace(status.BaseURL), current.baseURL)); err == nil {
			current.baseURL = parsedBaseURL.String()
		}
	case wechatLoginStatusExpired:
		current.status = wechatLoginStatusExpired
	default:
		if current.status == "" {
			current.status = wechatLoginStatusWait
		}
	}

	s.sessions[current.id] = current
	return current.view(), nil
}

func (s *wechatAuthService) DeleteLogin(workspaceID string, loginID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[strings.TrimSpace(loginID)]
	if !ok || session.workspaceID != strings.TrimSpace(workspaceID) {
		return ErrWeChatLoginNotFound
	}
	delete(s.sessions, session.id)
	return nil
}

func (s *wechatAuthService) fetchQRCode(ctx context.Context, baseURL string) (string, string, error) {
	endpoint, err := buildWeChatURL(baseURL, "/ilink/bot/get_bot_qrcode")
	if err != nil {
		return "", "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", fmt.Errorf("build wechat qrcode request: %w", err)
	}

	query := request.URL.Query()
	query.Set("bot_type", strconv.Itoa(wechatLoginBotType))
	request.URL.RawQuery = query.Encode()
	request.Header.Set("iLink-App-ClientVersion", wechatClientVersionHeader)

	response, err := s.client(wechatDefaultHTTPTimeout).Do(request)
	if err != nil {
		return "", "", &wechatRequestError{
			method: "/ilink/bot/get_bot_qrcode",
			cause:  err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return "", "", &wechatRequestError{
			method:      "/ilink/bot/get_bot_qrcode",
			statusCode:  response.StatusCode,
			status:      response.Status,
			description: strings.TrimSpace(string(content)),
		}
	}

	var payload wechatQRCodeResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", "", fmt.Errorf("decode wechat qrcode response: %w", err)
	}
	if payload.Ret != 0 || payload.ErrCode != 0 {
		return "", "", &wechatRequestError{
			method:      "/ilink/bot/get_bot_qrcode",
			statusCode:  payload.ErrCode,
			status:      "api error",
			description: firstNonEmpty(strings.TrimSpace(payload.ErrMsg), "wechat api request failed"),
		}
	}

	qrCode := strings.TrimSpace(payload.QRCode)
	qrCodeContent := firstNonEmpty(strings.TrimSpace(payload.QRCodeImg), strings.TrimSpace(payload.QRCodeImgString))
	if qrCode == "" || qrCodeContent == "" {
		return "", "", fmt.Errorf("%w: wechat qrcode response was incomplete", ErrInvalidInput)
	}
	return qrCode, qrCodeContent, nil
}

func (s *wechatAuthService) fetchQRCodeStatus(ctx context.Context, baseURL string, qrCode string) (wechatQRCodeStatusResponse, error) {
	endpoint, err := buildWeChatURL(baseURL, "/ilink/bot/get_qrcode_status")
	if err != nil {
		return wechatQRCodeStatusResponse{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return wechatQRCodeStatusResponse{}, fmt.Errorf("build wechat qrcode status request: %w", err)
	}

	query := request.URL.Query()
	query.Set("qrcode", strings.TrimSpace(qrCode))
	request.URL.RawQuery = query.Encode()
	request.Header.Set("iLink-App-ClientVersion", wechatClientVersionHeader)

	response, err := s.client(wechatLoginHTTPTimeout).Do(request)
	if err != nil {
		return wechatQRCodeStatusResponse{}, &wechatRequestError{
			method: "/ilink/bot/get_qrcode_status",
			cause:  err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return wechatQRCodeStatusResponse{}, &wechatRequestError{
			method:      "/ilink/bot/get_qrcode_status",
			statusCode:  response.StatusCode,
			status:      response.Status,
			description: strings.TrimSpace(string(content)),
		}
	}

	var payload wechatQRCodeStatusResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return wechatQRCodeStatusResponse{}, fmt.Errorf("decode wechat qrcode status response: %w", err)
	}
	if payload.Ret != 0 || payload.ErrCode != 0 {
		return wechatQRCodeStatusResponse{}, &wechatRequestError{
			method:      "/ilink/bot/get_qrcode_status",
			statusCode:  payload.ErrCode,
			status:      "api error",
			description: firstNonEmpty(strings.TrimSpace(payload.ErrMsg), "wechat api request failed"),
		}
	}
	return payload, nil
}

func (s *wechatAuthService) client(timeout time.Duration) *http.Client {
	if s.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}
	return s.clients.Client(timeout)
}

func (s *wechatAuthService) pruneExpiredLocked(now time.Time) {
	for id, session := range s.sessions {
		if now.After(session.expiresAt) {
			delete(s.sessions, id)
		}
	}
}

func (s wechatLoginSession) view() WeChatLoginView {
	status := normalizeWeChatLoginStatus(s.status)
	if status == "" {
		status = wechatLoginStatusWait
	}
	return WeChatLoginView{
		LoginID:         s.id,
		Status:          status,
		BaseURL:         strings.TrimSpace(s.baseURL),
		QRCodeContent:   strings.TrimSpace(s.qrCodeContent),
		AccountID:       strings.TrimSpace(s.accountID),
		UserID:          strings.TrimSpace(s.userID),
		BotToken:        strings.TrimSpace(s.botToken),
		CredentialReady: strings.TrimSpace(s.botToken) != "" && strings.TrimSpace(s.accountID) != "" && strings.TrimSpace(s.userID) != "",
		CreatedAt:       s.createdAt,
		UpdatedAt:       s.updatedAt,
		ExpiresAt:       s.expiresAt,
	}
}

func normalizeWeChatLoginStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", wechatLoginStatusWait:
		return wechatLoginStatusWait
	case wechatLoginStatusScanned:
		return wechatLoginStatusScanned
	case wechatLoginStatusConfirmed:
		return wechatLoginStatusConfirmed
	case wechatLoginStatusExpired:
		return wechatLoginStatusExpired
	default:
		return wechatLoginStatusWait
	}
}

func isWeChatLoginPollTimeout(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	var requestErr *wechatRequestError
	if errors.As(err, &requestErr) && requestErr != nil && requestErr.cause != nil {
		if errors.Is(requestErr.cause, context.Canceled) {
			return false
		}
		if errors.Is(requestErr.cause, context.DeadlineExceeded) {
			return true
		}
		var netErr net.Error
		if errors.As(requestErr.cause, &netErr) && netErr.Timeout() {
			return true
		}
	}

	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func randomWeChatLoginID() string {
	buffer := make([]byte, 10)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("wechat_login_%d", time.Now().UnixNano())
	}
	return "wechat_login_" + hex.EncodeToString(buffer)
}
