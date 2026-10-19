package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runEnvGenerate(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&rootGroup, append([]string{"env", "generate"}, args...), pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func writeTemplate(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env.example")
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestEnvGenerateWritesTheTemplateWithItsSecretsReadableByItsOwnerAlone(t *testing.T) {
	template := writeTemplate(t, "PUBLIRA_IMAGE_TAG=\nPUBLIRA_POSTGRES_PASSWORD=\nPUBLIRA_AUTH_JWT_SECRET=\n")
	output := filepath.Join(t.TempDir(), ".env")

	code, stdout, stderr := runEnvGenerate(t, "--template", template, "--output", output)
	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, stderr)
	}
	if want := "Wrote " + output + " with 2 secrets generated.\n"; stdout != want {
		t.Fatalf("stdout = %q, want %q", stdout, want)
	}
	info, err := os.Stat(output)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("mode = %o, want 600", mode)
	}
	written, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(written), "PUBLIRA_IMAGE_TAG=\nPUBLIRA_POSTGRES_PASSWORD=") || strings.Contains(string(written), "PUBLIRA_POSTGRES_PASSWORD=\n") {
		t.Fatalf("written = %q, want the secrets filled and the rest as the template has it", written)
	}
	// Nothing generated reaches the terminal, where it would stay in the
	// scrollback.
	for _, line := range strings.Split(string(written), "\n") {
		if _, value, _ := strings.Cut(line, "="); value != "" && strings.Contains(stdout+stderr, value) {
			t.Fatalf("the output shows the value of %s", line)
		}
	}
}

func TestEnvGenerateNeverWritesOverAFile(t *testing.T) {
	template := writeTemplate(t, "PUBLIRA_POSTGRES_PASSWORD=\n")
	output := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(output, []byte("PUBLIRA_POSTGRES_PASSWORD=the-install-runs-on-this\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	code, _, stderr := runEnvGenerate(t, "--template", template, "--output", output)
	if code != 1 || !strings.Contains(stderr, "--output: "+output+" exists") {
		t.Fatalf("exit code = %d, want 1 naming the file\n%s", code, stderr)
	}
	if written, _ := os.ReadFile(output); string(written) != "PUBLIRA_POSTGRES_PASSWORD=the-install-runs-on-this\n" {
		t.Fatalf("the existing file changed to %q", written)
	}
}

func TestEnvGenerateRefusesATemplateWithNoSecret(t *testing.T) {
	template := writeTemplate(t, "PUBLIRA_IMAGE_TAG=\n")
	output := filepath.Join(t.TempDir(), ".env")

	code, _, stderr := runEnvGenerate(t, "--template", template, "--output", output)
	if code != 1 || !strings.Contains(stderr, "sets none of the secrets") {
		t.Fatalf("exit code = %d, want 1 refusing the template\n%s", code, stderr)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("stat %s = %v, want nothing written", output, err)
	}
}
