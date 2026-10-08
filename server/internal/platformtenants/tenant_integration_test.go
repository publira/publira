package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenantstatus"
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
	tenantID := created.Tenant.ID

	update := func(p UpdateParams) (dbmodels.Tenant, error) {
		p.ID = tenantID
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

	if _, err := (UpdateParams{ID: tenantID}).Validate(); !errors.Is(err, ErrNoChange) {
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

func TestUpdateRefusesAHostAnotherTenantServes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	for _, p := range []CreateParams{
		{Name: "Stored", Domain: "stored.example.com", AdminDomain: "console.stored.example.com", DefaultLocale: "en"},
		{Name: "Implied", Domain: "implied.example.com", DefaultLocale: "en"},
		// Domains that are the admin.{domain} of a name no tenant has yet.
		{Name: "Prefixed", Domain: "admin.shop.example.com", DefaultLocale: "en"},
		{Name: "Prefixed own", Domain: "admin.target.example.com", DefaultLocale: "en"},
	} {
		if _, err := create(t, pg, auditlog.SystemPlatformActor, p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}
	// The tenant every case changes, whose own console host has to be a name of
	// its own: admin.target.example.com is another tenant's domain.
	target, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name: "Target", Domain: "target.example.com", AdminDomain: "console.target.example.com", DefaultLocale: "en",
	})
	if err != nil {
		t.Fatalf("Create target: %v", err)
	}

	update := func(p UpdateParams) error {
		p.ID = target.Tenant.ID
		c, err := p.Validate()
		if err != nil {
			t.Fatalf("Validate: %v", err)
		}
		return inPlatformTx(t, pg, func(tx *sql.Tx) error {
			_, err := Update(context.Background(), tx, nil, auditlog.SystemPlatformActor, c)
			return err
		})
	}

	for _, tc := range []struct {
		name   string
		params UpdateParams
		field  string
	}{
		{name: "domain equal to a stored console host", params: UpdateParams{Domain: ptr("console.stored.example.com")}, field: FieldDomain},
		{name: "domain equal to an implied console host", params: UpdateParams{Domain: ptr("admin.implied.example.com")}, field: FieldDomain},
		{name: "admin domain equal to a domain", params: UpdateParams{AdminDomain: ptr("implied.example.com")}, field: FieldAdminDomain},
		{name: "admin domain equal to an implied console host", params: UpdateParams{AdminDomain: ptr("admin.implied.example.com")}, field: FieldAdminDomain},
		{name: "admin domain equal to its own domain", params: UpdateParams{AdminDomain: ptr("target.example.com")}, field: FieldAdminDomain},
		{name: "clearing the admin domain onto a domain", params: UpdateParams{AdminDomain: ptr("")}, field: FieldAdminDomain},
		{name: "a domain whose implied console host is a domain", params: UpdateParams{Domain: ptr("shop.example.com"), AdminDomain: ptr("")}, field: FieldAdminDomain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := update(tc.params)
			var conflict *fielderr.Conflict
			if !errors.As(err, &conflict) {
				t.Fatalf("err = %v, want *fielderr.Conflict", err)
			}
			if conflict.Field != tc.field {
				t.Fatalf("field = %q, want %q", conflict.Field, tc.field)
			}
		})
	}

	// Its own hosts are not another tenant's: storing the console host its new
	// domain would imply anyway is a change, not a collision.
	if err := update(UpdateParams{Domain: ptr("moved.example.com"), AdminDomain: ptr("admin.moved.example.com")}); err != nil {
		t.Fatalf("store the implied console host: %v", err)
	}
	if err := update(UpdateParams{AdminDomain: ptr("")}); err != nil {
		t.Fatalf("clear the admin domain back to the same host: %v", err)
	}
	// A rename moves no host name, so it is not judged by them.
	if err := update(UpdateParams{Name: ptr("Renamed")}); err != nil {
		t.Fatalf("rename: %v", err)
	}
}

