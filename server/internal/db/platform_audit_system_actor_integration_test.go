package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A change made from publiractl names no operator, and the platform console's
// audit listing still returns it, under the system role.
func TestPlatformAuditLogAcceptsTheSystemActor(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.OpenPlatformDB(t))
	entry := auditlog.SystemPlatformActor.Entry(auditlog.PlatformEntry{
		Action:  "platform_storage_settings_updated",
		Outcome: auditlog.OutcomeSuccess,
	})
	if err := auditlog.WritePlatform(ctx, queries, nil, entry); err != nil {
		t.Fatalf("WritePlatform: %v", err)
	}

	rows, err := queries.ListPlatformAuditLogsDesc(ctx, dbmodels.ListPlatformAuditLogsDescParams{Limit: 10})
	if err != nil {
		t.Fatalf("ListPlatformAuditLogsDesc: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if got := rows[0]; got.ActorPlatformUserID.Valid || got.ActorRole != auditlog.RoleSystem || got.ActorPublicID != "" {
		t.Fatalf("actor = (%v, %q, %q), want no operator under %q", got.ActorPlatformUserID, got.ActorRole, got.ActorPublicID, auditlog.RoleSystem)
	}
}

// The actor's two halves have to agree, so a handler that forgot the operator
// cannot file an operator's change as a command's, nor a command claim one.
func TestPlatformAuditLogRejectsAHalfNamedActor(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.OpenPlatformDB(t))
	for _, tc := range []struct {
		name  string
		actor auditlog.PlatformActor
	}{
		{name: "operator role without an operator", actor: auditlog.PlatformActor{Role: "platform_owner"}},
		{name: "system role with an operator", actor: auditlog.PlatformActor{UserID: uuid.New(), Role: auditlog.RoleSystem}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := auditlog.WritePlatform(ctx, queries, nil, tc.actor.Entry(auditlog.PlatformEntry{
				Action:  "platform_policy_updated",
				Outcome: auditlog.OutcomeSuccess,
			}))
			if !isCheckViolation(err) {
				t.Fatalf("error = %v, want a check violation", err)
			}
			if got, want := checkName(err), "platform_audit_logs_actor_platform_user_id_check"; got != want {
				t.Fatalf("constraint = %q, want %q", got, want)
			}
		})
	}
}
