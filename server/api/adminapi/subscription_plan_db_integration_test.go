package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

const subscriptionPlanTestSecretKey = "sk_test_51SubscriptionPlanAAAA"

// subscriptionPlanFixture is a tenant that sells through Stripe, whose API is
// a fake holding a monthly and a yearly Price, with a label and two series to
// name.
type subscriptionPlanFixture struct {
	env     *adminDBEnv
	stripe  *stripetest.API
	admin   adminDBTenant
	label   testutil.Label
	seriesA testutil.Series
	seriesB testutil.Series
}

func newSubscriptionPlanFixture(t *testing.T) *subscriptionPlanFixture {
	t.Helper()

	api := stripetest.NewAPI(t)
	env := newAdminDBEnvWithPaymentProviders(t, paymentprovider.NewRegistry(stripe.New(stripe.WithAPIURL(api.URL()))))
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	f := &subscriptionPlanFixture{env: env, stripe: api, admin: admin}
	f.label = env.PG.SeedLabel(t, admin.Tenant.ID, testutil.LabelSeed{PublicID: "LABELA01", Name: "Label A"})
	f.seriesA = env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A", Published: true})
	f.seriesB = env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB1", Title: "Series B", Published: true})
	api.SetPrice(subscriptionPlanTestSecretKey, stripetest.Price{ID: "price_monthly", Active: true, Amount: 980, Currency: "JPY", Type: "recurring", Interval: "month", IntervalCount: 1})
	api.SetPrice(subscriptionPlanTestSecretKey, stripetest.Price{ID: "price_yearly", Active: true, Amount: 9800, Currency: "JPY", Type: "recurring", Interval: "year", IntervalCount: 1})

	if _, err := env.paymentClient().UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant:   admin.tenantContext(),
		Provider: stripe.ID,
		Enabled:  true,
		Currency: "JPY",
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: subscriptionPlanTestSecretKey},
			{Name: stripe.FieldWebhookSecret, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: "whsec_SubscriptionPlanAAAA"},
		},
	}); err != nil {
		t.Fatalf("save the Stripe settings: %v", err)
	}
	return f
}

func (f *subscriptionPlanFixture) client() publiraadminv1connect.AdminSubscriptionPlanServiceClient {
	return publiraadminv1connect.NewAdminSubscriptionPlanServiceClient(connect.NewClient(connecthttp.NewTransport(f.env.Server.Client(), f.env.Server.URL)))
}

func (f *subscriptionPlanFixture) ctx() context.Context {
	return testutil.WithBearer(context.Background(), f.admin.token())
}

func (f *subscriptionPlanFixture) labelPlan() *publiraadminv1.SubscriptionPlanInput {
	return &publiraadminv1.SubscriptionPlanInput{
		Name:          "  Label A unlimited  ",
		Description:   "Every series of Label A.",
		StripePriceId: "price_monthly",
		Scope:         publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_LABEL,
		LabelIds:      []string{f.label.ID.String(), f.label.ID.String()},
		Published:     true,
	}
}

func (f *subscriptionPlanFixture) create(t *testing.T, plan *publiraadminv1.SubscriptionPlanInput) *publiraadminv1.AdminSubscriptionPlan {
	t.Helper()
	res, err := f.client().CreateSubscriptionPlan(f.ctx(), &publiraadminv1.CreateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), Plan: plan})
	if err != nil {
		t.Fatalf("CreateSubscriptionPlan: %v", err)
	}
	return res.Plan
}

