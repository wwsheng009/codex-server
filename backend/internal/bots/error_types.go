package bots

import (
	"errors"
	"strings"
)

type aiBackendExecutionError struct {
	backend string
	cause   error
}

func (e *aiBackendExecutionError) Error() string {
	if e == nil {
		return ""
	}

	label := formatFailureLabel(e.backend)
	switch {
	case e.cause == nil && label == "":
		return "AI backend execution failed"
	case e.cause == nil:
		return label + " AI backend execution failed"
	case label == "":
		return "AI backend execution failed: " + e.cause.Error()
	default:
		return label + " AI backend execution failed: " + e.cause.Error()
	}
}

func (e *aiBackendExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type workspaceTurnTerminalError struct {
	Backend  string
	ThreadID string
	TurnID   string
	Status   string
	Detail   string
}

func (e *workspaceTurnTerminalError) Error() string {
	if e == nil {
		return ""
	}

	status := strings.TrimSpace(e.Status)
	detail := strings.TrimSpace(e.Detail)
	switch {
	case status == "" && detail == "":
		return "workspace turn failed without a final status"
	case status == "":
		return "workspace turn failed: " + detail
	case detail == "":
		return "workspace turn ended with status " + status
	default:
		return "workspace turn failed with status " + status + ": " + detail
	}
}

type botVisibleReplyMissingError struct {
	Backend  string
	ThreadID string
	TurnID   string
}

func (e *botVisibleReplyMissingError) Error() string {
	if e == nil {
		return ""
	}

	label := formatFailureLabel(e.Backend)
	if label == "" {
		return "AI backend returned no bot-visible reply"
	}
	return label + " AI backend returned no bot-visible reply"
}

func wrapAIBackendError(backend string, err error) error {
	if err == nil {
		return nil
	}

	var backendErr *aiBackendExecutionError
	if errors.As(err, &backendErr) {
		return err
	}

	var turnErr *workspaceTurnTerminalError
	if errors.As(err, &turnErr) {
		return err
	}

	var noReplyErr *botVisibleReplyMissingError
	if errors.As(err, &noReplyErr) {
		return err
	}

	return &aiBackendExecutionError{
		backend: strings.TrimSpace(backend),
		cause:   err,
	}
}

func formatFailureLabel(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	replacer := strings.NewReplacer("_", " ", "-", " ")
	normalized := strings.Join(strings.Fields(replacer.Replace(trimmed)), " ")
	if normalized == "" {
		return ""
	}

	words := strings.Fields(normalized)
	for index, word := range words {
		switch strings.ToLower(word) {
		case "ai":
			words[index] = "AI"
		case "api":
			words[index] = "API"
		case "openai":
			words[index] = "OpenAI"
		case "telegram":
			words[index] = "Telegram"
		case "wechat":
			words[index] = "WeChat"
		default:
			words[index] = strings.ToLower(word)
		}
	}

	return strings.Join(words, " ")
}
