package platformapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// newPolicyClient serves the policy over a server holding a secret manager,
// since the operator factor can be required only where an authenticator
// secret can be sealed.
func newPolicyClient(t *testing.T) (publirasplatformv1connect.PlatformPolicyServiceClient, *testutil.PostgresEnv, testutil.PlatformOperator) {
	t.Helper()
	return newPolicyClientWith(t, newTestEncryptor(t))
}

func newPolicyClientWith(t *testing.T, encryptor emailsettings.SecretManager) (publirasplatformv1connect.PlatformPolicyServiceClient, *testutil.PostgresEnv, testutil.PlatformOperator) {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), encryptor, nil, testutil.TokenManager(), nil, openMailGuard(), nil)
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	return publirasplatformv1connect.NewPlatformPolicyServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL))), pg, operator
}

// tightenedPolicy differs from the defaults in every group of values, so a
// read that answered the defaults instead of the row would be caught.
func tightenedPolicy() platformpolicy.Policy {
	policy := platformpolicy.Defaults()
	policy.MFARequiredForTenantAdmin = true
	policy.MFARequiredForPlatformOperator = true
	policy.PasswordVerification = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 30}
	policy.MailRequestsPerAddress = platformpolicy.HourDay{PerHour: 2, PerDay: 8}
	policy.MailRequestsPerSource = platformpolicy.HourDay{PerHour: 20, PerDay: 100}
	policy.Community.CommentPost = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 40}
	policy.Community.CommentReport = platformpolicy.MinuteDay{PerMinute: 5, PerDay: 25}
	policy.Community.DuplicateCommentWindow = 30 * time.Minute
	policy.Community.EpisodeRating = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	policy.Community.ContactMessagePerAccount = platformpolicy.HourDay{PerHour: 1, PerDay: 5}
	policy.Community.ContactMessagePerClient = platformpolicy.HourDay{PerHour: 4, PerDay: 12}
	policy.Community.ViewerPreferencesUpdate = platformpolicy.MinuteDay{PerMinute: 7, PerDay: 70}
	policy.Community.NotificationSettingsUpdate = platformpolicy.MinuteDay{PerMinute: 5, PerDay: 50}
	policy.StorePurchaseConfirmation = platformpolicy.MinuteDay{PerMinute: 8, PerDay: 80}
	policy.WaitFreeTicketUse = platformpolicy.MinuteDay{PerMinute: 9, PerDay: 90}
	policy.LegalPageAgreement = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 15}
	policy.IdentityLink = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 12}
	policy.IconChange = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 9}
	policy.Passkey = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 16}
	policy.SeriesRemainderCheckout = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 12}
	policy.SubscriptionCheckout = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 14}
	policy.CoinPayment = platformpolicy.MinuteDay{PerMinute: 5, PerDay: 40}
	policy.PurchaseCheckout = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 30}
	policy.LoginAttemptsPerAccount = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 20}
	policy.LoginAttemptsPerSource = platformpolicy.HourDay{PerHour: 30, PerDay: 120}
	policy.AnonymousReads = platformpolicy.ReadLimits{PublicAPI: 400, Search: 50, Images: 1500}
	policy.DisposableEmailDomainsURL = "https://lists.example.com/disposable.conf"
	policy.TenantCoinsAllowed = true
	return policy
}

func updatePolicy(
	t *testing.T,
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
	policy platformpolicy.Policy,
	expectedRevision int64,
) (*publirasplatformv1.UpdatePlatformPolicyResponse, error) {
	t.Helper()
	return client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
		Policy:           platformPolicyToProto(policy),
		ExpectedRevision: expectedRevision,
	})
}

func getPolicy(
	t *testing.T,
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
) (platformpolicy.Policy, int64) {
	t.Helper()
	resp, err := client.GetPlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.GetPlatformPolicyRequest{})
	if err != nil {
		t.Fatalf("GetPlatformPolicy: %v", err)
	}
	return platformPolicyFromProto(resp.Policy), resp.Revision
}

// An installation that has saved nothing reads the built-in defaults, which are
// what it enforces, at revision zero.
func TestDBGetPlatformPolicyAnswersTheDefaultsWhenNothingIsSaved(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)

	policy, revision := getPolicy(t, client, operator)
	if policy != platformpolicy.Defaults() {
		t.Fatalf("policy = %+v, want the built-in defaults", policy)
	}
	if revision != 0 {
		t.Fatalf("revision = %d, want 0", revision)
	}
}

