package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/testutil"
)

// inPlatformTx runs fn as publira_platform and commits when it succeeds.
func inPlatformTx(t *testing.T, pg *testutil.PostgresEnv, fn func(tx *sql.Tx) error) error {
	t.Helper()
	ctx := context.Background()
	tx, err := pg.OpenPlatformDB(t).BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return nil
}

func ptr(s string) *string { return &s }

func TestFindNamesATenantByPublicIDOrDomain(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	seeded := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	q := dbmodels.New(pg.DB)

	for _, ref := range []string{"TENANTAAAAAA", " tenant-a.example.com "} {
		tenant, err := Find(context.Background(), q, ref)
		if err != nil {
			t.Fatalf("Find(%q): %v", ref, err)
		}
		if tenant.ID != seeded.ID {
			t.Fatalf("Find(%q) = %s, want %s", ref, tenant.PublicID, seeded.PublicID)
		}
	}
	if _, err := Find(context.Background(), q, "other.example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown domain: err = %v, want ErrNotFound", err)
	}
	if _, err := Find(context.Background(), q, " "); fielderr.Field(err) != FieldTenant {
		t.Fatalf("blank: err = %v, want a refusal on %s", err, FieldTenant)
	}
}

func TestUpdateChangesOnlyTheFieldsItIsGiven(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	created, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name: "Tenant A", Domain: "tenant-a.example.com", AdminDomain: "console.tenant-a.example.com", DefaultLocale: "en",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	publicID := created.Tenant.PublicID

	update := func(p UpdateParams) (dbmodels.Tenant, error) {
		p.PublicID = publicID
		c, err := p.Validate()
		if err != nil {
			return dbmodels.Tenant{}, err
		}
		var tenant dbmodels.Tenant
		err = inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
			tenant, err = Update(context.Background(), tx, nil, auditlog.SystemPlatformActor, c)
			return err
		})
		return tenant, err
	}

	tenant, err := update(UpdateParams{Name: ptr(" Renamed ")})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if tenant.Name != "Renamed" || tenant.Domain != "tenant-a.example.com" || tenant.AdminDomain.String != "console.tenant-a.example.com" {
		t.Fatalf("after rename = %+v, want only the name changed", tenant)
	}

	tenant, err = update(UpdateParams{AdminDomain: ptr("")})
	if err != nil {
		t.Fatalf("clear admin domain: %v", err)
	}
	if tenant.AdminDomain.Valid || tenant.Name != "Renamed" {
		t.Fatalf("after clearing = %+v, want the admin domain unset and the name kept", tenant)
	}

	if _, err := (UpdateParams{PublicID: publicID}).Validate(); !errors.Is(err, ErrNoChange) {
		t.Fatalf("nothing to change: err = %v, want ErrNoChange", err)
	}

	pg.SeedTenant(t, "TENANTBBBBBB", "tenant-b.example.com", "Tenant B")
	var conflict *fielderr.Conflict
	if _, err := update(UpdateParams{Domain: ptr("tenant-b.example.com")}); !errors.As(err, &conflict) || conflict.Field != FieldDomain {
		t.Fatalf("taken domain: err = %v, want a conflict on domain", err)
	}

	entries := platformAuditRows(t, pg)
	var updates int
	for _, e := range entries {
		if e.action == "tenant_info_updated" {
			updates++
		}
	}
	if updates != 2 {
		t.Fatalf("tenant_info_updated entries = %d, want one per committed update", updates)
	}
}

