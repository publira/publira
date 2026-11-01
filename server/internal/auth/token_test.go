package auth

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/logging"
)

// The sign-in record is written at INFO even where the log is turned down to
// WARN. The test swaps the slog default, so it cannot run in parallel.
func TestAuditEventSurvivesAQuieterLogLevel(t *testing.T) {
	t.Setenv(logging.FormatEnv, "")
	t.Setenv(logging.LevelEnv, "warn")

	var buf bytes.Buffer
	logger, err := logging.New(&buf, slog.LevelInfo)
	if err != nil {
		t.Fatalf("logging.New: %v", err)
	}
	previous := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() { slog.SetDefault(previous) })

	AuditEvent(t.Context(), "admin_login", "failure", "t-1", "", "invalid_credentials")
	slog.Info("not an audit record")

	got := strings.TrimSuffix(buf.String(), "\n")
	if strings.Contains(got, "\n") || !strings.Contains(got, `level=INFO msg="audit auth action=admin_login outcome=failure`) {
		t.Errorf("records = %q, want the audit auth record alone", got)
	}
}
