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

func TestNew_S3Storage(t *testing.T) {
	setenv(t, "PUBLIRA_S3_BUCKET", "my-bucket")
	setenv(t, "AWS_REGION", "ap-northeast-1")
	setenv(t, "PUBLIRA_S3_FORCE_PATH_STYLE", "true")
	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
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
	setenv(t, "PUBLIRA_S3_BUCKET", "bucket")
	setenv(t, "PUBLIRA_S3_FORCE_PATH_STYLE", "not-bool")
	_, err := New()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestStorageValidate_MissingBucket(t *testing.T) {
	err := Storage{}.Validate()
	if err == nil || !strings.Contains(err.Error(), "PUBLIRA_S3_BUCKET") {
		t.Fatalf("err = %v, want PUBLIRA_S3_BUCKET error", err)
	}
}

func TestStorageValidate_Bucket(t *testing.T) {
	if err := (Storage{S3Bucket: "my-bucket"}).Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestNew_MissingEncryptionKeys(t *testing.T) {
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", "")
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "PUBLIRA_SECRET_ENCRYPTION_KEYS") {
		t.Fatalf("err = %v, want PUBLIRA_SECRET_ENCRYPTION_KEYS error", err)
	}
}

func TestNew_MissingPrimaryEncryptionKeyID(t *testing.T) {
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", "k1:"+testEncryptionKey)
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID") {
		t.Fatalf("err = %v, want PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID error", err)
	}
}

func TestNew_InvalidPrimaryEncryptionKeyID(t *testing.T) {
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", "k1:"+testEncryptionKey)
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k2")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID") {
		t.Fatalf("err = %v, want PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID error", err)
	}
}

func TestNew_InvalidEncryptionKeyLength(t *testing.T) {
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", "k1:Zm9v")
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")

	_, err := New()
	if err == nil || !strings.Contains(err.Error(), "invalid key length") {
		t.Fatalf("err = %v, want invalid key length", err)
	}
}

func TestNew_PushIsOffWithoutAnySetting(t *testing.T) {
	setenv(t, "PUBLIRA_FCM_PROJECT_ID", "")
	setenv(t, "PUBLIRA_FCM_CREDENTIALS_JSON", "")
	setenv(t, "GOOGLE_APPLICATION_CREDENTIALS", "")

	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if cfg.Push.Configured() {
		t.Fatal("Push.Configured() = true, want false")
	}
}

func TestNew_PushIsOnFromAnyOfItsSettings(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{
			// The metadata server of an instance with an attached service
			// account, and the well-known gcloud file, leave every credential
			// variable empty. Naming the project is what such a deployment can
			// still say, and the handler has to be registered for it.
			name:  "project id alone",
			key:   "PUBLIRA_FCM_PROJECT_ID",
			value: "publira-test",
		},
		{
			name:  "inline service account key",
			key:   "PUBLIRA_FCM_CREDENTIALS_JSON",
			value: `{"type":"service_account"}`,
		},
		{
			name:  "application default credentials path",
			key:   "GOOGLE_APPLICATION_CREDENTIALS",
			value: "/etc/publira/fcm.json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setenv(t, "PUBLIRA_FCM_PROJECT_ID", "")
			setenv(t, "PUBLIRA_FCM_CREDENTIALS_JSON", "")
			setenv(t, "GOOGLE_APPLICATION_CREDENTIALS", "")
			setenv(t, tt.key, tt.value)

			cfg, err := New()
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			if !cfg.Push.Configured() {
				t.Fatalf("Push.Configured() = false with %s set, want true", tt.key)
			}
		})
	}
}
