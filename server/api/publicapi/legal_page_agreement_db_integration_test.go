package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// publishRevision makes a new version of the page's seeded translation the live
// one, asking every reader to agree to it again when requireAgreement is set,
// the way AdminPagesService.PublishVersion stores it.
func publishRevision(t *testing.T, env *publicDBEnv, tenantID uuid.UUID, page testutil.Page, requireAgreement bool) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, status, published_at, agreement_required_at)
		SELECT $1, $2, $3, $4, max(version_number) + 1, 'Revised text.', 'published', now(), CASE WHEN $5::boolean THEN now() END
		FROM page_versions
		WHERE translation_id = $3
	`, id, page.ID, page.TranslationID, tenantID, requireAgreement); err != nil {
		t.Fatalf("insert a revision of %s: %v", page.Slug, err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE page_translations SET published_version_id = $1 WHERE id = $2`, id, page.TranslationID); err != nil {
		t.Fatalf("publish the revision of %s: %v", page.Slug, err)
	}
	return id
}

func recordConsents(t *testing.T, env *publicDBEnv, tenantID, userID uuid.UUID, versionIDs ...uuid.UUID) {
	t.Helper()

	for _, versionID := range versionIDs {
		if _, err := env.PG.DB.Exec(`
			INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)
		`, tenantID, userID, versionID); err != nil {
			t.Fatalf("record consent to %s: %v", versionID, err)
		}
	}
}

func assertLegalPageAgreementRequired(t *testing.T, rpc string, err error) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("%s error = %v, want failed_precondition", rpc, err)
	}
	if reason, _ := errorInfoReason(err); reason != rpcerrors.ReasonLegalPageAgreementRequired {
		t.Fatalf("%s reason = %q, want %s", rpc, reason, rpcerrors.ReasonLegalPageAgreementRequired)
	}
}

// Publishing a version that asks for agreement reports every existing reader as
// owing it until they agree, refuses them what they may not do meanwhile, and
// records their agreement per version.
func TestDBLegalPageAgreementIsAskedAgainAfterARevision(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	nameLegalPages(t, env, tenant.ID, terms.ID, privacy.ID)
	reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA", "reader@tenant-a.example.com", "Reader", "tenant_member")
	recordConsents(t, env, tenant.ID, reader.ID, terms.VersionID, privacy.VersionID)

	auth := env.authClient()
	signedIn := func() context.Context {
		return testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader))
	}
	owed := func() *publirav1.GetMyLegalPageAgreementsResponse {
		t.Helper()
		resp, err := auth.GetMyLegalPageAgreements(signedIn(), &publirav1.GetMyLegalPageAgreementsRequest{Tenant: tenantContext(tenant)})
		if err != nil {
			t.Fatalf("GetMyLegalPageAgreements: %v", err)
		}
		return resp
	}
	markAllRead := func() error {
		_, err := env.notificationClient().MarkAllNotificationsAsRead(signedIn(), &publirav1.MarkAllNotificationsAsReadRequest{Tenant: tenantContext(tenant)})
		return err
	}

	if resp := owed(); resp.TermsPage != nil || resp.PrivacyPage != nil {
		t.Fatalf("pages owed before any revision = %v, want none", resp)
	}
	// A correction asks nobody.
	publishRevision(t, env, tenant.ID, privacy, false)
	if resp := owed(); resp.TermsPage != nil || resp.PrivacyPage != nil {
		t.Fatalf("pages owed after a correction = %v, want none", resp)
	}

	revised := publishRevision(t, env, tenant.ID, terms, true)
	resp := owed()
	if resp.TermsPage.GetVersionId() != revised.String() || resp.PrivacyPage != nil {
		t.Fatalf("pages owed after a revision = %v, want the terms in version %s alone", resp, revised)
	}
	if resp.TermsPage.GetSlug() != "/tos" {
		t.Fatalf("owed terms slug = %q, want /tos", resp.TermsPage.GetSlug())
	}

	assertLegalPageAgreementRequired(t, "MarkAllNotificationsAsRead", markAllRead())
	_, err := env.followClient().Follow(signedIn(), &publirav1.FollowRequest{
		Tenant: tenantContext(tenant),
		Target: &publirav1.FollowTarget{Type: publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_SERIES, Id: "SERIESNONE1"},
	})
	assertLegalPageAgreementRequired(t, "Follow", err)
	if _, err := auth.GetMe(signedIn(), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)}); err != nil {
		t.Fatalf("GetMe while owing an agreement: %v", err)
	}
	if _, err := env.purchaseClient().ListMyPurchases(signedIn(), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(tenant)}); err != nil {
		t.Fatalf("ListMyPurchases while owing an agreement: %v", err)
	}

	// An agreement to the version the revision replaced is recorded and settles
	// nothing.
	agreed, err := auth.AgreeToLegalPages(signedIn(), &publirav1.AgreeToLegalPagesRequest{
		Tenant:               tenantContext(tenant),
		AgreedPageVersionIds: []string{terms.VersionID.String()},
	})
	if err != nil {
		t.Fatalf("AgreeToLegalPages to the replaced version: %v", err)
	}
	if agreed.TermsPage.GetVersionId() != revised.String() {
		t.Fatalf("pages owed after agreeing to the replaced version = %v, want the terms in version %s", agreed, revised)
	}

	agreed, err = auth.AgreeToLegalPages(signedIn(), &publirav1.AgreeToLegalPagesRequest{
		Tenant:               tenantContext(tenant),
		AgreedPageVersionIds: []string{revised.String()},
	})
	if err != nil {
		t.Fatalf("AgreeToLegalPages: %v", err)
	}
	if agreed.TermsPage != nil || agreed.PrivacyPage != nil {
		t.Fatalf("pages owed after agreeing = %v, want none", agreed)
	}
	if err := markAllRead(); err != nil {
		t.Fatalf("MarkAllNotificationsAsRead after agreeing: %v", err)
	}
	if count := env.countRows(t, `SELECT count(*) FROM user_page_consents WHERE user_id = $1 AND page_version_id = $2`, reader.ID, revised); count != 1 {
		t.Fatalf("consents to the revision = %d, want 1", count)
	}

	// Agreeing again is answered the same way and records nothing more: the
	// reader holds the two agreements given at sign-up and the revision's.
	if _, err := auth.AgreeToLegalPages(signedIn(), &publirav1.AgreeToLegalPagesRequest{
		Tenant:               tenantContext(tenant),
		AgreedPageVersionIds: []string{revised.String()},
	}); err != nil {
		t.Fatalf("AgreeToLegalPages again: %v", err)
	}
	if count := env.countRows(t, `SELECT count(*) FROM user_page_consents WHERE user_id = $1`, reader.ID); count != 3 {
		t.Fatalf("consents after agreeing again = %d, want 3", count)
	}
}

