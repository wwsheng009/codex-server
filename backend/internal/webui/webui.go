package webui

import (
	"errors"
	"io/fs"
	"net/http"
)

var ErrNotEnabled = errors.New("webui embedded assets are not enabled; rebuild with -tags embed_frontend")

type Mode string

const (
	ModeStub     Mode = "stub"
	ModeEmbedded Mode = "embedded"
)

type Status struct {
	Mode    Mode
	Enabled bool
	Reason  string
}

type Options struct {
	HTMLCacheControl   string
	AssetCacheControl  string
	StaticCacheControl string
	StubStatusCode     int
}

func Enabled() bool {
	return CurrentStatus().Enabled
}

func CurrentStatus() Status {
	return bundleStatus()
}

func Handler() http.Handler {
	return NewHandler(Options{})
}

func NewHandler(opts Options) http.Handler {
	opts = opts.withDefaults()
	status := bundleStatus()
	assets, err := bundleFS()
	if err != nil {
		if status.Reason == "" {
			status.Reason = err.Error()
		}
		return &handler{
			options: opts,
			status:  status,
		}
	}

	indexHTML, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		status.Enabled = false
		status.Reason = "webui embedded assets are unavailable: missing dist/index.html"
		return &handler{
			options: opts,
			status:  status,
		}
	}

	return &handler{
		options:   opts,
		status:    status,
		assets:    assets,
		indexHTML: indexHTML,
	}
}

func (o Options) withDefaults() Options {
	if o.HTMLCacheControl == "" {
		o.HTMLCacheControl = "no-cache"
	}
	if o.AssetCacheControl == "" {
		o.AssetCacheControl = "public, max-age=31536000, immutable"
	}
	if o.StaticCacheControl == "" {
		o.StaticCacheControl = "public, max-age=3600"
	}
	if o.StubStatusCode == 0 {
		o.StubStatusCode = http.StatusNotImplemented
	}
	return o
}
