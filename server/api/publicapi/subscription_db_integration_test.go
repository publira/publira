package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"path"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionFixture is a tenant selling through Stripe, whose API is the
// contract fixture's fake, and one reader signed in to it.
type subscriptionFixture struct {
	pg            *testutil.PostgresEnv
	stripe        *stripetest.Fixture
	credentials   paymentprovider.Credentials
	tenant        testutil.Tenant
	reader        testutil.TenantUser
	subscriptions publirav1connect.SubscriptionServiceClient
	purchases     publirav1connect.PurchaseServiceClient
}

func newSubscriptionFixture(t *testing.T) *subscriptionFixture {
	t.Helper()
	return newSubscriptionFixtureWithGuards(t, openReaderGuards())
}

func newSubscriptionFixtureWithGuards(t *testing.T, guards readerGuards) *subscriptionFixture {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	fixture := stripetest.NewFixture(t)
	credentials := fixture.Credentials()
	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "SUBTENANT", "subscriptions.example.com", "Subscription tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "SUBREADER01", "subscriber@example.com", "Subscriber")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID,
		stripeSettings(credentials[stripe.FieldSecretKey], credentials[stripe.FieldWebhookSecret]), paymentsettings.AuditMeta{},
	); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), guards, openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(fixture.Provider())
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL))
	return &subscriptionFixture{
		pg:            pg,
		stripe:        fixture,
		credentials:   credentials,
		tenant:        tenant,
		reader:        reader,
		subscriptions: publirav1connect.NewSubscriptionServiceClient(client),
		purchases:     publirav1connect.NewPurchaseServiceClient(client),
	}
}

func (f *subscriptionFixture) readerCtx(t *testing.T) context.Context {
	t.Helper()
	token, _, err := testutil.TokenManager().Issue(f.reader.PublicID, auth.AudiencePublic, f.tenant.ID.String(), f.reader.Role, f.reader.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return testutil.WithBearer(context.Background(), token)
}

// deliver hands a notification to the webhook the way web-storefront does.
func (f *subscriptionFixture) deliver(t *testing.T, payload []byte, headers map[string][]string) error {
	t.Helper()
	_, err := f.purchases.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(f.tenant.ID.String(), payload, headers))
	return err
}

// checkoutIDOf answers the id of the Checkout Session a checkout URL of the
// Stripe fake pays.
func checkoutIDOf(checkoutURL string) string {
	return path.Base(checkoutURL)
}

func withoutScheme(raw string) string {
	_, rest, _ := strings.Cut(raw, "://")
	return rest
}

func (f *subscriptionFixture) countRows(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := f.pg.DB.QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return count
}

func (f *subscriptionFixture) mySubscription(t *testing.T) *publirav1.Subscription {
	t.Helper()
	res, err := f.subscriptions.GetMySubscription(f.readerCtx(t), &publirav1.GetMySubscriptionRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetMySubscription: %v", err)
	}
	return res.Subscription
}

