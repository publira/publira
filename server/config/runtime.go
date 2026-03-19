package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const defaultDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"

type Config struct {
	DB      DB
	Storage Storage
}

type DB struct {
	URL string
}

type Storage struct {
	Backend          string
	LocalDir         string
	LocalBaseURL     string
	S3Bucket         string
	S3Region         string
	S3Endpoint       string
	S3PublicBaseURL  string
	S3ForcePathStyle bool
}

func New() (*Config, error) {
	storageCfg, err := parseStorage()
	if err != nil {
		return nil, err
	}
	return &Config{
		DB:      parseDB(),
		Storage: storageCfg,
	}, nil
}

func parseDB() DB {
	dbURL := strings.TrimSpace(os.Getenv("DB_URL"))
	if dbURL == "" {
		dbURL = defaultDBURL
	}
	return DB{URL: dbURL}
}

func parseStorage() (Storage, error) {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "local"
	}

	cfg := Storage{
		Backend:         backend,
		LocalDir:        strings.TrimSpace(os.Getenv("LOCAL_STORAGE_DIR")),
		LocalBaseURL:    strings.TrimSpace(os.Getenv("LOCAL_STORAGE_BASE_URL")),
		S3Bucket:        strings.TrimSpace(os.Getenv("S3_BUCKET")),
		S3Region:        strings.TrimSpace(os.Getenv("AWS_REGION")),
		S3Endpoint:      strings.TrimSpace(os.Getenv("S3_ENDPOINT")),
		S3PublicBaseURL: strings.TrimSpace(os.Getenv("S3_PUBLIC_BASE_URL")),
	}

	if cfg.LocalDir == "" {
		cfg.LocalDir = "/tmp/publira-storage"
	}

	if raw := strings.TrimSpace(os.Getenv("S3_FORCE_PATH_STYLE")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return Storage{}, fmt.Errorf("invalid S3_FORCE_PATH_STYLE: %w", err)
		}
		cfg.S3ForcePathStyle = parsed
	}

	return cfg, nil
}
