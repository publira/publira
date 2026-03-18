package local

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/publira/publira/server/internal/storage"
)

type Storage struct {
	rootDir string
	baseURL string
}

func New(rootDir, baseURL string) (*Storage, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, fmt.Errorf("create local storage dir: %w", err)
	}
	return &Storage{rootDir: rootDir, baseURL: strings.TrimRight(baseURL, "/")}, nil
}

func (s *Storage) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	relPath := filepath.FromSlash(strings.TrimLeft(req.ObjectKey, "/"))
	if relPath == "" {
		return storage.UploadResult{}, fmt.Errorf("object key is required")
	}
	fullPath := filepath.Join(s.rootDir, relPath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return storage.UploadResult{}, fmt.Errorf("create local storage subdir: %w", err)
	}
	if err := os.WriteFile(fullPath, req.Data, 0o644); err != nil {
		return storage.UploadResult{}, fmt.Errorf("write local object: %w", err)
	}
	url := "local://" + strings.TrimLeft(req.ObjectKey, "/")
	if s.baseURL != "" {
		url = s.baseURL + "/" + strings.TrimLeft(req.ObjectKey, "/")
	}
	return storage.UploadResult{
		Provider:  "local",
		ObjectKey: strings.TrimLeft(req.ObjectKey, "/"),
		URL:       url,
		SizeBytes: int64(len(req.Data)),
	}, nil
}