func TestDBListSubscriptionPlansAnswersThePublishedPlans(t *testing.T) {
	f := newSubscriptionFixture(t)
	other := f.pg.SeedTenant(t, "SUBOTHER", "subscriptions-other.example.com", "Other tenant")
	label := f.pg.SeedLabel(t, f.tenant.ID, testutil.LabelSeed{PublicID: "SUBLABEL01", Name: "Label"})
	series := f.pg.SeedSeries(t, f.tenant.ID, testutil.SeriesSeed{Published: true})
	whole := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Name: "Everything", Published: true})
	byLabel := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Name: "Label", Scope: "label", LabelIDs: []uuid.UUID{label.ID}, Published: true})
	bySeries := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Name: "Series", Scope: "series", SeriesIDs: []uuid.UUID{series.ID}, Published: true})
	f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Name: "Draft"})
	f.pg.SeedSubscriptionPlan(t, other.ID, testutil.SubscriptionPlanSeed{Name: "Other tenant", Published: true})

	// No session: the plan page is for readers who have not signed in yet.
	res, err := f.subscriptions.ListSubscriptionPlans(context.Background(), &publirav1.ListSubscriptionPlansRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListSubscriptionPlans: %v", err)
	}
	var ids []string
	for _, plan := range res.Plans {
		ids = append(ids, plan.Id)
	}
	if !slices.Equal(ids, []string{whole.ID.String(), byLabel.ID.String(), bySeries.ID.String()}) {
		t.Fatalf("plans = %v, want the three published plans of the tenant in the order they were created", ids)
	}
	first := res.Plans[0]
	if first.Name != "Everything" || first.PublicId != whole.PublicID || first.PriceAmount != 980 || first.Currency != "JPY" ||
		first.Interval != publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_MONTH || first.IntervalCount != 1 ||
		first.Scope != publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_ALL || len(first.LabelIds) != 0 || len(first.SeriesIds) != 0 {
		t.Fatalf("plan = %+v", first)
	}
	if got := res.Plans[1]; got.Scope != publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_LABEL || !slices.Equal(got.LabelIds, []string{label.ID.String()}) {
		t.Fatalf("label plan = %+v", got)
	}
	if got := res.Plans[2]; got.Scope != publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES || !slices.Equal(got.SeriesIds, []string{series.ID.String()}) {
		t.Fatalf("series plan = %+v", got)
	}
}

