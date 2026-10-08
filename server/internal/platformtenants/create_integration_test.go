package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/creatorroles"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
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
	wantTargets := []string{tenant.ID.String(), created.Invitations[0].ID.String(), created.Invitations[1].ID.String()}
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

func TestCreateRefusesAHostAnotherTenantServes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	for _, p := range []CreateParams{
		// A console host of its own, and one implied by the domain.
		{Name: "Stored", Domain: "stored.example.com", AdminDomain: "console.stored.example.com", DefaultLocale: "en"},
		{Name: "Implied", Domain: "implied.example.com", DefaultLocale: "en"},
		// A domain that is the admin.{domain} of a name no tenant has yet.
		{Name: "Prefixed", Domain: "admin.shop.example.com", DefaultLocale: "en"},
	} {
		if _, err := create(t, pg, auditlog.SystemPlatformActor, p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	for _, tc := range []struct {
		name        string
		domain      string
		adminDomain string
		field       string
	}{
		{name: "domain equal to a domain", domain: "stored.example.com", field: FieldDomain},
		{name: "domain equal to a stored console host", domain: "console.stored.example.com", field: FieldDomain},
		{name: "domain equal to an implied console host", domain: "admin.implied.example.com", field: FieldDomain},
		{name: "admin domain equal to a stored console host", domain: "new.example.com", adminDomain: "console.stored.example.com", field: FieldAdminDomain},
		{name: "admin domain equal to an implied console host", domain: "new.example.com", adminDomain: "admin.implied.example.com", field: FieldAdminDomain},
		{name: "admin domain equal to a domain", domain: "new.example.com", adminDomain: "implied.example.com", field: FieldAdminDomain},
		{name: "implied console host equal to a domain", domain: "shop.example.com", field: FieldAdminDomain},
		{name: "admin domain equal to its own domain", domain: "new.example.com", adminDomain: "new.example.com", field: FieldAdminDomain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
				Name: "New", Domain: tc.domain, AdminDomain: tc.adminDomain, DefaultLocale: "en",
			})
			var conflict *fielderr.Conflict
			if !errors.As(err, &conflict) {
				t.Fatalf("err = %v, want *fielderr.Conflict", err)
			}
			if conflict.Field != tc.field {
				t.Fatalf("field = %q, want %q", conflict.Field, tc.field)
			}
		})
	}

	// The implied console host of shop.example.com is taken, and an admin
	// domain of its own is what lets it in.
	if _, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name: "Shop", Domain: "shop.example.com", AdminDomain: "console.shop.example.com", DefaultLocale: "en",
	}); err != nil {
		t.Fatalf("Create with an admin domain of its own: %v", err)
	}
}

func TestCreateRefusesAHostAConcurrentCreateTakes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	db := pg.OpenPlatformDB(t)
	validate := func(p CreateParams) Creation {
		t.Helper()
		c, err := p.Validate()
		if err != nil {
			t.Fatalf("Validate: %v", err)
		}
		return c
	}

	// The first create holds its transaction open, with its tenant written,
	// while the second one claims the console host that tenant's domain is.
	first, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer first.Rollback() //nolint:errcheck
	if _, err := Create(ctx, first, nil, auditlog.SystemPlatformActor, validate(CreateParams{
		Name: "First", Domain: "admin.comics.example.com", DefaultLocale: "en",
	})); err != nil {
		t.Fatalf("Create first: %v", err)
	}

	secondCreation := validate(CreateParams{Name: "Second", Domain: "comics.example.com", DefaultLocale: "en"})
	second := make(chan error, 1)
	go func() {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			second <- err
			return
		}
		defer tx.Rollback() //nolint:errcheck
		if _, err := Create(ctx, tx, nil, auditlog.SystemPlatformActor, secondCreation); err != nil {
			second <- err
			return
		}
		second <- tx.Commit()
	}()

	// Commit the first only once the second is queued behind it, so the second
	// cannot have read the hosts before the first tenant was there to see.
	waitForHostsLock(t, pg, second)
	if err := first.Commit(); err != nil {
		t.Fatalf("Commit first: %v", err)
	}

	err = <-second
	var conflict *fielderr.Conflict
	if !errors.As(err, &conflict) || conflict.Field != FieldAdminDomain {
		t.Fatalf("second create: err = %v, want a conflict on %s", err, FieldAdminDomain)
	}
}

// waitForHostsLock returns once a transaction is waiting for the lock tenant
// hosts are claimed under, failing when done reports the write it was waiting
// for finished first instead.
func waitForHostsLock(t *testing.T, pg *testutil.PostgresEnv, done <-chan error) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); ; {
		var waiting bool
		if err := pg.DB.QueryRowContext(context.Background(),
			`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted)`).Scan(&waiting); err != nil {
			t.Fatalf("read pg_locks: %v", err)
		}
		if waiting {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("finished without waiting for the open transaction: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("never waited for the open transaction")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
