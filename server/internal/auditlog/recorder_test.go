package auditlog

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/logging"
)

// An operator who turns the log down to WARN still gets a line for every
// audit entry, at INFO, in either format.
func TestAuditLineSurvivesAQuieterLogLevel(t *testing.T) {
	for _, format := range []string{"text", "json"} {
		t.Run(format, func(t *testing.T) {
			t.Setenv(logging.FormatEnv, format)
			t.Setenv(logging.LevelEnv, "warn")

			var buf bytes.Buffer
			logger, err := logging.New(&buf, slog.LevelInfo)
			if err != nil {
				t.Fatalf("logging.New: %v", err)
			}
			recorder := New(recorderTestQuerier{}, logger)
			recorder.RecordPlatform(t.Context(), SystemPlatformActor.Entry(PlatformEntry{Action: "tenant.create", Outcome: OutcomeSuccess}))
			recorder.RecordTenant(t.Context(), TenantEntry{TenantID: uuid.New(), Action: "series.create", Outcome: OutcomeSuccess})
			logger.Info("not an audit record")

			got := strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n")
			if len(got) != 2 {
				t.Fatalf("records = %q, want the two audit records", got)
			}
			for i, action := range []string{"tenant.create", "series.create"} {
				for _, want := range []string{"INFO", "audit", action} {
					if !strings.Contains(got[i], want) {
						t.Errorf("record %d = %q, want it to contain %q", i, got[i], want)
					}
				}
			}
		})
	}
}
