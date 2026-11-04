package publicapi

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

// promotionCodeEnv is a tenant taking payments through Stripe, with an episode
// at 500 that is rented at 200, another at 400, and a volume of the two at
// 900, and a reader signed in to buy them.
type promotionCodeEnv struct {
	pg       *testutil.PostgresEnv
	tenant   testutil.Tenant
	reader   testutil.TenantUser
	token    string
	series   testutil.Series
	episode  testutil.Episode
	other    testutil.Episode
	volume   testutil.Volume
	checkout *capturingCheckoutProvider
	client   publirav1connect.PurchaseServiceClient
	tenants  publirav1connect.TenantServiceClient
}

func newPromotionCodeEnv(t *testing.T, guards readerGuards) *promotionCodeEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PROMOCODE001", "promo-code.example.com", "Promo tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "PROMOREADER1", "promo-reader@example.com", "Promo reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PROMOSERIES1", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "PROMOEPISOD1",
		Title:       "Promo episode",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})
	other := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "PROMOEPISOD2",
		Title:       "Other episode",
		Price:       400,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
		OrderIndex:  2,
	})
	if _, err := pg.DB.ExecContext(ctx, `UPDATE episode_listings SET rental_price = 200, rental_period_hours = 48 WHERE episode_id = $1`, episode.ID); err != nil {
		t.Fatalf("rent the episode: %v", err)
	}
	volume := pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{
		PublicID:   "PROMOVOLUME1",
		Title:      "Promo volume",
		Price:      900,
		Published:  true,
		EpisodeIDs: []uuid.UUID{episode.ID, other.ID},
	})
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	checkout := newCapturingCheckoutProvider()
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), guards, openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(checkout)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	transport := connecthttp.NewTransport(ts.Client(), ts.URL)
	return &promotionCodeEnv{
		pg:       pg,
		tenant:   tenant,
		reader:   reader,
		token:    tokenFor(t, tenant, reader),
		series:   series,
		episode:  episode,
		other:    other,
		volume:   volume,
		checkout: checkout,
		client:   publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport)),
		tenants:  publirav1connect.NewTenantServiceClient(connect.NewClient(transport)),
	}
}

func (e *promotionCodeEnv) ctx() context.Context {
	return testutil.WithBearer(context.Background(), e.token)
}

// promotionCodeSeed is a promotion_codes row a case starts from; the zero
// value of each optional column leaves it NULL.
type promotionCodeSeed struct {
	code                    string
	kind                    string
	value                   int32
	targetKind              string
	targetID                uuid.NullUUID
	startsAt                sql.NullTime
	endsAt                  sql.NullTime
	maxRedemptions          sql.NullInt32
	maxRedemptionsPerReader sql.NullInt32
	paused                  bool
	deleted                 bool
}

func seedPromotionCode(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, seed promotionCodeSeed) uuid.UUID {
	t.Helper()
	if seed.targetKind == "" {
		seed.targetKind = "catalog"
	}
	id := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id,
			starts_at, ends_at, max_redemptions, max_redemptions_per_reader, paused_at, deleted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			CASE WHEN $12 THEN now() END, CASE WHEN $13 THEN now() END)
	`, id, tenantID, seed.code, seed.kind, seed.value, seed.targetKind, seed.targetID,
		seed.startsAt, seed.endsAt, seed.maxRedemptions, seed.maxRedemptionsPerReader, seed.paused, seed.deleted); err != nil {
		t.Fatalf("seed promotion code %s: %v", seed.code, err)
	}
	return id
}

// redeem records a purchase of the other episode by userID that redeemed the
// code, as one confirmed earlier would have.
func (e *promotionCodeEnv) redeem(t *testing.T, codeID, userID uuid.UUID) {
	t.Helper()
	purchaseID := uuid.Must(uuid.NewV7())
	if _, err := e.pg.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, list_price, promotion_code_id, currency)
		VALUES ($1, $2, $3, $4, 300, 400, $5, $6)
	`, purchaseID, e.tenant.ID, userID, e.other.ID, codeID, e.pg.TenantCurrency(t, e.tenant.ID)); err != nil {
		t.Fatalf("seed a purchase that redeemed the code: %v", err)
	}
	if _, err := e.pg.DB.ExecContext(context.Background(), `
		INSERT INTO promotion_code_redemptions (id, tenant_id, promotion_code_id, user_id, purchase_id)
		VALUES ($1, $2, $3, $4, $5)
	`, uuid.Must(uuid.NewV7()), e.tenant.ID, codeID, userID, purchaseID); err != nil {
		t.Fatalf("seed a redemption: %v", err)
	}
}