func TestDBUpdatePlatformPolicyPersistsAndAudits(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	want := tightenedPolicy()

	created, err := updatePolicy(t, client, operator, want, 0)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (first): %v", err)
	}
	if created.Revision != 1 {
		t.Fatalf("revision of the created row = %d, want 1", created.Revision)
	}
	if got, revision := getPolicy(t, client, operator); got != want || revision != 1 {
		t.Fatalf("policy after the first save = %+v at revision %d, want %+v at revision 1", got, revision, want)
	}

	want.MFARequiredForTenantAdmin = false
	updated, err := updatePolicy(t, client, operator, want, created.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (second): %v", err)
	}
	if updated.Revision != 2 || platformPolicyFromProto(updated.Policy) != want {
		t.Fatalf("second save = %+v at revision %d, want %+v at revision 2", updated.Policy, updated.Revision, want)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 1 {
		t.Fatalf("platform_policy_config rows = %d, want 1", got)
	}
	if got := countRows(
		t,
		pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated' AND target_type = 'platform_policy' AND outcome = 'success'`,
	); got != 2 {
		t.Fatalf("platform_policy_updated audit entries = %d, want 2", got)
	}
}

// A console built before wait_free_ticket_use existed sends a policy without
// it. The save keeps the stored limit, or the default while nothing is saved,
// instead of refusing the whole policy.
func TestDBUpdatePlatformPolicyKeepsAnOmittedWaitFreeTicketUseLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.WaitFreeTicketUse = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without wait_free_ticket_use: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.WaitFreeTicketUse = platformpolicy.Defaults().WaitFreeTicketUse
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default ticket use limit", got, want)
	}

	want.WaitFreeTicketUse = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 30}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with wait_free_ticket_use: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored ticket use limit", got, want)
	}
}

// legal_page_agreement reached the policy after the console screens that save
// it, in the same way wait_free_ticket_use did, so an omitted one keeps what is
// stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedLegalPageAgreementLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.LegalPageAgreement = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without legal_page_agreement: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.LegalPageAgreement = platformpolicy.Defaults().LegalPageAgreement
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default agreement limit", got, want)
	}

	want.LegalPageAgreement = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 20}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with legal_page_agreement: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored agreement limit", got, want)
	}
}

// identity_link reached the policy after the console screens that save it, in
// the same way wait_free_ticket_use did, so an omitted one keeps what is stored
// too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedIdentityLinkLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.IdentityLink = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without identity_link: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.IdentityLink = platformpolicy.Defaults().IdentityLink
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default link limit", got, want)
	}

	want.IdentityLink = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 30}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with identity_link: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored link limit", got, want)
	}
}

// icon_change reached the policy after the console screens that save it, in
// the same way wait_free_ticket_use did, so an omitted one keeps what is stored
// too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedIconChangeLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.IconChange = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without icon_change: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.IconChange = platformpolicy.Defaults().IconChange
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default icon limit", got, want)
	}

	want.IconChange = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 40}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with icon_change: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored icon limit", got, want)
	}
}

// passkey reached the policy after the console screens that save it, in
// the same way wait_free_ticket_use did, so an omitted one keeps what is stored
// too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedPasskeyLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.Passkey = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without passkey: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.Passkey = platformpolicy.Defaults().Passkey
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default passkey limit", got, want)
	}

	want.Passkey = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with passkey: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored passkey limit", got, want)
	}
}

// series_remainder_checkout reached the policy after the console screens that
// save it, in the same way wait_free_ticket_use did, so an omitted one keeps
// what is stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedSeriesRemainderCheckoutLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.SeriesRemainderCheckout = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without series_remainder_checkout: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.SeriesRemainderCheckout = platformpolicy.Defaults().SeriesRemainderCheckout
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default remainder checkout limit", got, want)
	}

	want.SeriesRemainderCheckout = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with series_remainder_checkout: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored remainder checkout limit", got, want)
	}
}

