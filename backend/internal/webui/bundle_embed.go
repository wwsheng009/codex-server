//go:build embed_frontend

package webui

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed dist
var embeddedFiles embed.FS

type embeddedAssetState struct {
	fs  fs.FS
	err error
}

var embeddedAssets = func() embeddedAssetState {
	subFS, err := fs.Sub(embeddedFiles, "dist")
	return embeddedAssetState{
		fs:  subFS,
		err: err,
	}
}()

func bundleStatus() Status {
	if embeddedAssets.err != nil {
		return Status{
			Mode:    ModeEmbedded,
			Enabled: false,
			Reason:  fmt.Sprintf("webui embedded assets are unavailable: %v", embeddedAssets.err),
		}
	}

	if _, err := fs.Stat(embeddedAssets.fs, "index.html"); err != nil {
		return Status{
			Mode:    ModeEmbedded,
			Enabled: false,
			Reason:  "webui embedded assets are unavailable: missing dist/index.html",
		}
	}

	return Status{
		Mode:    ModeEmbedded,
		Enabled: true,
	}
}

func bundleFS() (fs.FS, error) {
	if embeddedAssets.err != nil {
		return nil, embeddedAssets.err
	}
	return embeddedAssets.fs, nil
}
