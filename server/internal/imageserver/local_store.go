package imageserver

import (
	"context"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

type LocalStore struct {
	rootDir string
}

func NewLocalStore(rootDir string) (*LocalStore, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, fmt.Errorf("create local storage dir: %w", err)
	}
	return &LocalStore{rootDir: rootDir}, nil
}

func (s *LocalStore) GetObject(_ context.Context, key string) (ObjectResult, error) {
	relPath := strings.TrimLeft(strings.TrimSpace(key), "/")
	if relPath == "" {
		return ObjectResult{}, ErrObjectNotFound
	}

	fullPath := filepath.Join(s.rootDir, filepath.FromSlash(relPath))
	cleanRoot := filepath.Clean(s.rootDir)
	cleanPath := filepath.Clean(fullPath)
	if cleanPath != cleanRoot && !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) {
		return ObjectResult{}, ErrObjectNotFound
	}

	file, err := os.Open(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return ObjectResult{}, ErrObjectNotFound
		}
		return ObjectResult{}, fmt.Errorf("open local object: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return ObjectResult{}, fmt.Errorf("stat local object: %w", err)
	}

	contentType := mime.TypeByExtension(filepath.Ext(cleanPath))
	return ObjectResult{
		Body:          file,
		ContentType:   contentType,
		ContentLength: info.Size(),
	}, nil
}