// subscription_checkout reached the policy after the console screens that
// save it, in the same way wait_free_ticket_use did, so an omitted one keeps
// what is stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedSubscriptionCheckoutLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.SubscriptionCheckout = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without subscription_checkout: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.SubscriptionCheckout = platformpolicy.Defaults().SubscriptionCheckout
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default subscription checkout limit", got, want)
	}

	want.SubscriptionCheckout = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with subscription_checkout: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored subscription checkout limit", got, want)
	}
}

// coin_payment reached the policy after the console screens that save it, in
// the same way wait_free_ticket_use did, so an omitted one keeps what is
// stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedCoinPaymentLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.CoinPayment = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without coin_payment: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.CoinPayment = platformpolicy.Defaults().CoinPayment
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default coin payment limit", got, want)
	}

	want.CoinPayment = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with coin_payment: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored coin payment limit", got, want)
	}
}

// anonymous_read_limits reached the policy after the console screens that
// save it, in the same way wait_free_ticket_use did, so an omitted one keeps
// what is stored too.
func TestDBUpdatePlatformPolicyKeepsOmittedAnonymousReadLimits(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.AnonymousReadLimits = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without anonymous_read_limits: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.AnonymousReads = platformpolicy.Defaults().AnonymousReads
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default read limits", got, want)
	}

	want.AnonymousReads = platformpolicy.ReadLimits{PublicAPI: 2000, Search: 200, Images: 6000}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with anonymous_read_limits: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limits = %+v, want %+v keeping the stored read limits", got, want)
	}
}

// purchase_checkout reached the policy after the console screens that save
// it, in the same way wait_free_ticket_use did, so an omitted one keeps what
// is stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedPurchaseCheckoutLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.PurchaseCheckout = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without purchase_checkout: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.PurchaseCheckout = platformpolicy.Defaults().PurchaseCheckout
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default purchase checkout limit", got, want)
	}

	want.PurchaseCheckout = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with purchase_checkout: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored purchase checkout limit", got, want)
	}
}

// community_limit_defaults.notification_settings reached the policy after the
// Community page that saves it, so an omitted one keeps what is stored too.
func TestDBUpdatePlatformPolicyKeepsAnOmittedNotificationSettingsLimit(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.CommunityLimitDefaults.NotificationSettings = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without notification_settings: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.Community.NotificationSettingsUpdate = platformpolicy.Defaults().Community.NotificationSettingsUpdate
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default notification settings limit", got, want)
	}

	want.Community.NotificationSettingsUpdate = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with notification_settings: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the limit = %+v, want %+v keeping the stored notification settings limit", got, want)
	}
}

// The login limits reached the policy after the console screens that save it,
// in the same way wait_free_ticket_use did, so an omitted one keeps what is
// stored too.
func TestDBUpdatePlatformPolicyKeepsOmittedLoginLimits(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.LoginAttemptsPerAccount = nil
		message.LoginAttemptsPerSource = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without the login limits: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.LoginAttemptsPerAccount = platformpolicy.Defaults().LoginAttemptsPerAccount
	want.LoginAttemptsPerSource = platformpolicy.Defaults().LoginAttemptsPerSource
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the default login limits", got, want)
	}

	want.LoginAttemptsPerAccount = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 10}
	want.LoginAttemptsPerSource = platformpolicy.HourDay{PerHour: 15, PerDay: 45}
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with the login limits: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the login limits = %+v, want %+v keeping the stored ones", got, want)
	}
}

// The operator MFA requirement reached the policy after the console screens
// that save it, so a save that leaves it out keeps what is stored rather than
// switching the requirement off behind the back of the operator who set it.
func TestDBUpdatePlatformPolicyKeepsAnOmittedOperatorMfaRequirement(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.MfaRequiredForPlatformOperator = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without the operator MFA requirement: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.MFARequiredForPlatformOperator = false
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the requirement off by default", got, want)
	}

	want.MFARequiredForPlatformOperator = true
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with the operator MFA requirement: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the requirement = %+v, want %+v keeping the stored one", got, want)
	}
}

