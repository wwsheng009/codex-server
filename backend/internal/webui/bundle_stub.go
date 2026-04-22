//go:build !embed_frontend

package webui

import "io/fs"

func bundleStatus() Status {
	return Status{
		Mode:    ModeStub,
		Enabled: false,
		Reason:  ErrNotEnabled.Error(),
	}
}

func bundleFS() (fs.FS, error) {
	return nil, ErrNotEnabled
}
