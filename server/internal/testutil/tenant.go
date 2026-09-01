package testutil

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/tenanttz"
)

// Tenant is a seeded tenants row. Admin API requests address a tenant by its
// primary key, so tests need the UUID as well as the public ID.
type Tenant struct {
	ID          uuid.UUID
	PublicID    string
	Domain      string
	AdminDomain string
	Name        string
	// DefaultLocale is the locale [SeedTenant] stated for the row, so a test
	// asserting what an API answers names the seeded value rather than a
	// constant of its own.
	DefaultLocale string
}

// TenantUser is a seeded users row together with the tenant role it holds.
// Password is always [SeededPassword].
type TenantUser struct {
	ID                 uuid.UUID
	TenantID           uuid.UUID
	PublicID           string
	Email              string
	Name               string
	Role               string
	CredentialsVersion int32
}

// SeedTenant inserts an active tenant. The admin domain is derived from the
// domain so two tenants seeded with distinct domains never collide on it.
// Uses the superuser connection, which is not subject to RLS.
func (e *PostgresEnv) SeedTenant(t *testing.T, publicID, domain, name string) Tenant {
	t.Helper()
	if e.DB == nil {
		t.Fatal("postgres env db is nil; call Reset first if needed")
	}

	publicID = defaultIfEmpty(publicID, "TENANT001")
	domain = defaultIfEmpty(domain, "tenant.example.com")
	name = defaultIfEmpty(name, "Tenant")
	adminDomain := "admin-" + domain

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tenant, err := dbmodels.New(e.DB).CreateTenant(ctx, dbmodels.CreateTenantParams{
		ID:            uuid.Must(uuid.NewV7()),
		PublicID:      publicID,
		Domain:        domain,
		AdminDomain:   sql.NullString{String: adminDomain, Valid: true},
		Name:          name,
		Timezone:      tenanttz.Default,
		DefaultLocale: "ja",
	})
	if err != nil {
		t.Fatalf("CreateTenant %s: %v", publicID, err)
	}

	return Tenant{
		ID:            tenant.ID,
		PublicID:      tenant.PublicID,
		Domain:        tenant.Domain,
		AdminDomain:   adminDomain,
		Name:          tenant.Name,
		DefaultLocale: tenant.DefaultLocale,
	}
}

// SeedTenantAdmin inserts an active user holding the tenant_admin role, the
// account the admin console signs in as.
func (e *PostgresEnv) SeedTenantAdmin(t *testing.T, tenantID uuid.UUID, publicID, email, name string) TenantUser {
	t.Helper()
	return e.SeedTenantUser(t, tenantID, publicID, email, name, auth.RoleTenantAdmin)
}

// SeedEndUser inserts a member of the tenant's public site: an active user with
// a verified address and no tenant role, which is the only shape the public API
// lets sign in.
func (e *PostgresEnv) SeedEndUser(t *testing.T, tenantID uuid.UUID, publicID, email, name string) TenantUser {
	t.Helper()

	user := e.seedUser(t, tenantID, publicID, email, name)
	e.markEndUserVerified(t, user.ID)
	return user
}

// SeedUnverifiedEndUser inserts the state signup leaves behind before the
// address is confirmed: inactive, with email_verified_at still null.
func (e *PostgresEnv) SeedUnverifiedEndUser(t *testing.T, tenantID uuid.UUID, publicID, email, name string) TenantUser {
	t.Helper()

	user := e.seedUser(t, tenantID, publicID, email, name)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(e.DB).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{
		ID:     user.ID,
		Status: "inactive",
	}); err != nil {
		t.Fatalf("UpdateUserStatusByID %s: %v", publicID, err)
	}
	return user
}

func (e *PostgresEnv) markEndUserVerified(t *testing.T, userID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(e.DB).UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              userID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("UpdateUserEmailVerifiedAtByID %s: %v", userID, err)
	}
}

// SeedTenantUser inserts an active user in the tenant and grants it one tenant
// role (tenant_admin / tenant_editor / tenant_auditor).
func (e *PostgresEnv) SeedTenantUser(t *testing.T, tenantID uuid.UUID, publicID, email, name, role string) TenantUser {
	t.Helper()

	user := e.seedUser(t, tenantID, publicID, email, name)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := dbmodels.New(e.DB).CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenantID,
		UserID:   user.ID,
		Role:     role,
	}); err != nil {
		t.Fatalf("CreateTenantUserRole for %s: %v", user.PublicID, err)
	}

	user.Role = role
	return user
}

// seedUser inserts the users row shared by every kind of account in a tenant.
// The caller decides what the account is by what it adds on top: a tenant role,
// a verified address, or neither.
func (e *PostgresEnv) seedUser(t *testing.T, tenantID uuid.UUID, publicID, email, name string) TenantUser {
	t.Helper()
	if e.DB == nil {
		t.Fatal("postgres env db is nil; call Reset first if needed")
	}

	publicID = defaultIfEmpty(publicID, "TENANTUSER01")
	email = defaultIfEmpty(email, "admin@example.com")
	name = defaultIfEmpty(name, "Tenant Admin")

	passwordHash, err := auth.HashPassword(SeededPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	user, err := dbmodels.New(e.DB).CreateUser(ctx, dbmodels.CreateUserParams{
		ID:           uuid.Must(uuid.NewV7()),
		TenantID:     uuid.NullUUID{UUID: tenantID, Valid: true},
		PublicID:     publicID,
		Email:        email,
		PasswordHash: passwordHash,
		Name:         name,
	})
	if err != nil {
		t.Fatalf("CreateUser %s: %v", publicID, err)
	}

	return TenantUser{
		ID:                 user.ID,
		TenantID:           tenantID,
		PublicID:           user.PublicID,
		Email:              user.Email,
		Name:               user.Name,
		CredentialsVersion: user.CredentialsVersion,
	}
}