// The tenant coin allowance reached the policy after the console screens that
// save it, so a save that leaves it out keeps what is stored rather than
// stopping every tenant's coins behind the back of the operator who allowed
// them.
func TestDBUpdatePlatformPolicyKeepsAnOmittedTenantCoinAllowance(t *testing.T) {
	t.Parallel()

	client, _, operator := newPolicyClient(t)
	saveWithout := func(t *testing.T, policy platformpolicy.Policy, revision int64) *publirasplatformv1.UpdatePlatformPolicyResponse {
		t.Helper()
		message := platformPolicyToProto(policy)
		message.TenantCoinsAllowed = nil
		resp, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
			Policy:           message,
			ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatalf("UpdatePlatformPolicy without the tenant coin allowance: %v", err)
		}
		return resp
	}

	want := tightenedPolicy()
	first := saveWithout(t, want, 0)
	want.TenantCoinsAllowed = false
	if got := platformPolicyFromProto(first.Policy); got != want {
		t.Fatalf("first save = %+v, want %+v with the allowance off by default", got, want)
	}

	want.TenantCoinsAllowed = true
	second, err := updatePolicy(t, client, operator, want, first.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy with the tenant coin allowance: %v", err)
	}

	want.MFARequiredForTenantAdmin = false
	third := saveWithout(t, want, second.Revision)
	if got := platformPolicyFromProto(third.Policy); got != want {
		t.Fatalf("save without the allowance = %+v, want %+v keeping the stored one", got, want)
	}

	want.TenantCoinsAllowed = false
	if _, err := updatePolicy(t, client, operator, want, third.Revision); err != nil {
		t.Fatalf("UpdatePlatformPolicy withdrawing the tenant coin allowance: %v", err)
	}
	if got, _ := getPolicy(t, client, operator); got != want {
		t.Fatalf("policy after withdrawing the allowance = %+v, want %+v", got, want)
	}
}

// rewritePolicyRowWithout writes the stored policy row again with an insert
// that leaves out the given columns, the way the previous release's insert
// writes a row while this release's schema is in place.
func rewritePolicyRowWithout(t *testing.T, pg *testutil.PostgresEnv, omitted ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	var columns string
	if err := tx.QueryRowContext(ctx, `
		SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'platform_policy_config'
		  AND column_name <> ALL (string_to_array($1, ','))`, strings.Join(omitted, ",")).Scan(&columns); err != nil {
		t.Fatalf("read the policy columns: %v", err)
	}
	for _, statement := range []string{
		`CREATE TEMPORARY TABLE saved_policy ON COMMIT DROP AS SELECT * FROM platform_policy_config`,
		`DELETE FROM platform_policy_config`,
		`INSERT INTO platform_policy_config (` + columns + `) SELECT ` + columns + ` FROM saved_policy`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

// The previous release's insert does not name tenant_coins_allowed, so a row
// it writes while this release's schema is in place reads the allowance as
// off.
func TestDBPlatformPolicyRowWrittenWithoutTheTenantCoinAllowanceReadsItOff(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}

	rewritePolicyRowWithout(t, pg, "tenant_coins_allowed")

	want := tightenedPolicy()
	want.TenantCoinsAllowed = false
	if got, _ := getPolicy(t, client, operator); got != want {
		t.Fatalf("policy = %+v, want %+v with the allowance off", got, want)
	}
}

// The previous release's insert does not name the subscription checkout
// limits either, so a row it writes while this release's schema is in place
// reads the built-in ones.
func TestDBPlatformPolicyRowWrittenWithoutTheSubscriptionCheckoutLimitReadsTheDefault(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}

	rewritePolicyRowWithout(t, pg, "subscription_checkout_limit_per_minute", "subscription_checkout_limit_per_day")

	want := tightenedPolicy()
	want.SubscriptionCheckout = platformpolicy.Defaults().SubscriptionCheckout
	if got, _ := getPolicy(t, client, operator); got != want {
		t.Fatalf("policy = %+v, want %+v with the default subscription checkout limit", got, want)
	}
}

// Nor does it name the purchase checkout limits.
func TestDBPlatformPolicyRowWrittenWithoutThePurchaseCheckoutLimitReadsTheDefault(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}

	rewritePolicyRowWithout(t, pg, "purchase_checkout_limit_per_minute", "purchase_checkout_limit_per_day")

	want := tightenedPolicy()
	want.PurchaseCheckout = platformpolicy.Defaults().PurchaseCheckout
	if got, _ := getPolicy(t, client, operator); got != want {
		t.Fatalf("policy = %+v, want %+v with the default purchase checkout limit", got, want)
	}
}