func TestRenameKeepsTheHostsAConcurrentUpdateWrites(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	created, err := create(t, pg, auditlog.SystemPlatformActor, CreateParams{
		Name: "Tenant A", Domain: "tenant-a.example.com", DefaultLocale: "en",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	validate := func(p UpdateParams) Change {
		t.Helper()
		p.ID = created.Tenant.ID
		c, err := p.Validate()
		if err != nil {
			t.Fatalf("Validate: %v", err)
		}
		return c
	}
	db := pg.OpenPlatformDB(t)

	// The domain change holds its transaction open while the rename starts.
	move, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer move.Rollback() //nolint:errcheck
	if _, err := Update(ctx, move, nil, auditlog.SystemPlatformActor, validate(UpdateParams{Domain: ptr("moved.example.com")})); err != nil {
		t.Fatalf("move: %v", err)
	}

	rename := validate(UpdateParams{Name: ptr("Renamed")})
	renamed := make(chan error, 1)
	go func() {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			renamed <- err
			return
		}
		defer tx.Rollback() //nolint:errcheck
		if _, err := Update(ctx, tx, nil, auditlog.SystemPlatformActor, rename); err != nil {
			renamed <- err
			return
		}
		renamed <- tx.Commit()
	}()

	waitForHostsLock(t, pg, renamed)
	if err := move.Commit(); err != nil {
		t.Fatalf("Commit move: %v", err)
	}
	if err := <-renamed; err != nil {
		t.Fatalf("rename: %v", err)
	}

	tenant, err := GetByID(ctx, dbmodels.New(pg.DB), created.Tenant.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if tenant.Name != "Renamed" || tenant.Domain != "moved.example.com" {
		t.Fatalf("tenant = %q on %q, want the rename on the moved domain", tenant.Name, tenant.Domain)
	}
}

func TestSuspendAndResumeFileTheirEntries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	seeded := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	for _, step := range []struct {
		change func(context.Context, *sql.Tx, *slog.Logger, auditlog.PlatformActor, uuid.UUID) (dbmodels.Tenant, error)
		status string
	}{
		{change: Suspend, status: tenantstatus.Suspended},
		{change: Resume, status: tenantstatus.Active},
	} {
		var tenant dbmodels.Tenant
		if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
			tenant, err = step.change(context.Background(), tx, nil, auditlog.SystemPlatformActor, seeded.ID)
			return err
		}); err != nil {
			t.Fatalf("change to %s: %v", step.status, err)
		}
		if tenant.Status != step.status {
			t.Fatalf("status = %q, want %q", tenant.Status, step.status)
		}
	}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := Suspend(context.Background(), tx, nil, auditlog.SystemPlatformActor, uuid.Must(uuid.NewV7()))
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
		if e.targetID != invited.Invitation.ID.String() {
			t.Fatalf("audit entry = %+v, want it to name the invitation", e)
		}
		actions = append(actions, e.action)
	}
	if got := strings.Join(actions, ","); got != "tenant_admin_invited,tenant_admin_invite_resent,tenant_admin_invite_canceled" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestMemberChangesFileTheirEntries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	operator := pg.SeedPlatformOperator(t, "PLATOPS01", "operator@platform.example.com", "Operator")
	actor := auditlog.PlatformActor{UserID: operator.ID, Role: operator.Role, ClientIP: "203.0.113.10"}
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@tenant-a.example.com", "Reader")
	ctx := context.Background()

	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := AddMember(ctx, tx, nil, actor, tenantmembers.AddParams{TenantID: tenant.ID, UserID: reader.ID, Role: auth.RoleTenantEditor})
		return err
	}); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := UpdateMemberRole(ctx, tx, nil, actor, tenantmembers.UpdateRoleParams{TenantID: tenant.ID, UserID: reader.ID, Role: auth.RoleTenantAdmin})
		return err
	}); err != nil {
		t.Fatalf("UpdateMemberRole: %v", err)
	}
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := RemoveMember(ctx, tx, nil, actor, tenantmembers.RemoveParams{TenantID: tenant.ID, UserID: reader.ID})
		return err
	}); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}

	var actions []string
	for _, e := range platformAuditRows(t, pg) {
		if e.targetID != reader.ID.String() {
			t.Fatalf("audit entry = %+v, want it to name the user", e)
		}
		if e.actorUserID.UUID != operator.ID || e.actorRole != operator.Role || e.clientIP.String != "203.0.113.10" {
			t.Fatalf("audit entry = %+v, want it filed under the operator", e)
		}
		actions = append(actions, e.action)
	}
	if got := strings.Join(actions, ","); got != "tenant_member_added,tenant_member_role_updated,tenant_member_removed" {
		t.Fatalf("audit actions = %s", got)
	}
}

// A role change whose entry cannot be written does not land either: an actor
// naming no operator is refused by the entry's foreign key.
func TestMemberChangeIsNotCommittedWithoutItsEntry(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@tenant-a.example.com", "Reader")
	unknown := auditlog.PlatformActor{UserID: uuid.Must(uuid.NewV7()), Role: auth.RolePlatformOperator}

	err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := AddMember(context.Background(), tx, nil, unknown, tenantmembers.AddParams{TenantID: tenant.ID, UserPublicID: reader.PublicID, Role: auth.RoleTenantAdmin})
		return err
	})
	if err == nil {
		t.Fatal("AddMember succeeded with an entry that cannot be written")
	}

	var roles int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM tenant_user_roles WHERE user_id = $1`, reader.ID).Scan(&roles); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	if roles != 0 {
		t.Fatalf("roles = %d, want the role rolled back with the entry", roles)
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
