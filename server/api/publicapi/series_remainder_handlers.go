package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/url"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/paymentprovider"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// maxSeriesRemainderEpisodes is the most episodes one checkout of the rest of
// a series sells: the line items Stripe and PAY.JP both take on one checkout
// in payment mode, one per episode.
const maxSeriesRemainderEpisodes = 100

// seriesRemainderSale is the rest of a series as one checkout sells it to one
// reader: the episodes in the series' order, what each costs on its own, the
// part of the price each accounts for once the discount is spread over them,
// and the total.
type seriesRemainderSale struct {
	episodes        []dbmodels.ListSeriesRemainderEpisodesRow
	listPrice       int32
	discountPercent int32
	price           int32
	// discountedPrices are the episodes' parts of price, in their order.
	discountedPrices []int32
}

// errNoSeriesRemainderSale is what every reason the rest of a series is no
// sale wraps.
var errNoSeriesRemainderSale = errors.New("the rest of the series is no sale")

var (
	errNothingToSell   = fmt.Errorf("%w: the series sells no priced episode on this surface", errNoSeriesRemainderSale)
	errEverythingHeld  = fmt.Errorf("%w: the reader holds every episode the series sells", errNoSeriesRemainderSale)
	errTooManyToSell   = fmt.Errorf("%w: more episodes are left than one checkout lists", errNoSeriesRemainderSale)
	errReaderCredited  = fmt.Errorf("%w: the reader is credited on an episode of it", errNoSeriesRemainderSale)
	errPriceOutOfRange = fmt.Errorf("%w: it costs more than one checkout charges", errNoSeriesRemainderSale)
)

// newSeriesRemainderSale prices the episodes the reader does not hold yet. The
// price is the sum of theirs less discountPercent of it, rounded down to the
// minor unit, and each episode's part of it is its share of the price in
// proportion to its own, rounded so that the parts add up to the price exactly.
func newSeriesRemainderSale(rows []dbmodels.ListSeriesRemainderEpisodesRow, discountPercent int32) (seriesRemainderSale, error) {
	if len(rows) == 0 {
		return seriesRemainderSale{}, errNothingToSell
	}
	sale := seriesRemainderSale{discountPercent: discountPercent}
	var listPrice int64
	for _, row := range rows {
		if row.Held {
			continue
		}
		if row.Credited {
			return seriesRemainderSale{}, errReaderCredited
		}
		sale.episodes = append(sale.episodes, row)
		listPrice += int64(row.Price)
	}
	switch {
	case len(sale.episodes) == 0:
		return seriesRemainderSale{}, errEverythingHeld
	case len(sale.episodes) > maxSeriesRemainderEpisodes:
		return seriesRemainderSale{}, errTooManyToSell
	case listPrice > math.MaxInt32:
		return seriesRemainderSale{}, errPriceOutOfRange
	}
	price := listPrice * int64(100-discountPercent) / 100
	sale.listPrice = int32(listPrice)
	sale.price = int32(price)
	sale.discountedPrices = make([]int32, len(sale.episodes))
	var running, allotted int64
	for i, episode := range sale.episodes {
		running += int64(episode.Price)
		upTo := price * running / listPrice
		sale.discountedPrices[i] = int32(upTo - allotted)
		allotted = upTo
	}
	return sale, nil
}

// seriesRemainderOffer is the quote GetSeriesEpisodeAccess gives of the rest
// of a series, and nil when that rest is no sale.
func (s *apiServer) seriesRemainderOffer(ctx context.Context, tenantID, seriesID uuid.UUID, surface string, userID uuid.NullUUID) (*publirav1.SeriesRemainderOffer, error) {
	queries := s.queriesFor(ctx)
	series, err := queries.GetSeriesForRemainderSale(ctx, dbmodels.GetSeriesForRemainderSaleParams{
		TenantID: tenantID,
		ID:       seriesID,
		Surface:  surface,
	})
	// A series taken down since the caller read it sells nothing.
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get series for remainder sale: %w", err)
	}
	rows, err := queries.ListSeriesRemainderEpisodes(ctx, dbmodels.ListSeriesRemainderEpisodesParams{
		UserID:   userID,
		TenantID: tenantID,
		SeriesID: series.ID,
		Surface:  surface,
	})
	if err != nil {
		return nil, fmt.Errorf("list series remainder episodes: %w", err)
	}
	sale, err := newSeriesRemainderSale(rows, series.BundleDiscountPercent.Int32)
	if errors.Is(err, errNoSeriesRemainderSale) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &publirav1.SeriesRemainderOffer{
		EpisodeCount:    int32(len(sale.episodes)),
		ListPrice:       sale.listPrice,
		DiscountPercent: sale.discountPercent,
		Price:           sale.price,
	}, nil
}