func (e *promotionCodeEnv) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := e.pg.DB.QueryRowContext(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", query, err)
	}
	return n
}

func assertPromotionCodeRefusal(t *testing.T, label string, err error, want string) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("%s = %v, want failed_precondition with %s", label, err, want)
	}
	if reason, _ := errorInfoReason(err); reason != want {
		t.Fatalf("%s reason = %q, want %q", label, reason, want)
	}
}

// episodeSaleOf, rentalSaleOf, and volumeSaleOf name the sales PreviewPromotionCode
// quotes.
func episodeSaleOf(id uuid.UUID) *publirav1.PromotionCodeSale {
	return &publirav1.PromotionCodeSale{EpisodeId: id.String()}
}

func rentalSaleOf(id uuid.UUID) *publirav1.PromotionCodeSale {
	return &publirav1.PromotionCodeSale{EpisodeId: id.String(), Kind: publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL}
}

func volumeSaleOf(id uuid.UUID) *publirav1.PromotionCodeSale {
	return &publirav1.PromotionCodeSale{VolumeId: id.String()}
}

// quote is what a test expects of one PromotionCodeQuote.
type quote struct {
	listPrice, discountAmount, price int32
	refusal                          publirav1.PromotionCodeQuote_Refusal
}

func assertQuotes(t *testing.T, res *publirav1.PreviewPromotionCodeResponse, want ...quote) {
	t.Helper()
	if res.GetCurrency() == "" {
		t.Fatalf("the response names no currency: %+v", res)
	}
	if len(res.GetQuotes()) != len(want) {
		t.Fatalf("quotes = %+v, want %d of them", res.GetQuotes(), len(want))
	}
	for i, got := range res.GetQuotes() {
		if (quote{got.GetListPrice(), got.GetDiscountAmount(), got.GetPrice(), got.GetRefusal()}) != want[i] {
			t.Fatalf("quote %d = %+v, want %+v", i, got, want[i])
		}
	}
}