func TestSuspendAndResumeFileTheirEntries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	seeded := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	for _, step := range []struct {
		change func(context.Context, *sql.Tx, *slog.Logger, auditlog.PlatformActor, string) (dbmodels.Tenant, error)
		status string
	}{
		{change: Suspend, status: StatusSuspended},
		{change: Resume, status: StatusActive},
	} {
		var tenant dbmodels.Tenant
		if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
			tenant, err = step.change(context.Background(), tx, nil, auditlog.SystemPlatformActor, seeded.PublicID)
			return err
		}); err != nil {
			t.Fatalf("change to %s: %v", step.status, err)
		}
		if tenant.Status != step.status {
			t.Fatalf("status = %q, want %q", tenant.Status, step.status)
		}
	}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := Suspend(context.Background(), tx, nil, auditlog.SystemPlatformActor, "NOSUCHTENANT")
		return err
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown tenant: err = %v, want ErrNotFound", err)
	}

	entries := platformAuditRows(t, pg)
	if len(entries) != 2 || entries[0].action != "tenant_suspended" || entries[1].action != "tenant_resumed" {
		t.Fatalf("audit entries = %+v, want tenant_suspended then tenant_resumed", entries)
	}
	for _, e := range entries {
		if e.targetID != seeded.ID.String() || e.actorRole != auditlog.RoleSystem {
			t.Fatalf("audit entry = %+v, want the tenant under the system actor", e)
		}
	}
}

func TestInvitationChangesFileTheirEntries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	ctx := context.Background()

	var invited tenantmembers.Invited
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
		invited, err = Invite(ctx, tx, nil, auditlog.SystemPlatformActor, tenantmembers.InviteParams{TenantID: tenant.ID, Email: "owner@tenant-a.example.com"})
		return err
	}); err != nil {
		t.Fatalf("Invite: %v", err)
	}
	target := tenantmembers.InvitationParams{TenantID: tenant.ID, InvitationID: invited.Invitation.ID}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := ResendInvitation(ctx, tx, nil, auditlog.SystemPlatformActor, tenantmembers.ResendParams{TenantID: target.TenantID, InvitationID: target.InvitationID})
		return err
	}); err != nil {
		t.Fatalf("ResendInvitation: %v", err)
	}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := CancelInvitation(ctx, tx, nil, auditlog.SystemPlatformActor, target)
		return err
	}); err != nil {
		t.Fatalf("CancelInvitation: %v", err)
	}

	var mails int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM outbox_events WHERE tenant_id = $1`, tenant.ID).Scan(&mails); err != nil {
		t.Fatalf("count outbox_events: %v", err)
	}
	if mails != 2 {
		t.Fatalf("queued mails = %d, want one for the invitation and one for the resend", mails)
	}
	var actions []string
	for _, e := range platformAuditRows(t, pg) {
		if e.targetID != "owner@tenant-a.example.com" {
			t.Fatalf("audit entry = %+v, want it to name the address", e)
		}
		actions = append(actions, e.action)
	}
	if got := strings.Join(actions, ","); got != "tenant_admin_invited,tenant_admin_invite_resent,tenant_admin_invite_canceled" {
		t.Fatalf("audit actions = %s", got)
	}
}

// The entry for a created account names the user and nothing that could carry
// its password.
func TestCreateAccountFilesAnEntryWithoutThePassword(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	const password = "never-in-the-audit-log"

	var member tenantmembers.Member
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
		member, err = CreateAccount(context.Background(), tx, nil, auditlog.SystemPlatformActor, tenantmembers.AccountParams{
			TenantID: tenant.ID, Email: "owner@tenant-a.example.com", Name: "Owner", Password: password, Role: auth.RoleTenantAdmin,
		})
		return err
	}); err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}

	entries := platformAuditRows(t, pg)
	if len(entries) != 1 || entries[0].action != "tenant_member_created" || entries[0].targetID != member.UserID.String() {
		t.Fatalf("audit entries = %+v, want one tenant_member_created naming the user", entries)
	}
	var leaked int
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM platform_audit_logs WHERE row_to_json(platform_audit_logs)::text LIKE '%' || $1 || '%'`, password,
	).Scan(&leaked); err != nil {
		t.Fatalf("search platform_audit_logs: %v", err)
	}
	if leaked != 0 {
		t.Fatal("the password is in platform_audit_logs")
	}
}
