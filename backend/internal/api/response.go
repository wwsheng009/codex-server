package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type envelope struct {
	Data  any            `json:"data,omitempty"`
	Error *errorEnvelope `json:"error,omitempty"`
}

type errorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Data: data})
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	writeErrorDetails(w, status, code, message, nil)
}

func writeErrorDetails(w http.ResponseWriter, status int, code string, message string, details any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{
		Error: &errorEnvelope{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}

func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}

	defer r.Body.Close()

	err := json.NewDecoder(r.Body).Decode(target)
	if errors.Is(err, io.EOF) {
		return nil
	}

	return err
}
