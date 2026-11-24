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

func TestNew_MalformedEncryptionKeysNeverQuoteAKey(t *testing.T) {
	const otherKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"
	const shortKey = "AwMDAwMDAwMDAwMDAwMDAwMDAwM"
	const aes128Key = "BAQEBAQEBAQEBAQEBAQEBA"
	const notBase64 = "c2VjcmV0!c2VjcmV0"

	tests := []struct {
		name    string
		keys    string
		want    string
		secrets []string
	}{
		{
			name:    "bare key",
			keys:    testEncryptionKey,
			want:    "entry 1 of PUBLIRA_SECRET_ENCRYPTION_KEYS is not in key-id:base64key form",
			secrets: []string{testEncryptionKey},
		},
		{
			name:    "bare key after a valid entry",
			keys:    "k1:" + testEncryptionKey + "," + otherKey,
			want:    "entry 2 of PUBLIRA_SECRET_ENCRYPTION_KEYS is not in key-id:base64key form",
			secrets: []string{testEncryptionKey, otherKey},
		},
		{
			name:    "empty key id",
			keys:    ":" + testEncryptionKey,
			want:    "entry 1 of PUBLIRA_SECRET_ENCRYPTION_KEYS has no key id",
			secrets: []string{testEncryptionKey},
		},
		{
			name:    "blank key id",
			keys:    "k1:" + otherKey + ",  :" + testEncryptionKey,
			want:    "entry 2 of PUBLIRA_SECRET_ENCRYPTION_KEYS has no key id",
			secrets: []string{testEncryptionKey, otherKey},
		},
		{
			name:    "key followed by a colon",
			keys:    testEncryptionKey + ":",
			want:    "entry 1 of PUBLIRA_SECRET_ENCRYPTION_KEYS has no key",
			secrets: []string{testEncryptionKey},
		},
		{
			name:    "key that is not base64",
			keys:    "k1:" + notBase64,
			want:    `invalid base64 key for "k1" in entry 1 of PUBLIRA_SECRET_ENCRYPTION_KEYS`,
			secrets: []string{notBase64},
		},
		{
			name:    "key of the wrong length",
			keys:    "k1:" + shortKey,
			want:    `invalid key length for "k1" in entry 1 of PUBLIRA_SECRET_ENCRYPTION_KEYS: 20`,
			secrets: []string{shortKey},
		},
		{
			name:    "duplicated key id",
			keys:    "k1:" + testEncryptionKey + ",k2:" + aes128Key + ",k1:" + otherKey,
			want:    `key id "k1" appears in both entry 1 and entry 3 of PUBLIRA_SECRET_ENCRYPTION_KEYS`,
			secrets: []string{testEncryptionKey, aes128Key, otherKey},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", tt.keys)
			setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")

			_, err := New()
			if err == nil {
				t.Fatal("New succeeded, want an error")
			}
			if err.Error() != tt.want {
				t.Fatalf("err = %q, want %q", err, tt.want)
			}
			for _, secret := range tt.secrets {
				// Any run of eight characters is enough to narrow a key down, so
				// no window of a key may appear in the error.
				for i := 0; i+8 <= len(secret); i++ {
					if window := secret[i : i+8]; strings.Contains(err.Error(), window) {
						t.Fatalf("err = %q contains %q from a configured key", err, window)
					}
				}
			}
		})
	}
}

func TestNew_EncryptionKeysSkipEmptyEntries(t *testing.T) {
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_KEYS", " ,k1:"+testEncryptionKey+",,k2:AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI, ")
	setenv(t, "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k2")

	cfg, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := len(cfg.Encryption.Keys); got != 2 {
		t.Fatalf("len(Keys) = %d, want 2", got)
	}
	if cfg.Encryption.PrimaryKeyID != "k2" {
		t.Fatalf("PrimaryKeyID = %q, want %q", cfg.Encryption.PrimaryKeyID, "k2")
	}
}