// hold records a purchase by the reader, paid without a code, of the episode
// or the volume, one of which is uuid.Nil.
func (e *promotionCodeEnv) hold(t *testing.T, episodeID, volumeID uuid.UUID) {
	t.Helper()
	if _, err := e.pg.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, volume_id, price_at_purchase, currency)
		VALUES ($1, $2, $3, $4, $5, 400, $6)
	`, uuid.Must(uuid.NewV7()), e.tenant.ID, e.reader.ID,
		uuid.NullUUID{UUID: episodeID, Valid: episodeID != uuid.Nil},
		uuid.NullUUID{UUID: volumeID, Valid: volumeID != uuid.Nil},
		e.pg.TenantCurrency(t, e.tenant.ID)); err != nil {
		t.Fatalf("seed a purchase the reader holds: %v", err)
	}
}

// A code is quoted against each sale the reader is about to start, at the
// price that sale charges now, and matched whatever its case. A code that
// cannot be applied at all fails the call with the reason a client tells the
// reader, while one that does not fit a sale is answered on that sale's quote.
func TestDBPreviewPromotionCodeQuotesTheSaleAndRefusesWithAReason(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	tenantID := env.tenant.ID
	hourAgo := sql.NullTime{Time: time.Now().Add(-time.Hour), Valid: true}
	inAnHour := sql.NullTime{Time: time.Now().Add(time.Hour), Valid: true}
	one := sql.NullInt32{Int32: 1, Valid: true}
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "Spring20", kind: "percent", value: 20})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "YEN150", kind: "amount", value: 150, targetKind: "episode", targetID: uuid.NullUUID{UUID: env.episode.ID, Valid: true}})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "PAUSED", kind: "percent", value: 10, paused: true})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "DELETED", kind: "percent", value: 10, deleted: true})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "SOON", kind: "percent", value: 10, startsAt: inAnHour})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "OVER", kind: "percent", value: 10, startsAt: sql.NullTime{Time: time.Now().Add(-2 * time.Hour), Valid: true}, endsAt: hourAgo})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "OTHERONLY", kind: "percent", value: 10, targetKind: "episode", targetID: uuid.NullUUID{UUID: env.other.ID, Valid: true}})
	seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "VOLUMEONLY", kind: "percent", value: 10, targetKind: "volume", targetID: uuid.NullUUID{UUID: env.volume.ID, Valid: true}})
	someoneElse := env.pg.SeedEndUser(t, tenantID, "PROMOREADER2", "someone@example.com", "Someone")
	spent := seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "SPENT", kind: "percent", value: 10, maxRedemptions: one})
	env.redeem(t, spent, someoneElse.ID)
	mine := seedPromotionCode(t, env.pg, tenantID, promotionCodeSeed{code: "ONCEEACH", kind: "percent", value: 10, maxRedemptionsPerReader: one})
	env.redeem(t, mine, env.reader.ID)
	// Another tenant's code of the same name is not this tenant's.
	elsewhere := env.pg.SeedTenant(t, "PROMOCODE002", "promo-elsewhere.example.com", "Elsewhere")
	seedPromotionCode(t, env.pg, elsewhere.ID, promotionCodeSeed{code: "ELSEWHERE", kind: "percent", value: 50})

	preview := func(req *publirav1.PreviewPromotionCodeRequest) (*publirav1.PreviewPromotionCodeResponse, error) {
		req.Tenant = tenantContext(env.tenant)
		if req.Sales == nil {
			req.Sales = []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID)}
		}
		return env.client.PreviewPromotionCode(env.ctx(), req)
	}
	for _, tc := range []struct {
		name string
		req  *publirav1.PreviewPromotionCodeRequest
		want quote
	}{
		{name: "a percentage of the permanent copy", req: &publirav1.PreviewPromotionCodeRequest{Code: "SPRING20"}, want: quote{500, 100, 400, 0}},
		{name: "a percentage of the rental", req: &publirav1.PreviewPromotionCodeRequest{Code: "spring20", Sales: []*publirav1.PromotionCodeSale{rentalSaleOf(env.episode.ID)}}, want: quote{200, 40, 160, 0}},
		{name: "a percentage of the volume", req: &publirav1.PreviewPromotionCodeRequest{Code: " Spring20 ", Sales: []*publirav1.PromotionCodeSale{volumeSaleOf(env.volume.ID)}}, want: quote{900, 180, 720, 0}},
		{name: "an amount of the episode it names", req: &publirav1.PreviewPromotionCodeRequest{Code: "YEN150"}, want: quote{500, 150, 350, 0}},
		{name: "a code of another episode", req: &publirav1.PreviewPromotionCodeRequest{Code: "OTHERONLY"}, want: quote{500, 0, 500, publirav1.PromotionCodeQuote_REFUSAL_NOT_APPLICABLE}},
		{name: "a code of a volume holding the episode", req: &publirav1.PreviewPromotionCodeRequest{Code: "VOLUMEONLY"}, want: quote{500, 0, 500, publirav1.PromotionCodeQuote_REFUSAL_NOT_APPLICABLE}},
		{name: "a store purchase of a rental", req: &publirav1.PreviewPromotionCodeRequest{Code: "SPRING20", Sales: []*publirav1.PromotionCodeSale{rentalSaleOf(env.episode.ID)}, Store: true}, want: quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_NOT_SOLD}},
		{name: "a store purchase of a volume", req: &publirav1.PreviewPromotionCodeRequest{Code: "SPRING20", Sales: []*publirav1.PromotionCodeSale{volumeSaleOf(env.volume.ID)}, Store: true}, want: quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_NOT_SOLD}},
		{name: "an episode the surface does not show", req: &publirav1.PreviewPromotionCodeRequest{Code: "SPRING20", Sales: []*publirav1.PromotionCodeSale{episodeSaleOf(uuid.Must(uuid.NewV7()))}}, want: quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_NOT_SOLD}},
		{name: "the rental of an episode that is not rented", req: &publirav1.PreviewPromotionCodeRequest{Code: "SPRING20", Sales: []*publirav1.PromotionCodeSale{rentalSaleOf(env.other.ID)}}, want: quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_NOT_SOLD}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res, err := preview(tc.req)
			if err != nil {
				t.Fatalf("PreviewPromotionCode: %v", err)
			}
			assertQuotes(t, res, tc.want)
		})
	}
	for _, tc := range []struct {
		name string
		code string
		want string
	}{
		{name: "an unknown code", code: "NOSUCHCODE", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "a code no code could be", code: "NO-SUCH-CODE", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "another tenant's code", code: "ELSEWHERE", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "a paused code", code: "PAUSED", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "a deleted code", code: "DELETED", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "a code not started", code: "SOON", want: rpcerrors.ReasonPromotionCodeInvalid},
		{name: "a code ended", code: "OVER", want: rpcerrors.ReasonPromotionCodeExpired},
		{name: "a code redeemed as often as it may be", code: "SPENT", want: rpcerrors.ReasonPromotionCodeExhausted},
		{name: "a code the reader redeemed", code: "ONCEEACH", want: rpcerrors.ReasonPromotionCodeAlreadyRedeemed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Beside a sale the code would not fit, the code's own refusal
			// still fails the call.
			_, err := preview(&publirav1.PreviewPromotionCodeRequest{Code: tc.code, Sales: []*publirav1.PromotionCodeSale{
				rentalSaleOf(env.other.ID),
				episodeSaleOf(env.episode.ID),
				volumeSaleOf(env.volume.ID),
			}})
			assertPromotionCodeRefusal(t, "PreviewPromotionCode", err, tc.want)
		})
	}

	if _, err := env.client.PreviewPromotionCode(context.Background(), &publirav1.PreviewPromotionCodeRequest{
		Tenant: tenantContext(env.tenant),
		Code:   "SPRING20",
		Sales:  []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID)},
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("PreviewPromotionCode without a session = %v, want unauthenticated", err)
	}
}

// One call quotes the permanent copy and the rental of an episode and every
// volume asked for, and spends one lookup of the reader's allowance for them
// all. A sale the code does not fit, or the reader cannot start, is answered
// on its own quote beside the others.
func TestDBPreviewPromotionCodeQuotesSeveralSalesForOneLookup(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.PromotionCodeAttempt = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	}))
	third := env.pg.SeedEpisode(t, env.tenant.ID, env.series.ID, testutil.EpisodeSeed{
		PublicID:    "PROMOEPISOD3",
		Title:       "Third episode",
		Price:       400,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
		OrderIndex:  3,
	})
	second := env.pg.SeedVolume(t, env.tenant.ID, env.series.ID, testutil.VolumeSeed{
		PublicID:   "PROMOVOLUME2",
		Title:      "Second volume",
		Price:      700,
		Published:  true,
		EpisodeIDs: []uuid.UUID{third.ID},
	})
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "VOLUMEONLY", kind: "percent", value: 10, targetKind: "volume", targetID: uuid.NullUUID{UUID: env.volume.ID, Valid: true}})
	env.hold(t, env.other.ID, uuid.Nil)
	env.hold(t, uuid.Nil, second.ID)

	res, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{
		Tenant: tenantContext(env.tenant),
		Code:   "volumeonly",
		Sales: []*publirav1.PromotionCodeSale{
			episodeSaleOf(env.episode.ID),
			rentalSaleOf(env.episode.ID),
			volumeSaleOf(env.volume.ID),
			volumeSaleOf(second.ID),
			episodeSaleOf(env.other.ID),
		},
	})
	if err != nil {
		t.Fatalf("PreviewPromotionCode: %v", err)
	}
	notApplicable := publirav1.PromotionCodeQuote_REFUSAL_NOT_APPLICABLE
	assertQuotes(t, res,
		quote{500, 0, 500, notApplicable},
		quote{200, 0, 200, notApplicable},
		quote{900, 90, 810, 0},
		quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_HELD},
		quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_HELD},
	)

	// The allowance of one lookup is spent.
	if _, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{
		Tenant: tenantContext(env.tenant),
		Code:   "VOLUMEONLY",
		Sales:  []*publirav1.PromotionCodeSale{volumeSaleOf(env.volume.ID)},
	}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a second call = %v, want resource_exhausted", err)
	}
}

// A code is still read when no sale gets as far as it, so one that cannot be
// applied is refused rather than answered as the sales' refusals alone.
func TestDBPreviewPromotionCodeRefusesTheCodeWhenNoSaleReachesIt(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "SPRING20", kind: "percent", value: 20})
	env.hold(t, env.episode.ID, uuid.Nil)

	sales := []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID), rentalSaleOf(env.episode.ID)}
	_, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{Tenant: tenantContext(env.tenant), Code: "NOSUCHCODE", Sales: sales})
	assertPromotionCodeRefusal(t, "PreviewPromotionCode(NOSUCHCODE)", err, rpcerrors.ReasonPromotionCodeInvalid)

	res, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{Tenant: tenantContext(env.tenant), Code: "SPRING20", Sales: sales})
	if err != nil {
		t.Fatalf("PreviewPromotionCode(SPRING20): %v", err)
	}
	held := quote{refusal: publirav1.PromotionCodeQuote_REFUSAL_HELD}
	assertQuotes(t, res, held, held)
}

// A call names 1 to maxQuotedSales sales, each an episode or a volume.
func TestDBPreviewPromotionCodeBoundsTheSales(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "SPRING20", kind: "percent", value: 20})
	preview := func(sales ...*publirav1.PromotionCodeSale) (*publirav1.PreviewPromotionCodeResponse, error) {
		return env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{Tenant: tenantContext(env.tenant), Code: "SPRING20", Sales: sales})
	}

	most := slices.Repeat([]*publirav1.PromotionCodeSale{volumeSaleOf(env.volume.ID)}, maxQuotedSales)
	res, err := preview(most...)
	if err != nil {
		t.Fatalf("PreviewPromotionCode of %d sales: %v", maxQuotedSales, err)
	}
	assertQuotes(t, res, slices.Repeat([]quote{{900, 180, 720, 0}}, maxQuotedSales)...)

	for _, tc := range []struct {
		name  string
		sales []*publirav1.PromotionCodeSale
	}{
		{name: "no sale"},
		{name: "one sale too many", sales: append(most, volumeSaleOf(env.volume.ID))},
		{name: "an episode and a volume in one sale", sales: []*publirav1.PromotionCodeSale{{EpisodeId: env.episode.ID.String(), VolumeId: env.volume.ID.String()}}},
		{name: "the rental of a volume", sales: []*publirav1.PromotionCodeSale{{VolumeId: env.volume.ID.String(), Kind: publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL}}},
		{name: "a sale naming nothing", sales: []*publirav1.PromotionCodeSale{{}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := preview(tc.sales...); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("PreviewPromotionCode = %v, want invalid_argument", err)
			}
		})
	}
}

// A checkout started with a code charges the discounted price with Stripe's
// own codes closed, and the purchase its webhook confirms records the list
// price, what was paid, and the code, and redeems it once however often the
// webhook is delivered. A checkout started without a code is the request it
// was before codes existed.
func TestDBACheckoutWithAPromotionCodeChargesTheDiscountAndRedeemsItOnce(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	codeID := seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "Spring20", kind: "percent", value: 20})

	if _, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{
		Tenant:    tenantContext(env.tenant),
		EpisodeId: env.episode.ID.String(),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout without a code: %v", err)
	}
	if plain := env.checkout.input; plain.Purchase.Price != 500 || plain.Purchase.ListPrice != 0 || plain.Purchase.PromotionCodeID != uuid.Nil || plain.DisallowProviderCodes {
		t.Fatalf("checkout without a code = %+v, want 500 and nothing of a code", plain)
	}

	res, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{
		Tenant:        tenantContext(env.tenant),
		EpisodeId:     env.episode.ID.String(),
		PromotionCode: "spring20",
	})
	if err != nil {
		t.Fatalf("StartEpisodeCheckout with a code: %v", err)
	}
	if res.CheckoutUrl != env.checkout.url {
		t.Fatalf("checkout url = %q, want the provider's", res.CheckoutUrl)
	}
	discounted := env.checkout.input
	if discounted.Purchase.Price != 400 || discounted.Purchase.ListPrice != 500 || discounted.Purchase.PromotionCodeID != codeID || !discounted.DisallowProviderCodes {
		t.Fatalf("checkout with a code = %+v, want 400 off 500 with the code and Stripe's codes closed", discounted)
	}
	if got := env.count(t, `SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1`, env.tenant.ID); got != 0 {
		t.Fatalf("redemptions after the checkout started = %d, want none until it is paid", got)
	}

	payload, headers := stripetest.NewFixture(t).CheckoutCompleted(t, stripeFixtureCredentials, paymentprovidertest.Checkout{
		CheckoutID: "cs_promotion_code",
		PaymentID:  "pi_promotion_code",
		Purchase:   discounted.Purchase,
	})
	for range 2 {
		if _, err := env.client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(env.tenant.ID.String(), payload, headers)); err != nil {
			t.Fatalf("ProcessPaymentWebhook: %v", err)
		}
	}
	var paid, listPrice int32
	var recordedCode uuid.NullUUID
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT price_at_purchase, list_price, promotion_code_id FROM purchases WHERE tenant_id = $1
	`, env.tenant.ID).Scan(&paid, &listPrice, &recordedCode); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if paid != 400 || listPrice != 500 || recordedCode.UUID != codeID {
		t.Fatalf("purchase = paid %d of %d with code %v, want 400 of 500 with %s", paid, listPrice, recordedCode, codeID)
	}
	if got := env.count(t, `SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1 AND promotion_code_id = $2 AND user_id = $3`, env.tenant.ID, codeID, env.reader.ID); got != 1 {
		t.Fatalf("redemptions = %d, want 1", got)
	}

	library, err := env.client.ListMyPurchases(env.ctx(), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.Purchases) != 1 || library.Purchases[0].PriceAtPurchase != 400 || library.Purchases[0].ListPrice != 500 || library.Purchases[0].PromotionCode != "Spring20" {
		t.Fatalf("library = %+v, want the purchase at 400 of 500 with Spring20", library.Purchases)
	}
}

