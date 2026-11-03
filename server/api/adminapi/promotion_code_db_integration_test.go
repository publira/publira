package adminapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) promotionCodeClient() publiraadminv1connect.AdminPromotionCodeServiceClient {
	return publiraadminv1connect.NewAdminPromotionCodeServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// promotionCodeFixture is a tenant with an admin, a series, and an episode a
// code can name.
type promotionCodeFixture struct {
	env     *adminDBEnv
	admin   adminDBTenant
	series  testutil.Series
	episode testutil.Episode
	client  publiraadminv1connect.AdminPromotionCodeServiceClient
	// currency is the tenant's, and otherCurrency one it does not sell in.
	currency      string
	otherCurrency string
}

func newPromotionCodeFixture(t *testing.T) *promotionCodeFixture {
	t.Helper()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "PROMOTENANT1", "promo.example.com", "Promo Tenant", "PROMOADMIN01", "admin@promo.example.com")
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "PROMOSERIES1", Title: "Promo Series"})
	episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "PROMOEPISOD1",
		Title:    "Promo Episode",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	currency := env.PG.TenantCurrency(t, admin.Tenant.ID)
	otherCurrency := "JPY"
	if currency == otherCurrency {
		otherCurrency = "USD"
	}
	return &promotionCodeFixture{env: env, admin: admin, series: series, episode: episode, client: env.promotionCodeClient(), currency: currency, otherCurrency: otherCurrency}
}

func (f *promotionCodeFixture) ctx() context.Context {
	return testutil.WithBearer(context.Background(), f.admin.token())
}

func (f *promotionCodeFixture) create(t *testing.T, req *publiraadminv1.CreatePromotionCodeRequest) *publiraadminv1.PromotionCode {
	t.Helper()
	req.Tenant = f.admin.tenantContext()
	res, err := f.client.CreatePromotionCode(f.ctx(), req)
	if err != nil {
		t.Fatalf("CreatePromotionCode(%s): %v", req.Code, err)
	}
	return res.PromotionCode
}