// A plan is saved with what its Price bills, read from Stripe, and the labels
// it names, and is listed and read back as it was saved.
func TestDBCreateSubscriptionPlanStoresWhatItsPriceBills(t *testing.T) {
	f := newSubscriptionPlanFixture(t)

	created := f.create(t, f.labelPlan())
	if created.Name != "Label A unlimited" || created.Description != "Every series of Label A." || created.StripePriceId != "price_monthly" {
		t.Fatalf("plan = %+v", created)
	}
	if created.PriceAmount != 980 || created.Currency != "JPY" || created.Interval != publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_MONTH || created.IntervalCount != 1 {
		t.Fatalf("plan bills %d %s every %d %s, want 980 JPY every month", created.PriceAmount, created.Currency, created.IntervalCount, created.Interval)
	}
	if created.Scope != publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_LABEL || !slices.Equal(created.LabelIds, []string{f.label.ID.String()}) || len(created.SeriesIds) != 0 {
		t.Fatalf("plan opens %s %v %v, want Label A once", created.Scope, created.LabelIds, created.SeriesIds)
	}
	if !created.Published || created.SubscriberCount != 0 || created.PublicId == "" || created.Id == "" {
		t.Fatalf("plan = %+v", created)
	}

	got, err := f.client().GetSubscriptionPlan(f.ctx(), &publiraadminv1.GetSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: created.Id})
	if err != nil {
		t.Fatalf("GetSubscriptionPlan: %v", err)
	}
	if got.Plan.Id != created.Id || got.Plan.Name != created.Name || !slices.Equal(got.Plan.LabelIds, created.LabelIds) {
		t.Fatalf("read back %+v, want %+v", got.Plan, created)
	}

	seriesPlan := f.create(t, &publiraadminv1.SubscriptionPlanInput{
		Name:          "Two series",
		StripePriceId: "price_yearly",
		Scope:         publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES,
		SeriesIds:     []string{f.seriesB.ID.String(), f.seriesA.ID.String()},
	})
	listed, err := f.client().ListSubscriptionPlans(f.ctx(), &publiraadminv1.ListSubscriptionPlansRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListSubscriptionPlans: %v", err)
	}
	if len(listed.Plans) != 2 || listed.Plans[0].Id != created.Id || listed.Plans[1].Id != seriesPlan.Id {
		t.Fatalf("listed %v, want both plans in the order they were created", listed.Plans)
	}
	if got := listed.Plans[1]; got.Published || len(got.SeriesIds) != 2 || got.Interval != publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_YEAR {
		t.Fatalf("series plan = %+v, want an unpublished yearly plan of both series", got)
	}

	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'subscription_plan_created' AND target_type = 'subscription_plan' AND target_id = $2",
		f.admin.Tenant.ID, created.PublicId,
	); got != 1 {
		t.Fatalf("audit entries for the create = %d, want 1", got)
	}
}

func TestDBSubscriptionPlanWritesRefuseWhatAPlanCannotHold(t *testing.T) {
	f := newSubscriptionPlanFixture(t)
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreignLabel := f.env.PG.SeedLabel(t, other.Tenant.ID, testutil.LabelSeed{PublicID: "LABELB01", Name: "Label B"})
	f.stripe.SetPrice(subscriptionPlanTestSecretKey, stripetest.Price{ID: "price_archived", Active: false, Amount: 980, Currency: "JPY", Type: "recurring", Interval: "month", IntervalCount: 1})
	f.stripe.SetPrice(subscriptionPlanTestSecretKey, stripetest.Price{ID: "price_once", Active: true, Amount: 980, Currency: "JPY", Type: "one_time"})
	f.create(t, f.labelPlan())

	cases := []struct {
		name  string
		edit  func(*publiraadminv1.SubscriptionPlanInput)
		code  connect.Code
		field string
	}{
		{"no name", func(p *publiraadminv1.SubscriptionPlanInput) { p.Name = "  " }, connect.CodeInvalidArgument, "plan.name"},
		{"no price", func(p *publiraadminv1.SubscriptionPlanInput) { p.StripePriceId = "" }, connect.CodeInvalidArgument, "plan.stripe_price_id"},
		{"no scope", func(p *publiraadminv1.SubscriptionPlanInput) {
			p.Scope = publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED
		}, connect.CodeInvalidArgument, "plan.scope"},
		{"the whole catalog with a label", func(p *publiraadminv1.SubscriptionPlanInput) {
			p.Scope = publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_ALL
		}, connect.CodeInvalidArgument, "plan.scope"},
		{"labels with none named", func(p *publiraadminv1.SubscriptionPlanInput) { p.LabelIds = nil }, connect.CodeInvalidArgument, "plan.label_ids"},
		{"labels with a series", func(p *publiraadminv1.SubscriptionPlanInput) { p.SeriesIds = []string{f.seriesA.ID.String()} }, connect.CodeInvalidArgument, "plan.series_ids"},
		{"a label of another tenant", func(p *publiraadminv1.SubscriptionPlanInput) { p.LabelIds = []string{foreignLabel.ID.String()} }, connect.CodeInvalidArgument, "plan.label_ids"},
		{"a price Stripe does not know", func(p *publiraadminv1.SubscriptionPlanInput) { p.StripePriceId = "price_missing" }, connect.CodeInvalidArgument, "plan.stripe_price_id"},
		{"an archived price", func(p *publiraadminv1.SubscriptionPlanInput) { p.StripePriceId = "price_archived" }, connect.CodeInvalidArgument, "plan.stripe_price_id"},
		{"a price that bills once", func(p *publiraadminv1.SubscriptionPlanInput) { p.StripePriceId = "price_once" }, connect.CodeInvalidArgument, "plan.stripe_price_id"},
		{"a price another plan bills", func(*publiraadminv1.SubscriptionPlanInput) {}, connect.CodeAlreadyExists, "plan.stripe_price_id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan := f.labelPlan()
			tc.edit(plan)
			_, err := f.client().CreateSubscriptionPlan(f.ctx(), &publiraadminv1.CreateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), Plan: plan})
			if connect.CodeOf(err) != tc.code {
				t.Fatalf("CreateSubscriptionPlan = %v, want %s", err, tc.code)
			}
			assertBadRequestField(t, err, tc.field)
		})
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM subscription_plans WHERE tenant_id = $1", f.admin.Tenant.ID); got != 1 {
		t.Fatalf("plans = %d, want only the first", got)
	}

	// A tenant that sells through no provider has no Price to name.
	_, err := f.client().CreateSubscriptionPlan(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.CreateSubscriptionPlanRequest{
		Tenant: other.tenantContext(),
		Plan:   &publiraadminv1.SubscriptionPlanInput{Name: "Plan", StripePriceId: "price_monthly", Scope: publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_ALL},
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("CreateSubscriptionPlan without payments = %v, want failed_precondition", err)
	}
}

