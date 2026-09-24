package emailsettings

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/secretupdate"
)

const encryptedSMTPPassword = "enc:v1:k1:nonce:ciphertext"

func TestDecryptPasswordNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := DecryptPassword(encryptedSMTPPassword, nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("DecryptPassword error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestResolvePasswordForTestNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := ResolvePasswordForTest(encryptedSMTPPassword, secretupdate.Unchanged, "", nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("ResolvePasswordForTest error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestEncryptUpdatedPasswordRefusesABlankReplacementAsAPassword(t *testing.T) {
	_, _, err := EncryptUpdatedPassword(encryptedSMTPPassword, secretupdate.Replace, "   ", nil)
	if !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("EncryptUpdatedPassword(replace, blank) error = %v, want ErrPasswordRequired", err)
	}
	_, err = ResolvePasswordForTest(encryptedSMTPPassword, secretupdate.Replace, "", nil)
	if !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("ResolvePasswordForTest(replace, blank) error = %v, want ErrPasswordRequired", err)
	}
}
