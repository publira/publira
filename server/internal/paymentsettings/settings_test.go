package paymentsettings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func TestMaskSecret(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "whitespace", input: "  ", want: ""},
		{name: "stripe secret key", input: "sk_test_51ABCDEFGHIJKLMN", want: "sk_test_••••••••KLMN"},
		{name: "webhook secret", input: "whsec_abcdefghijklmnopqrstuv", want: "whsec_••••••••stuv"},
		{name: "short rest", input: "sk_test_ab", want: "sk_test_••••"},
		{name: "no prefix", input: "supersecretvalue", want: "••••••••alue"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := MaskSecret(tt.input)
			if got != tt.want {
				t.Fatalf("MaskSecret(%q) = %q, want %q", tt.input, got, tt.want)
			}
			if tt.input != "" && strings.TrimSpace(tt.input) != "" && strings.Contains(got, strings.TrimSpace(tt.input)) {
				t.Fatalf("hint %q contains plaintext", got)
			}
		})
	}
}

func TestNormalizeProvider(t *testing.T) {
	t.Parallel()

	got, err := NormalizeProvider("")
	if err != nil {
		t.Fatalf("empty provider error = %v", err)
	}
	if got != ProviderStripe {
		t.Fatalf("empty provider = %q, want %q", got, ProviderStripe)
	}

	got, err = NormalizeProvider("stripe")
	if err != nil {
		t.Fatalf("stripe provider error = %v", err)
	}
	if got != ProviderStripe {
		t.Fatalf("stripe provider = %q, want %q", got, ProviderStripe)
	}

	_, err = NormalizeProvider("paypal")
	if !errors.Is(err, ErrInvalidProvider) {
		t.Fatalf("paypal provider error = %v, want ErrInvalidProvider", err)
	}
}

func TestSecretsRedactsPlaintext(t *testing.T) {
	t.Parallel()

	const secretKey = "sk_test_leak_me_now_please"
	const webhookSecret = "whsec_also_must_not_appear"
	secrets := Secrets{SecretKey: secretKey, WebhookSecret: webhookSecret}

	dumps := []string{
		secrets.String(),
		secrets.GoString(),
		fmt.Sprintf("%v", secrets),
		fmt.Sprintf("%+v", secrets),
		fmt.Sprintf("%#v", secrets),
	}
	for _, dump := range dumps {
		if containsAny(dump, secretKey, webhookSecret) {
			t.Fatalf("dump %q leaked a secret", dump)
		}
		if !strings.Contains(dump, "redacted") {
			t.Fatalf("dump %q is not marked redacted", dump)
		}
	}

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	logger.Info("loaded", "secrets", secrets)
	if containsAny(buf.String(), secretKey, webhookSecret) {
		t.Fatalf("slog output leaked a secret: %s", buf.String())
	}
}

func TestPublicConfigJSONOmitsSecrets(t *testing.T) {
	t.Parallel()

	cfg := PublicConfig{
		Provider:                ProviderStripe,
		Enabled:                 true,
		SecretKeyConfigured:     true,
		WebhookSecretConfigured: true,
		SecretKeyHint:           MaskSecret("sk_test_51ABCDEFGHIJKLMN"),
		WebhookSecretHint:       MaskSecret("whsec_abcdefghijklmnopqrstuv"),
		Ready:                   true,
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	body := string(encoded)
	if containsAny(body, "sk_test_51ABCDEFGHIJKLMN", "whsec_abcdefghijklmnopqrstuv") {
		t.Fatalf("public JSON leaked a secret: %s", body)
	}
	if !strings.Contains(body, "SecretKeyHint") {
		t.Fatalf("public JSON missing hint: %s", body)
	}
}

func TestEncryptSecretRejectsEmptyAndMissingManager(t *testing.T) {
	t.Parallel()

	_, _, err := encryptSecret("  ", nil)
	if !errors.Is(err, ErrSecretRequired) {
		t.Fatalf("empty plaintext error = %v, want ErrSecretRequired", err)
	}

	_, _, err = encryptSecret("sk_test_value", nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("nil manager error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestDecryptEnvelopeRejectsNonEnvelope(t *testing.T) {
	t.Parallel()

	mgr := testEncryptor(t)
	_, err := decryptEnvelope("sk_test_plain_in_db", mgr)
	if !errors.Is(err, ErrInvalidCiphertext) {
		t.Fatalf("plaintext decrypt error = %v, want ErrInvalidCiphertext", err)
	}
	if err != nil && strings.Contains(err.Error(), "sk_test_plain_in_db") {
		t.Fatalf("decrypt error leaked plaintext: %v", err)
	}
}

func TestApplySecretUpdateModes(t *testing.T) {
	t.Parallel()

	mgr := testEncryptor(t)
	encrypted, hint, err := encryptSecret("sk_test_originalXXXX", mgr)
	if err != nil {
		t.Fatalf("encrypt original: %v", err)
	}

	gotEnc, gotHint, err := applySecretUpdate(encrypted, hint, SecretUpdateModeUnchanged, "ignored", mgr)
	if err != nil {
		t.Fatalf("unchanged: %v", err)
	}
	if gotEnc != encrypted || gotHint != hint {
		t.Fatalf("unchanged mutated secret")
	}

	rotated, rotatedHint, err := applySecretUpdate(encrypted, hint, SecretUpdateModeReplace, "sk_test_rotatedYYYY", mgr)
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if rotated == encrypted {
		t.Fatal("replace reused ciphertext")
	}
	if rotatedHint == hint {
		t.Fatal("replace reused hint")
	}
	if strings.Contains(rotated, "sk_test_rotatedYYYY") {
		t.Fatal("ciphertext contains plaintext")
	}

	clearedEnc, clearedHint, err := applySecretUpdate(encrypted, hint, SecretUpdateModeClear, "", mgr)
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if clearedEnc != "" || clearedHint != "" {
		t.Fatalf("clear = %q / %q, want empty", clearedEnc, clearedHint)
	}

	_, _, err = applySecretUpdate(encrypted, hint, 99, "", mgr)
	if !errors.Is(err, ErrInvalidSecretUpdateMode) {
		t.Fatalf("invalid mode error = %v, want ErrInvalidSecretUpdateMode", err)
	}
}

func TestIsUnavailable(t *testing.T) {
	t.Parallel()
	if !IsUnavailable(ErrNotEnabled) || !IsUnavailable(fmt.Errorf("wrap: %w", ErrDecryptFailed)) {
		t.Fatal("sentinel payment errors must be unavailable")
	}
	if IsUnavailable(errors.New("pq: connection refused")) {
		t.Fatal("database errors must not be treated as unavailable settings")
	}
}
