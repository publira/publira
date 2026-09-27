package paymentsettings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/secretupdate"
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

func TestLoadedCredentialsRedactPlaintext(t *testing.T) {
	t.Parallel()

	const secretKey = "sk_test_leak_me_now_please"
	const webhookSecret = "whsec_also_must_not_appear"
	credentials := paymentprovider.Credentials{
		stripe.FieldSecretKey:     secretKey,
		stripe.FieldWebhookSecret: webhookSecret,
	}

	dumps := []string{
		credentials.String(),
		credentials.GoString(),
		fmt.Sprintf("%v", credentials),
		fmt.Sprintf("%+v", credentials),
		fmt.Sprintf("%#v", credentials),
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
	logger.Info("loaded", "credentials", credentials)
	if containsAny(buf.String(), secretKey, webhookSecret) {
		t.Fatalf("slog output leaked a secret: %s", buf.String())
	}
}

func TestPublicConfigJSONOmitsSecrets(t *testing.T) {
	t.Parallel()

	cfg := PublicConfig{
		Provider: stripe.ID,
		Enabled:  true,
		Fields: []FieldState{
			{Name: stripe.FieldSecretKey, Configured: true, Hint: MaskSecret("sk_test_51ABCDEFGHIJKLMN")},
			{Name: stripe.FieldWebhookSecret, Configured: true, Hint: MaskSecret("whsec_abcdefghijklmnopqrstuv")},
		},
		Ready: true,
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	body := string(encoded)
	if containsAny(body, "sk_test_51ABCDEFGHIJKLMN", "whsec_abcdefghijklmnopqrstuv") {
		t.Fatalf("public JSON leaked a secret: %s", body)
	}
	if !strings.Contains(body, "Hint") {
		t.Fatalf("public JSON missing hint: %s", body)
	}
}

func TestApplySecretUpdateRejectsEmptyAndMissingManager(t *testing.T) {
	t.Parallel()

	_, _, err := applySecretUpdate("", "", secretupdate.Replace, "  ", nil)
	if !errors.Is(err, ErrSecretRequired) {
		t.Fatalf("empty plaintext error = %v, want ErrSecretRequired", err)
	}

	_, _, err = applySecretUpdate("", "", secretupdate.Replace, "sk_test_value", nil)
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

	gotEnc, gotHint, err := applySecretUpdate(encrypted, hint, secretupdate.Unchanged, "ignored", mgr)
	if err != nil {
		t.Fatalf("unchanged: %v", err)
	}
	if gotEnc != encrypted || gotHint != hint {
		t.Fatalf("unchanged mutated secret")
	}

	rotated, rotatedHint, err := applySecretUpdate(encrypted, hint, secretupdate.Replace, "sk_test_rotatedYYYY", mgr)
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

	clearedEnc, clearedHint, err := applySecretUpdate(encrypted, hint, secretupdate.Clear, "", mgr)
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if clearedEnc != "" || clearedHint != "" {
		t.Fatalf("clear = %q / %q, want empty", clearedEnc, clearedHint)
	}

	_, _, err = applySecretUpdate(encrypted, hint, 99, "", mgr)
	if !errors.Is(err, secretupdate.ErrInvalidMode) {
		t.Fatalf("invalid mode error = %v, want secretupdate.ErrInvalidMode", err)
	}
}

func TestIsUnavailable(t *testing.T) {
	t.Parallel()
	if !IsUnavailable(ErrNotEnabled) || !IsUnavailable(fmt.Errorf("wrap: %w", ErrDecryptFailed)) || !IsUnavailable(ErrProviderUnavailable) {
		t.Fatal("sentinel payment errors must be unavailable")
	}
	if IsUnavailable(errors.New("pq: connection refused")) {
		t.Fatal("database errors must not be treated as unavailable settings")
	}
}