// A subscription is started through Stripe Checkout and from then on is what
// Stripe last reported it to be: active, set to cancel, past due, and ended.
func TestDBASubscriptionFollowsStripesWebhooks(t *testing.T) {
	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})

	if got := f.mySubscription(t); got != nil {
		t.Fatalf("subscription before subscribing = %+v, want none", got)
	}
	started, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: plan.ID.String()})
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout: %v", err)
	}
	if started.CheckoutUrl == "" {
		t.Fatal("StartSubscriptionCheckout answered no URL")
	}
	sessions := f.stripe.API.CheckoutSessions()
	if len(sessions) != 1 {
		t.Fatalf("checkout sessions = %d, want 1", len(sessions))
	}
	form := sessions[0].Form
	if form.Get("mode") != "subscription" || form.Get("line_items[0][price]") != "price_monthly" || form.Has("customer") {
		t.Fatalf("session = %v, want the plan's price in subscription mode for a new customer", form)
	}
	if form.Get("subscription_data[metadata]["+stripe.MetadataPlanID+"]") != plan.ID.String() ||
		form.Get("subscription_data[metadata]["+stripe.MetadataUserID+"]") != f.reader.ID.String() ||
		form.Get("subscription_data[metadata]["+stripe.MetadataTenantID+"]") != f.tenant.ID.String() ||
		form.Get("subscription_data[metadata]["+stripe.MetadataPriceID+"]") != "price_monthly" {
		t.Fatalf("session = %v, want the subscription to carry the tenant, the reader, the plan, and its price", form)
	}
	// The scheme is the deployment's; the host is the tenant's own domain.
	if withoutScheme(form.Get("success_url")) != "subscriptions.example.com/my?session_id=%7BCHECKOUT_SESSION_ID%7D&subscription=success" ||
		withoutScheme(form.Get("cancel_url")) != "subscriptions.example.com/plans?subscription=cancelled" {
		t.Fatalf("return URLs = %q, %q", form.Get("success_url"), form.Get("cancel_url"))
	}

	periodEnd := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Second).UTC()
	subscription := stripetest.Subscription{
		ID:               "sub_lifecycle",
		CustomerID:       "cus_lifecycle",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: periodEnd.Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	payload, headers := f.stripe.SubscriptionCheckoutCompleted(t, f.credentials, checkoutIDOf(started.CheckoutUrl), subscription)
	for range 2 {
		if err := f.deliver(t, payload, headers); err != nil {
			t.Fatalf("deliver the completed checkout: %v", err)
		}
	}
	if got := f.countRows(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("subscriptions = %d, want one however often the notification is delivered", got)
	}
	got := f.mySubscription(t)
	if got == nil || got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE || got.CancelAtPeriodEnd ||
		got.CurrentPeriodEnd != periodEnd.Format(time.RFC3339) || got.Plan.GetId() != plan.ID.String() {
		t.Fatalf("subscription = %+v, want an active one on the plan ending %s", got, periodEnd.Format(time.RFC3339))
	}

	// One reader holds one subscription.
	_, err = f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: plan.ID.String()})
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("StartSubscriptionCheckout while subscribed = %v, want already_exists", err)
	}

	portal, err := f.subscriptions.CreateBillingPortalSession(f.readerCtx(t), &publirav1.CreateBillingPortalSessionRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("CreateBillingPortalSession: %v", err)
	}
	portals := f.stripe.API.BillingPortalSessions()
	if portal.Url == "" || len(portals) != 1 || portals[0].Form.Get("customer") != "cus_lifecycle" || withoutScheme(portals[0].Form.Get("return_url")) != "subscriptions.example.com/my" {
		t.Fatalf("portal %q opened as %+v, want the reader's customer returning to /my", portal.Url, portals)
	}

	subscription.CancelAtPeriodEnd = true
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the update: %v", err)
	}
	if got := f.mySubscription(t); got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE || !got.CancelAtPeriodEnd {
		t.Fatalf("subscription = %+v, want it active and set to cancel at the period's end", got)
	}

	subscription.CancelAtPeriodEnd = false
	subscription.Status = "past_due"
	payload, headers = f.stripe.InvoicePaymentFailed(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the failed payment: %v", err)
	}
	if got := f.mySubscription(t); got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE {
		t.Fatalf("subscription = %+v, want it past due", got)
	}

	stale, staleHeaders := f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	payload, headers = f.stripe.SubscriptionDeleted(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the deletion: %v", err)
	}
	if got := f.mySubscription(t); got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELED {
		t.Fatalf("subscription = %+v, want it canceled", got)
	}
	// A notification Stripe sent before the deletion and delivered after it
	// records what Stripe holds now, not what it carried.
	if err := f.deliver(t, stale, staleHeaders); err != nil {
		t.Fatalf("deliver the late update: %v", err)
	}
	if got := f.mySubscription(t); got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELED {
		t.Fatalf("subscription after a late update = %+v, want it still canceled", got)
	}

	// The reader may subscribe again once it has ended, as the customer they
	// were, and on a checkout of its own rather than the one they completed.
	if _, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: plan.ID.String()}); err != nil {
		t.Fatalf("StartSubscriptionCheckout after the subscription ended: %v", err)
	}
	sessions = f.stripe.API.CheckoutSessions()
	if len(sessions) != 2 || sessions[1].Form.Get("customer") != "cus_lifecycle" || sessions[1].IdempotencyKey == sessions[0].IdempotencyKey {
		t.Fatalf("sessions = %+v, want a second one for the same customer under another key", sessions)
	}
}

func TestDBStartSubscriptionCheckoutRefusesWhatItCannotSell(t *testing.T) {
	f := newSubscriptionFixture(t)
	other := f.pg.SeedTenant(t, "SUBNOPAY", "subscriptions-nopay.example.com", "No payments")
	draft := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{})
	foreign := f.pg.SeedSubscriptionPlan(t, other.ID, testutil.SubscriptionPlanSeed{Published: true})
	published := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Published: true})

	for name, planID := range map[string]string{
		"an unpublished plan":        draft.ID.String(),
		"another tenant's plan":      foreign.ID.String(),
		"a plan that does not exist": uuid.NewString(),
	} {
		_, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: planID})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("StartSubscriptionCheckout of %s = %v, want not_found", name, err)
		}
	}
	_, err := f.subscriptions.StartSubscriptionCheckout(context.Background(), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: published.ID.String()})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("StartSubscriptionCheckout without a session = %v, want unauthenticated", err)
	}
	if got := len(f.stripe.API.CheckoutSessions()); got != 0 {
		t.Fatalf("checkout sessions = %d, want none", got)
	}

	// A tenant that takes no payments sells no plan.
	otherReader := f.pg.SeedEndUser(t, other.ID, "SUBNOPAYR1", "nopay@example.com", "No payments reader")
	token, _, err := testutil.TokenManager().Issue(otherReader.PublicID, auth.AudiencePublic, other.ID.String(), otherReader.Role, otherReader.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	_, err = f.subscriptions.StartSubscriptionCheckout(testutil.WithBearer(context.Background(), token), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(other), PlanId: foreign.ID.String()})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("StartSubscriptionCheckout without payments = %v, want failed_precondition", err)
	}
	_, err = f.subscriptions.CreateBillingPortalSession(testutil.WithBearer(context.Background(), token), &publirav1.CreateBillingPortalSessionRequest{Tenant: tenantContext(other)})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("CreateBillingPortalSession without payments = %v, want failed_precondition", err)
	}
}

