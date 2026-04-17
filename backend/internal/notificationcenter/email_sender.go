package notificationcenter

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"os"
	"strconv"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	emailSMTPHostEnv            = "CODEX_SERVER_NOTIFICATION_EMAIL_SMTP_HOST"
	emailSMTPPortEnv            = "CODEX_SERVER_NOTIFICATION_EMAIL_SMTP_PORT"
	emailSMTPUsernameEnv        = "CODEX_SERVER_NOTIFICATION_EMAIL_SMTP_USERNAME"
	emailSMTPPasswordEnv        = "CODEX_SERVER_NOTIFICATION_EMAIL_SMTP_PASSWORD"
	emailSMTPFromEnv            = "CODEX_SERVER_NOTIFICATION_EMAIL_FROM"
	emailSMTPRequireTLSEnv      = "CODEX_SERVER_NOTIFICATION_EMAIL_REQUIRE_TLS"
	emailSMTPSkipVerifyTLSEnv   = "CODEX_SERVER_NOTIFICATION_EMAIL_SKIP_VERIFY"
	defaultNotificationSMTPPort = 587
)

type smtpEmailSender struct {
	host       string
	addr       string
	from       string
	username   string
	password   string
	requireTLS bool
	skipVerify bool
	logger     *slog.Logger
}

type workspaceEmailSender struct {
	store    *store.MemoryStore
	fallback EmailSender
	logger   *slog.Logger
}

func NewEmailSender(dataStore *store.MemoryStore, logger *slog.Logger) EmailSender {
	return &workspaceEmailSender{
		store:    dataStore,
		fallback: newEnvSMTPEmailSender(logger),
		logger:   logger,
	}
}

func newEnvSMTPEmailSender(logger *slog.Logger) EmailSender {
	host := strings.TrimSpace(os.Getenv(emailSMTPHostEnv))
	from := strings.TrimSpace(os.Getenv(emailSMTPFromEnv))
	if host == "" || from == "" {
		return nil
	}

	port := defaultNotificationSMTPPort
	if rawPort := strings.TrimSpace(os.Getenv(emailSMTPPortEnv)); rawPort != "" {
		if parsed, err := strconv.Atoi(rawPort); err == nil && parsed > 0 {
			port = parsed
		}
	}

	requireTLS := true
	if value := strings.TrimSpace(os.Getenv(emailSMTPRequireTLSEnv)); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			requireTLS = parsed
		}
	}

	skipVerify := false
	if value := strings.TrimSpace(os.Getenv(emailSMTPSkipVerifyTLSEnv)); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			skipVerify = parsed
		}
	}

	return &smtpEmailSender{
		host:       host,
		addr:       net.JoinHostPort(host, strconv.Itoa(port)),
		from:       from,
		username:   strings.TrimSpace(os.Getenv(emailSMTPUsernameEnv)),
		password:   os.Getenv(emailSMTPPasswordEnv),
		requireTLS: requireTLS,
		skipVerify: skipVerify,
		logger:     logger,
	}
}

func newSMTPEmailSenderFromConfig(
	config store.NotificationMailServerConfig,
	logger *slog.Logger,
) (*smtpEmailSender, error) {
	host := strings.TrimSpace(config.Host)
	from := strings.TrimSpace(config.From)
	if host == "" || from == "" {
		return nil, ErrEmailDeliveryUnavailable
	}

	port := config.Port
	if port <= 0 {
		port = defaultNotificationSMTPPort
	}

	return &smtpEmailSender{
		host:       host,
		addr:       net.JoinHostPort(host, strconv.Itoa(port)),
		from:       from,
		username:   strings.TrimSpace(config.Username),
		password:   config.Password,
		requireTLS: config.RequireTLS,
		skipVerify: config.SkipVerify,
		logger:     logger,
	}, nil
}

func (s *workspaceEmailSender) Send(ctx context.Context, message EmailMessage) error {
	if s != nil && s.store != nil {
		if config, ok := s.store.GetNotificationMailServerConfig(strings.TrimSpace(message.WorkspaceID)); ok && config.Enabled {
			sender, err := newSMTPEmailSenderFromConfig(config, s.logger)
			if err != nil {
				return err
			}
			return sender.Send(ctx, message)
		}
	}
	if s != nil && s.fallback != nil {
		return s.fallback.Send(ctx, message)
	}
	return ErrEmailDeliveryUnavailable
}

func (s *smtpEmailSender) Send(ctx context.Context, message EmailMessage) error {
	if s == nil {
		return ErrEmailDeliveryUnavailable
	}
	if len(message.To) == 0 {
		return fmt.Errorf("%w: empty email recipient list", ErrInvalidInput)
	}

	subject := sanitizeHeaderValue(message.Subject)
	body := normalizeEmailBody(message.Body)
	if body == "" {
		return fmt.Errorf("%w: empty email body", ErrInvalidInput)
	}

	client, err := smtp.Dial(s.addr)
	if err != nil {
		return err
	}
	defer client.Close()

	if ctx != nil {
		done := make(chan struct{})
		defer close(done)
		go func() {
			select {
			case <-ctx.Done():
				_ = client.Close()
			case <-done:
			}
		}()
	}

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{
			ServerName:         s.host,
			InsecureSkipVerify: s.skipVerify,
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	} else if s.requireTLS {
		return fmt.Errorf("%w: smtp server does not support STARTTLS", ErrEmailDeliveryUnavailable)
	}

	if s.username != "" {
		auth := smtp.PlainAuth("", s.username, s.password, s.host)
		if err := client.Auth(auth); err != nil {
			return err
		}
	}

	if err := client.Mail(s.from); err != nil {
		return err
	}
	for _, recipient := range message.To {
		trimmed := strings.TrimSpace(recipient)
		if trimmed == "" {
			continue
		}
		if err := client.Rcpt(trimmed); err != nil {
			return err
		}
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}

	payload := buildSMTPMessage(s.from, message.To, subject, body)
	if _, err := writer.Write([]byte(payload)); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if err := client.Quit(); err != nil {
		return err
	}

	if s.logger != nil {
		s.logger.Info(
			"notification email delivered",
			"workspaceId",
			strings.TrimSpace(message.WorkspaceID),
			"targetId",
			strings.TrimSpace(message.TargetID),
			"recipientCount",
			len(message.To),
			"subject",
			subject,
		)
	}
	return nil
}

func buildSMTPMessage(from string, to []string, subject string, body string) string {
	headers := []string{
		"From: " + sanitizeHeaderValue(from),
		"To: " + sanitizeHeaderValue(strings.Join(to, ", ")),
		"Subject: " + sanitizeHeaderValue(subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
	}
	return strings.Join(headers, "\r\n") + "\r\n\r\n" + normalizeEmailBody(body)
}

func sanitizeHeaderValue(value string) string {
	cleaned := strings.TrimSpace(value)
	cleaned = strings.ReplaceAll(cleaned, "\r", " ")
	cleaned = strings.ReplaceAll(cleaned, "\n", " ")
	return cleaned
}

func normalizeEmailBody(value string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if trimmed == "" {
		return ""
	}
	return strings.ReplaceAll(trimmed, "\n", "\r\n")
}
