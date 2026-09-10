package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A birth date is written once, and what enforces that is a WHERE clause in
// the UPDATE rather than the read above it: a second request that raced the
// first past that read still has to match no row. Only a real database shows
// that, so the profile RPCs are driven here.

// storedBirthDate reads the column back over the superuser connection, so an
// assertion looks at what was written rather than at what the handler chose to
// answer with.
func storedBirthDate(t *testing.T, env *publicDBEnv, userID uuid.UUID) sql.NullTime {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var birthDate sql.NullTime
	if err := env.PG.DB.QueryRowContext(ctx,
		"SELECT birth_date FROM users WHERE id = $1", userID,
	).Scan(&birthDate); err != nil {
		t.Fatalf("read birth_date: %v", err)
	}
	return birthDate
}

func TestDBUpdateMeStoresABirthDateGetMeAnswersWith(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()
	token := tokenFor(t, tenant, reader)

	before, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, token,
	))
	if err != nil {
		t.Fatalf("GetMe before: %v", err)
	}
	if before.Msg.User.BirthDate != "" {
		t.Fatalf("birth_date before = %q, want empty", before.Msg.User.BirthDate)
	}

	updated, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Member", BirthDate: "2000-04-02"}, token,
	))
	if err != nil {
		t.Fatalf("UpdateMe: %v", err)
	}
	if updated.Msg.User.BirthDate != "2000-04-02" {
		t.Fatalf("birth_date from UpdateMe = %q, want 2000-04-02", updated.Msg.User.BirthDate)
	}

	after, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, token,
	))
	if err != nil {
		t.Fatalf("GetMe after: %v", err)
	}
	if after.Msg.User.BirthDate != "2000-04-02" {
		t.Fatalf("birth_date from GetMe = %q, want 2000-04-02", after.Msg.User.BirthDate)
	}
}

// The second write is refused, and the stored date is the one the reader gave
// first. Changing it goes through support.
func TestDBUpdateMeRefusesASecondBirthDate(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()
	token := tokenFor(t, tenant, reader)

	if _, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Member", BirthDate: "2000-04-02"}, token,
	)); err != nil {
		t.Fatalf("UpdateMe: %v", err)
	}

	_, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Renamed", BirthDate: "1990-01-01"}, token,
	))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	stored := storedBirthDate(t, env, reader.ID)
	if !stored.Valid || stored.Time.Format(time.DateOnly) != "2000-04-02" {
		t.Fatalf("stored birth_date = %v, want 2000-04-02", stored)
	}
	// The refusal took the rename with it: the two are one transaction, so a
	// profile save either lands whole or not at all.
	if count := env.countRows(t,
		"SELECT count(*) FROM users WHERE id = $1 AND name = 'Member'", reader.ID,
	); count != 1 {
		t.Fatalf("name after the refused save = %d rows still called Member, want 1", count)
	}
}

// An empty field is a form that is only renaming the account, not one asking
// for the stored date to be cleared.
func TestDBUpdateMeLeavesAStoredBirthDateAloneWhenTheFieldIsEmpty(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()
	token := tokenFor(t, tenant, reader)

	if _, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Member", BirthDate: "2000-04-02"}, token,
	)); err != nil {
		t.Fatalf("UpdateMe with the birth date: %v", err)
	}

	renamed, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Renamed"}, token,
	))
	if err != nil {
		t.Fatalf("UpdateMe with the name alone: %v", err)
	}
	if renamed.Msg.User.Name != "Renamed" {
		t.Fatalf("name = %q, want Renamed", renamed.Msg.User.Name)
	}
	if renamed.Msg.User.BirthDate != "2000-04-02" {
		t.Fatalf("birth_date = %q, want 2000-04-02", renamed.Msg.User.BirthDate)
	}
}

func TestDBUpdateMeRejectsADateItWillNotStore(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()
	token := tokenFor(t, tenant, reader)

	for _, raw := range []string{"2000-4-2", "02/04/2000", "3000-01-01", "not a date"} {
		_, err := client.UpdateMe(context.Background(), newBearerRequest(
			&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Member", BirthDate: raw}, token,
		))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdateMe(%q) code = %v, want invalid_argument (err=%v)", raw, connect.CodeOf(err), err)
		}
	}
	if stored := storedBirthDate(t, env, reader.ID); stored.Valid {
		t.Fatalf("stored birth_date = %v, want none", stored)
	}
}

// A tenant that verifies ages asks for the birth date on the sign-up form, so
// the account carries it from the moment it exists.
func TestDBCreateUserStoresTheBirthDateGivenAtSignup(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if _, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:    tenantContext(tenant),
		Name:      "Newcomer",
		Email:     "newcomer@tenant-a.example.com",
		Password:  testutil.SeededPassword,
		BirthDate: "2000-04-02",
	})); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM users WHERE email = $1 AND birth_date = DATE '2000-04-02'",
		"newcomer@tenant-a.example.com",
	); count != 1 {
		t.Fatalf("accounts stored with the birth date = %d, want 1", count)
	}
}

// A form that did not ask sends nothing, and the account is created without a
// date: whether one is asked for is the tenant's rule, not this handler's.
func TestDBCreateUserAcceptsASignupWithNoBirthDate(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if _, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Newcomer",
		Email:    "newcomer@tenant-a.example.com",
		Password: testutil.SeededPassword,
	})); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM users WHERE email = $1 AND birth_date IS NULL",
		"newcomer@tenant-a.example.com",
	); count != 1 {
		t.Fatalf("accounts stored without a birth date = %d, want 1", count)
	}
}

func TestDBCreateUserRejectsADateItWillNotStore(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:    tenantContext(tenant),
		Name:      "Newcomer",
		Email:     "newcomer@tenant-a.example.com",
		Password:  testutil.SeededPassword,
		BirthDate: "3000-01-01",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM users WHERE email = $1", "newcomer@tenant-a.example.com",
	); count != 0 {
		t.Fatalf("accounts created = %d, want none", count)
	}
}