func TestDBCreateBillingPortalSessionRefusesAReaderWhoNeverSubscribed(t *testing.T) {
	f := newSubscriptionFixture(t)
	_, err := f.subscriptions.CreateBillingPortalSession(f.readerCtx(t), &publirav1.CreateBillingPortalSessionRequest{Tenant: tenantContext(f.tenant)})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("CreateBillingPortalSession = %v, want failed_precondition", err)
	}
	if got := len(f.stripe.API.BillingPortalSessions()); got != 0 {
		t.Fatalf("portal sessions = %d, want none", got)
	}
}

// A subscription is recorded on the plan of the Price Stripe bills it at,
// which follows a reader who changed their Price in the billing portal.
func TestDBProcessPaymentWebhookRecordsASubscriptionOnThePlanOfItsPrice(t *testing.T) {
	f := newSubscriptionFixture(t)
	monthly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	yearly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_yearly", Published: true})
	subscription := stripetest.Subscription{
		ID:         "sub_switch",
		CustomerID: "cus_switch",
		PriceID:    "price_monthly",
		Status:     "active",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, monthly.ID, "price_monthly"),
	}
	payload, headers := f.stripe.SubscriptionCheckoutCompleted(t, f.credentials, "cs_switch", subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the completed checkout: %v", err)
	}
	subscription.PriceID = "price_yearly"
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the update: %v", err)
	}
	if got := f.mySubscription(t); got.GetPlan().GetId() != yearly.ID.String() {
		t.Fatalf("subscription plan = %s, want the yearly plan its price now names", got.GetPlan().GetId())
	}
	// Staff give the yearly plan another Price. The reader goes on being billed
	// at the old one, which no plan names any more, and stays on the yearly
	// plan rather than falling back to the monthly one the checkout named.
	if _, err := f.pg.DB.ExecContext(context.Background(), "UPDATE subscription_plans SET stripe_price_id = 'price_yearly_v2' WHERE id = $1", yearly.ID); err != nil {
		t.Fatalf("give the yearly plan another price: %v", err)
	}
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the update after the price changed: %v", err)
	}
	if got := f.mySubscription(t); got.GetPlan().GetId() != yearly.ID.String() {
		t.Fatalf("subscription plan after the price changed = %s, want it kept on the yearly plan", got.GetPlan().GetId())
	}
	// Staff then hand the old Price to the monthly plan. The reader is still
	// billed at the Price the subscription was recorded at, so it stays on the
	// yearly plan rather than following the Price to its new plan.
	if _, err := f.pg.DB.ExecContext(context.Background(), "UPDATE subscription_plans SET stripe_price_id = 'price_yearly' WHERE id = $1", monthly.ID); err != nil {
		t.Fatalf("hand the old price to the monthly plan: %v", err)
	}
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the update after the price moved: %v", err)
	}
	if got := f.mySubscription(t); got.GetPlan().GetId() != yearly.ID.String() {
		t.Fatalf("subscription plan after the price moved = %s, want it kept on the yearly plan", got.GetPlan().GetId())
	}
	// A subscription with no current period recorded is answered without one.
	if got := f.mySubscription(t); got.CurrentPeriodEnd != "" {
		t.Fatalf("current period end = %q, want none", got.CurrentPeriodEnd)
	}

	// A subscription whose metadata names another tenant is refused.
	foreign := subscription
	foreign.ID = "sub_foreign_tenant"
	foreign.Metadata = stripetest.SubscriptionMetadata(uuid.New(), f.reader.ID, monthly.ID, "price_monthly")
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, foreign)
	if err := f.deliver(t, payload, headers); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("deliver a subscription of another tenant = %v, want invalid_argument", err)
	}

	// One whose plan is gone is acknowledged, since no redelivery would find
	// it, and records nothing.
	orphan := subscription
	orphan.ID = "sub_orphan"
	orphan.PriceID = "price_deleted"
	orphan.Metadata = stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, uuid.New(), "price_deleted")
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, orphan)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver a subscription of no plan: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("subscriptions = %d, want the first alone", got)
	}
}

