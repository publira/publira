package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/creatorroles"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// create runs Create as publira_platform, the login both adapters write with,
// and commits.
func create(t *testing.T, pg *testutil.PostgresEnv, actor auditlog.PlatformActor, p CreateParams) (Created, error) {
	t.Helper()
	c, err := p.Validate()
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	ctx := context.Background()
	tx, err := pg.OpenPlatformDB(t).BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	created, err := Create(ctx, tx, nil, actor, c)
	if err != nil {
		return Created{}, err
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return created, nil
}

type auditRow struct {
	actorUserID uuid.NullUUID
	actorRole   string
	action      string
	targetID    string
	clientIP    sql.NullString
}

func platformAuditRows(t *testing.T, pg *testutil.PostgresEnv) []auditRow {
	t.Helper()
	rows, err := pg.DB.QueryContext(context.Background(),
		`SELECT actor_platform_user_id, actor_role, action, target_id, client_ip FROM platform_audit_logs ORDER BY id`)
	if err != nil {
		t.Fatalf("read platform_audit_logs: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var out []auditRow
	for rows.Next() {
		var r auditRow
		if err := rows.Scan(&r.actorUserID, &r.actorRole, &r.action, &r.targetID, &r.clientIP); err != nil {
			t.Fatalf("scan platform_audit_logs: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read platform_audit_logs: %v", err)
	}
	return out
}

func TestCreateWritesTheTenantWithItsRolesAndInvitations(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	operator := pg.SeedPlatformOperator(t, "PLATOPS01", "operator@platform.example.com", "Operator")
	actor := auditlog.PlatformActor{UserID: operator.ID, Role: operator.Role, ClientIP: "203.0.113.10"}

	created, err := create(t, pg, actor, CreateParams{
		Name:               "Example Comics",
		Domain:             "comics.example.com",
		AdminDomain:        "admin.comics.example.com",
		DefaultLocale:      "en",
		InitialAdminEmails: []string{"owner@comics.example.com", "editor@comics.example.com"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	q := dbmodels.New(pg.DB)
	ctx := context.Background()
	tenant, err := q.GetTenantByPublicID(ctx, created.Tenant.PublicID)
	if err != nil {
		t.Fatalf("GetTenantByPublicID: %v", err)
	}
	if tenant.Name != "Example Comics" || tenant.Domain != "comics.example.com" || tenant.AdminDomain.String != "admin.comics.example.com" || tenant.DefaultLocale != "en" {
		t.Fatalf("tenant = %+v, want the requested values", tenant)
	}

	var roles []string
	rows, err := pg.DB.QueryContext(ctx, `SELECT name FROM creator_roles WHERE tenant_id = $1 ORDER BY display_priority`, tenant.ID)
	if err != nil {
		t.Fatalf("read creator_roles: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan creator_roles: %v", err)
		}
		roles = append(roles, name)
	}
	wantRoles := make([]string, 0, len(creatorroles.Defaults))
	for _, role := range creatorroles.Defaults {
		wantRoles = append(wantRoles, role.Name)
	}
	if !slices.Equal(roles, wantRoles) {
		t.Fatalf("creator roles = %q, want %q", roles, wantRoles)
	}

	var invited []string
	for _, invitation := range created.Invitations {
		invited = append(invited, invitation.Email)
	}
	if want := []string{"owner@comics.example.com", "editor@comics.example.com"}; !slices.Equal(invited, want) {
		t.Fatalf("invitations = %q, want %q", invited, want)
	}
	var mails int
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 AND status = 'pending'`,
		tenant.ID, outbox.EventTypeTenantAdminInvitationEmail,
	).Scan(&mails); err != nil {
		t.Fatalf("count outbox_events: %v", err)
	}
	if mails != 2 {
		t.Fatalf("queued invitation mails = %d, want 2", mails)
	}

	audit := platformAuditRows(t, pg)
	wantActions := []string{"tenant_created", "tenant_admin_invited", "tenant_admin_invited"}
	wantTargets := []string{tenant.ID.String(), "owner@comics.example.com", "editor@comics.example.com"}
	if len(audit) != len(wantActions) {
		t.Fatalf("audit entries = %+v, want %d", audit, len(wantActions))
	}
	for i, row := range audit {
		if row.action != wantActions[i] || row.targetID != wantTargets[i] {
			t.Fatalf("audit entry %d = %s %s, want %s %s", i, row.action, row.targetID, wantActions[i], wantTargets[i])
		}
		if row.actorUserID.UUID != operator.ID || row.actorRole != operator.Role || row.clientIP.String != "203.0.113.10" {
			t.Fatalf("audit entry %d = %+v, want it filed under the operator", i, row)
		}
	}
}

// publiractl has no session, so its entries name no operator.
func TestCreateFilesTheSystemActorWithNoOperator(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	if _, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name:               "Example Comics",
		Domain:             "comics.example.com",
		DefaultLocale:      "ja",
		InitialAdminEmails: []string{"owner@comics.example.com"},
	}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	audit := platformAuditRows(t, pg)
	if len(audit) != 2 {
		t.Fatalf("audit entries = %+v, want 2", audit)
	}
	for _, row := range audit {
		if row.actorUserID.Valid || row.actorRole != auditlog.RoleSystem || row.clientIP.Valid {
			t.Fatalf("audit entry = %+v, want the system actor with no operator", row)
		}
	}
}

func TestCreateRefusesADomainAnotherTenantHolds(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	if _, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name:          "First",
		Domain:        "first.example.com",
		AdminDomain:   "admin.first.example.com",
		DefaultLocale: "en",
	}); err != nil {
		t.Fatalf("Create first: %v", err)
	}

	for _, tc := range []struct {
		name   string
		params CreateParams
		field  string
	}{
		{name: "domain", params: CreateParams{Name: "Second", Domain: "first.example.com", DefaultLocale: "en"}, field: FieldDomain},
		{name: "admin domain", params: CreateParams{Name: "Second", Domain: "second.example.com", AdminDomain: "admin.first.example.com", DefaultLocale: "en"}, field: FieldAdminDomain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := create(t, pg, auditlog.SystemPlatformActor, tc.params)
			var conflict *ConflictError
			if !errors.As(err, &conflict) {
				t.Fatalf("err = %v, want *ConflictError", err)
			}
			if conflict.Field != tc.field {
				t.Fatalf("field = %q, want %q", conflict.Field, tc.field)
			}
		})
	}
}
