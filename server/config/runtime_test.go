package config

import (
	"os"
	"strings"
	"testing"
)

const testEncryptionKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"

func setenv(t *testing.T, key, value string) {
	t.Helper()
	oldValue, existed := os.LookupEnv(key)
	if err := os.Setenv(key, value); err != nil {
		t.Fatalf("Setenv(%s): %v", key, err)
	}
	t.Cleanup(func() {
		var err error
		if existed {
			err = os.Setenv(key, oldValue)
		} else {
			err = os.Unsetenv(key)
		}
		if err != nil {
			t.Fatalf("restore env %s: %v", key, err)
		}
	})
}

func TestNew_DefaultDB(t *testing.T) {
	setenv(t, "PUBLIRA_DB_URL", "")
	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if cfg.DB.URL != defaultDBURL {
		t.Fatalf("DB.URL = %q, want %q", cfg.DB.URL, defaultDBURL)
	}
}

func TestNew_CustomDBURL(t *testing.T) {
	setenv(t, "PUBLIRA_DB_URL", "  postgres://example/db  ")
	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if cfg.DB.URL != "postgres://example/db" {
		t.Fatalf("DB.URL = %q, want %q", cfg.DB.URL, "postgres://example/db")
	}
}
func TestNew_DefaultLocalStorage(t *testing.T) {
	setenv(t, "STORAGE_BACKEND", "")
	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if cfg.Storage.Backend != "local" {
		t.Fatalf("Storage.Backend = %q, want local", cfg.Storage.Backend)
	}
	if cfg.Storage.LocalDir != "/tmp/publira-storage" {
		t.Fatalf("Storage.LocalDir = %q, want /tmp/publira-storage", cfg.Storage.LocalDir)
	}
}

func TestNew_S3Storage(t *testing.T) {
	setenv(t, "STORAGE_BACKEND", "s3")
	setenv(t, "S3_BUCKET", "my-bucket")
	setenv(t, "AWS_REGION", "ap-northeast-1")
	setenv(t, "S3_FORCE_PATH_STYLE", "true")
	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if cfg.Storage.Backend != "s3" {
		t.Fatalf("Storage.Backend = %q, want s3", cfg.Storage.Backend)
	}
	if cfg.Storage.S3Bucket != "my-bucket" {
		t.Fatalf("Storage.S3Bucket = %q, want my-bucket", cfg.Storage.S3Bucket)
	}
	if cfg.Storage.S3Region != "ap-northeast-1" {
		t.Fatalf("Storage.S3Region = %q, want ap-northeast-1", cfg.Storage.S3Region)
	}
	if !cfg.Storage.S3ForcePathStyle {
		t.Fatal("Storage.S3ForcePathStyle = false, want true")
	}
}

func TestNew_InvalidForcePathStyle(t *testing.T) {
	setenv(t, "STORAGE_BACKEND", "s3")
	setenv(t, "S3_BUCKET", "bucket")
	setenv(t, "S3_FORCE_PATH_STYLE", "not-bool")
	_, err := New()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestNew_MissingEncryptionKeys(t *testing.T) {
	setenv(t, "SECRET_ENCRYPTION_KEYS", "")
	setenv(t, "SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "SECRET_ENCRYPTION_KEYS") {
		t.Fatalf("err = %v, want SECRET_ENCRYPTION_KEYS error", err)
	}
}

func TestNew_MissingPrimaryEncryptionKeyID(t *testing.T) {
	setenv(t, "SECRET_ENCRYPTION_KEYS", "k1:"+testEncryptionKey)
	setenv(t, "SECRET_ENCRYPTION_PRIMARY_KEY_ID", "")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "SECRET_ENCRYPTION_PRIMARY_KEY_ID") {
		t.Fatalf("err = %v, want SECRET_ENCRYPTION_PRIMARY_KEY_ID error", err)
	}
}

func TestNew_InvalidPrimaryEncryptionKeyID(t *testing.T) {
	setenv(t, "SECRET_ENCRYPTION_KEYS", "k1:"+testEncryptionKey)
	setenv(t, "SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k2")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "SECRET_ENCRYPTION_PRIMARY_KEY_ID") {
		t.Fatalf("err = %v, want SECRET_ENCRYPTION_PRIMARY_KEY_ID error", err)
	}
}

func TestNew_InvalidEncryptionKeyLength(t *testing.T) {
	setenv(t, "SECRET_ENCRYPTION_KEYS", "k1:Zm9v")
	setenv(t, "SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "invalid key length") {
		t.Fatalf("err = %v, want invalid key length", err)
	}
}
