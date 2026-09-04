package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestDBPlatformAuditorCannotWritePlatformSettings(t *testing.T) {
	server, pg := newDBIntegrationEnv(t)
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT001", "auditor@example.com", "Platform Auditor")
	queries := dbmodels.New(pg.DB)

	beforeTimezone, beforeFound := dbPlatformDefaultTimezone(t, queries)
	beforeAuditLogs := dbPlatformAuditLogCount(t, pg.DB)

	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(server.Client(), server.URL)
	_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(auditor, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "Asia/Tokyo",
	}))
	if got := connect.CodeOf(err); got != connect.CodePermissionDenied {
		t.Fatalf("UpdatePlatformSettings code = %v, want permission_denied (err=%v)", got, err)
	}

	afterTimezone, afterFound := dbPlatformDefaultTimezone(t, queries)
	if afterFound != beforeFound || afterTimezone != beforeTimezone {
		t.Fatalf("platform config changed: before=(%q, %t), after=(%q, %t)", beforeTimezone, beforeFound, afterTimezone, afterFound)
	}
	if afterAuditLogs := dbPlatformAuditLogCount(t, pg.DB); afterAuditLogs != beforeAuditLogs {
		t.Fatalf("platform audit log count = %d, want %d", afterAuditLogs, beforeAuditLogs)
	}
}

func dbPlatformDefaultTimezone(t *testing.T, queries dbmodels.Querier) (string, bool) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	config, err := queries.GetPlatformConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false
	}
	if err != nil {
		t.Fatalf("GetPlatformConfig: %v", err)
	}
	return config.DefaultTimezone, true
}

func dbPlatformAuditLogCount(t *testing.T, db *sql.DB) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM platform_audit_logs").Scan(&count); err != nil {
		t.Fatalf("count platform audit logs: %v", err)
	}
	return count
}