// Nor does it name the anonymous read limits.
func TestDBPlatformPolicyRowWrittenWithoutTheAnonymousReadLimitsReadsTheDefault(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}

	rewritePolicyRowWithout(t, pg,
		"anonymous_read_public_api_limit_per_10_seconds",
		"anonymous_read_search_limit_per_10_seconds",
		"anonymous_read_images_limit_per_10_seconds",
	)

	want := tightenedPolicy()
	want.AnonymousReads = platformpolicy.Defaults().AnonymousReads
	if got, _ := getPolicy(t, client, operator); got != want {
		t.Fatalf("policy = %+v, want %+v with the default read limits", got, want)
	}
}

// Without a secret manager no operator could enroll, so requiring the factor
// would leave nobody able to sign in to the Platform Console and switch it back
// off. A requirement stored already, from publiractl, is kept rather than
// blocking every other save.
func TestDBUpdatePlatformPolicyRefusesTheOperatorMfaRequirementWithoutSecrets(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClientWith(t, nil)

	_, err := updatePolicy(t, client, operator, tightenedPolicy(), 0)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("switching the requirement on without a secret manager = %v, want failed_precondition", err)
	}
	assertFieldViolation(t, err, "policy.mfa_required_for_platform_operator")
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want the refused save to write nothing", got)
	}

	stored := platformpolicy.Defaults()
	stored.MFARequiredForPlatformOperator = true
	pg.SavePlatformPolicy(t, stored)
	_, revision := getPolicy(t, client, operator)
	want := tightenedPolicy()
	resp, err := updatePolicy(t, client, operator, want, revision)
	if err != nil {
		t.Fatalf("saving the policy over a stored requirement without a secret manager: %v", err)
	}
	if got := platformPolicyFromProto(resp.Policy); got != want {
		t.Fatalf("saved policy = %+v, want %+v", got, want)
	}

	want.MFARequiredForPlatformOperator = false
	if _, err := updatePolicy(t, client, operator, want, resp.Revision); err != nil {
		t.Fatalf("switching the requirement off without a secret manager: %v", err)
	}
}

// A save based on a read another save has since moved past is refused, so it
// cannot roll that other save back.
func TestDBUpdatePlatformPolicyRejectsAStaleRevision(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)

	first, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), 0)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (first): %v", err)
	}
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), first.Revision); err != nil {
		t.Fatalf("UpdatePlatformPolicy (second): %v", err)
	}

	for name, revision := range map[string]int64{
		"the revision before the last save": first.Revision,
		"zero once a row exists":            0,
		"a revision never issued":           99,
	} {
		stale := platformpolicy.Defaults()
		stale.MFARequiredForTenantAdmin = true
		if _, err := updatePolicy(t, client, operator, stale, revision); connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("save stating %s code = %v, want failed_precondition (err=%v)", name, connect.CodeOf(err), err)
		}
	}

	if got, revision := getPolicy(t, client, operator); got != tightenedPolicy() || revision != 2 {
		t.Fatalf("policy after the refused saves = %+v at revision %d, want the second save at revision 2", got, revision)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated'`); got != 2 {
		t.Fatalf("platform_policy_updated audit entries = %d, want only the two saves that went through", got)
	}
}

// With no row saved, only a save stating revision zero creates one: any other
// number was read from a row that no longer exists.
func TestDBUpdatePlatformPolicyRefusesARevisionWithoutARow(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)

	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 1); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("save stating revision 1 with no row code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want 0", got)
	}
}