func (s *apiServer) StartSeriesRemainderCheckout(
	ctx context.Context,
	req *publirav1.StartSeriesRemainderCheckoutRequest,
) (*publirav1.StartSeriesRemainderCheckoutResponse, error) {
	seriesID, err := requestRecordID("series_id", req.SeriesId)
	if err != nil {
		return nil, err
	}
	surface, err := checkoutSurface(req.Client)
	if err != nil {
		return nil, err
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if req.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		if err := s.refuseCheckoutForStoreRoute(ctx, tenant.ID); err != nil {
			return nil, err
		}
	}
	origin, err := tenantorigin.Site(tenant)
	if errors.Is(err, tenantorigin.ErrDomainNotConfigured) {
		s.logger.WarnContext(ctx, "checkout refused because tenant domain is not configured", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the tenant site origin", err, "tenant_id", tenant.ID.String())
	}
	provider, config, credentials, err := s.loadPaymentProvider(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	code, err := locale.Resolve(readerLocale)
	if err != nil {
		return nil, s.internalError(ctx, "reader locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	queries := s.queriesFor(ctx)
	series, err := queries.GetSeriesForRemainderSale(ctx, dbmodels.GetSeriesForRemainderSaleParams{
		TenantID: tenant.ID,
		ID:       seriesID,
		Surface:  surface,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "series not found")
		}
		return nil, s.internalDBError(ctx, "failed to get the series for a remainder checkout", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	// The checkout page names each episode in the reader's language.
	rows, err := queries.ListSeriesRemainderEpisodes(ctx, dbmodels.ListSeriesRemainderEpisodesParams{
		UserID:   uuid.NullUUID{UUID: user.ID, Valid: true},
		Locale:   readerLocale,
		TenantID: tenant.ID,
		SeriesID: series.ID,
		Surface:  surface,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the episodes left in a series", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	sale, err := newSeriesRemainderSale(rows, series.BundleDiscountPercent.Int32)
	switch {
	case errors.Is(err, errReaderCredited):
		return nil, readerCreditedOnEpisodeError()
	case errors.Is(err, errEverythingHeld):
		return nil, connect.NewError(connect.CodeAlreadyExists, "every episode of the series is already purchased")
	case err != nil:
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error())
	}

	successURL := seriesRemainderReturnURL(origin, series.PublicID, "success")
	cancelURL := seriesRemainderReturnURL(origin, series.PublicID, "cancelled")
	if req.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		appLocale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		successURL = mobileSeriesRemainderReturnURL(origin, appLocale, series.PublicID, "success")
		cancelURL = mobileSeriesRemainderReturnURL(origin, appLocale, series.PublicID, "cancelled")
	}
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID: tenant.ID,
			ReaderID: user.ID,
			Kind:     paymentprovider.KindPurchase,
			Price:    sale.price,
			Currency: config.Currency,
		},
		LineItems:  make([]paymentprovider.LineItem, len(sale.episodes)),
		SuccessURL: successURL,
		CancelURL:  cancelURL,
	}
	for i, episode := range sale.episodes {
		checkout.LineItems[i] = paymentprovider.LineItem{
			Name:            episode.Title,
			Price:           episode.Price,
			DiscountedPrice: sale.discountedPrices[i],
		}
	}
	if sale.price < sale.listPrice {
		name, err := locale.Message(code, "checkout.bundle_discount", map[string]any{"percent": int(sale.discountPercent)})
		if err != nil {
			return nil, s.internalError(ctx, "failed to name the bundle discount", err, "tenant_id", tenant.ID.String())
		}
		checkout.Discount = &paymentprovider.Discount{Name: name, Amount: sale.listPrice - sale.price}
	}

	expiredCheckoutID, err := queries.GetExpiredSeriesBundleCheckoutID(ctx, dbmodels.GetExpiredSeriesBundleCheckoutIDParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		SeriesID: series.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's expired remainder checkout", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	paidCheckoutID, err := queries.GetLastPaidSeriesBundleCheckoutID(ctx, dbmodels.GetLastPaidSeriesBundleCheckoutIDParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		SeriesID: series.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's last paid remainder checkout", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	// The key is made before the bundle is written down, so it names the
	// sale rather than the row, and the row is found again by it.
	checkout.IdempotencyKey, err = seriesRemainderIdempotencyKey(checkout, series.ID, expiredCheckoutID, paidCheckoutID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the checkout idempotency key", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	checkout.Purchase.SeriesBundleID, err = s.writeSeriesBundle(ctx, queries, tenant.ID, user.ID, series.ID, sale, checkout.IdempotencyKey)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to write down the series bundle", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	checkoutURL, err := provider.StartCheckout(ctx, credentials, checkout)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "provider", provider.Declaration().ID, "series_id", series.ID.String())
		return nil, connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	return &publirav1.StartSeriesRemainderCheckoutResponse{CheckoutUrl: checkoutURL}, nil
}

// seriesRemainderIdempotencyKey names one reader's checkout of the rest of
// one series by everything the request sends, for the reasons
// checkoutIdempotencyKey gives. The episodes and their prices are among them:
// a reader who buys one on its own, or an editor who reprices one, changes
// what the next checkout sells.
func seriesRemainderIdempotencyKey(req paymentprovider.CheckoutRequest, seriesID uuid.UUID, expiredCheckoutID, paidCheckoutID string) (string, error) {
	sum, err := checkoutRequestDigest(req, expiredCheckoutID, paidCheckoutID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("series-remainder-checkout:%s:%s:%s:%x", req.Purchase.TenantID, req.Purchase.ReaderID, seriesID, sum), nil
}

// writeSeriesBundle writes down the bundle sale sells under idempotencyKey and
// answers its id, or the id of the bundle a request with the same key wrote
// first.
func (s *apiServer) writeSeriesBundle(ctx context.Context, queries Querier, tenantID, userID, seriesID uuid.UUID, sale seriesRemainderSale, idempotencyKey string) (uuid.UUID, error) {
	params := dbmodels.CreateSeriesBundleParams{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		SeriesID:           seriesID,
		UserID:             userID,
		IdempotencyKey:     idempotencyKey,
		DiscountPercent:    sql.NullInt32{Int32: sale.discountPercent, Valid: sale.discountPercent > 0},
		Price:              sale.price,
		EpisodeIds:         make([]uuid.UUID, len(sale.episodes)),
		ListPrices:         make([]int32, len(sale.episodes)),
		Prices:             sale.discountedPrices,
		ReadingPeriodHours: make([]int32, len(sale.episodes)),
	}
	for i, episode := range sale.episodes {
		params.EpisodeIds[i] = episode.ID
		params.ListPrices[i] = episode.Price
		params.ReadingPeriodHours[i] = episode.ReadingPeriodHours.Int32
	}
	id, err := queries.CreateSeriesBundle(ctx, params)
	if !errors.Is(err, sql.ErrNoRows) {
		return id, err
	}
	return queries.GetSeriesBundleIDByIdempotencyKey(ctx, dbmodels.GetSeriesBundleIDByIdempotencyKeyParams{
		TenantID:       tenantID,
		IdempotencyKey: idempotencyKey,
	})
}

// seriesRemainderReturnURL is where the storefront takes the reader back to
// after a checkout of the rest of a series: the series page.
func seriesRemainderReturnURL(base *url.URL, seriesPublicID, checkout string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", "series", seriesPublicID)
	query := result.Query()
	query.Set("checkout", checkout)
	query.Set("remainder", "1")
	result.RawQuery = query.Encode()
	return result.String()
}

// mobileSeriesRemainderReturnURL is the app's return link after a checkout of
// the rest of a series, which names the series the app opens.
func mobileSeriesRemainderReturnURL(base *url.URL, locale, seriesPublicID, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", locale, "checkout", "return")
	query := result.Query()
	query.Set("series", seriesPublicID)
	query.Set("remainder", "1")
	query.Set("status", status)
	result.RawQuery = query.Encode()
	return result.String()
}