// A code that takes the whole price off opens no checkout: the purchase is
// recorded at once with no provider, the reader is sent where a paid checkout
// would have returned them, and the code is redeemed. A second attempt finds
// the episode bought. A volume a code took the whole price off is credited at
// its price, spread over its episodes.
func TestDBACodeThatTakesTheWholePriceOffRecordsThePurchaseAtOnce(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	codeID := seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "FREE", kind: "percent", value: 100})

	res, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{
		Tenant:        tenantContext(env.tenant),
		EpisodeId:     env.episode.ID.String(),
		PromotionCode: "free",
	})
	if err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	if !strings.Contains(res.CheckoutUrl, "/episodes/"+env.episode.PublicID) || !strings.Contains(res.CheckoutUrl, "checkout=success") {
		t.Fatalf("checkout url = %q, want the episode's success return", res.CheckoutUrl)
	}
	if env.checkout.input.IdempotencyKey != "" {
		t.Fatalf("the provider was asked for a checkout %+v", env.checkout.input)
	}
	var paid, listPrice int32
	var provider sql.NullString
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT price_at_purchase, list_price, provider FROM purchases WHERE tenant_id = $1 AND episode_id = $2
	`, env.tenant.ID, env.episode.ID).Scan(&paid, &listPrice, &provider); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if paid != 0 || listPrice != 500 || provider.Valid {
		t.Fatalf("purchase = paid %d of %d through %v, want 0 of 500 through no provider", paid, listPrice, provider)
	}
	opens, err := dbmodels.New(env.pg.DB).UserHasEpisodeContentAccess(context.Background(), dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  env.tenant.ID,
		UserID:    env.reader.ID,
		EpisodeID: env.episode.ID,
	})
	if err != nil || !opens {
		t.Fatalf("UserHasEpisodeContentAccess = %v, %v, want the granted purchase to open the episode", opens, err)
	}
	if _, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{
		Tenant:        tenantContext(env.tenant),
		EpisodeId:     env.episode.ID.String(),
		PromotionCode: "FREE",
	}); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a second free checkout = %v, want already_exists", err)
	}

	if _, err := env.client.StartVolumeCheckout(env.ctx(), &publirav1.StartVolumeCheckoutRequest{
		Tenant:        tenantContext(env.tenant),
		VolumeId:      env.volume.ID.String(),
		PromotionCode: "FREE",
	}); err != nil {
		t.Fatalf("StartVolumeCheckout: %v", err)
	}
	var parts, royaltyParts int64
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT COALESCE(sum(vpe.price), 0), COALESCE(sum(vpe.royalty_price), 0)
		FROM volume_purchase_episodes vpe
		JOIN purchases p ON p.tenant_id = vpe.tenant_id AND p.id = vpe.purchase_id
		WHERE p.tenant_id = $1 AND p.volume_id = $2
	`, env.tenant.ID, env.volume.ID).Scan(&parts, &royaltyParts); err != nil {
		t.Fatalf("read the volume's parts: %v", err)
	}
	if parts != 0 || royaltyParts != 900 {
		t.Fatalf("volume parts = paid %d, credited %d, want 0 and the list price of 900", parts, royaltyParts)
	}
	if got := env.count(t, `SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1 AND promotion_code_id = $2`, env.tenant.ID, codeID); got != 2 {
		t.Fatalf("redemptions = %d, want one for the episode and one for the volume", got)
	}
	if got := env.count(t, `SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = 'purchase_receipt'`, env.tenant.ID); got != 2 {
		t.Fatalf("receipts queued = %d, want one per granted purchase", got)
	}
}

