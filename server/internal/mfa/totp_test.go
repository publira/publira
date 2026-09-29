package mfa

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestGenerateEnrollmentDescribesTheSecretAsAnOTPAuthURI(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	if enrollment.Secret == "" {
		t.Fatal("Secret is empty")
	}

	parsed, err := url.Parse(enrollment.OTPAuthURI)
	if err != nil {
		t.Fatalf("parse otpauth uri %q: %v", enrollment.OTPAuthURI, err)
	}
	if parsed.Scheme != "otpauth" || parsed.Host != "totp" {
		t.Fatalf("otpauth uri = %q, want an otpauth://totp/ URI", enrollment.OTPAuthURI)
	}
	if !strings.Contains(parsed.Path, "admin@example.com") {
		t.Fatalf("otpauth uri path = %q, want it to name the account", parsed.Path)
	}
	query := parsed.Query()
	if query.Get("issuer") != "Example Tenant" {
		t.Fatalf("issuer = %q, want Example Tenant", query.Get("issuer"))
	}
	if query.Get("secret") != enrollment.Secret {
		t.Fatalf("uri secret = %q, want the returned secret %q", query.Get("secret"), enrollment.Secret)
	}
}

func TestGenerateEnrollmentRequiresAnIssuerAndAnAccount(t *testing.T) {
	if _, err := GenerateEnrollment("", "admin@example.com"); err == nil {
		t.Fatal("GenerateEnrollment succeeded without an issuer")
	}
	if _, err := GenerateEnrollment("Example Tenant", "  "); err == nil {
		t.Fatal("GenerateEnrollment succeeded without an account name")
	}
}

func TestValidateCodeAcceptsTheCurrentStep(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)

	code, err := GenerateCode(enrollment.Secret, now)
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	step, ok := ValidateCode(enrollment.Secret, code, now)
	if !ok {
		t.Fatalf("ValidateCode(%q) = false, want true", code)
	}
	if want := now.Unix() / Period; step != want {
		t.Fatalf("step = %d, want %d", step, want)
	}
}

// The skew window is what lets a code that was on screen when the user began
// typing still be accepted, and the step it reports is what the replay check
// compares against.
func TestValidateCodeAcceptsTheNeighbouringStepsAndReportsThem(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)

	for _, offset := range []int{-Skew, Skew} {
		at := now.Add(time.Duration(offset) * Period * time.Second)
		code, err := GenerateCode(enrollment.Secret, at)
		if err != nil {
			t.Fatalf("GenerateCode: %v", err)
		}
		step, ok := ValidateCode(enrollment.Secret, code, now)
		if !ok {
			t.Fatalf("ValidateCode for offset %d = false, want true", offset)
		}
		if want := at.Unix() / Period; step != want {
			t.Fatalf("step for offset %d = %d, want %d", offset, step, want)
		}
	}
}

func TestValidateCodeRejectsACodeFromOutsideTheWindow(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)

	code, err := GenerateCode(enrollment.Secret, now.Add((Skew+1)*Period*time.Second))
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	if _, ok := ValidateCode(enrollment.Secret, code, now); ok {
		t.Fatalf("ValidateCode(%q) = true, want false for a code %d periods away", code, Skew+1)
	}
}

func TestValidateCodeRejectsMalformedInput(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)

	tests := []struct {
		name   string
		secret string
		code   string
	}{
		{name: "empty code", secret: enrollment.Secret, code: ""},
		{name: "too few digits", secret: enrollment.Secret, code: "12345"},
		{name: "too many digits", secret: enrollment.Secret, code: "1234567"},
		{name: "not digits", secret: enrollment.Secret, code: "abcdef"},
		{name: "empty secret", secret: "", code: "123456"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, ok := ValidateCode(tt.secret, tt.code, now); ok {
				t.Fatalf("ValidateCode(%q, %q) = true, want false", tt.secret, tt.code)
			}
		})
	}
}

// Authenticator apps show the code in two groups, and that is how it gets
// pasted back.
func TestValidateCodeAcceptsASpacedCode(t *testing.T) {
	enrollment, err := GenerateEnrollment("Example Tenant", "admin@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)

	code, err := GenerateCode(enrollment.Secret, now)
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	spaced := code[:3] + " " + code[3:]
	if _, ok := ValidateCode(enrollment.Secret, spaced, now); !ok {
		t.Fatalf("ValidateCode(%q) = false, want true", spaced)
	}
}