// A refusal names the request field at fault, the same field publiractl
// policy set names through the flag it came from.
func TestDBUpdatePlatformPolicyRejectsInvalidValues(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)

	for name, tc := range map[string]struct {
		adjust func(*publirasplatformv1.PlatformPolicy)
		field  string
	}{
		"no policy": {nil, "policy"},
		"a zero limit": {
			func(p *publirasplatformv1.PlatformPolicy) { p.CommunityLimitDefaults.CommentPost.PerMinute = 0 },
			"policy.community_limit_defaults.comment_post.per_minute",
		},
		"a day below its hour": {
			func(p *publirasplatformv1.PlatformPolicy) {
				p.MailRequestsPerSource.PerDay = p.MailRequestsPerSource.PerHour - 1
			},
			"policy.mail_requests_per_source.per_day",
		},
		"a missing limit": {
			func(p *publirasplatformv1.PlatformPolicy) { p.PasswordVerification = nil },
			"policy.password_verification.per_minute",
		},
		"a missing community group": {
			func(p *publirasplatformv1.PlatformPolicy) { p.CommunityLimitDefaults = nil },
			"policy.community_limit_defaults.comment_post.per_minute",
		},
		"a duplicate window over a week": {
			func(p *publirasplatformv1.PlatformPolicy) {
				p.CommunityLimitDefaults.DuplicateCommentWindowMinutes = 7*24*60 + 1
			},
			"policy.community_limit_defaults.duplicate_comment_window_minutes",
		},
		"a read limit below the edge's": {
			func(p *publirasplatformv1.PlatformPolicy) {
				p.AnonymousReadLimits.Images = int32(platformpolicy.EdgeReadLimits().Images - 1)
			},
			"policy.anonymous_read_limits.images",
		},
		"a list URL that is not http": {
			func(p *publirasplatformv1.PlatformPolicy) {
				p.DisposableEmailDomainsUrl = "file:///etc/disposable.conf"
			},
			"policy.disposable_email_domains_url",
		},
	} {
		t.Run(name, func(t *testing.T) {
			var policy *publirasplatformv1.PlatformPolicy
			if tc.adjust != nil {
				policy = platformPolicyToProto(platformpolicy.Defaults())
				tc.adjust(policy)
			}
			_, err := client.UpdatePlatformPolicy(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{Policy: policy})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformPolicy code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			assertFieldViolation(t, err, tc.field)
		})
	}

	_, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), -1)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdatePlatformPolicy with a negative revision code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertFieldViolation(t, err, "expected_revision")
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want the rejected saves to write nothing", got)
	}
}

func TestDBPlatformPolicyRequiresAuthentication(t *testing.T) {
	t.Parallel()

	ts, _ := newDBIntegrationEnv(t)
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	if _, err := client.GetPlatformPolicy(context.Background(), &publirasplatformv1.GetPlatformPolicyRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetPlatformPolicy code = %v, want unauthenticated", connect.CodeOf(err))
	}
	if _, err := client.UpdatePlatformPolicy(context.Background(), &publirasplatformv1.UpdatePlatformPolicyRequest{
		Policy: platformPolicyToProto(platformpolicy.Defaults()),
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdatePlatformPolicy code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

// An auditor reads the policy and changes none of it.
func TestDBPlatformAuditorReadsButCannotUpdateThePolicy(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT01", "auditor@example.com", "Platform Auditor")
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	if _, revision := getPolicy(t, client, auditor); revision != 0 {
		t.Fatalf("revision = %d, want 0", revision)
	}
	if _, err := updatePolicy(t, client, auditor, tightenedPolicy(), 0); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdatePlatformPolicy as an auditor code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want 0", got)
	}
}

// Two sessions saving from the same read race for the row: one applies, the
// other is told the row moved on. Run both for the first save, where no row
// exists to lock, and for a later one, where the lock decides.
func TestDBUpdatePlatformPolicyConcurrentSavesOneWins(t *testing.T) {
	t.Parallel()

	for name, seeded := range map[string]bool{"first save": false, "later save": true} {
		t.Run(name, func(t *testing.T) {
			client, pg, operator := newPolicyClient(t)
			var shared int64
			if seeded {
				resp, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), 0)
				if err != nil {
					t.Fatalf("UpdatePlatformPolicy (seed): %v", err)
				}
				shared = resp.Revision
			}

			candidates := []platformpolicy.Policy{tightenedPolicy(), platformpolicy.Defaults()}
			candidates[1].MFARequiredForTenantAdmin = true
			// A deadline keeps a lock that is never released from hanging
			// the suite instead of failing this case.
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			errs := make(chan error, len(candidates))
			var wg sync.WaitGroup
			for _, candidate := range candidates {
				wg.Go(func() {
					_, err := client.UpdatePlatformPolicy(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.UpdatePlatformPolicyRequest{
						Policy:           platformPolicyToProto(candidate),
						ExpectedRevision: shared,
					})
					errs <- err
				})
			}
			wg.Wait()
			close(errs)

			succeeded := 0
			for err := range errs {
				switch {
				case err == nil:
					succeeded++
				case connect.CodeOf(err) != connect.CodeFailedPrecondition:
					t.Fatalf("losing UpdatePlatformPolicy code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
				}
			}
			if succeeded != 1 {
				t.Fatalf("%d saves succeeded, want exactly one", succeeded)
			}
			if _, revision := getPolicy(t, client, operator); revision != shared+1 {
				t.Fatalf("revision = %d, want %d", revision, shared+1)
			}
			if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 1 {
				t.Fatalf("platform_policy_config rows = %d, want 1", got)
			}
		})
	}
}

// droppingRecorder loses every entry, as an asynchronous recorder with a full
// queue would.
type droppingRecorder struct{}

func (droppingRecorder) RecordPlatform(context.Context, auditlog.PlatformEntry) {}
func (droppingRecorder) RecordTenant(context.Context, auditlog.TenantEntry)     {}

// The audit entry commits with the policy it records, so a recorder that drops
// entries cannot leave a policy change unrecorded.
func TestDBUpdatePlatformPolicyAuditsInTheSameTransaction(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), newTestEncryptor(t), nil, testutil.TokenManager(), droppingRecorder{}, openMailGuard(), nil)
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated'`); got != 1 {
		t.Fatalf("platform_policy_updated audit entries = %d, want 1", got)
	}
}

