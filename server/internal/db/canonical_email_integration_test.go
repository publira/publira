package dbtest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailaddress"
	"github.com/publira/publira/server/internal/testutil"
)

// The database's canonical_email and the server's emailaddress.Canonical are
// one rule written twice, once for the index and once for the comparisons Go
// makes, so they must agree on every address either one sees.
func TestCanonicalEmailMatchesTheServer(t *testing.T) {
	pg := testutil.StartPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, address := range []string{
		"john@example.com",
		"john+news@example.com",
		"John+News@Example.COM",
		"john+a+b@example.com",
		"+news@example.com",
		"john@ex+ample.com",
		"j.o.h.n@example.com",
		"ÉMILE+x@MÜNCHEN.de",
		"ΣΟΦΙΑ@example.gr",
		"İSTANBUL@example.com.tr",
		"John+news",
		"a+b@c@Example.com",
		`"a@b"+x@Example.com`,
		"a@b+c@Example.com",
		"a+b@ex+ample.com",
		"",
	} {
		var got string
		if err := pg.DB.QueryRowContext(ctx, `SELECT canonical_email($1)`, address).Scan(&got); err != nil {
			t.Fatalf("canonical_email(%q): %v", address, err)
		}
		if want := emailaddress.Canonical(address); got != want {
			t.Errorf("canonical_email(%q) = %q, emailaddress.Canonical = %q", address, got, want)
		}
	}
}

// A tenant may already hold two accounts whose addresses differ only by a tag.
// The lookup still answers one of them: the address as given when the tenant
// holds it, else the oldest, and never an account of another tenant.
func TestGetUserByCanonicalEmailForTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantA := mustInsertTenant(t, ctx, pg.DB, "TCEA", "canonical-a.example.com", "admin-canonical-a.example.com", "Tenant A")
	tenantB := mustInsertTenant(t, ctx, pg.DB, "TCEB", "canonical-b.example.com", "admin-canonical-b.example.com", "Tenant B")
	plain := mustInsertUser(t, ctx, pg.DB, tenantA, "UCEA", "john@example.com", "John")
	tagged := mustInsertUser(t, ctx, pg.DB, tenantA, "UCEB", "john+a@example.com", "John A")
	other := mustInsertUser(t, ctx, pg.DB, tenantB, "UCEC", "John+b@Example.com", "John B")

	q := dbmodels.New(pg.DB)
	for _, tc := range []struct {
		name   string
		tenant uuid.UUID
		email  string
		want   uuid.UUID
	}{
		{name: "the address as stored", tenant: tenantA, email: "john@example.com", want: plain},
		{name: "the tagged sibling as stored", tenant: tenantA, email: "john+a@example.com", want: tagged},
		{name: "an unheld tag answers the oldest", tenant: tenantA, email: "JOHN+c@example.com", want: plain},
		{name: "another tenant's account", tenant: tenantB, email: "john@example.com", want: other},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user, err := q.GetUserByCanonicalEmailForTenant(ctx, dbmodels.GetUserByCanonicalEmailForTenantParams{
				TenantID: uuid.NullUUID{UUID: tc.tenant, Valid: true},
				Email:    tc.email,
			})
			if err != nil {
				t.Fatalf("GetUserByCanonicalEmailForTenant: %v", err)
			}
			if user.ID != tc.want {
				t.Fatalf("answered %s (%s), want %s", user.ID, user.Email, tc.want)
			}
		})
	}

	held, err := q.CanonicalEmailHeldByAnotherUserForTenant(ctx, dbmodels.CanonicalEmailHeldByAnotherUserForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenantB, Valid: true},
		Email:    "john+z@example.com",
		UserID:   other,
	})
	if err != nil {
		t.Fatalf("CanonicalEmailHeldByAnotherUserForTenant: %v", err)
	}
	if held {
		t.Fatal("an account's own inbox counted as held by another account")
	}
	held, err = q.CanonicalEmailHeldByAnotherUserForTenant(ctx, dbmodels.CanonicalEmailHeldByAnotherUserForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenantA, Valid: true},
		Email:    "john+z@example.com",
		UserID:   plain,
	})
	if err != nil {
		t.Fatalf("CanonicalEmailHeldByAnotherUserForTenant: %v", err)
	}
	if !held {
		t.Fatal("the tagged sibling's inbox did not count as held by another account")
	}
}

// Every sign-up and every email change asks for the inbox, so the lookup has
// to stay on idx_users_tenant_id_canonical_email rather than scan the tenant's
// accounts.
func TestGetUserByCanonicalEmailForTenantUsesTheIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pg.DB.Conn(ctx)
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	if _, err := conn.ExecContext(ctx, `SET enable_seqscan = off`); err != nil {
		t.Fatalf("disable sequential scans: %v", err)
	}
	rows, err := conn.QueryContext(ctx, `EXPLAIN `+dbmodels.GetUserByCanonicalEmailForTenant, uuid.New(), "john+a@example.com")
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(line + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read plan: %v", err)
	}
	if !strings.Contains(plan.String(), "idx_users_tenant_id_canonical_email") {
		t.Fatalf("the lookup does not use idx_users_tenant_id_canonical_email:\n%s", plan.String())
	}
}