// A checkout started before staff handed its Price to another plan records the
// subscription it starts on the plan the reader chose, and keeps it there.
func TestDBProcessPaymentWebhookRecordsANewSubscriptionOnThePlanItsCheckoutNamed(t *testing.T) {
	f := newSubscriptionFixture(t)
	monthly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	yearly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_yearly", Published: true})
	subscription := stripetest.Subscription{
		ID:         "sub_reassigned",
		CustomerID: "cus_reassigned",
		PriceID:    "price_monthly",
		Status:     "active",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, monthly.ID, "price_monthly"),
	}
	// While the checkout is open, the monthly plan gets another Price and its
	// old one goes to the yearly plan.
	for _, update := range []struct {
		planID  uuid.UUID
		priceID string
	}{{monthly.ID, "price_monthly_v2"}, {yearly.ID, "price_monthly"}} {
		if _, err := f.pg.DB.ExecContext(context.Background(), "UPDATE subscription_plans SET stripe_price_id = $2 WHERE id = $1", update.planID, update.priceID); err != nil {
			t.Fatalf("give plan %s the price %s: %v", update.planID, update.priceID, err)
		}
	}
	payload, headers := f.stripe.SubscriptionCheckoutCompleted(t, f.credentials, "cs_reassigned", subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the completed checkout: %v", err)
	}
	if got := f.mySubscription(t); got.GetPlan().GetId() != monthly.ID.String() {
		t.Fatalf("subscription plan = %s, want the monthly plan the checkout named", got.GetPlan().GetId())
	}
	payload, headers = f.stripe.SubscriptionUpdated(t, f.credentials, subscription)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the update: %v", err)
	}
	if got := f.mySubscription(t); got.GetPlan().GetId() != monthly.ID.String() {
		t.Fatalf("subscription plan after an update = %s, want it kept on the monthly plan", got.GetPlan().GetId())
	}
}

