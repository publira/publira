package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const defaultDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"

type Config struct {
	DB         DB
	Storage    Storage
	Encryption Encryption
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

type Encryption struct {
	PrimaryKeyID string
	Keys         map[string][]byte
}

func New() (*Config, error) {
	storageCfg, err := parseStorage()
	if err != nil {
		return nil, err
	}
	encryptionCfg, err := parseEncryption()
	if err != nil {
		return nil, err
	}
	return &Config{
		DB:         parseDB(),
		Storage:    storageCfg,
		Encryption: encryptionCfg,
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

func parseEncryption() (Encryption, error) {
	rawKeys := strings.TrimSpace(os.Getenv("SECRET_ENCRYPTION_KEYS"))
	primaryKeyID := strings.TrimSpace(os.Getenv("SECRET_ENCRYPTION_PRIMARY_KEY_ID"))

	if rawKeys == "" && primaryKeyID == "" {
		return Encryption{}, nil
	}
	if rawKeys == "" {
		return Encryption{}, fmt.Errorf("SECRET_ENCRYPTION_KEYS is required when SECRET_ENCRYPTION_PRIMARY_KEY_ID is set")
	}
	if primaryKeyID == "" {
		return Encryption{}, fmt.Errorf("SECRET_ENCRYPTION_PRIMARY_KEY_ID is required when SECRET_ENCRYPTION_KEYS is set")
	}

	keys := make(map[string][]byte)
	entries := strings.Split(rawKeys, ",")
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		parts := strings.SplitN(entry, ":", 2)
		if len(parts) != 2 {
			return Encryption{}, fmt.Errorf("invalid SECRET_ENCRYPTION_KEYS entry: %q", entry)
		}

		keyID := strings.TrimSpace(parts[0])
		encodedKey := strings.TrimSpace(parts[1])
		if keyID == "" || encodedKey == "" {
			return Encryption{}, fmt.Errorf("invalid SECRET_ENCRYPTION_KEYS entry: %q", entry)
		}

		decodedKey, err := base64.RawURLEncoding.DecodeString(encodedKey)
		if err != nil {
			decodedKey, err = base64.StdEncoding.DecodeString(encodedKey)
			if err != nil {
				return Encryption{}, fmt.Errorf("invalid base64 key for %q", keyID)
			}
		}

		keyLen := len(decodedKey)
		if keyLen != 16 && keyLen != 24 && keyLen != 32 {
			return Encryption{}, fmt.Errorf("invalid key length for %q: %d", keyID, keyLen)
		}
		keys[keyID] = decodedKey
	}

	if len(keys) == 0 {
		return Encryption{}, fmt.Errorf("SECRET_ENCRYPTION_KEYS is required")
	}
	if _, ok := keys[primaryKeyID]; !ok {
		return Encryption{}, fmt.Errorf("SECRET_ENCRYPTION_PRIMARY_KEY_ID %q is not present in SECRET_ENCRYPTION_KEYS", primaryKeyID)
	}

	return Encryption{
		PrimaryKeyID: primaryKeyID,
		Keys:         keys,
	}, nil
}