func (f *promotionCodeFixture) audited(t *testing.T, action string) int {
	t.Helper()
	return f.env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = 'promotion_code'`, f.admin.Tenant.ID, action)
}

// A code is created with its discount and target fixed, read back as the
// console shows it, has its limits changed, is paused and resumed, and is
// deleted, each change audited once and a request that changes nothing not
// at all.
func TestDBPromotionCodeIsCreatedChangedPausedAndDeleted(t *testing.T) {
	t.Parallel()

	f := newPromotionCodeFixture(t)
	endsAt := time.Now().Add(30 * 24 * time.Hour).UTC().Truncate(time.Second).Format(time.RFC3339)
	created := f.create(t, &publiraadminv1.CreatePromotionCodeRequest{
		Code:          "Spring20",
		DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
		DiscountValue: 20,
		TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_SERIES,
		TargetId:      f.series.ID.String(),
		Limits:        &publiraadminv1.PromotionCodeLimits{EndsAt: endsAt, MaxRedemptions: 100},
	})
	if created.Code != "Spring20" || created.DiscountValue != 20 || created.TargetTitle != "Promo Series" || created.Currency != f.currency ||
		created.Limits.EndsAt != endsAt || created.Limits.MaxRedemptions != 100 || created.Limits.MaxRedemptionsPerReader != 0 || created.PausedAt != "" {
		t.Fatalf("created = %+v", created)
	}
	if got := f.audited(t, "promotion_code_created"); got != 1 {
		t.Fatalf("promotion_code_created audited %d times, want 1", got)
	}

	// The same name in another case is the same code.
	_, err := f.client.CreatePromotionCode(f.ctx(), &publiraadminv1.CreatePromotionCodeRequest{
		Tenant:        f.admin.tenantContext(),
		Code:          "SPRING20",
		DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_AMOUNT,
		DiscountValue: 100,
		Currency:      f.currency,
		TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_CATALOG,
	})
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a second SPRING20 = %v, want already_exists", err)
	}

	limits := &publiraadminv1.PromotionCodeLimits{EndsAt: endsAt, MaxRedemptions: 50, MaxRedemptionsPerReader: 1}
	update := func() *publiraadminv1.PromotionCode {
		t.Helper()
		res, err := f.client.UpdatePromotionCode(f.ctx(), &publiraadminv1.UpdatePromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: created.Id, Limits: limits})
		if err != nil {
			t.Fatalf("UpdatePromotionCode: %v", err)
		}
		return res.PromotionCode
	}
	if got := update(); got.Limits.MaxRedemptions != 50 || got.Limits.MaxRedemptionsPerReader != 1 || got.DiscountValue != 20 {
		t.Fatalf("updated = %+v", got)
	}
	update()
	if got := f.audited(t, "promotion_code_updated"); got != 1 {
		t.Fatalf("promotion_code_updated audited %d times, want 1 for two saves of the same limits", got)
	}

	for range 2 {
		res, err := f.client.PausePromotionCode(f.ctx(), &publiraadminv1.PausePromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: created.Id})
		if err != nil {
			t.Fatalf("PausePromotionCode: %v", err)
		}
		if res.PromotionCode.PausedAt == "" {
			t.Fatal("a paused code answers no paused_at")
		}
	}
	resumed, err := f.client.ResumePromotionCode(f.ctx(), &publiraadminv1.ResumePromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: created.Id})
	if err != nil {
		t.Fatalf("ResumePromotionCode: %v", err)
	}
	if resumed.PromotionCode.PausedAt != "" {
		t.Fatalf("resumed = %+v, want no paused_at", resumed.PromotionCode)
	}
	if paused, resumed := f.audited(t, "promotion_code_paused"), f.audited(t, "promotion_code_resumed"); paused != 1 || resumed != 1 {
		t.Fatalf("paused audited %d times and resumed %d, want 1 each", paused, resumed)
	}

	if _, err := f.client.DeletePromotionCode(f.ctx(), &publiraadminv1.DeletePromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: created.Id}); err != nil {
		t.Fatalf("DeletePromotionCode: %v", err)
	}
	if got := f.audited(t, "promotion_code_deleted"); got != 1 {
		t.Fatalf("promotion_code_deleted audited %d times, want 1", got)
	}
	if _, err := f.client.GetPromotionCode(f.ctx(), &publiraadminv1.GetPromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: created.Id}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPromotionCode of a deleted code = %v, want not_found", err)
	}
	// A deleted code gives its name up.
	again := f.create(t, &publiraadminv1.CreatePromotionCodeRequest{
		Code:          "SPRING20",
		DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_AMOUNT,
		DiscountValue: 100,
		Currency:      f.currency,
		TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_CATALOG,
	})
	listed, err := f.client.ListPromotionCodes(f.ctx(), &publiraadminv1.ListPromotionCodesRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListPromotionCodes: %v", err)
	}
	if len(listed.PromotionCodes) != 1 || listed.PromotionCodes[0].Id != again.Id || listed.PromotionCodes[0].TargetTitle != "" {
		t.Fatalf("listed = %+v, want the new SPRING20 alone", listed.PromotionCodes)
	}
}

// Every field a code is created with is checked and a refusal names it.
func TestDBCreatePromotionCodeChecksItsFields(t *testing.T) {
	t.Parallel()

	f := newPromotionCodeFixture(t)
	valid := func() *publiraadminv1.CreatePromotionCodeRequest {
		return &publiraadminv1.CreatePromotionCodeRequest{
			Tenant:        f.admin.tenantContext(),
			Code:          "VALID1",
			DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
			DiscountValue: 10,
			TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_EPISODE,
			TargetId:      f.episode.ID.String(),
		}
	}
	for _, tc := range []struct {
		name   string
		change func(*publiraadminv1.CreatePromotionCodeRequest)
		code   connect.Code
		field  string
	}{
		{name: "a code with a hyphen", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.Code = "SPRING-20" }, code: connect.CodeInvalidArgument, field: "code"},
		{name: "a code too long", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.Code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456" }, code: connect.CodeInvalidArgument, field: "code"},
		{name: "no discount kind", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.DiscountKind = 0 }, code: connect.CodeInvalidArgument, field: "discount_kind"},
		{name: "a percentage above 100", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.DiscountValue = 101 }, code: connect.CodeInvalidArgument, field: "discount_value"},
		{name: "no amount", change: func(r *publiraadminv1.CreatePromotionCodeRequest) {
			r.DiscountKind = publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_AMOUNT
			r.DiscountValue = 0
		}, code: connect.CodeInvalidArgument, field: "discount_value"},
		{name: "an amount in another currency", change: func(r *publiraadminv1.CreatePromotionCodeRequest) {
			r.DiscountKind = publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_AMOUNT
			r.DiscountValue = 100
			r.Currency = f.otherCurrency
		}, code: connect.CodeFailedPrecondition, field: "currency"},
		{name: "no target kind", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.TargetKind = 0 }, code: connect.CodeInvalidArgument, field: "target_kind"},
		{name: "a target of nothing", change: func(r *publiraadminv1.CreatePromotionCodeRequest) { r.TargetId = uuid.Must(uuid.NewV7()).String() }, code: connect.CodeInvalidArgument, field: "target_id"},
		{name: "an episode named as a series", change: func(r *publiraadminv1.CreatePromotionCodeRequest) {
			r.TargetKind = publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_SERIES
		}, code: connect.CodeInvalidArgument, field: "target_id"},
		{name: "a window that ends before it starts", change: func(r *publiraadminv1.CreatePromotionCodeRequest) {
			r.Limits = &publiraadminv1.PromotionCodeLimits{StartsAt: "2026-12-01T00:00:00Z", EndsAt: "2026-11-01T00:00:00Z"}
		}, code: connect.CodeInvalidArgument, field: "limits.ends_at"},
		{name: "a negative limit", change: func(r *publiraadminv1.CreatePromotionCodeRequest) {
			r.Limits = &publiraadminv1.PromotionCodeLimits{MaxRedemptionsPerReader: -1}
		}, code: connect.CodeInvalidArgument, field: "limits.max_redemptions_per_reader"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := valid()
			tc.change(req)
			_, err := f.client.CreatePromotionCode(f.ctx(), req)
			if connect.CodeOf(err) != tc.code {
				t.Fatalf("CreatePromotionCode = %v, want %v", err, tc.code)
			}
			assertBadRequestField(t, err, tc.field)
		})
	}
	if got := f.env.countRows(t, `SELECT count(*) FROM promotion_codes WHERE tenant_id = $1`, f.admin.Tenant.ID); got != 0 {
		t.Fatalf("promotion codes = %d, want none of the refused ones", got)
	}
}

// The redemptions of a code are listed newest first with who bought what, at
// what list price and for how much, a page at a time.
func TestDBListPromotionCodeRedemptionsPagesTheNewestFirst(t *testing.T) {
	t.Parallel()

	f := newPromotionCodeFixture(t)
	code := f.create(t, &publiraadminv1.CreatePromotionCodeRequest{
		Code:          "HALF",
		DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
		DiscountValue: 50,
		TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_CATALOG,
	})
	reader := f.env.PG.SeedEndUser(t, f.admin.Tenant.ID, "PROMOREADER1", "reader@promo.example.com", "Reader")
	base := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	for i := range 3 {
		purchaseID := uuid.Must(uuid.NewV7())
		if _, err := f.env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, list_price, promotion_code_id, currency)
			VALUES ($1, $2, $3, $4, 250, 500, $5, $6)
		`, purchaseID, f.admin.Tenant.ID, reader.ID, f.episode.ID, code.Id, f.currency); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
		if _, err := f.env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO promotion_code_redemptions (id, tenant_id, promotion_code_id, user_id, purchase_id, redeemed_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, uuid.Must(uuid.NewV7()), f.admin.Tenant.ID, code.Id, reader.ID, purchaseID, base.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatalf("insert redemption: %v", err)
		}
	}

	list := func(token string) *publiraadminv1.ListPromotionCodeRedemptionsResponse {
		t.Helper()
		res, err := f.client.ListPromotionCodeRedemptions(f.ctx(), &publiraadminv1.ListPromotionCodeRedemptionsRequest{
			Tenant:          f.admin.tenantContext(),
			PromotionCodeId: code.Id,
			Limit:           2,
			Token:           token,
		})
		if err != nil {
			t.Fatalf("ListPromotionCodeRedemptions: %v", err)
		}
		return res
	}
	first := list("")
	if len(first.Redemptions) != 2 || first.NextToken == "" || first.PreviousToken != "" {
		t.Fatalf("first page = %+v", first)
	}
	got := first.Redemptions[0]
	if got.RedeemedAt != base.Add(2*time.Minute).Format(time.RFC3339) || got.ReaderEmail != "reader@promo.example.com" ||
		got.Title != "Promo Episode" || got.ListPrice != 500 || got.Price != 250 || got.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE {
		t.Fatalf("newest redemption = %+v", got)
	}
	second := list(first.NextToken)
	if len(second.Redemptions) != 1 || second.NextToken != "" || second.PreviousToken == "" {
		t.Fatalf("second page = %+v", second)
	}
	if read, err := f.client.GetPromotionCode(f.ctx(), &publiraadminv1.GetPromotionCodeRequest{Tenant: f.admin.tenantContext(), PromotionCodeId: code.Id}); err != nil || read.PromotionCode.RedemptionCount != 3 {
		t.Fatalf("GetPromotionCode = %+v, %v, want 3 redemptions", read, err)
	}
}

// Another tenant's code is not one this tenant can read or change.
func TestDBPromotionCodeOfAnotherTenantIsNotFound(t *testing.T) {
	t.Parallel()

	f := newPromotionCodeFixture(t)
	other := f.env.seedTenantWithAdmin(t, "PROMOTENANT2", "promo-b.example.com", "Promo B", "PROMOADMIN02", "admin@promo-b.example.com")
	code := f.create(t, &publiraadminv1.CreatePromotionCodeRequest{
		Code:          "MINE",
		DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
		DiscountValue: 10,
		TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_CATALOG,
	})
	ctx := testutil.WithBearer(context.Background(), other.token())
	_, err := f.client.PausePromotionCode(ctx, &publiraadminv1.PausePromotionCodeRequest{Tenant: other.tenantContext(), PromotionCodeId: code.Id})
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeNotFound {
		t.Fatalf("PausePromotionCode of another tenant's code = %v, want not_found", err)
	}
}
