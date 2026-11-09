package testutil

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// SeedSQL reads a seed file under db/seeds as one script database/sql can
// run: it follows psql's \ir includes and \set assignments, and puts each
// :'name' the file uses in as the quoted value vars or an earlier \set gives
// it. An include named in skip, as the including file writes it, is left out,
// for a test that applies the seeds to a database whose roles another test
// shares.
func SeedSQL(t testing.TB, path string, vars map[string]string, skip ...string) string {
	t.Helper()

	statements, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	lines := strings.Split(string(statements), "\n")
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if assignment, ok := strings.CutPrefix(trimmed, `\set `); ok {
			name, value, _ := strings.Cut(strings.TrimSpace(assignment), " ")
			vars[name] = strings.TrimSpace(value)
			lines[index] = ""
			continue
		}
		if included, ok := strings.CutPrefix(trimmed, `\ir `); ok {
			included = strings.TrimSpace(included)
			if slices.Contains(skip, included) {
				lines[index] = ""
				continue
			}
			lines[index] = SeedSQL(t, filepath.Join(filepath.Dir(path), included), vars, skip...)
			continue
		}
		for name, value := range vars {
			line = strings.ReplaceAll(line, ":'"+name+"'", "'"+strings.ReplaceAll(value, "'", "''")+"'")
		}
		lines[index] = line
	}
	return strings.Join(lines, "\n")
}
