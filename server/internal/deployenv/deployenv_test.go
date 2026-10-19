package deployenv_test

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/deployenv"
)

const template = `# A comment naming PUBLIRA_POSTGRES_PASSWORD= is kept.
PUBLIRA_IMAGE_TAG=
PUBLIRA_EDGE_PORT=8080
PUBLIRA_POSTGRES_PASSWORD=
PUBLIRA_SECRET_ENCRYPTION_KEYS=placeholder
PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=
PUBLIRA_AUTH_JWT_SECRET=` + "\r\n"

func values(t *testing.T, env []byte) map[string]string {
	t.Helper()
	got := map[string]string{}
	for line := range strings.Lines(string(env)) {
		name, value, ok := strings.Cut(strings.TrimRight(line, "\r\n"), "=")
		if ok && !strings.HasPrefix(name, "#") {
			got[name] = value
		}
	}
	return got
}

func TestFillGeneratesEverySecretInItsShapeAndKeepsTheRest(t *testing.T) {
	out, filled, err := deployenv.Fill([]byte(template), rand.Reader)
	if err != nil {
		t.Fatalf("Fill: %v", err)
	}
	if want := "PUBLIRA_POSTGRES_PASSWORD,PUBLIRA_SECRET_ENCRYPTION_KEYS,PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID,PUBLIRA_AUTH_JWT_SECRET"; strings.Join(filled, ",") != want {
		t.Fatalf("filled = %v, want %s", filled, want)
	}
	got := values(t, out)

	if got["PUBLIRA_IMAGE_TAG"] != "" || got["PUBLIRA_EDGE_PORT"] != "8080" {
		t.Fatalf("a variable that is no secret changed: %q", out)
	}
	if !strings.HasPrefix(string(out), "# A comment naming PUBLIRA_POSTGRES_PASSWORD= is kept.\n") {
		t.Fatalf("the comment changed: %q", out)
	}
	// A database password goes into a connection URL unescaped.
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(got["PUBLIRA_POSTGRES_PASSWORD"]) {
		t.Fatalf("PUBLIRA_POSTGRES_PASSWORD = %q, want 32 bytes of hex", got["PUBLIRA_POSTGRES_PASSWORD"])
	}
	if key, err := base64.StdEncoding.DecodeString(got["PUBLIRA_AUTH_JWT_SECRET"]); err != nil || len(key) != 32 {
		t.Fatalf("PUBLIRA_AUTH_JWT_SECRET = %q, want 32 bytes of base64", got["PUBLIRA_AUTH_JWT_SECRET"])
	}
	// The value a template gives a secret is replaced, too.
	id, key, _ := strings.Cut(got["PUBLIRA_SECRET_ENCRYPTION_KEYS"], ":")
	if decoded, err := base64.StdEncoding.DecodeString(key); id != "k1" || err != nil || len(decoded) != 32 {
		t.Fatalf("PUBLIRA_SECRET_ENCRYPTION_KEYS = %q, want k1 and 32 bytes of base64", got["PUBLIRA_SECRET_ENCRYPTION_KEYS"])
	}
	if got["PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID"] != "k1" {
		t.Fatalf("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID = %q, want the ID of the key generated beside it", got["PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID"])
	}
	// A line ending the template keeps its own line break.
	if !strings.HasSuffix(string(out), "\r\n") {
		t.Fatalf("the last line lost its line break: %q", out)
	}
}

func TestFillGivesEverySecretAValueOfItsOwn(t *testing.T) {
	var template strings.Builder
	for _, s := range deployenv.Secrets {
		template.WriteString(s.Name + "=\n")
	}
	out, filled, err := deployenv.Fill([]byte(template.String()), rand.Reader)
	if err != nil {
		t.Fatalf("Fill: %v", err)
	}
	if len(filled) != len(deployenv.Secrets) {
		t.Fatalf("filled %d of %d secrets", len(filled), len(deployenv.Secrets))
	}
	seen := map[string]string{}
	for name, value := range values(t, out) {
		if value == "" {
			t.Fatalf("%s is empty", name)
		}
		if name == "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID" {
			continue
		}
		if other, ok := seen[value]; ok {
			t.Fatalf("%s and %s share a value", name, other)
		}
		seen[value] = name
	}
}

func TestFillReportsARandomSourceThatRunsDry(t *testing.T) {
	short := bytes.NewReader(make([]byte, 40))
	_, _, err := deployenv.Fill([]byte("PUBLIRA_POSTGRES_PASSWORD=\nPUBLIRA_ADMIN_DB_PASSWORD=\n"), short)
	if err == nil || !strings.Contains(err.Error(), "PUBLIRA_ADMIN_DB_PASSWORD") {
		t.Fatalf("Fill = %v, want an error naming the secret it could not generate", err)
	}
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("Fill = %v, want the reader's error", err)
	}
}
