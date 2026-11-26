package secrethint

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestMask(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "whitespace", input: "  ", want: ""},
		{name: "stripe secret key", input: "sk_test_51ABCDEFGHIJKLMN", want: "sk_test_••••••••KLMN"},
		{name: "live key", input: "sk_live_51ABCDEFGHIJKLMN", want: "sk_live_••••••••KLMN"},
		{name: "restricted key", input: "rk_live_51ABCDEFGHIJKLMN", want: "rk_live_••••••••KLMN"},
		{name: "webhook secret", input: "whsec_abcdefghijklmnopqrstuv", want: "whsec_••••••••stuv"},
		{name: "resend key", input: "re_123abc_XYZdefghijklmnop", want: "re_••••••••mnop"},
		{name: "underscores after the type prefix", input: "sk_test_leak_me_now_please", want: "sk_test_••••••••ease"},
		{name: "underscores with no type prefix", input: "my_webhook_token_2026", want: "••••••••2026"},
		{name: "unknown prefix", input: "a_0123456789abcdefgh_ijkl", want: "••••••••ijkl"},
		{name: "short rest", input: "sk_test_ab", want: "sk_test_••••••••"},
		{name: "rest too short for its tail", input: "sk_test_0123456789abcde", want: "sk_test_••••••••"},
		{name: "underscore at the end", input: "token_", want: "••••••••"},
		{name: "no prefix", input: "supersecretvalue", want: "••••••••alue"},
		{name: "short value", input: "hunter2", want: "••••••••"},
		{name: "multibyte", input: "ひみつのあいことばはひらけごまです", want: "••••••••ごまです"},
		{name: "trimmed", input: "  supersecretvalue\n", want: "••••••••alue"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := Mask(tt.input)
			if got != tt.want {
				t.Fatalf("Mask(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// A hint carries at most a type prefix and four characters of the secret,
// and the four only from a secret at least four times as long as them.
func TestMaskRevealsAtMostThePrefixAndTheTail(t *testing.T) {
	t.Parallel()

	secrets := []string{
		"sk_test_leak_me_now_please",
		"sk_live_a_b_c_d_e_f_g_h_i_j_k",
		"whsec_x_y",
		"my_webhook_token_2026",
		"pk_live_",
		"re_",
		"a_b",
		"_____________________",
		"supersecretvalue",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_b",
	}
	for _, secret := range secrets {
		hint := Mask(secret)
		if !strings.Contains(hint, fill) {
			t.Fatalf("Mask(%q) = %q, want it to mask", secret, hint)
		}
		prefix, revealed, _ := strings.Cut(hint, fill)
		if prefix != "" && !typePrefix.MatchString(prefix) {
			t.Fatalf("Mask(%q) = %q keeps %q, which is not a type prefix", secret, hint, prefix)
		}
		if !strings.HasPrefix(secret, prefix) || !strings.HasSuffix(secret, revealed) {
			t.Fatalf("Mask(%q) = %q, want the prefix and the tail of the secret", secret, hint)
		}
		masked := utf8.RuneCountInString(secret) - utf8.RuneCountInString(prefix)
		if n := utf8.RuneCountInString(revealed); n > tail || (n > 0 && masked < minRevealed) {
			t.Fatalf("Mask(%q) = %q shows %d of the %d characters it masks", secret, hint, n, masked)
		}
	}
}

func TestPrivateKey(t *testing.T) {
	t.Parallel()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pemText := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	public, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(public)
	want := "SHA256:" + strings.TrimRight(base64.StdEncoding.EncodeToString(sum[:]), "=")

	if got := PrivateKey(pemText); got != want {
		t.Fatalf("PrivateKey = %q, want %q", got, want)
	}
	if got := PrivateKey("\n  " + pemText + "\n"); got != want {
		t.Fatalf("PrivateKey with surrounding spaces = %q, want %q", got, want)
	}
	for _, invalid := range []string{"", "not a key", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"} {
		if got := PrivateKey(invalid); got != "" {
			t.Fatalf("PrivateKey(%q) = %q, want empty", invalid, got)
		}
	}
}
