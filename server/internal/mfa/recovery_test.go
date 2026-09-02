package mfa

import (
	"regexp"
	"testing"
)

var recoveryCodePattern = regexp.MustCompile(`^[` + recoveryAlphabet + `]{5}-[` + recoveryAlphabet + `]{5}$`)

func TestGenerateRecoveryCodesReturnsDistinctCodesInDisplayForm(t *testing.T) {
	codes, err := GenerateRecoveryCodes()
	if err != nil {
		t.Fatalf("GenerateRecoveryCodes: %v", err)
	}
	if len(codes) != RecoveryCodeCount {
		t.Fatalf("len(codes) = %d, want %d", len(codes), RecoveryCodeCount)
	}

	seen := make(map[string]bool, len(codes))
	for _, code := range codes {
		if !recoveryCodePattern.MatchString(code) {
			t.Fatalf("code %q does not match the display form", code)
		}
		if seen[code] {
			t.Fatalf("code %q was handed out twice", code)
		}
		seen[code] = true
	}
}

// A code is read off a screen or a printout and typed back, so the form it
// comes back in is not the form it went out in.
func TestVerifyRecoveryCodeAcceptsTheCodeAsItIsTypedBack(t *testing.T) {
	hash, err := HashRecoveryCode("ABCDE-FGHJK")
	if err != nil {
		t.Fatalf("HashRecoveryCode: %v", err)
	}

	for _, typed := range []string{"ABCDE-FGHJK", "abcde-fghjk", "ABCDEFGHJK", " ABCDE FGHJK "} {
		if !VerifyRecoveryCode(typed, hash) {
			t.Fatalf("VerifyRecoveryCode(%q) = false, want true", typed)
		}
	}
}

func TestVerifyRecoveryCodeRejectsAnotherCode(t *testing.T) {
	hash, err := HashRecoveryCode("ABCDE-FGHJK")
	if err != nil {
		t.Fatalf("HashRecoveryCode: %v", err)
	}
	if VerifyRecoveryCode("ABCDE-FGHJM", hash) {
		t.Fatal("VerifyRecoveryCode accepted a code it was not hashed from")
	}
}

func TestHashRecoveryCodeDoesNotStoreThePlaintext(t *testing.T) {
	hash, err := HashRecoveryCode("ABCDE-FGHJK")
	if err != nil {
		t.Fatalf("HashRecoveryCode: %v", err)
	}
	if hash == "ABCDE-FGHJK" || hash == "ABCDEFGHJK" {
		t.Fatalf("hash = %q, want something other than the code", hash)
	}
}
