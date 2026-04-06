package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fixedHTTPClientSource struct {
	client *http.Client
}

func (s fixedHTTPClientSource) Client(time.Duration) *http.Client {
	if s.client == nil {
		return &http.Client{}
	}
	return s.client
}

func TestWeChatAuthServiceStartAndConfirmLogin(t *testing.T) {
	t.Parallel()

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			if got := r.URL.Query().Get("bot_type"); got != "3" {
				t.Fatalf("expected bot_type=3, got %q", got)
			}
			if got := r.Header.Get("iLink-App-Id"); got != wechatAppIDHeader {
				t.Fatalf("expected iLink-App-Id %q, got %q", wechatAppIDHeader, got)
			}
			if got := r.Header.Get("iLink-App-ClientVersion"); got != wechatClientVersionHeader {
				t.Fatalf("expected client version header %q, got %q", wechatClientVersionHeader, got)
			}
			assertValidWeChatUINHeader(t, r.Header)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "qr-code-1",
				"qrcode_img_content": "weixin://qr/abc-123",
			})
		case "/ilink/bot/get_qrcode_status":
			if got := r.URL.Query().Get("qrcode"); got != "qr-code-1" {
				t.Fatalf("expected qrcode query to use qr-code-1, got %q", got)
			}
			if got := r.Header.Get("iLink-App-Id"); got != wechatAppIDHeader {
				t.Fatalf("expected iLink-App-Id %q, got %q", wechatAppIDHeader, got)
			}
			if got := r.Header.Get("iLink-App-ClientVersion"); got != wechatClientVersionHeader {
				t.Fatalf("expected client version header %q, got %q", wechatClientVersionHeader, got)
			}
			assertValidWeChatUINHeader(t, r.Header)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":           0,
				"errcode":       0,
				"errmsg":        "",
				"status":        wechatLoginStatusConfirmed,
				"bot_token":     "wechat-token-confirmed",
				"ilink_bot_id":  "wechat-account-7",
				"baseurl":       server.URL,
				"ilink_user_id": "wechat-owner-9",
			})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newWeChatAuthService(staticHTTPClientSource{client: server.Client()})

	started, err := service.StartLogin(context.Background(), "ws_1", server.URL)
	if err != nil {
		t.Fatalf("StartLogin() error = %v", err)
	}
	if started.Status != wechatLoginStatusWait {
		t.Fatalf("expected wait status after start, got %#v", started)
	}
	if started.LoginID == "" || started.QRCodeContent != "weixin://qr/abc-123" {
		t.Fatalf("expected login id and qrcode content, got %#v", started)
	}

	status, err := service.GetLoginStatus(context.Background(), "ws_1", started.LoginID)
	if err != nil {
		t.Fatalf("GetLoginStatus() error = %v", err)
	}
	if status.Status != wechatLoginStatusConfirmed {
		t.Fatalf("expected confirmed status, got %#v", status)
	}
	if !status.CredentialReady {
		t.Fatalf("expected credentialReady=true, got %#v", status)
	}
	if status.BotToken != "wechat-token-confirmed" || status.AccountID != "wechat-account-7" || status.UserID != "wechat-owner-9" {
		t.Fatalf("expected confirmed credentials in status, got %#v", status)
	}
	if status.BaseURL != server.URL {
		t.Fatalf("expected confirmed base url %q, got %#v", server.URL, status)
	}
}

func TestWeChatAuthServiceFollowsRedirectHostUntilConfirmed(t *testing.T) {
	t.Parallel()

	redirectStatusCalls := 0
	var redirectServer *httptest.Server
	redirectServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/get_qrcode_status" {
			t.Fatalf("unexpected redirect polling path %s", r.URL.Path)
		}
		redirectStatusCalls++
		if got := r.URL.Query().Get("qrcode"); got != "qr-redirect-1" {
			t.Fatalf("expected redirected qrcode qr-redirect-1, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":           0,
			"errcode":       0,
			"errmsg":        "",
			"status":        wechatLoginStatusConfirmed,
			"bot_token":     "wechat-token-redirected",
			"ilink_bot_id":  "wechat-account-redirected",
			"baseurl":       redirectServer.URL,
			"ilink_user_id": "wechat-owner-redirected",
		})
	}))
	defer redirectServer.Close()

	mainStatusCalls := 0
	mainServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "qr-redirect-1",
				"qrcode_img_content": "weixin://qr/redirect-1",
			})
		case "/ilink/bot/get_qrcode_status":
			mainStatusCalls++
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":           0,
				"errcode":       0,
				"errmsg":        "",
				"status":        wechatLoginStatusRedirecting,
				"redirect_host": strings.TrimPrefix(redirectServer.URL, "http://"),
			})
		default:
			t.Fatalf("unexpected main polling path %s", r.URL.Path)
		}
	}))
	defer mainServer.Close()

	service := newWeChatAuthService(staticHTTPClientSource{client: mainServer.Client()})

	started, err := service.StartLogin(context.Background(), "ws_redirect", mainServer.URL)
	if err != nil {
		t.Fatalf("StartLogin() error = %v", err)
	}

	firstStatus, err := service.GetLoginStatus(context.Background(), "ws_redirect", started.LoginID)
	if err != nil {
		t.Fatalf("GetLoginStatus() first poll error = %v", err)
	}
	if firstStatus.Status != wechatLoginStatusScanned {
		t.Fatalf("expected first redirect poll to be normalized as scanned, got %#v", firstStatus)
	}

	secondStatus, err := service.GetLoginStatus(context.Background(), "ws_redirect", started.LoginID)
	if err != nil {
		t.Fatalf("GetLoginStatus() second poll error = %v", err)
	}
	if secondStatus.Status != wechatLoginStatusConfirmed || !secondStatus.CredentialReady {
		t.Fatalf("expected redirected poll to confirm credentials, got %#v", secondStatus)
	}
	if secondStatus.BotToken != "wechat-token-redirected" || secondStatus.AccountID != "wechat-account-redirected" || secondStatus.UserID != "wechat-owner-redirected" {
		t.Fatalf("expected redirected credentials in final status, got %#v", secondStatus)
	}
	if mainStatusCalls != 1 {
		t.Fatalf("expected main server to be polled once before redirect, got %d", mainStatusCalls)
	}
	if redirectStatusCalls != 1 {
		t.Fatalf("expected redirect server to be polled once after redirect, got %d", redirectStatusCalls)
	}
}