func TestDBCreateSubscriptionPlanRefusesPastTheCap(t *testing.T) {
	f := newSubscriptionPlanFixture(t)
	for range maxSubscriptionPlans {
		f.env.PG.SeedSubscriptionPlan(t, f.admin.Tenant.ID, testutil.SubscriptionPlanSeed{})
	}
	_, err := f.client().CreateSubscriptionPlan(f.ctx(), &publiraadminv1.CreateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), Plan: f.labelPlan()})
	if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonSubscriptionPlanLimit {
		t.Fatalf("CreateSubscriptionPlan past the cap = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonSubscriptionPlanLimit)
	}
}

// An update replaces every field. The Price is asked of Stripe only when it
// changes, so a plan whose Price Stripe no longer answers for can still be
// renamed.
func TestDBUpdateSubscriptionPlanReplacesEveryField(t *testing.T) {
	f := newSubscriptionPlanFixture(t)
	created := f.create(t, f.labelPlan())

	// The tenant archives the Price; the plan keeps it.
	f.stripe.SetPrice(subscriptionPlanTestSecretKey, stripetest.Price{ID: "price_monthly", Active: false, Amount: 980, Currency: "JPY", Type: "recurring", Interval: "month", IntervalCount: 1})
	renamed := f.labelPlan()
	renamed.Name = "Renamed"
	renamed.Published = false
	res, err := f.client().UpdateSubscriptionPlan(f.ctx(), &publiraadminv1.UpdateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: created.Id, Plan: renamed})
	if err != nil {
		t.Fatalf("UpdateSubscriptionPlan keeping the price: %v", err)
	}
	if res.Plan.Name != "Renamed" || res.Plan.Published || res.Plan.PriceAmount != 980 {
		t.Fatalf("plan = %+v", res.Plan)
	}

	moved := &publiraadminv1.SubscriptionPlanInput{
		Name:          "Series A yearly",
		StripePriceId: "price_yearly",
		Scope:         publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES,
		SeriesIds:     []string{f.seriesA.ID.String()},
		Published:     true,
	}
	res, err = f.client().UpdateSubscriptionPlan(f.ctx(), &publiraadminv1.UpdateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: created.Id, Plan: moved})
	if err != nil {
		t.Fatalf("UpdateSubscriptionPlan moving the price and the scope: %v", err)
	}
	if res.Plan.PriceAmount != 9800 || res.Plan.Interval != publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_YEAR || res.Plan.Scope != publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES {
		t.Fatalf("plan = %+v, want the yearly price and the series scope", res.Plan)
	}
	if len(res.Plan.LabelIds) != 0 || !slices.Equal(res.Plan.SeriesIds, []string{f.seriesA.ID.String()}) {
		t.Fatalf("plan opens %v %v, want Series A alone", res.Plan.LabelIds, res.Plan.SeriesIds)
	}
	if res.Plan.PublicId != created.PublicId {
		t.Fatalf("public id moved from %s to %s", created.PublicId, res.Plan.PublicId)
	}

	moved.StripePriceId = "price_archived_never_saved"
	_, err = f.client().UpdateSubscriptionPlan(f.ctx(), &publiraadminv1.UpdateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: created.Id, Plan: moved})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSubscriptionPlan to an unknown price = %v, want invalid_argument", err)
	}

	_, err = f.client().UpdateSubscriptionPlan(f.ctx(), &publiraadminv1.UpdateSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: uuid.NewString(), Plan: renamed})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateSubscriptionPlan of no plan = %v, want not_found", err)
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'subscription_plan_updated' AND target_id = $2",
		f.admin.Tenant.ID, created.PublicId,
	); got != 2 {
		t.Fatalf("audit entries for the updates = %d, want 2", got)
	}
}

