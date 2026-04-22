package webui

import (
	"bytes"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

type handler struct {
	options   Options
	status    Status
	assets    fs.FS
	indexHTML []byte
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}

	if !h.status.Enabled || h.assets == nil {
		h.serveStubResponse(w, r)
		return
	}

	name, shouldFallback := resolveAssetPath(r.URL.Path)
	content, err := fs.ReadFile(h.assets, name)
	if err != nil {
		if shouldFallback {
			name = "index.html"
			content = h.indexHTML
		} else {
			http.NotFound(w, r)
			return
		}
	}

	setStaticHeaders(w.Header(), name, h.options)
	http.ServeContent(w, r, path.Base(name), time.Time{}, bytes.NewReader(content))
}

func (h *handler) serveStubResponse(w http.ResponseWriter, r *http.Request) {
	reason := h.status.Reason
	if reason == "" {
		reason = ErrNotEnabled.Error()
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(h.options.StubStatusCode)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write([]byte(reason + "\n"))
}

func resolveAssetPath(requestPath string) (name string, shouldFallback bool) {
	cleaned := path.Clean("/" + requestPath)
	cleaned = strings.TrimPrefix(cleaned, "/")

	if cleaned == "" || cleaned == "." {
		return "index.html", false
	}

	if cleaned == "assets" || strings.HasPrefix(cleaned, "assets/") {
		return cleaned, false
	}

	if path.Ext(path.Base(cleaned)) != "" {
		return cleaned, false
	}

	return cleaned, true
}

func setStaticHeaders(header http.Header, name string, options Options) {
	header.Set("Cache-Control", cacheControlForPath(name, options))

	contentType := contentTypeForPath(name)
	if contentType != "" {
		header.Set("Content-Type", contentType)
	}
}

func cacheControlForPath(name string, options Options) string {
	if strings.EqualFold(path.Base(name), "index.html") {
		return options.HTMLCacheControl
	}
	if strings.HasPrefix(name, "assets/") {
		return options.AssetCacheControl
	}
	return options.StaticCacheControl
}

func contentTypeForPath(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json", ".map":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".wasm":
		return "application/wasm"
	}
	return mime.TypeByExtension(strings.ToLower(path.Ext(name)))
}