func TestWeChatAuthServiceRefreshesExpiredQRCode(t *testing.T) {
	t.Parallel()

	qrFetchCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			qrFetchCount++
			if qrFetchCount == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ret":                0,
					"errcode":            0,
					"errmsg":             "",
					"qrcode":             "qr-expired-1",
					"qrcode_img_content": "weixin://qr/expired-1",
				})
				return
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "qr-expired-2",
				"qrcode_img_content": "weixin://qr/expired-2",
			})
		case "/ilink/bot/get_qrcode_status":
			if got := r.URL.Query().Get("qrcode"); got != "qr-expired-1" {
				t.Fatalf("expected first expired poll to use qr-expired-1, got %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
				"status":  wechatLoginStatusExpired,
			})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newWeChatAuthService(staticHTTPClientSource{client: server.Client()})

	started, err := service.StartLogin(context.Background(), "ws_expired", server.URL)
	if err != nil {
		t.Fatalf("StartLogin() error = %v", err)
	}

	status, err := service.GetLoginStatus(context.Background(), "ws_expired", started.LoginID)
	if err != nil {
		t.Fatalf("GetLoginStatus() error = %v", err)
	}
	if status.Status != wechatLoginStatusWait {
		t.Fatalf("expected expired qrcode to refresh back to wait, got %#v", status)
	}
	if status.QRCodeContent != "weixin://qr/expired-2" {
		t.Fatalf("expected refreshed qrcode content weixin://qr/expired-2, got %#v", status)
	}
	if qrFetchCount != 2 {
		t.Fatalf("expected qrcode to be fetched twice after refresh, got %d", qrFetchCount)
	}
}

func TestWeChatAuthServiceTreatsPollingTimeoutAsWait(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "qr-timeout-1",
				"qrcode_img_content": "weixin://qr/timeout-1",
			})
		case "/ilink/bot/get_qrcode_status":
			time.Sleep(100 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
				"status":  wechatLoginStatusWait,
			})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newWeChatAuthService(fixedHTTPClientSource{
		client: &http.Client{
			Timeout:   20 * time.Millisecond,
			Transport: server.Client().Transport,
		},
	})

	started, err := service.StartLogin(context.Background(), "ws_timeout", server.URL)
	if err != nil {
		t.Fatalf("StartLogin() error = %v", err)
	}

	status, err := service.GetLoginStatus(context.Background(), "ws_timeout", started.LoginID)
	if err != nil {
		t.Fatalf("GetLoginStatus() error = %v", err)
	}
	if status.Status != wechatLoginStatusWait {
		t.Fatalf("expected timeout to be reported as wait, got %#v", status)
	}
	if status.CredentialReady {
		t.Fatalf("expected no credentials after timeout wait, got %#v", status)
	}
}

func TestWeChatAuthServiceDeleteLogin(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":                0,
			"errcode":            0,
			"errmsg":             "",
			"qrcode":             "qr-delete-1",
			"qrcode_img_content": "weixin://qr/delete-1",
		})
	}))
	defer server.Close()

	service := newWeChatAuthService(staticHTTPClientSource{client: server.Client()})

	started, err := service.StartLogin(context.Background(), "ws_delete", server.URL)
	if err != nil {
		t.Fatalf("StartLogin() error = %v", err)
	}

	if err := service.DeleteLogin("ws_delete", started.LoginID); err != nil {
		t.Fatalf("DeleteLogin() error = %v", err)
	}

	_, err = service.GetLoginStatus(context.Background(), "ws_delete", started.LoginID)
	if !errors.Is(err, ErrWeChatLoginNotFound) {
		t.Fatalf("expected ErrWeChatLoginNotFound after delete, got %v", err)
	}
}

func TestWeChatAuthServiceRejectsInvalidBaseURL(t *testing.T) {
	t.Parallel()

	service := newWeChatAuthService(staticHTTPClientSource{})
	_, err := service.StartLogin(context.Background(), "ws_invalid", " /relative ")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for invalid base url, got %v", err)
	}
	if !strings.Contains(err.Error(), "base url") {
		t.Fatalf("expected invalid base url detail, got %v", err)
	}
}
