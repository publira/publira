package emailsettings

import (
	"errors"
	"testing"
)

const encryptedSMTPPassword = "enc:v1:k1:nonce:ciphertext"

func TestDecryptPasswordNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := DecryptPassword(encryptedSMTPPassword, nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("DecryptPassword error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestResolvePasswordForTestNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := ResolvePasswordForTest(encryptedSMTPPassword, SecretUpdateModeUnchanged, "", nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("ResolvePasswordForTest error = %v, want ErrSecretManagerUnavailable", err)
	}
}
