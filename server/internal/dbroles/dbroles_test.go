package dbroles

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// task db:seed ENV=prod and publiractl db roles apply the same files: psql
// through the \ir lines of prod.sql, and Apply by listing the directory.
func TestFilesAreWhatTheProdSeedIncludes(t *testing.T) {
	dir, err := RepoDir()
	if err != nil {
		t.Fatal(err)
	}
	files, err := Files(dir)
	if err != nil {
		t.Fatal(err)
	}
	var listed []string
	for _, f := range files {
		listed = append(listed, "baseline/"+filepath.Base(f))
	}

	prod, err := os.Open(filepath.Join(filepath.Dir(dir), "prod.sql"))
	if err != nil {
		t.Fatal(err)
	}
	defer prod.Close() //nolint:errcheck
	var included []string
	for scanner := bufio.NewScanner(prod); scanner.Scan(); {
		if path, ok := strings.CutPrefix(scanner.Text(), `\ir `); ok {
			included = append(included, path)
		}
	}
	if !slices.Equal(included, listed) {
		t.Fatalf("prod.sql includes %v, want the files of baseline/ in name order, %v", included, listed)
	}
}

func TestApplyRefusesAPasswordItCannotSet(t *testing.T) {
	for name, passwords := range map[string]map[string]string{
		"unknown role":      {"publira_rls_bypass": "secret"},
		"empty password":    {"publira_admin": ""},
		"superuser account": {"postgres": "secret"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Apply(t.Context(), nil, "", passwords); err == nil {
				t.Fatal("Apply succeeded, want a refusal before connecting")
			}
		})
	}
}

func TestSCRAMVerifierIsSaltedPerCall(t *testing.T) {
	a, err := scramSHA256("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	b, err := scramSHA256("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(a, "SCRAM-SHA-256$4096:") {
		t.Fatalf("verifier = %q, want the SCRAM-SHA-256 format PostgreSQL recognizes", a)
	}
	if a == b {
		t.Fatal("two verifiers of one password are equal, want a fresh salt each")
	}
	if strings.Contains(a, "correct horse") || strings.ContainsRune(a, '\'') {
		t.Fatalf("verifier = %q carries the password or a quote", a)
	}
}