// An agreement names published versions of the tenant's terms and privacy
// policy, one per page.
func TestDBAgreeToLegalPagesRefusesAnythingButTheNamedPages(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	about := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "about", Title: "About", Published: true})
	draft := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "draft", Title: "Draft"})
	nameLegalPages(t, env, tenant.ID, terms.ID, privacy.ID)
	reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA", "reader@tenant-a.example.com", "Reader", "tenant_member")
	revised := publishRevision(t, env, tenant.ID, terms, true)

	for _, tc := range []struct {
		name string
		ids  []string
	}{
		{name: "nothing", ids: nil},
		{name: "a page the tenant does not ask consent to", ids: []string{about.VersionID.String()}},
		{name: "a draft", ids: []string{draft.VersionID.String()}},
		{name: "a malformed id", ids: []string{"not-a-version"}},
		{name: "one page twice", ids: []string{terms.VersionID.String(), revised.String()}},
		{name: "more than two", ids: []string{revised.String(), privacy.VersionID.String(), terms.VersionID.String()}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := env.authClient().AgreeToLegalPages(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.AgreeToLegalPagesRequest{
				Tenant:               tenantContext(tenant),
				AgreedPageVersionIds: tc.ids,
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("AgreeToLegalPages error = %v, want invalid_argument", err)
			}
			assertPublicBadRequestField(t, err, "agreed_page_version_ids")
		})
	}
	if count := env.countRows(t, `SELECT count(*) FROM user_page_consents WHERE user_id = $1`, reader.ID); count != 0 {
		t.Fatalf("consents after refused agreements = %d, want none", count)
	}
}

// Every agreement charges the reader's allowance before the versions it names
// are read, so a reader repeating one runs out like any other writer.
func TestDBAgreeToLegalPagesChargesTheSharedFloodControl(t *testing.T) {
	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.LegalPageAgreement = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	}))
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	nameLegalPages(t, env, tenant.ID, terms.ID, privacy.ID)
	reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA", "reader@tenant-a.example.com", "Reader", "tenant_member")
	revised := publishRevision(t, env, tenant.ID, terms, true)

	agree := func(versionID uuid.UUID) error {
		_, err := env.authClient().AgreeToLegalPages(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.AgreeToLegalPagesRequest{
			Tenant:               tenantContext(tenant),
			AgreedPageVersionIds: []string{versionID.String()},
		})
		return err
	}
	for range 2 {
		if err := agree(terms.VersionID); err != nil {
			t.Fatalf("AgreeToLegalPages within the allowance: %v", err)
		}
	}
	if err := agree(revised); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("an agreement past the allowance: code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, `SELECT count(*) FROM user_page_consents WHERE user_id = $1 AND page_version_id = $2`, reader.ID, revised); count != 0 {
		t.Fatalf("consents to the revision past the allowance = %d, want none", count)
	}
}