// A plan anyone has subscribed to stays, whatever the subscription's state; one
// nobody has goes.
func TestDBDeleteSubscriptionPlanKeepsAPlanSomeoneSubscribedTo(t *testing.T) {
	f := newSubscriptionPlanFixture(t)
	reader := f.env.PG.SeedEndUser(t, f.admin.Tenant.ID, "READER01", "reader@example.com", "Reader")
	subscribed := f.env.PG.SeedSubscriptionPlan(t, f.admin.Tenant.ID, testutil.SubscriptionPlanSeed{})
	f.env.PG.SeedSubscription(t, f.admin.Tenant.ID, reader.ID, subscribed.ID, testutil.SubscriptionSeed{Status: "canceled"})
	checkedOut := f.env.PG.SeedSubscriptionPlan(t, f.admin.Tenant.ID, testutil.SubscriptionPlanSeed{})
	if _, err := f.env.PG.DB.ExecContext(context.Background(),
		"INSERT INTO subscription_checkouts (tenant_id, user_id, plan_id, stripe_checkout_session_id) VALUES ($1, $2, $3, 'cs_open')",
		f.admin.Tenant.ID, reader.ID, checkedOut.ID,
	); err != nil {
		t.Fatalf("seed a checkout: %v", err)
	}
	unused := f.env.PG.SeedSubscriptionPlan(t, f.admin.Tenant.ID, testutil.SubscriptionPlanSeed{})

	// A reader's open checkout may still be paid, so its plan stays too.
	for name, plan := range map[string]testutil.SubscriptionPlan{"a subscribed plan": subscribed, "a plan a reader is checking out": checkedOut} {
		_, err := f.client().DeleteSubscriptionPlan(f.ctx(), &publiraadminv1.DeleteSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: plan.ID.String()})
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonSubscriptionPlanInUse {
			t.Fatalf("DeleteSubscriptionPlan of %s = %v (reason %q), want failed_precondition %s", name, err, reason, rpcerrors.ReasonSubscriptionPlanInUse)
		}
	}
	if _, err := f.client().DeleteSubscriptionPlan(f.ctx(), &publiraadminv1.DeleteSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: unused.ID.String()}); err != nil {
		t.Fatalf("DeleteSubscriptionPlan: %v", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM subscription_plans WHERE tenant_id = $1", f.admin.Tenant.ID); got != 2 {
		t.Fatalf("plans = %d, want the two in use", got)
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'subscription_plan_deleted' AND target_id = $2",
		f.admin.Tenant.ID, unused.PublicID,
	); got != 1 {
		t.Fatalf("audit entries for the delete = %d, want 1", got)
	}

	// Another tenant's plan is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreign := f.env.PG.SeedSubscriptionPlan(t, other.Tenant.ID, testutil.SubscriptionPlanSeed{})
	for name, call := range map[string]func() error{
		"get": func() error {
			_, err := f.client().GetSubscriptionPlan(f.ctx(), &publiraadminv1.GetSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: foreign.ID.String()})
			return err
		},
		"delete": func() error {
			_, err := f.client().DeleteSubscriptionPlan(f.ctx(), &publiraadminv1.DeleteSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: foreign.ID.String()})
			return err
		},
	} {
		if err := call(); connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s of another tenant's plan = %v, want not_found", name, err)
		}
	}
}

// A plan's subscribers are the readers it bills or is retrying: trialing,
// active, and past due.
func TestDBSubscriptionPlanCountsTheReadersItBills(t *testing.T) {
	f := newSubscriptionPlanFixture(t)
	plan := f.env.PG.SeedSubscriptionPlan(t, f.admin.Tenant.ID, testutil.SubscriptionPlanSeed{})
	for i, status := range []string{"trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"} {
		reader := f.env.PG.SeedEndUser(t, f.admin.Tenant.ID, fmt.Sprintf("READER%02d", i), fmt.Sprintf("reader%d@example.com", i), "Reader")
		f.env.PG.SeedSubscription(t, f.admin.Tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{Status: status})
	}
	res, err := f.client().GetSubscriptionPlan(f.ctx(), &publiraadminv1.GetSubscriptionPlanRequest{Tenant: f.admin.tenantContext(), SubscriptionPlanId: plan.ID.String()})
	if err != nil {
		t.Fatalf("GetSubscriptionPlan: %v", err)
	}
	if res.Plan.SubscriberCount != 3 {
		t.Fatalf("subscriber count = %d, want 3", res.Plan.SubscriberCount)
	}
}
