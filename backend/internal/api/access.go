package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"codex-server/backend/internal/accesscontrol"
)

type originalRemoteAddrContextKey struct{}

func (s *Server) captureOriginalRemoteAddr(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), originalRemoteAddrContextKey{}, strings.TrimSpace(r.RemoteAddr))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireRemoteAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || s.accessControl == nil {
			next.ServeHTTP(w, r)
			return
		}

		decision := s.accessControl.EvaluateRemoteAccess(originalRemoteAddrFromRequest(r))
		if decision.Allowed {
			next.ServeHTTP(w, r)
			return
		}

		switch decision.Reason {
		case accesscontrol.RemoteAccessReasonRequiresActiveToken:
			writeError(
				w,
				http.StatusForbidden,
				"remote_access_requires_active_token",
				"remote access is blocked until an active access token is configured; use localhost to create one first",
			)
		default:
			writeError(
				w,
				http.StatusForbidden,
				"remote_access_disabled",
				"remote access is disabled; only localhost may access this server",
			)
		}
	})
}

func (s *Server) requireProtectedAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.accessControl == nil {
			next.ServeHTTP(w, r)
			return
		}

		err := s.accessControl.RequireAccess(r, originalRemoteAddrFromRequest(r))
		switch {
		case err == nil:
			next.ServeHTTP(w, r)
		case errors.Is(err, accesscontrol.ErrLoginRequired):
			writeError(w, http.StatusUnauthorized, "access_login_required", "access token login is required")
		case errors.Is(err, accesscontrol.ErrSessionInvalid):
			writeError(w, http.StatusUnauthorized, "access_session_invalid", "access session is invalid or expired")
		default:
			writeError(w, http.StatusUnauthorized, "access_session_invalid", "access session is invalid or expired")
		}
	})
}

func (s *Server) handleAccessBootstrap(w http.ResponseWriter, r *http.Request) {
	if s.accessControl == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"authenticated":                    true,
			"loginRequired":                    false,
			"allowRemoteAccess":                true,
			"allowLocalhostWithoutAccessToken": false,
			"configuredTokenCount":             0,
			"activeTokenCount":                 0,
		})
		return
	}

	writeJSON(w, http.StatusOK, s.accessControl.Bootstrap(r, originalRemoteAddrFromRequest(r)))
}

func (s *Server) handleAccessLogin(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Token string `json:"token"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if s.accessControl == nil {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"authenticated":                    true,
			"loginRequired":                    false,
			"allowRemoteAccess":                true,
			"allowLocalhostWithoutAccessToken": false,
			"configuredTokenCount":             0,
			"activeTokenCount":                 0,
		})
		return
	}

	result, err := s.accessControl.Login(w, r, originalRemoteAddrFromRequest(r), request.Token)
	switch {
	case err == nil:
		writeJSON(w, http.StatusAccepted, result)
	case errors.Is(err, accesscontrol.ErrAccessTokenRequired):
		writeError(w, http.StatusBadRequest, "access_token_required", err.Error())
	case errors.Is(err, accesscontrol.ErrAccessTokenInvalid):
		writeError(w, http.StatusUnauthorized, "access_token_invalid", "access token is invalid or expired")
	default:
		writeError(w, http.StatusUnauthorized, "access_token_invalid", "access token is invalid or expired")
	}
}

func (s *Server) handleAccessLogout(w http.ResponseWriter, r *http.Request) {
	if s.accessControl != nil {
		s.accessControl.Logout(w, r)
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func originalRemoteAddrFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}

	if value, ok := r.Context().Value(originalRemoteAddrContextKey{}).(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}

	return strings.TrimSpace(r.RemoteAddr)
}
