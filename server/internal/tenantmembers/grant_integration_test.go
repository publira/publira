package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// An account whose owner has not shown the address is theirs, or that an
// administrator suspended, is given no console role on an administrator's word
// alone: inviting its address mails an invitation, and adding it is refused.
// Only accepting the invitation, which takes following the mailed link, hands
// the account over.
func TestRoleIsGrantedWithoutInvitationOnlyToAnActiveConfirmedAccount(t *testing.T) {
	pg := testutil.StartPostgres(t)

	accounts := []struct {
		name string
		seed func(t *testing.T, tenantID uuid.UUID, email string) testutil.TenantUser
		// addErr is what Add refuses the account with, nil when it grants.
		addErr error
	}{
		{
			name: "active and confirmed",
			seed: func(t *testing.T, tenantID uuid.UUID, email string) testutil.TenantUser {
				return pg.SeedEndUser(t, tenantID, "READER01", email, "Reader")
			},
		},
		{
			name: "signed up and never confirmed",
			seed: func(t *testing.T, tenantID uuid.UUID, email string) testutil.TenantUser {
				return pg.SeedUnverifiedEndUser(t, tenantID, "READER01", email, "Applicant")
			},
			addErr: ErrAccountUnconfirmed,
		},
		{
			name: "active with an address never confirmed",
			seed: func(t *testing.T, tenantID uuid.UUID, email string) testutil.TenantUser {
				user := pg.SeedUnverifiedEndUser(t, tenantID, "READER01", email, "Applicant")
				setUserStatus(t, pg, user.ID, "active")
				return user
			},
			addErr: ErrAccountUnconfirmed,
		},
		{
			name: "suspended",
			seed: func(t *testing.T, tenantID uuid.UUID, email string) testutil.TenantUser {
				user := pg.SeedEndUser(t, tenantID, "READER01", email, "Reader")
				setUserStatus(t, pg, user.ID, "suspended")
				return user
			},
			addErr: ErrAccountSuspended,
		},
	}

	for _, account := range accounts {
		grants := account.addErr == nil

		t.Run(account.name+"/invite", func(t *testing.T) {
			pg.Reset(t)
			ctx := context.Background()
			tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			const email = "staff@tenant-a.example.com"
			user := account.seed(t, tenant.ID, email)

			invited := inTx(t, pg, func(tx *sql.Tx) (Invited, error) {
				return Invite(ctx, tx, InviteParams{TenantID: tenant.ID, Email: email})
			})

			if invited.RoleGrantedImmediately != grants {
				t.Fatalf("RoleGrantedImmediately = %v, want %v", invited.RoleGrantedImmediately, grants)
			}
			if grants {
				assertRoles(t, pg, user.ID, auth.RoleTenantAdmin)
				assertInvitationMails(t, pg, 0)
				return
			}
			assertRoles(t, pg, user.ID)
			if invited.Invitation.Email != email || invited.Invitation.Role != auth.RoleTenantAdmin {
				t.Fatalf("invitation = %s as %s, want %s as %s", invited.Invitation.Email, invited.Invitation.Role, email, auth.RoleTenantAdmin)
			}
			assertInvitationMails(t, pg, 1)
		})

		t.Run(account.name+"/add", func(t *testing.T) {
			pg.Reset(t)
			ctx := context.Background()
			tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			const email = "staff@tenant-a.example.com"
			user := account.seed(t, tenant.ID, email)

			tx, err := pg.DB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatalf("BeginTx: %v", err)
			}
			defer tx.Rollback() //nolint:errcheck
			_, err = Add(ctx, tx, AddParams{TenantID: tenant.ID, Email: email, Role: auth.RoleTenantAdmin})
			if !errors.Is(err, account.addErr) {
				t.Fatalf("Add error = %v, want %v", err, account.addErr)
			}
			if err != nil {
				return
			}
			if err := tx.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}
			assertRoles(t, pg, user.ID, auth.RoleTenantAdmin)
		})
	}
}

func inTx[T any](t *testing.T, pg *testutil.PostgresEnv, fn func(tx *sql.Tx) (T, error)) T {
	t.Helper()
	tx, err := pg.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	result, err := fn(tx)
	if err != nil {
		t.Fatalf("in tx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return result
}

func setUserStatus(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID, status string) {
	t.Helper()
	if _, err := dbmodels.New(pg.DB).UpdateUserStatusByID(context.Background(), dbmodels.UpdateUserStatusByIDParams{ID: userID, Status: status}); err != nil {
		t.Fatalf("UpdateUserStatusByID %s: %v", status, err)
	}
}

func assertRoles(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID, want ...string) {
	t.Helper()
	roles, err := dbmodels.New(pg.DB).ListTenantUserRoles(context.Background(), userID)
	if err != nil {
		t.Fatalf("ListTenantUserRoles: %v", err)
	}
	if len(roles) != len(want) || (len(want) > 0 && roles[0] != want[0]) {
		t.Fatalf("roles = %v, want %v", roles, want)
	}
}

func assertInvitationMails(t *testing.T, pg *testutil.PostgresEnv, want int) {
	t.Helper()
	var got int
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM outbox_events WHERE event_type = $1`,
		outbox.EventTypeTenantAdminInvitationEmail,
	).Scan(&got); err != nil {
		t.Fatalf("count invitation mails: %v", err)
	}
	if got != want {
		t.Fatalf("invitation mails = %d, want %d", got, want)
	}
}
