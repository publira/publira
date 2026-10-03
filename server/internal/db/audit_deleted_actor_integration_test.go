package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// Deleting an account moves the entries it acted in from the account to its
// name and public ID, and the tenant's audit listing reads those back, for the
// columns as for the actor filter. Another member's entries are left alone.
func TestAuditLogKeepsTheActorOfADeletedAccount(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "ADATENANT001", "deleted-actor.example.com", "admin-deleted-actor.example.com", "Deleted Actor")
	leaving := mustInsertUser(t, ctx, pg.DB, tenantID, "ADALEAVING01", "leaving@deleted-actor.example.com", "Leaving")
	staying := mustInsertUser(t, ctx, pg.DB, tenantID, "ADASTAYING01", "staying@deleted-actor.example.com", "Staying")
	now := time.Now().UTC().Truncate(time.Microsecond)
	leavingEntry := mustInsertAuditLog(t, ctx, pg.DB, tenantID, leaving, now)
	stayingEntry := mustInsertAuditLog(t, ctx, pg.DB, tenantID, staying, now.Add(-time.Minute))

	mustExec(t, ctx, pg.DB, `DELETE FROM users WHERE id = $1`, leaving)

	queries := dbmodels.New(pg.DB)
	rows, err := queries.ListAuditLogsByTenantDesc(ctx, dbmodels.ListAuditLogsByTenantDescParams{TenantID: tenantID, Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditLogsByTenantDesc: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want both entries", len(rows))
	}
	if got := rows[0]; got.ID != leavingEntry || got.ActorUserID.Valid || got.ActorPublicID != "ADALEAVING01" || got.ActorName != "Leaving" {
		t.Fatalf("entry of the deleted account = (%v, %v, %q, %q), want no account and its kept name and public ID", got.ID, got.ActorUserID, got.ActorPublicID, got.ActorName)
	}
	if got := rows[1]; got.ID != stayingEntry || got.ActorUserID.UUID != staying || got.ActorPublicID != "ADASTAYING01" || got.ActorName != "Staying" {
		t.Fatalf("entry of the remaining account = (%v, %v, %q, %q), want it still naming the account", got.ID, got.ActorUserID, got.ActorPublicID, got.ActorName)
	}
	var keptPublicID, keptName *string
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM audit_logs WHERE id = $1`, &keptPublicID, stayingEntry)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_name FROM audit_logs WHERE id = $1`, &keptName, stayingEntry)
	if keptPublicID != nil || keptName != nil {
		t.Fatalf("entry of the remaining account kept (%v, %v), want nothing while the account exists", keptPublicID, keptName)
	}

	filtered, err := queries.ListAuditLogsByTenantDesc(ctx, dbmodels.ListAuditLogsByTenantDescParams{
		TenantID:                tenantID,
		FilterActorUserPublicID: sql.NullString{String: "ADALEAVING01", Valid: true},
		Limit:                   10,
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByTenantDesc filtered by the deleted actor: %v", err)
	}
	if len(filtered) != 1 || filtered[0].ID != leavingEntry {
		t.Fatalf("entries filed under the deleted actor = %v, want only %v", auditLogIDs(filtered), leavingEntry)
	}
}

// An entry names its actor exactly one way, so a member's action cannot lose
// its actor, claim both an account and a deleted one, or be filed as the
// platform's own with a name beside it.
func TestAuditLogRejectsAnActorNamedOtherThanOnce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "ADCTENANT001", "actor-check.example.com", "admin-actor-check.example.com", "Actor Check")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "ADCMEMBER001", "member@actor-check.example.com", "Member")

	for _, tc := range []struct {
		name       string
		userID     uuid.NullUUID
		role       string
		publicID   *string
		actorName  *string
		constraint string
	}{
		{name: "member role naming no one", role: "tenant_admin", constraint: "audit_logs_actor_user_id_check"},
		{name: "member role naming an account and a deleted one", userID: nullUUID(userID), role: "tenant_admin", publicID: new("ADCMEMBER001"), actorName: new("Member"), constraint: "audit_logs_actor_user_id_check"},
		{name: "system role naming a deleted account", role: "system", publicID: new("ADCMEMBER001"), actorName: new("Member"), constraint: "audit_logs_actor_user_id_check"},
		{name: "deleted account without its name", role: "tenant_admin", publicID: new("ADCMEMBER001"), constraint: "audit_logs_actor_name_check"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pg.DB.ExecContext(ctx, `
				INSERT INTO audit_logs (id, tenant_id, actor_user_id, actor_role, actor_public_id, actor_name, action, outcome)
				VALUES ($1, $2, $3, $4, $5, $6, 'series_updated', 'success')
			`, uuid.Must(uuid.NewV7()), tenantID, tc.userID, tc.role, tc.publicID, tc.actorName)
			if !isCheckViolation(err) {
				t.Fatalf("error = %v, want a check violation", err)
			}
			if got := checkName(err); got != tc.constraint {
				t.Fatalf("constraint = %q, want %q", got, tc.constraint)
			}
		})
	}
}

// An entry written after its actor was deleted is filed under the public ID
// and name the caller kept, and one whose actor still exists names the account
// and keeps nothing beside it.
func TestInsertAuditLogFilesALateEntryUnderTheDeletedActor(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "ADLTENANT001", "late-entry.example.com", "admin-late-entry.example.com", "Late Entry")
	gone := mustInsertUser(t, ctx, pg.DB, tenantID, "ADLGONE00001", "gone@late-entry.example.com", "Gone")
	present := mustInsertUser(t, ctx, pg.DB, tenantID, "ADLPRESENT01", "present@late-entry.example.com", "Present")
	mustExec(t, ctx, pg.DB, `DELETE FROM users WHERE id = $1`, gone)

	queries := dbmodels.New(pg.DB)
	insert := func(actor uuid.UUID, publicID, name string) uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if err := queries.InsertAuditLog(ctx, dbmodels.InsertAuditLogParams{
			ID:            id,
			TenantID:      tenantID,
			ActorUserID:   nullUUID(actor),
			ActorPublicID: sql.NullString{String: publicID, Valid: true},
			ActorName:     sql.NullString{String: name, Valid: true},
			ActorRole:     "tenant_admin",
			Action:        "page_created",
			Outcome:       "success",
		}); err != nil {
			t.Fatalf("InsertAuditLog for %s: %v", publicID, err)
		}
		return id
	}
	late := insert(gone, "ADLGONE00001", "Gone")
	current := insert(present, "ADLPRESENT01", "Present")

	var actorUserID uuid.NullUUID
	var publicID, name sql.NullString
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_user_id FROM audit_logs WHERE id = $1`, &actorUserID, late)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM audit_logs WHERE id = $1`, &publicID, late)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_name FROM audit_logs WHERE id = $1`, &name, late)
	if actorUserID.Valid || publicID.String != "ADLGONE00001" || name.String != "Gone" {
		t.Fatalf("late entry = (%v, %v, %v), want no account and the kept name and public ID", actorUserID, publicID, name)
	}
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_user_id FROM audit_logs WHERE id = $1`, &actorUserID, current)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM audit_logs WHERE id = $1`, &publicID, current)
	if actorUserID.UUID != present || publicID.Valid {
		t.Fatalf("entry of an existing actor = (%v, %v), want the account and nothing kept beside it", actorUserID, publicID)
	}
}