// The storefront prices episodes in coins only while the platform allows
// tenant coins, so allowing or forbidding them owes a drop of the cached
// series and episode reads of every tenant whose coins are on, and of no other
// tenant. The drop waits out the API's own cache of the policy.
func TestDBUpdatePlatformPolicyDropsTheCoinPricesOfTenantsWithCoins(t *testing.T) {
	t.Parallel()

	client, pg, operator := newPolicyClient(t)
	withCoins := pg.SeedTenant(t, "COINSON", "coins-on.example.com", "Coins on")
	withoutCoins := pg.SeedTenant(t, "COINSOFF", "coins-off.example.com", "Coins off")
	pg.SeedCoinSettings(t, withCoins.ID, testutil.CoinSettingsSeed{Names: map[string]string{"ja": "Tickets"}})
	pg.SeedCoinSettings(t, withoutCoins.ID, testutil.CoinSettingsSeed{Disabled: true})

	drops := func(tenantID string) int {
		t.Helper()
		var count int
		if err := pg.DB.QueryRowContext(context.Background(), `
			SELECT count(*) FROM outbox_events
			WHERE tenant_id = $1
				AND event_type = 'next_cache_revalidation'
				AND payload->'tags' ? ('tenant:' || $1 || ':series:detail')
				AND available_at > NOW()`, tenantID).Scan(&count); err != nil {
			t.Fatalf("count the series detail drops: %v", err)
		}
		return count
	}

	policy := tightenedPolicy()
	policy.TenantCoinsAllowed = false
	first, err := updatePolicy(t, client, operator, policy, 0)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}
	if got := drops(withCoins.ID.String()); got != 0 {
		t.Fatalf("drops after a first save that leaves coins forbidden = %d, want 0", got)
	}

	policy.TenantCoinsAllowed = true
	second, err := updatePolicy(t, client, operator, policy, first.Revision)
	if err != nil {
		t.Fatalf("allow tenant coins: %v", err)
	}
	if got := drops(withCoins.ID.String()); got != 1 {
		t.Fatalf("drops of the tenant with coins = %d, want 1", got)
	}
	if got := drops(withoutCoins.ID.String()); got != 0 {
		t.Fatalf("drops of the tenant without coins = %d, want 0", got)
	}

	policy.MFARequiredForTenantAdmin = !policy.MFARequiredForTenantAdmin
	third, err := updatePolicy(t, client, operator, policy, second.Revision)
	if err != nil {
		t.Fatalf("save another change: %v", err)
	}
	if got := drops(withCoins.ID.String()); got != 1 {
		t.Fatalf("drops after a save that keeps the allowance = %d, want still 1", got)
	}

	policy.TenantCoinsAllowed = false
	if _, err := updatePolicy(t, client, operator, policy, third.Revision); err != nil {
		t.Fatalf("forbid tenant coins: %v", err)
	}
	if got := drops(withCoins.ID.String()); got != 2 {
		t.Fatalf("drops after forbidding coins = %d, want 2", got)
	}
}
