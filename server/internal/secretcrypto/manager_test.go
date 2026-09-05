package secretcrypto

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func fixedKey(seed byte) []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = seed
	}
	return key
}

func TestManagerEncryptDecrypt(t *testing.T) {
	mgr, err := NewManager(map[string][]byte{
		"k1": fixedKey(1),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	plaintext := "super-secret-value"
	ciphertext, err := mgr.EncryptString(plaintext)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if ciphertext == plaintext {
		t.Fatal("ciphertext must differ from plaintext")
	}
	if strings.Contains(ciphertext, plaintext) {
		t.Fatal("ciphertext must not include plaintext")
	}
	if !IsEncryptedEnvelope(ciphertext) {
		t.Fatal("ciphertext is not encrypted envelope")
	}

	decrypted, err := mgr.DecryptString(ciphertext)
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("DecryptString = %q, want %q", decrypted, plaintext)
	}
}

func TestManagerDecryptUnknownKey(t *testing.T) {
	encryptor, err := NewManager(map[string][]byte{
		"k1": fixedKey(1),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager(encryptor): %v", err)
	}

	decryptor, err := NewManager(map[string][]byte{
		"k2": fixedKey(2),
	}, "k2")
	if err != nil {
		t.Fatalf("NewManager(decryptor): %v", err)
	}

	ciphertext, err := encryptor.EncryptString("secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	_, err = decryptor.DecryptString(ciphertext)
	if err == nil {
		t.Fatal("DecryptString error = nil, want unknown key error")
	}
	if !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("DecryptString error = %v, want ErrUnknownKey", err)
	}
}

func TestManagerDecryptTamperedCiphertext(t *testing.T) {
	mgr, err := NewManager(map[string][]byte{
		"k1": fixedKey(1),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	ciphertext, err := mgr.EncryptString("secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	parts := strings.Split(ciphertext, ":")
	if len(parts) != 5 {
		t.Fatalf("ciphertext envelope parts = %d, want 5", len(parts))
	}

	rawCiphertext, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		t.Fatalf("DecodeString: %v", err)
	}
	if len(rawCiphertext) == 0 {
		t.Fatal("raw ciphertext must not be empty")
	}

	// Flip a bit to ensure ciphertext authentication fails deterministically.
	rawCiphertext[0] ^= 0x01
	parts[4] = base64.RawURLEncoding.EncodeToString(rawCiphertext)
	tampered := strings.Join(parts, ":")

	_, err = mgr.DecryptString(tampered)
	if err == nil {
		t.Fatal("DecryptString error = nil, want decrypt failed")
	}
	if !errors.Is(err, ErrDecryptFailed) && !errors.Is(err, ErrInvalidCiphertext) {
		t.Fatalf("DecryptString error = %v, want ErrDecryptFailed or ErrInvalidCiphertext", err)
	}
}

func TestManagerDecryptLegacyPlaintext(t *testing.T) {
	mgr, err := NewManager(map[string][]byte{
		"k1": fixedKey(1),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	got, err := mgr.DecryptString("legacy-plain-text")
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	if got != "legacy-plain-text" {
		t.Fatalf("DecryptString = %q, want legacy plaintext", got)
	}
}

func TestNilManagerEncryptString(t *testing.T) {
	var mgr *Manager
	_, err := mgr.EncryptString("secret")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("EncryptString error = %v, want ErrUnavailable", err)
	}
}

func TestNilManagerDecryptEncryptedEnvelope(t *testing.T) {
	var mgr *Manager
	_, err := mgr.DecryptString("enc:v1:k1:nonce:ciphertext")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("DecryptString error = %v, want ErrUnavailable", err)
	}
}

func TestNilManagerDecryptLegacyPlaintext(t *testing.T) {
	var mgr *Manager
	got, err := mgr.DecryptString("legacy-plain-text")
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	if got != "legacy-plain-text" {
		t.Fatalf("DecryptString = %q, want legacy plaintext", got)
	}
}

func TestNewManagerValidation(t *testing.T) {
	_, err := NewManager(nil, "k1")
	if !errors.Is(err, ErrEmptyKeySet) {
		t.Fatalf("err = %v, want ErrEmptyKeySet", err)
	}

	_, err = NewManager(map[string][]byte{"k1": fixedKey(1)}, "")
	if !errors.Is(err, ErrPrimaryKeyMissing) {
		t.Fatalf("err = %v, want ErrPrimaryKeyMissing", err)
	}

	_, err = NewManager(map[string][]byte{"k1": fixedKey(1)}, "k2")
	if !errors.Is(err, ErrUnknownPrimaryKey) {
		t.Fatalf("err = %v, want ErrUnknownPrimaryKey", err)
	}
}