// Each lookup of a code spends the reader's allowance for codes before the
// code is read, whether it is a quote or a checkout, so a reader past it is
// refused even a code that would work.
func TestDBAReaderPastThePromotionCodeLimitIsRefusedBeforeTheCodeIsRead(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.PromotionCodeAttempt = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	}))
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "SPRING20", kind: "percent", value: 20})

	for _, code := range []string{"GUESS1", "GUESS2"} {
		_, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{Tenant: tenantContext(env.tenant), Code: code, Sales: []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID)}})
		assertPromotionCodeRefusal(t, fmt.Sprintf("PreviewPromotionCode(%s)", code), err, rpcerrors.ReasonPromotionCodeInvalid)
	}
	if _, err := env.client.PreviewPromotionCode(env.ctx(), &publirav1.PreviewPromotionCodeRequest{Tenant: tenantContext(env.tenant), Code: "SPRING20", Sales: []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID), volumeSaleOf(env.volume.ID)}}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a third lookup = %v, want resource_exhausted", err)
	}
	if _, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{Tenant: tenantContext(env.tenant), EpisodeId: env.episode.ID.String(), PromotionCode: "SPRING20"}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a checkout with a code past the limit = %v, want resource_exhausted", err)
	}
	// A checkout without a code spends none of it.
	if _, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{Tenant: tenantContext(env.tenant), EpisodeId: env.episode.ID.String()}); err != nil {
		t.Fatalf("a checkout without a code: %v", err)
	}
}

