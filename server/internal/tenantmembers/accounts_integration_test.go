package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/testutil"
)

// inPlatformTx runs fn as publira_platform, the login publiractl writes with,
// and commits when it succeeds.
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

func TestCreateAccountWritesAnActiveVerifiedMember(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	var member Member
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
		member, err = CreateAccount(context.Background(), tx, AccountParams{
			TenantID: tenant.ID,
			Email:    " Owner@Tenant-A.example.com ",
			Name:     " Owner ",
			Password: " correct horse ",
			Role:     auth.RoleTenantAdmin,
		})
		return err
	}); err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}

	user, err := dbmodels.New(pg.DB).GetUserByEmailForTenant(context.Background(), dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    "owner@tenant-a.example.com",
	})
	if err != nil {
		t.Fatalf("GetUserByEmailForTenant: %v", err)
	}
	if user.ID != member.UserID || user.Name != "Owner" || user.Status != "active" || !user.EmailVerifiedAt.Valid {
		t.Fatalf("user = %+v, want an active, verified Owner", user)
	}
	if !auth.VerifyPassword(" correct horse ", user.PasswordHash) {
		t.Fatal("the stored hash does not verify the password as given")
	}
	roles, err := dbmodels.New(pg.DB).ListTenantUserRoles(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("ListTenantUserRoles: %v", err)
	}
	if len(roles) != 1 || roles[0] != auth.RoleTenantAdmin || member.Role != auth.RoleTenantAdmin {
		t.Fatalf("roles = %q, member.Role = %q; want tenant_admin alone", roles, member.Role)
	}
}

func TestCreateAccountRefusesAnAddressTheTenantHas(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pg.SeedEndUser(t, tenant.ID, "READER01", "reader@tenant-a.example.com", "Reader")

	err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := CreateAccount(context.Background(), tx, AccountParams{
			TenantID: tenant.ID,
			Email:    "reader@tenant-a.example.com",
			Name:     "Reader",
			Password: "secret",
			Role:     auth.RoleTenantEditor,
		})
		return err
	})
	var conflict *fielderr.Conflict
	if !errors.As(err, &conflict) || conflict.Field != FieldEmail {
		t.Fatalf("err = %v, want a conflict on email", err)
	}
}

func TestAddGivesAUserOfTheTenantARole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	byID := pg.SeedEndUser(t, tenant.ID, "READER01", "first@tenant-a.example.com", "First")
	pg.SeedEndUser(t, tenant.ID, "READER02", "second@tenant-a.example.com", "Second")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMIN001", "admin@tenant-a.example.com", "Admin")

	for _, tc := range []struct {
		name   string
		params AddParams
		want   string
		err    error
	}{
		{name: "by public ID", params: AddParams{UserPublicID: byID.PublicID, Role: auth.RoleTenantEditor}, want: "READER01"},
		{name: "by email", params: AddParams{Email: "Second@Tenant-A.example.com", Role: auth.RoleTenantAuditor}, want: "READER02"},
		{name: "a user with a role already", params: AddParams{UserPublicID: admin.PublicID, Role: auth.RoleTenantEditor}, err: ErrAlreadyMember},
		{name: "no such user", params: AddParams{Email: "nobody@tenant-a.example.com", Role: auth.RoleTenantEditor}, err: ErrMemberNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.params.TenantID = tenant.ID
			var member Member
			err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
				member, err = Add(context.Background(), tx, tc.params)
				return err
			})
			if tc.err != nil {
				if !errors.Is(err, tc.err) {
					t.Fatalf("err = %v, want %v", err, tc.err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Add: %v", err)
			}
			if member.PublicID != tc.want || member.Role != tc.params.Role {
				t.Fatalf("member = %+v, want %s as %s", member, tc.want, tc.params.Role)
			}
		})
	}
}
