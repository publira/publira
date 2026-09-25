package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// nameLegalPages makes the given pages the tenant's terms and privacy policy.
func nameLegalPages(t *testing.T, env *publicDBEnv, tenantID, termsID, privacyID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, terms_page_id, privacy_page_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id) DO UPDATE
		SET terms_page_id = EXCLUDED.terms_page_id, privacy_page_id = EXCLUDED.privacy_page_id
	`, tenantID, termsID, privacyID); err != nil {
		t.Fatalf("name legal pages: %v", err)
	}
}

func signUpAgreeing(env *publicDBEnv, tenant testutil.Tenant, email string, versionIDs ...uuid.UUID) error {
	ids := make([]string, 0, len(versionIDs))
	for _, id := range versionIDs {
		ids = append(ids, id.String())
	}
	_, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:               tenantContext(tenant),
		Name:                 "Newcomer",
		Email:                email,
		Password:             "newcomer-password",
		AgreedPageVersionIds: ids,
	}))
	return err
}

// agreedVersions reads the consents an account was opened with, once the worker
// has taken the sign-ups waiting for it.
func agreedVersions(t *testing.T, env *publicDBEnv, email string) map[uuid.UUID]bool {
	t.Helper()

	env.processReaderAuthRequests(t)
	rows, err := env.PG.DB.Query(`
		SELECT c.page_version_id
		FROM user_page_consents c
			JOIN users u ON u.id = c.user_id
		WHERE u.email = $1
	`, email)
	if err != nil {
		t.Fatalf("read consents of %s: %v", email, err)
	}
	defer rows.Close() //nolint:errcheck
	got := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan consent: %v", err)
		}
		got[id] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read consents of %s: %v", email, err)
	}
	return got
}

func assertConsentRefused(t *testing.T, env *publicDBEnv, err error, email string) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateUser error = %v, want invalid_argument", err)
	}
	assertPublicBadRequestField(t, err, "agreed_page_version_ids")
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE email = $1`, email); count != 0 {
		t.Fatalf("accounts for %s after a refused sign-up = %d, want none", email, count)
	}
}

// A tenant that names its terms and privacy policy takes a sign-up only with
// consent to both, and keeps the version of each that was agreed to.
func TestDBCreateUserRecordsConsentToTheNamedPages(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	nameLegalPages(t, env, tenant.ID, terms.ID, privacy.ID)

	assertConsentRefused(t, env, signUpAgreeing(env, tenant, "none@tenant-a.example.com"), "none@tenant-a.example.com")
	assertConsentRefused(t, env,
		signUpAgreeing(env, tenant, "terms-only@tenant-a.example.com", terms.VersionID), "terms-only@tenant-a.example.com")
	assertConsentRefused(t, env,
		signUpAgreeing(env, tenant, "twice@tenant-a.example.com", terms.VersionID, terms.VersionID),
		"twice@tenant-a.example.com")
	assertConsentRefused(t, env,
		signUpAgreeing(env, tenant, "surplus@tenant-a.example.com", terms.VersionID, privacy.VersionID, terms.VersionID),
		"surplus@tenant-a.example.com")

	if err := signUpAgreeing(env, tenant, "both@tenant-a.example.com", terms.VersionID, privacy.VersionID); err != nil {
		t.Fatalf("CreateUser agreeing to both pages: %v", err)
	}
	got := agreedVersions(t, env, "both@tenant-a.example.com")
	if len(got) != 2 || !got[terms.VersionID] || !got[privacy.VersionID] {
		t.Fatalf("agreed versions = %v, want %s and %s", got, terms.VersionID, privacy.VersionID)
	}
}

// Consent names the tenant's own named pages, published: a version of any other
// page, another tenant's included, or a draft no reader was shown, is refused.
// A version the page has since superseded is still the text the reader saw.
func TestDBCreateUserRefusesConsentToAnythingButTheNamedPages(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	terms := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	about := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "about", Title: "About", Published: true})
	theirs := env.PG.SeedPage(t, second.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	nameLegalPages(t, env, first.ID, terms.ID, privacy.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	draftID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO page_versions (id, tenant_id, page_id, version_number, content_markdown)
		VALUES ($1, $2, $3, 2, 'Revised terms')
	`, draftID, first.ID, terms.ID); err != nil {
		t.Fatalf("seed a draft of the terms: %v", err)
	}

	cases := map[string]uuid.UUID{
		"another-page@tenant-a.example.com":   about.VersionID,
		"another-tenant@tenant-a.example.com": theirs.VersionID,
		"draft@tenant-a.example.com":          draftID,
		"unknown@tenant-a.example.com":        uuid.Must(uuid.NewV7()),
	}
	for email, termsVersion := range cases {
		assertConsentRefused(t, env, signUpAgreeing(env, first, email, termsVersion, privacy.VersionID), email)
	}

	// Publishing the draft supersedes the version a reader may still have open.
	if _, err := env.PG.DB.ExecContext(ctx, `
		UPDATE page_versions SET status = 'published', published_at = now() WHERE id = $1
	`, draftID); err != nil {
		t.Fatalf("publish the revised terms: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE pages SET published_version_id = $2 WHERE id = $1`, terms.ID, draftID); err != nil {
		t.Fatalf("point the terms at the revision: %v", err)
	}
	if err := signUpAgreeing(env, first, "superseded@tenant-a.example.com", terms.VersionID, privacy.VersionID); err != nil {
		t.Fatalf("CreateUser agreeing to the superseded terms: %v", err)
	}
	if got := agreedVersions(t, env, "superseded@tenant-a.example.com"); !got[terms.VersionID] {
		t.Fatalf("agreed versions = %v, want the superseded terms %s", got, terms.VersionID)
	}
}

// A tenant that names no page, or names one it has not published, has nothing
// for a reader to agree to, and signs readers up as it did before consent.
func TestDBCreateUserNeedsNoConsentWhereNothingIsNamed(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	if err := signUpAgreeing(env, first, "newcomer@tenant-a.example.com"); err != nil {
		t.Fatalf("CreateUser against a tenant that names nothing: %v", err)
	}
	if got := agreedVersions(t, env, "newcomer@tenant-a.example.com"); len(got) != 0 {
		t.Fatalf("agreed versions = %v, want none", got)
	}

	unpublished := env.PG.SeedPage(t, second.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service"})
	nameLegalPages(t, env, second.ID, unpublished.ID, unpublished.ID)
	if err := signUpAgreeing(env, second, "newcomer@tenant-b.example.com"); err != nil {
		t.Fatalf("CreateUser against a tenant whose named page is unpublished: %v", err)
	}
}
