package webui

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func performRequest(t *testing.T, handler http.Handler, method string, target string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, target, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