// GetTenant offers the code input while the tenant holds a code that is
// neither paused, deleted, nor past its end.
func TestDBGetTenantAcceptsPromotionCodesWhileOneIsLive(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	accepts := func() bool {
		t.Helper()
		res, err := env.tenants.GetTenant(context.Background(), &publirav1.GetTenantRequest{Tenant: tenantContext(env.tenant)})
		if err != nil {
			t.Fatalf("GetTenant: %v", err)
		}
		return res.AcceptsPromotionCodes
	}
	if accepts() {
		t.Fatal("a tenant with no code accepts codes")
	}
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "PAUSED", kind: "percent", value: 10, paused: true})
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "OVER", kind: "percent", value: 10, endsAt: sql.NullTime{Time: time.Now().Add(-time.Hour), Valid: true}})
	if accepts() {
		t.Fatal("a tenant whose codes are paused or ended accepts codes")
	}
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "SOON", kind: "percent", value: 10, startsAt: sql.NullTime{Time: time.Now().Add(time.Hour), Valid: true}})
	if !accepts() {
		t.Fatal("a tenant with a code about to start does not accept codes")
	}
}

// In the app, a code opens the intent at the store product of the discounted
// price, which the store products list; the purchase the store confirms
// records the list price and the code and redeems it. A code that takes the
// whole price off is answered with the purchase, and the store sells nothing.
func TestDBAStorePurchaseWithAPromotionCodeOpensTheIntentAtTheDiscountedProduct(t *testing.T) {
	t.Parallel()

	env := newStorePurchaseEnv(t)
	codeID := seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "APP100", kind: "amount", value: 100})

	prices, err := dbmodels.New(env.pg.DB).ListTenantStoreProductPrices(context.Background(), env.tenant.ID)
	if err != nil {
		t.Fatalf("ListTenantStoreProductPrices: %v", err)
	}
	listed := map[int32]bool{}
	for _, row := range prices {
		listed[row.Price] = true
	}
	if !listed[300] || !listed[200] {
		t.Fatalf("store product prices = %+v, want the price of 300 and its discounted 200", prices)
	}

	// The quote is the store's price, and a discounted price the store sells
	// no product at is answered on the sale's quote.
	quoted, err := env.client.PreviewPromotionCode(testutil.WithBearer(context.Background(), env.token), &publirav1.PreviewPromotionCodeRequest{
		Tenant: tenantContext(env.tenant),
		Code:   "APP100",
		Sales:  []*publirav1.PromotionCodeSale{episodeSaleOf(env.episode.ID)},
		Store:  true,
	})
	if err != nil {
		t.Fatalf("PreviewPromotionCode of the store purchase: %v", err)
	}
	assertQuotes(t, quoted, quote{300, 100, 200, 0})
	asReader := rpcmiddleware.WithTenantQueries(context.Background(), dbmodels.New(env.pg.DB))
	unsold, err := env.server.quoteSale(asReader, dbmodels.Tenant{ID: env.tenant.ID}, env.reader.ID, "APP100", "", true, []int32{300}, quotedSale{episodeID: env.episode.ID, kind: paymentprovider.KindPurchase})
	if err != nil {
		t.Fatalf("quoteSale without a product at the discounted price: %v", err)
	}
	if got := unsold.quote; got.GetRefusal() != publirav1.PromotionCodeQuote_REFUSAL_NO_STORE_PRODUCT || got.GetListPrice() != 300 || got.GetPrice() != 300 || got.GetDiscountAmount() != 0 {
		t.Fatalf("quote without a product at the discounted price = %+v, want 300 refused with no store product", got)
	}

	intent, err := env.client.StartStorePurchase(testutil.WithBearer(context.Background(), env.token), &publirav1.StartStorePurchaseRequest{
		Tenant:        tenantContext(env.tenant),
		EpisodeId:     env.episode.ID.String(),
		Store:         publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
		PromotionCode: "app100",
	})
	if err != nil {
		t.Fatalf("StartStorePurchase: %v", err)
	}
	if intent.ProductId != "episode_200" || intent.Purchase != nil {
		t.Fatalf("intent = %+v, want episode_200", intent)
	}
	transaction := env.appStoreTransaction("2000000000000099", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	purchase, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if purchase.PriceAtPurchase != 200 || purchase.ListPrice != 300 || purchase.PromotionCode != "APP100" {
		t.Fatalf("purchase = %+v, want 200 of 300 with APP100", purchase)
	}
	if got := env.count(t, `SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1 AND promotion_code_id = $2`, env.tenant.ID, codeID); got != 1 {
		t.Fatalf("redemptions = %d, want 1", got)
	}

	// The store sells no product at a price the products do not list.
	asOwner := rpcmiddleware.WithTenantQueries(context.Background(), dbmodels.New(env.pg.DB))
	if err := env.server.requireStoreProduct(asOwner, env.tenant.ID, 200); err != nil {
		t.Fatalf("requireStoreProduct(200) = %v, want the listed price accepted", err)
	}
	if err := env.server.requireStoreProduct(asOwner, env.tenant.ID, 123); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("requireStoreProduct(123) = %v, want failed_precondition", err)
	} else if reason, _ := errorInfoReason(err); reason != rpcerrors.ReasonPromotionCodeNoStoreProduct {
		t.Fatalf("requireStoreProduct(123) reason = %q, want %q", reason, rpcerrors.ReasonPromotionCodeNoStoreProduct)
	}

	var seriesID uuid.UUID
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT series_id FROM episodes WHERE id = $1`, env.episode.ID).Scan(&seriesID); err != nil {
		t.Fatalf("read the episode's series: %v", err)
	}
	other := env.pg.SeedEpisode(t, env.tenant.ID, seriesID, testutil.EpisodeSeed{
		PublicID:   "STOREEPISOD2",
		Title:      "Store Episode 2",
		Status:     testutil.EpisodeStatusPublished,
		Price:      100,
		OrderIndex: 2,
	})
	granted, err := env.client.StartStorePurchase(testutil.WithBearer(context.Background(), env.token), &publirav1.StartStorePurchaseRequest{
		Tenant:        tenantContext(env.tenant),
		EpisodeId:     other.ID.String(),
		Store:         publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
		PromotionCode: "APP100",
	})
	if err != nil {
		t.Fatalf("StartStorePurchase of an episode the code makes free: %v", err)
	}
	if granted.IntentId != "" || granted.ProductId != "" || granted.Purchase == nil || granted.Purchase.PriceAtPurchase != 0 || granted.Purchase.ListPrice != 100 {
		t.Fatalf("answer = %+v, want the purchase granted at 0 of 100 and no intent", granted)
	}
}

// Two codes that each make the same episode free, sent at once by the same
// reader, grant one purchase: the second request sees the first one's
// purchase, whichever code it names.
func TestDBTwoFreeCodesSentAtOnceGrantOnePurchase(t *testing.T) {
	t.Parallel()

	env := newPromotionCodeEnv(t, openReaderGuards())
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "FREEA", kind: "percent", value: 100})
	seedPromotionCode(t, env.pg, env.tenant.ID, promotionCodeSeed{code: "FREEB", kind: "amount", value: 1000})

	errs := make(chan error, 2)
	for _, code := range []string{"FREEA", "FREEB"} {
		go func() {
			_, err := env.client.StartEpisodeCheckout(env.ctx(), &publirav1.StartEpisodeCheckoutRequest{
				Tenant:        tenantContext(env.tenant),
				EpisodeId:     env.episode.ID.String(),
				PromotionCode: code,
			})
			errs <- err
		}()
	}
	var granted, refused int
	for range 2 {
		switch err := <-errs; connect.CodeOf(err) {
		case connect.CodeUnknown:
			if err != nil {
				t.Fatalf("StartEpisodeCheckout: %v", err)
			}
			granted++
		case connect.CodeAlreadyExists:
			refused++
		default:
			t.Fatalf("StartEpisodeCheckout = %v, want a grant or already_exists", err)
		}
	}
	if granted != 1 || refused != 1 {
		t.Fatalf("granted %d and refused %d, want one of each", granted, refused)
	}
	if got := env.count(t, `SELECT count(*) FROM purchases WHERE tenant_id = $1 AND episode_id = $2`, env.tenant.ID, env.episode.ID); got != 1 {
		t.Fatalf("purchases = %d, want 1", got)
	}
	if got := env.count(t, `SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1`, env.tenant.ID); got != 1 {
		t.Fatalf("redemptions = %d, want 1", got)
	}
}