// The reader's current subscription is the latest one that is not over,
// rather than the one changed last.
func TestDBGetMySubscriptionPrefersOneThatIsNotOver(t *testing.T) {
	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Published: true})
	live := f.pg.SeedSubscription(t, f.tenant.ID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{Status: "active"})
	f.pg.SeedSubscription(t, f.tenant.ID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{Status: "canceled"})

	got := f.mySubscription(t)
	if got.GetId() != live.String() || got.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE {
		t.Fatalf("subscription = %+v, want the active one", got)
	}
	if _, err := f.subscriptions.GetMySubscription(context.Background(), &publirav1.GetMySubscriptionRequest{Tenant: tenantContext(f.tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMySubscription without a session = %v, want unauthenticated", err)
	}
}

// A reader holds at most one checkout they could pay: asking again for the
// same plan answers the open checkout, and asking for another expires it
// first, so two subscriptions can never be paid for side by side.
func TestDBStartSubscriptionCheckoutKeepsOneCheckoutPerReader(t *testing.T) {
	f := newSubscriptionFixture(t)
	monthly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	yearly := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_yearly", Published: true})
	start := func(planID uuid.UUID) (string, error) {
		t.Helper()
		res, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: planID.String()})
		return res.GetCheckoutUrl(), err
	}

	first, err := start(monthly.ID)
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout: %v", err)
	}
	again, err := start(monthly.ID)
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout of the same plan again: %v", err)
	}
	if again != first || len(f.stripe.API.CheckoutSessions()) != 1 {
		t.Fatalf("checkout = %q after %q with %d sessions, want the open one reused", again, first, len(f.stripe.API.CheckoutSessions()))
	}

	other, err := start(yearly.ID)
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout of another plan: %v", err)
	}
	if other == first || f.stripe.API.CheckoutSessionStatus(checkoutIDOf(first)) != "expired" {
		t.Fatalf("checkout of another plan = %q, first is %s, want a new one and the first expired", other, f.stripe.API.CheckoutSessionStatus(checkoutIDOf(first)))
	}

	// The reader pays the open checkout, and asks for another before Stripe's
	// notification has recorded the subscription.
	f.stripe.API.CompleteCheckoutSession(checkoutIDOf(other), "sub_on_its_way")
	if _, err := start(monthly.ID); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("StartSubscriptionCheckout after paying one = %v, want already_exists", err)
	}
	if got := len(f.stripe.API.CheckoutSessions()); got != 2 {
		t.Fatalf("checkout sessions = %d, want no third", got)
	}

	// Recorded but not over, as one whose first payment is still pending is,
	// it still holds the reader to the one subscription.
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], stripetest.Subscription{
		ID:         "sub_on_its_way",
		CustomerID: "cus_on_its_way",
		PriceID:    "price_yearly",
		Status:     "incomplete",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, yearly.ID, "price_yearly"),
	})
	payload, headers := f.stripe.SubscriptionUpdated(t, f.credentials, stripetest.Subscription{
		ID:         "sub_on_its_way",
		CustomerID: "cus_on_its_way",
		PriceID:    "price_yearly",
		Status:     "incomplete",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, yearly.ID, "price_yearly"),
	})
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the incomplete subscription: %v", err)
	}
	if _, err := start(monthly.ID); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("StartSubscriptionCheckout while the paid checkout's subscription is incomplete = %v, want already_exists", err)
	}

	// Once the subscription is recorded and has ended, the reader may start
	// again.
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], stripetest.Subscription{
		ID:         "sub_on_its_way",
		CustomerID: "cus_on_its_way",
		PriceID:    "price_yearly",
		Status:     "canceled",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, yearly.ID, "price_yearly"),
	})
	payload, headers = f.stripe.SubscriptionDeleted(t, f.credentials, stripetest.Subscription{
		ID:         "sub_on_its_way",
		CustomerID: "cus_on_its_way",
		PriceID:    "price_yearly",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, yearly.ID, "price_yearly"),
	})
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the deletion: %v", err)
	}
	if _, err := start(monthly.ID); err != nil {
		t.Fatalf("StartSubscriptionCheckout after the subscription ended: %v", err)
	}
	sessions := f.stripe.API.CheckoutSessions()
	if len(sessions) != 3 || sessions[2].Form.Get("customer") != "cus_on_its_way" {
		t.Fatalf("sessions = %d, the last for %q, want a third for the reader's customer", len(sessions), sessions[len(sessions)-1].Form.Get("customer"))
	}
}

// Starting a subscription checkout spends the reader's allowance before
// anything is written or asked of the provider.
func TestDBStartSubscriptionCheckoutSpendsTheReadersAllowance(t *testing.T) {
	f := newSubscriptionFixtureWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.SubscriptionCheckout = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	}))
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{Published: true})
	request := &publirav1.StartSubscriptionCheckoutRequest{Tenant: tenantContext(f.tenant), PlanId: plan.ID.String()}
	if _, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), request); err != nil {
		t.Fatalf("StartSubscriptionCheckout: %v", err)
	}
	if _, err := f.subscriptions.StartSubscriptionCheckout(f.readerCtx(t), request); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a second start over the limit = %v, want resource_exhausted", err)
	}
	if got := len(f.stripe.API.CheckoutSessions()); got != 1 {
		t.Fatalf("checkout sessions = %d, want the refused start to have asked Stripe for nothing", got)
	}
}
