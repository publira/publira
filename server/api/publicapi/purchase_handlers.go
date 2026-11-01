package publicapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/coinledger"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantorigin"
)

const (
	defaultPurchasePageSize = int32(20)
	maxPurchasePageSize     = int32(100)

	// maxPaymentWebhookPayload bounds the notification body a provider may
	// post.
	maxPaymentWebhookPayload = 64 << 10
)

// checkoutSurface is the surface a checkout is started from, named by the
// client it returns to. Every client other than the app is the storefront, as
// an unnamed catalog surface is.
func checkoutSurface(client publirav1.StartEpisodeCheckoutRequest_Client) (string, error) {
	if client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		return callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_APP)
	}
	return callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB)
}

func (s *apiServer) StartEpisodeCheckout(
	ctx context.Context,
	req *publirav1.StartEpisodeCheckoutRequest,
) (*publirav1.StartEpisodeCheckoutResponse, error) {
	episodeID, err := requestRecordID("episode_id", req.EpisodeId)
	if err != nil {
		return nil, err
	}
	surface, err := checkoutSurface(req.Client)
	if err != nil {
		return nil, err
	}
	kind, err := protomapper.PurchaseKindFromRequest(req.Kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "kind")
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionStartPurchaseCheckout, tenant.ID, user.ID); err != nil {
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

	// The checkout page names the episode in the reader's language.
	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeForTenant(ctx, dbmodels.GetPurchasableEpisodeForTenantParams{
		TenantID: tenant.ID,
		ID:       episodeID,
		Surface:  surface,
		Locale:   readerLocale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get purchasable episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	if episode.Price <= 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "free episodes do not require checkout")
	}
	price, readingPeriodHours := episode.Price, episode.ReadingPeriodHours.Int32
	// A campaign cuts the price of the permanent copy alone; the rental keeps
	// its own. The price charged is the one in force now, which the checkout
	// carries to the notification that confirms it, so a campaign ending
	// before the reader pays does not change what they are charged.
	if kind == paymentprovider.KindPurchase && episode.CampaignPrice.Valid {
		price = episode.CampaignPrice.Int32
	}
	if kind == paymentprovider.KindRental {
		if !episode.RentalPrice.Valid || !episode.RentalPeriodHours.Valid {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "episode is not rented")
		}
		price, readingPeriodHours = episode.RentalPrice.Int32, episode.RentalPeriodHours.Int32
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if !soldHere {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "episode is not sold on this surface")
	}
	if err := s.refuseCreditedReader(ctx, tenant.ID, user.ID, episode.ID); err != nil {
		return nil, err
	}

	held, err := s.queriesFor(ctx).GetActiveEpisodePurchaseKinds(ctx, dbmodels.GetActiveEpisodePurchaseKindsParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check purchase status", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	// A reader who holds the permanent copy has nothing left to buy, while
	// one who holds a rental may still buy the permanent copy.
	if held.HoldsPurchase {
		return nil, connect.NewError(connect.CodeAlreadyExists, "episode is already purchased")
	}
	if kind == paymentprovider.KindRental && held.HoldsRental {
		return nil, connect.NewError(connect.CodeAlreadyExists, "episode is already rented")
	}

	lineItemName := episode.Title
	if kind == paymentprovider.KindRental {
		code, err := locale.Resolve(readerLocale)
		if err != nil {
			return nil, s.internalError(ctx, "reader locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		lineItemName, err = rentalLineItemName(code, episode.Title, readingPeriodHours)
		if err != nil {
			return nil, s.internalError(ctx, "failed to name the rental line item", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
	}
	successURL := purchaseReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "success")
	cancelURL := purchaseReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "cancelled")
	if req.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		locale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		successURL = mobilePurchaseReturnURL(origin, locale, episode.PublicID, "success")
		cancelURL = mobilePurchaseReturnURL(origin, locale, episode.PublicID, "cancelled")
	}
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:           tenant.ID,
			ReaderID:           user.ID,
			EpisodeID:          episode.ID,
			Kind:               kind,
			Price:              price,
			Currency:           config.Currency,
			ReadingPeriodHours: readingPeriodHours,
		},
		LineItemName: lineItemName,
		SuccessURL:   successURL,
		CancelURL:    cancelURL,
	}
	expiredCheckoutID, err := s.queriesFor(ctx).GetExpiredCheckoutID(ctx, dbmodels.GetExpiredCheckoutIDParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's expired checkout", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	paidCheckoutID, err := s.queriesFor(ctx).GetLastPaidCheckoutID(ctx, dbmodels.GetLastPaidCheckoutIDParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's last paid checkout", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	checkout.IdempotencyKey, err = checkoutIdempotencyKey(checkout, expiredCheckoutID, paidCheckoutID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the checkout idempotency key", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	checkoutURL, err := provider.StartCheckout(ctx, credentials, checkout)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "provider", provider.Declaration().ID, "episode_id", episode.ID.String())
		return nil, connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	return &publirav1.StartEpisodeCheckoutResponse{CheckoutUrl: checkoutURL}, nil
}

// rentalLineItemName is what the checkout of a rental calls the sale: the
// episode's title with the period it is rented for, so the payment page says
// which of the two sales the reader is paying for where the permanent copy's
// says the title alone. It is written in the reader's locale, the language
// the title is given in.
func rentalLineItemName(code, episodeTitle string, rentalPeriodHours int32) (string, error) {
	return locale.Message(code, "checkout.rental_line_item", map[string]any{
		"episode_title": episodeTitle,
		"hours":         int(rentalPeriodHours),
	})
}

// checkoutIdempotencyKey names one reader's checkout of one episode, of one
// volume, or of one pack, by everything the request sends, so a retried request reuses the provider's
// checkout. A provider refuses a key it has seen sent with other parameters, or
// answers with the checkout it made for them, and any of those parameters can
// change between two attempts of the same reader: an editor can change the
// episode's price, reading period, or title, and the return URLs differ
// between the storefront and the app. The key therefore covers the whole
// request rather than a list of its fields, which a field added later would
// not be on.
//
// A provider also keeps answering a key with its checkout after that checkout
// has expired, for as long as it remembers the key, which would send a reader
// who comes back later to a checkout they can no longer pay. The key therefore
// names expiredCheckoutID too, the reader's last checkout of the episode the
// provider reported expired, so each expiry moves the next attempt onto a new
// checkout. Empty is a reader who has let none expire.
//
// The same holds for a checkout the reader paid: once the purchase it made
// stops opening the episode — a rental or a reading period running out — the
// reader may buy again with the very request they paid with before, and the
// provider would answer it with the completed checkout. The key therefore
// names paidCheckoutID as well, the checkout of the reader's latest purchase
// of the episode, so each payment moves the next attempt onto a new checkout.
// Empty is a reader who has paid for none.
func checkoutIdempotencyKey(req paymentprovider.CheckoutRequest, expiredCheckoutID, paidCheckoutID string) (string, error) {
	sum, err := checkoutRequestDigest(req, expiredCheckoutID, paidCheckoutID, nil)
	if err != nil {
		return "", err
	}
	purchase := req.Purchase
	if purchase.CoinPackID != uuid.Nil {
		return fmt.Sprintf("coin-pack-checkout:%s:%s:%s:%x", purchase.TenantID, purchase.ReaderID, purchase.CoinPackID, sum), nil
	}
	if purchase.VolumeID != uuid.Nil {
		return fmt.Sprintf("volume-checkout:%s:%s:%s:%x", purchase.TenantID, purchase.ReaderID, purchase.VolumeID, sum), nil
	}
	return fmt.Sprintf("episode-checkout:%s:%s:%s:%x", purchase.TenantID, purchase.ReaderID, purchase.EpisodeID, sum), nil
}

// checkoutRequestDigest is the part of an idempotency key that names the
// request, the expired checkout, and the paid one, and terms, which a caller
// that writes down more about the sale than the request carries passes. A nil
// terms leaves the encoding as it was before terms existed, so the key of an
// episode's or a volume's checkout does not change.
func checkoutRequestDigest(req paymentprovider.CheckoutRequest, expiredCheckoutID, paidCheckoutID string, terms any) ([]byte, error) {
	req.IdempotencyKey = ""
	encoded, err := json.Marshal(struct {
		Request           paymentprovider.CheckoutRequest
		ExpiredCheckoutID string
		PaidCheckoutID    string
		Terms             any `json:",omitempty"`
	}{req, expiredCheckoutID, paidCheckoutID, terms})
	if err != nil {
		return nil, fmt.Errorf("encode checkout request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return sum[:16], nil
}

// refuseCheckoutForStoreRoute answers failed_precondition for a tenant whose
// app sells through the store: that app may not send a reader to the external
// checkout, whatever an out-of-date build asks for.
func (s *apiServer) refuseCheckoutForStoreRoute(ctx context.Context, tenantID uuid.UUID) error {
	route, err := s.appPurchaseRoute(ctx, tenantID)
	if err != nil {
		return err
	}
	if route == paymentsettings.RouteStore {
		return connect.NewError(connect.CodeFailedPrecondition, "the app sells through the store")
	}
	return nil
}

// appPurchaseRoute answers how the tenant's app sells. A tenant that saved no
// settings sells through the external checkout.
func (s *apiServer) appPurchaseRoute(ctx context.Context, tenantID uuid.UUID) (string, error) {
	stored, err := s.queriesFor(ctx).GetTenantAppPurchaseRoute(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return paymentsettings.RouteExternalCheckout, nil
		}
		return "", s.internalDBError(ctx, "failed to get tenant app purchase route", err, "tenant_id", tenantID.String())
	}
	route, err := paymentsettings.ResolveAppPurchaseRoute(stored)
	if err != nil {
		return "", s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenantID.String())
	}
	return route, nil
}

type purchasePageRow struct {
	id              uuid.UUID
	kind            string
	priceAtPurchase int32
	currency        string
	expiresAt       sql.NullTime
	revokedAt       sql.NullTime
	refundedAmount  sql.NullInt32
	refundedAt      sql.NullTime
	purchasedAt     time.Time
	// coinsSpent is the coins a purchase paid with coins spent, and zero on
	// any other purchase.
	coinsSpent        int32
	episodeID         uuid.NullUUID
	episodePublicID   string
	episodeTitle      string
	episodeLocale     string
	episodeOrderIndex int32
	volumeID          uuid.NullUUID
	volumePublicID    string
	volumeTitle       string
	volumeOrderIndex  int32
	seriesBundleID    uuid.NullUUID
	// seriesBundleEpisodeCount and seriesBundleDiscountPercent describe the
	// bundle bought, and are zero on any other purchase.
	seriesBundleEpisodeCount    int32
	seriesBundleDiscountPercent int32
	coinPackID                  uuid.NullUUID
	// coinPackPublicID, coinPackCoins, and coinPackBonusCoins describe the
	// pack bought as the reader was shown it, and are zero on any other
	// purchase.
	coinPackPublicID   string
	coinPackCoins      int32
	coinPackBonusCoins int32
	// seriesID is NULL on a purchase of a pack, which is of no series.
	seriesID       uuid.NullUUID
	seriesPublicID string
	seriesTitle    string
	seriesLocale   string
}

func mapPurchaseDescRows(rows []dbmodels.ListMyPurchasesDescRow) []purchasePageRow {
	mapped := make([]purchasePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, purchasePageRow{
			id:                          row.ID,
			kind:                        row.Kind,
			priceAtPurchase:             row.PriceAtPurchase,
			currency:                    row.Currency,
			expiresAt:                   row.ExpiresAt,
			revokedAt:                   row.RevokedAt,
			refundedAmount:              row.RefundedAmount,
			refundedAt:                  row.RefundedAt,
			purchasedAt:                 row.PurchasedAt,
			coinsSpent:                  row.CoinsSpent,
			episodeID:                   row.EpisodeID,
			episodePublicID:             row.EpisodePublicID.String,
			episodeTitle:                row.EpisodeTitle,
			episodeLocale:               row.EpisodeTitleLocale,
			episodeOrderIndex:           row.EpisodeOrderIndex.Int32,
			volumeID:                    row.VolumeID,
			volumePublicID:              row.VolumePublicID.String,
			volumeTitle:                 row.VolumeTitle.String,
			volumeOrderIndex:            row.VolumeOrderIndex.Int32,
			seriesBundleID:              row.SeriesBundleID,
			seriesBundleEpisodeCount:    row.SeriesBundleEpisodeCount,
			seriesBundleDiscountPercent: row.SeriesBundleDiscountPercent.Int32,
			coinPackID:                  row.CoinPackID,
			coinPackPublicID:            row.CoinPackPublicID.String,
			coinPackCoins:               row.CoinPackCoins.Int32,
			coinPackBonusCoins:          row.CoinPackBonusCoins.Int32,
			seriesID:                    row.SeriesID,
			seriesPublicID:              row.SeriesPublicID.String,
			seriesTitle:                 row.SeriesTitle,
			seriesLocale:                row.SeriesTitleLocale,
		})
	}
	return mapped
}

func mapPurchaseAscRows(rows []dbmodels.ListMyPurchasesAscRow) []purchasePageRow {
	mapped := make([]purchasePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, purchasePageRow{
			id:                          row.ID,
			kind:                        row.Kind,
			priceAtPurchase:             row.PriceAtPurchase,
			currency:                    row.Currency,
			expiresAt:                   row.ExpiresAt,
			revokedAt:                   row.RevokedAt,
			refundedAmount:              row.RefundedAmount,
			refundedAt:                  row.RefundedAt,
			purchasedAt:                 row.PurchasedAt,
			coinsSpent:                  row.CoinsSpent,
			episodeID:                   row.EpisodeID,
			episodePublicID:             row.EpisodePublicID.String,
			episodeTitle:                row.EpisodeTitle,
			episodeLocale:               row.EpisodeTitleLocale,
			episodeOrderIndex:           row.EpisodeOrderIndex.Int32,
			volumeID:                    row.VolumeID,
			volumePublicID:              row.VolumePublicID.String,
			volumeTitle:                 row.VolumeTitle.String,
			volumeOrderIndex:            row.VolumeOrderIndex.Int32,
			seriesBundleID:              row.SeriesBundleID,
			seriesBundleEpisodeCount:    row.SeriesBundleEpisodeCount,
			seriesBundleDiscountPercent: row.SeriesBundleDiscountPercent.Int32,
			coinPackID:                  row.CoinPackID,
			coinPackPublicID:            row.CoinPackPublicID.String,
			coinPackCoins:               row.CoinPackCoins.Int32,
			coinPackBonusCoins:          row.CoinPackBonusCoins.Int32,
			seriesID:                    row.SeriesID,
			seriesPublicID:              row.SeriesPublicID.String,
			seriesTitle:                 row.SeriesTitle,
			seriesLocale:                row.SeriesTitleLocale,
		})
	}
	return mapped
}

func (s *apiServer) purchasePage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	surface string,
	locale string,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]purchasePageRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyPurchasesDescParams{
		TenantID:          tenantID,
		UserID:            userID,
		Surface:           surface,
		Locale:            locale,
		CursorPurchasedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive:   keys.Inclusive,
		CursorID:          uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:             limit,
	}
	if direction == pagination.Backward {
		rows, err := queries.ListMyPurchasesAsc(ctx, dbmodels.ListMyPurchasesAscParams(params))
		if err != nil {
			return nil, err
		}
		return mapPurchaseAscRows(rows), nil
	}

	rows, err := queries.ListMyPurchasesDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	return mapPurchaseDescRows(rows), nil
}

// purchaseItemFromRow maps one purchase of the reader's library. coinName is
// the tenant's word for its coins in the reader's locale, which a purchase
// paid with coins and a purchase of a pack are answered with.
func purchaseItemFromRow(row purchasePageRow, coinName string, now time.Time) (*publirav1.MyPurchase, error) {
	kind, err := protomapper.PurchaseKindFromStored(row.kind)
	if err != nil {
		return nil, err
	}
	expiresAt := ""
	// A revoked purchase opens nothing, so the library must not offer it as
	// one the reader can still open.
	isActive := !row.revokedAt.Valid
	if row.expiresAt.Valid {
		expiresAt = row.expiresAt.Time.UTC().Format(time.RFC3339)
		isActive = isActive && row.expiresAt.Time.After(now)
	}
	refundedAt := ""
	if row.refundedAt.Valid {
		refundedAt = row.refundedAt.Time.UTC().Format(time.RFC3339)
	}
	revokedAt := ""
	if row.revokedAt.Valid {
		revokedAt = row.revokedAt.Time.UTC().Format(time.RFC3339)
	}

	item := &publirav1.MyPurchase{
		Id:              row.id.String(),
		Currency:        row.currency,
		ExpiresAt:       expiresAt,
		IsActive:        isActive,
		Kind:            kind,
		PriceAtPurchase: row.priceAtPurchase,
		PurchasedAt:     row.purchasedAt.UTC().Format(time.RFC3339),
		RefundedAmount:  row.refundedAmount.Int32,
		RefundedAt:      refundedAt,
		RevokedAt:       revokedAt,
		CoinsSpent:      row.coinsSpent,
	}
	// A purchase paid with coins records what its coins were worth, and what
	// a refund of their pack took back of that, as the tenant's sale. The
	// reader paid coins and was refunded nothing, so neither is theirs to see.
	if row.coinsSpent > 0 {
		item.PriceAtPurchase = 0
		item.RefundedAmount = 0
	}
	if row.seriesID.Valid {
		item.Series = &publirattypesv1.Series{
			Id:       row.seriesID.UUID.String(),
			PublicId: row.seriesPublicID,
			Title:    row.seriesTitle,
			Locale:   row.seriesLocale,
		}
	}
	if namesCoins(row) {
		item.CoinName = coinName
	}
	// A purchase is of an episode, a volume, the rest of a series, or a pack
	// of coins, and the library names whichever it bought.
	switch {
	case row.coinPackID.Valid:
		item.CoinPack = &publirattypesv1.PurchasedCoinPack{
			Id:         row.coinPackID.UUID.String(),
			PublicId:   row.coinPackPublicID,
			Coins:      row.coinPackCoins,
			BonusCoins: row.coinPackBonusCoins,
		}
	case row.volumeID.Valid:
		item.Volume = &publirattypesv1.Volume{
			Id:         row.volumeID.UUID.String(),
			PublicId:   row.volumePublicID,
			Title:      row.volumeTitle,
			OrderIndex: row.volumeOrderIndex,
		}
	case row.seriesBundleID.Valid:
		item.SeriesBundle = &publirattypesv1.SeriesBundle{
			Id:              row.seriesBundleID.UUID.String(),
			EpisodeCount:    row.seriesBundleEpisodeCount,
			DiscountPercent: row.seriesBundleDiscountPercent,
		}
	default:
		item.Episode = &publirattypesv1.Episode{
			Id:         row.episodeID.UUID.String(),
			OrderIndex: row.episodeOrderIndex,
			PublicId:   row.episodePublicID,
			Title:      row.episodeTitle,
			Locale:     row.episodeLocale,
		}
	}
	return item, nil
}

// namesCoins reports whether a purchase is answered with the tenant's word for
// its coins: one paid with coins, or one of a pack.
func namesCoins(row purchasePageRow) bool {
	return row.coinsSpent > 0 || row.coinPackID.Valid
}

func (s *apiServer) ListMyPurchases(
	ctx context.Context,
	req *publirav1.ListMyPurchasesRequest,
) (*publirav1.ListMyPurchasesResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}

	surface, err := callingSurface(req.Surface)
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultPurchasePageSize, maxPurchasePageSize)
	cursor, err := decodeSurfaceToken(req.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	rows, err := s.purchasePage(ctx, tenant.ID, user.ID, surface, readerLocale, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list purchases", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	// The coins are named only on a page that holds a purchase paid with
	// them or of them, so a library that holds none reads nothing about coins.
	var coinName string
	if slices.ContainsFunc(rows, namesCoins) {
		if coinName, err = s.coinNameFor(ctx, tenant.ID, readerLocale); err != nil {
			return nil, err
		}
	}
	now := time.Now()
	items := make([]*publirav1.MyPurchase, 0, len(rows))
	for _, row := range rows {
		item, err := purchaseItemFromRow(row, coinName, now)
		if err != nil {
			return nil, s.internalError(ctx, "purchase holds a kind this build does not know", err, "tenant_id", tenant.ID.String(), "purchase_id", row.id.String())
		}
		items = append(items, item)
	}

	res := &publirav1.ListMyPurchasesResponse{Purchases: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].purchasedAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.purchasedAt, last.id)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)

	return res, nil
}

func purchaseReturnURL(base *url.URL, seriesPublicID, episodePublicID, checkout string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", "series", seriesPublicID, "episodes", episodePublicID)
	query := result.Query()
	query.Set("checkout", checkout)
	result.RawQuery = query.Encode()
	return result.String()
}

func mobilePurchaseReturnURL(base *url.URL, locale, episodePublicID, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", locale, "checkout", "return")
	query := result.Query()
	query.Set("episode", episodePublicID)
	query.Set("status", status)
	result.RawQuery = query.Encode()
	return result.String()
}

func (s *apiServer) ProcessPaymentWebhook(
	ctx context.Context,
	req *publirav1.ProcessPaymentWebhookRequest,
) (*publirav1.ProcessPaymentWebhookResponse, error) {
	providerID := strings.TrimSpace(req.Provider)
	if _, ok := s.paymentProviders.Lookup(providerID); !ok {
		return nil, connect.NewError(connect.CodeNotFound, "payment provider not found")
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	provider, config, credentials, err := s.loadPaymentProvider(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if provider.Declaration().ID != providerID {
		s.logger.WarnContext(ctx, "payment webhook names a provider the tenant does not use",
			"tenant_id", tenant.ID,
			"provider", providerID,
			"tenant_provider", provider.Declaration().ID,
		)
		return nil, paymentsNotConfiguredError()
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxPaymentWebhookPayload {
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid payment webhook payload")
	}
	headers := make(http.Header, len(req.Headers))
	for name, value := range req.Headers {
		headers.Set(name, value)
	}
	event, err := provider.ParseNotification(ctx, req.Payload, headers, credentials)
	switch {
	case errors.Is(err, paymentprovider.ErrInvalidSignature):
		s.logger.WarnContext(ctx, "invalid payment webhook signature", "tenant_id", tenant.ID, "provider", providerID)
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid payment webhook signature")
	case errors.Is(err, paymentprovider.ErrMalformedNotification):
		s.logger.WarnContext(ctx, "malformed payment webhook", "tenant_id", tenant.ID, "provider", providerID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid payment webhook")
	case err != nil:
		return nil, s.internalError(ctx, "payment webhook could not be processed", err, "tenant_id", tenant.ID.String(), "provider", providerID)
	}

	switch event := event.(type) {
	case paymentprovider.Refunded:
		if err := s.recordRefund(ctx, s.queriesFor(ctx), tenant.ID, provider, credentials, event); err != nil {
			return nil, err
		}
	case paymentprovider.RefundFailed:
		if err := s.recordFailedRefund(ctx, s.queriesFor(ctx), tenant.ID, provider.Declaration().ID, event); err != nil {
			return nil, err
		}
	case paymentprovider.Disputed:
		if err := s.recordDispute(ctx, s.queriesFor(ctx), tenant.ID, provider.Declaration().ID, event); err != nil {
			return nil, err
		}
	case paymentprovider.DisputeLost:
		if err := s.recordLostDispute(ctx, s.queriesFor(ctx), tenant.ID, provider.Declaration().ID, event); err != nil {
			return nil, err
		}
	case paymentprovider.CheckoutExpired:
		if event.Purchase.TenantID != tenant.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument, "checkout tenant does not match webhook path")
		}
		if err := s.recordExpiredCheckout(ctx, tenant.ID, provider.Declaration().ID, event); err != nil {
			return nil, s.internalDBError(ctx, "failed to record an expired checkout", err, "event_id", event.ID, "checkout_id", event.CheckoutID)
		}
	case paymentprovider.PurchaseCompleted:
		if event.Purchase.TenantID != tenant.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument, "checkout tenant does not match webhook path")
		}
		// A checkout started before the tenant changed its currency completes
		// in the one it was started in. The reader has paid, so the purchase is
		// recorded in that currency rather than refused, and is no sale on a
		// royalty statement in the new one.
		if event.Purchase.Currency != config.Currency {
			s.logger.WarnContext(ctx, "a completed checkout was paid in a currency other than the tenant's",
				"tenant_id", tenant.ID,
				"event_id", event.ID,
				"checkout_id", event.CheckoutID,
				"checkout_currency", event.Purchase.Currency,
				"tenant_currency", config.Currency,
			)
		}
		if err := s.createPurchase(ctx, tenant.ID, provider.Declaration().ID, event); err != nil {
			return nil, s.internalDBError(ctx, "failed to create purchase from a completed checkout", err, "event_id", event.ID, "checkout_id", event.CheckoutID)
		}
	case paymentprovider.SubscriptionChanged:
		if err := s.recordSubscription(ctx, tenant.ID, provider, credentials, event, nil); err != nil {
			return nil, err
		}
	case paymentprovider.SubscriptionPaid:
		if err := s.recordSubscriptionPayment(ctx, tenant.ID, provider, credentials, event); err != nil {
			return nil, err
		}
	}
	return &publirav1.ProcessPaymentWebhookResponse{}, nil
}

// recordExpiredCheckout records the checkout the provider reports expired as
// the reader's latest on what it would have sold: the episode, the volume, the
// rest of the series, or the pack.
func (s *apiServer) recordExpiredCheckout(ctx context.Context, tenantID uuid.UUID, providerID string, event paymentprovider.CheckoutExpired) error {
	if event.Purchase.CoinPackID != uuid.Nil {
		return s.queriesFor(ctx).RecordExpiredCoinPackCheckout(ctx, dbmodels.RecordExpiredCoinPackCheckoutParams{
			TenantID:           tenantID,
			UserID:             event.Purchase.ReaderID,
			CoinPackID:         event.Purchase.CoinPackID,
			Provider:           providerID,
			ProviderCheckoutID: event.CheckoutID,
		})
	}
	if event.Purchase.SeriesBundleID != uuid.Nil {
		return s.queriesFor(ctx).RecordExpiredSeriesBundleCheckout(ctx, dbmodels.RecordExpiredSeriesBundleCheckoutParams{
			Provider:           providerID,
			ProviderCheckoutID: event.CheckoutID,
			TenantID:           tenantID,
			ID:                 event.Purchase.SeriesBundleID,
			UserID:             event.Purchase.ReaderID,
		})
	}
	if event.Purchase.VolumeID != uuid.Nil {
		return s.queriesFor(ctx).RecordExpiredVolumeCheckout(ctx, dbmodels.RecordExpiredVolumeCheckoutParams{
			TenantID:           tenantID,
			UserID:             event.Purchase.ReaderID,
			VolumeID:           event.Purchase.VolumeID,
			Provider:           providerID,
			ProviderCheckoutID: event.CheckoutID,
		})
	}
	return s.queriesFor(ctx).RecordExpiredCheckout(ctx, dbmodels.RecordExpiredCheckoutParams{
		TenantID:           tenantID,
		UserID:             event.Purchase.ReaderID,
		EpisodeID:          event.Purchase.EpisodeID,
		Provider:           providerID,
		ProviderCheckoutID: event.CheckoutID,
	})
}

func (s *apiServer) recordRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	event paymentprovider.Refunded,
) error {
	providerID := provider.Declaration().ID
	// A refund of nothing is not a refund, and one that names no currency is
	// comparable to no price. Either way the purchase is recorded as refunded
	// in full, which is what a refund notification means when it says nothing
	// more precise; the queries do the same with an amount in a currency other
	// than the purchase's.
	var (
		refundedAmount sql.NullInt32
		currency       sql.NullString
	)
	if event.Currency != "" && event.AmountRefunded > 0 && event.AmountRefunded <= math.MaxInt32 {
		refundedAmount = sql.NullInt32{Int32: int32(event.AmountRefunded), Valid: true}
		currency = sql.NullString{String: event.Currency, Valid: true}
	} else {
		s.logger.WarnContext(ctx, "refund reported no comparable amount and is recorded as a full refund",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"payment_id", event.PaymentID,
			"currency", event.Currency,
			"amount_refunded", event.AmountRefunded,
		)
	}

	purchase, err := queries.RecordRefundOnPurchase(ctx, dbmodels.RecordRefundOnPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: event.PaymentID,
		RefundedAmount:    refundedAmount,
		Currency:          currency,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Matched against a subscription payment, or held, under the lock
		// recordSubscriptionPayment takes, so a payment being recorded at the
		// same moment either is seen here or sees what is held.
		return s.withProviderPaymentLock(ctx, tenantID, providerID, event.PaymentID, func(queries Querier) error {
			// A payment of a subscription plan is refunded through the same
			// notification as a purchase is.
			payment, err := queries.RecordRefundOnSubscriptionPayment(ctx, dbmodels.RecordRefundOnSubscriptionPaymentParams{
				TenantID:              tenantID,
				StripePaymentIntentID: event.PaymentID,
				RefundedAmount:        refundedAmount,
				Currency:              currency,
			})
			if err == nil {
				s.logger.InfoContext(ctx, "recorded a refund on a subscription payment",
					"tenant_id", tenantID,
					"event_id", event.ID,
					"subscription_payment_id", payment.ID,
					"refunded_amount", payment.RefundedAmount.Int32,
				)
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return s.internalDBError(ctx, "failed to record a refund on a subscription payment", err, "event_id", event.ID, "payment_id", event.PaymentID)
			}
			// The sale may simply not exist yet: a provider need order
			// neither its notifications nor its retries, so a refund can
			// overtake the one that creates the sale. Holding it lets that
			// notification apply it, and a refund that belongs to no sale of
			// ours costs one row instead of days of retries.
			if err := queries.HoldUnappliedRefund(ctx, dbmodels.HoldUnappliedRefundParams{
				TenantID:          tenantID,
				Provider:          providerID,
				ProviderPaymentID: event.PaymentID,
				RefundedAmount:    refundedAmount,
				Currency:          currency,
			}); err != nil {
				return s.internalDBError(ctx, "failed to hold an unmatched refund", err, "event_id", event.ID, "payment_id", event.PaymentID)
			}
			s.logger.WarnContext(ctx, "refund matches no purchase yet and is held",
				"tenant_id", tenantID,
				"event_id", event.ID,
				"payment_id", event.PaymentID,
			)
			return nil
		})
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to record refund", err, "event_id", event.ID, "payment_id", event.PaymentID)
	}
	if currency.Valid && currency.String != purchase.Currency {
		s.logger.WarnContext(ctx, "refund was reported in a currency other than its purchase's and is recorded as a full refund",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"purchase_id", purchase.ID,
			"currency", event.Currency,
			"purchase_currency", purchase.Currency,
		)
	}
	s.logger.InfoContext(ctx, "recorded a refund on a purchase",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"purchase_id", purchase.ID,
		"refunded_amount", purchase.RefundedAmount.Int32,
		"fully_refunded", purchase.RefundedAt.Valid,
	)
	if purchase.StaffRefundRequestedAmount.Valid {
		if err := s.settleStaffRefundInPart(ctx, queries, tenantID, provider, credentials, event, purchase); err != nil {
			return err
		}
	}
	// A pack refunded in part keeps its coins: they are what the reader still
	// pays for. Refunded in full, it grants nothing more.
	if purchase.RefundedAt.Valid {
		return s.revokeCoinPackGrant(ctx, purchase)
	}
	return nil
}

// settleStaffRefundInPart ends the wait of the refund in part staff asked for
// on purchase once the provider has made it. The notification reports the
// total of every refund of the payment, one made in the provider's dashboard
// among them, so the provider is asked whether the refund made under the key
// of the attempt waiting is one of them.
func (s *apiServer) settleStaffRefundInPart(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	event paymentprovider.Refunded,
	purchase dbmodels.Purchase,
) error {
	made, err := provider.RefundMade(ctx, credentials, event.PaymentID, paymentprovider.StaffRefundKey(purchase.ID, purchase.StaffRefundAttempt))
	if err != nil {
		return s.internalError(ctx, "failed to look up the refund in part a purchase waits for", err, "event_id", event.ID, "purchase_id", purchase.ID.String())
	}
	if !made {
		return nil
	}
	if _, err := queries.SettleStaffRefundInPart(ctx, dbmodels.SettleStaffRefundInPartParams{
		TenantID: tenantID,
		ID:       purchase.ID,
		Attempt:  purchase.StaffRefundAttempt,
	}); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return s.internalDBError(ctx, "failed to settle a refund in part", err, "event_id", event.ID, "purchase_id", purchase.ID.String())
	}
	return nil
}

// withProviderPaymentLock runs fn in a transaction that holds the lock on
// one payment of the provider, which every write that matches a refund to a
// subscription payment or holds it for one takes, so the two cannot miss each
// other.
func (s *apiServer) withProviderPaymentLock(ctx context.Context, tenantID uuid.UUID, providerID, paymentID string, fn func(queries Querier) error) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin the refund transaction", err, "payment_id", paymentID)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	if err := queries.LockProviderPayment(ctx, dbmodels.LockProviderPaymentParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: paymentID,
	}); err != nil {
		return s.internalDBError(ctx, "failed to lock a payment", err, "payment_id", paymentID)
	}
	if err := fn(queries); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit the refund transaction", err, "payment_id", paymentID)
	}
	return nil
}

// recordFailedRefund writes down that a refund of a payment failed, which can
// reopen the purchase a refund closed.
func (s *apiServer) recordFailedRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	event paymentprovider.RefundFailed,
) error {
	if event.Currency == "" || event.AmountRefunded < 0 || event.AmountRefunded > math.MaxInt32 {
		s.logger.WarnContext(ctx, "a failed refund reported no comparable amount that stays refunded and is not recorded",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"payment_id", event.PaymentID,
			"currency", event.Currency,
			"amount_refunded", event.AmountRefunded,
		)
		return nil
	}
	purchase, err := queries.RecordFailedRefundOnPurchase(ctx, dbmodels.RecordFailedRefundOnPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: event.PaymentID,
		Currency:          event.Currency,
		RefundedAmount:    int32(event.AmountRefunded),
		RefundKey:         event.RefundKey,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Under the lock recordSubscriptionPayment takes, as a refund that
		// matches no purchase is.
		return s.withProviderPaymentLock(ctx, tenantID, providerID, event.PaymentID, func(queries Querier) error {
			payment, err := queries.RecordFailedRefundOnSubscriptionPayment(ctx, dbmodels.RecordFailedRefundOnSubscriptionPaymentParams{
				TenantID:              tenantID,
				StripePaymentIntentID: event.PaymentID,
				RefundedAmount:        int32(event.AmountRefunded),
				Currency:              event.Currency,
			})
			if err == nil {
				s.logger.InfoContext(ctx, "recorded a failed refund on a subscription payment",
					"tenant_id", tenantID,
					"event_id", event.ID,
					"subscription_payment_id", payment.ID,
					"refunded_amount", payment.RefundedAmount.Int32,
				)
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return s.internalDBError(ctx, "failed to record a failed refund on a subscription payment", err, "event_id", event.ID, "payment_id", event.PaymentID)
			}
			// A refund held for a purchase that is not here yet is all that
			// remains to correct: it is set to what stays refunded, or released
			// when that is nothing, so the purchase it is applied to later is not
			// refunded by the failed one.
			if event.AmountRefunded == 0 {
				if err := queries.ReleaseUnappliedRefund(ctx, dbmodels.ReleaseUnappliedRefundParams{
					TenantID:          tenantID,
					Provider:          providerID,
					ProviderPaymentID: event.PaymentID,
				}); err != nil {
					return s.internalDBError(ctx, "failed to release a held refund that failed", err, "event_id", event.ID, "payment_id", event.PaymentID)
				}
			} else if err := queries.ReplaceUnappliedRefund(ctx, dbmodels.ReplaceUnappliedRefundParams{
				TenantID:          tenantID,
				Provider:          providerID,
				ProviderPaymentID: event.PaymentID,
				RefundedAmount:    int32(event.AmountRefunded),
				Currency:          event.Currency,
			}); err != nil {
				return s.internalDBError(ctx, "failed to correct a held refund one of whose refunds failed", err, "event_id", event.ID, "payment_id", event.PaymentID)
			}
			s.logger.WarnContext(ctx, "a failed refund matches no purchase",
				"tenant_id", tenantID,
				"event_id", event.ID,
				"payment_id", event.PaymentID,
				"currency", event.Currency,
			)
			return nil
		})
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to record a failed refund", err, "event_id", event.ID, "payment_id", event.PaymentID)
	}
	s.logger.InfoContext(ctx, "recorded a failed refund on a purchase",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"purchase_id", purchase.ID,
		"refunded_amount", purchase.RefundedAmount.Int32,
		"revoked", purchase.RevokedAt.Valid,
	)
	// The coins a pack's refund took back stay taken back: the reader may have
	// bought another pack since, which paid the shortfall the refund left, and
	// giving the coins back would count those coins twice. The warning is what
	// tells staff the reader paid for coins they no longer hold.
	if purchase.CoinPackID.Valid && !purchase.RevokedAt.Valid {
		s.logger.WarnContext(ctx, "a failed refund reopened a pack purchase whose coins were taken back",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"purchase_id", purchase.ID,
		)
	}
	return nil
}

func (s *apiServer) recordDispute(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	event paymentprovider.Disputed,
) error {
	purchase, err := queries.RecordDisputeOnPurchase(ctx, dbmodels.RecordDisputeOnPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: event.PaymentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Held for the same reason a refund is: the notification that creates
		// the purchase may still be on its way.
		if err := queries.HoldUnappliedDispute(ctx, dbmodels.HoldUnappliedDisputeParams{
			TenantID:          tenantID,
			Provider:          providerID,
			ProviderPaymentID: event.PaymentID,
		}); err != nil {
			return s.internalDBError(ctx, "failed to hold an unmatched dispute", err, "event_id", event.ID, "payment_id", event.PaymentID)
		}
		s.logger.WarnContext(ctx, "dispute matches no purchase yet and is held",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"payment_id", event.PaymentID,
		)
		return nil
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to record dispute", err, "event_id", event.ID, "payment_id", event.PaymentID)
	}
	s.logger.InfoContext(ctx, "revoked a disputed purchase",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"purchase_id", purchase.ID,
		"revocation_reason", purchase.RevocationReason.String,
	)
	// A dispute closes a pack's coins at once, as it closes an episode: the
	// reader's bank holds the money, whatever the dispute later decides.
	return s.revokeCoinPackGrant(ctx, purchase)
}

// recordLostDispute writes down that the reader's bank returned the money of a
// disputed payment to them, which takes the purchase off royalty statements.
func (s *apiServer) recordLostDispute(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	event paymentprovider.DisputeLost,
) error {
	purchase, err := queries.RecordLostDisputeOnPurchase(ctx, dbmodels.RecordLostDisputeOnPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: event.PaymentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Held as an open dispute is, and for the same reason.
		if err := queries.HoldUnappliedDispute(ctx, dbmodels.HoldUnappliedDisputeParams{
			TenantID:          tenantID,
			Provider:          providerID,
			ProviderPaymentID: event.PaymentID,
			Lost:              true,
		}); err != nil {
			return s.internalDBError(ctx, "failed to hold an unmatched lost dispute", err, "event_id", event.ID, "payment_id", event.PaymentID)
		}
		s.logger.WarnContext(ctx, "lost dispute matches no purchase yet and is held",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"payment_id", event.PaymentID,
		)
		return nil
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to record a lost dispute", err, "event_id", event.ID, "payment_id", event.PaymentID)
	}
	s.logger.InfoContext(ctx, "recorded a lost dispute on a purchase",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"purchase_id", purchase.ID,
		"revocation_reason", purchase.RevocationReason.String,
	)
	return s.revokeCoinPackGrant(ctx, purchase)
}

// revokeCoinPackGrant closes the coins a pack purchase granted, in a
// transaction of its own, once a refund in full or a dispute has been recorded
// on the purchase. Any other purchase grants no coins and is left alone. A
// failure leaves the refund or the dispute recorded and the coins in place,
// and the provider's retry of the notification closes them: both writes are
// repeatable.
func (s *apiServer) revokeCoinPackGrant(ctx context.Context, purchase dbmodels.Purchase) error {
	if !purchase.CoinPackID.Valid {
		return nil
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin the revocation of a pack's coins", err, "tenant_id", purchase.TenantID.String(), "purchase_id", purchase.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	revocation, err := coinledger.RevokePackGrant(ctx, dbmodels.New(tx), purchase.TenantID, purchase.ID)
	if err != nil {
		return s.internalDBError(ctx, "failed to revoke a pack's coins", err, "tenant_id", purchase.TenantID.String(), "purchase_id", purchase.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit the revocation of a pack's coins", err, "tenant_id", purchase.TenantID.String(), "purchase_id", purchase.ID.String())
	}
	s.logRevokedCoins(ctx, purchase, revocation)
	return nil
}

func (s *apiServer) logRevokedCoins(ctx context.Context, purchase dbmodels.Purchase, revocation coinledger.Revocation) {
	if !revocation.Closed {
		return
	}
	s.logger.InfoContext(ctx, "revoked the coins of a pack purchase",
		"tenant_id", purchase.TenantID,
		"purchase_id", purchase.ID,
		"revoked_coins", revocation.Revoked,
		"shortfall_coins", revocation.Shortfall,
		"refunded_spend_amount", revocation.RefundedAmount,
	)
}

// createPurchase records the purchase a completed checkout paid for, of an
// episode, a volume, the rest of a series, or a pack of coins, and everything
// that follows from it, in one transaction: the coins of a pack, the refund or
// the dispute that may have overtaken it, its engagement event, and the
// receipt the reader is owed.
// A delivery that fails partway therefore leaves nothing behind, and the
// provider's retry starts again from the purchase.
func (s *apiServer) createPurchase(
	ctx context.Context,
	tenantID uuid.UUID,
	providerID string,
	event paymentprovider.PurchaseCompleted,
) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return fmt.Errorf("begin purchase transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)

	purchase := event.Purchase
	var paymentID sql.NullString
	if event.PaymentID != "" {
		paymentID = sql.NullString{String: event.PaymentID, Valid: true}
	}
	// The purchase records what the reader paid rather than the price the
	// checkout was started at, so that a promotion code's discount is what a
	// refund of the whole payment is measured against.
	var promotionCodeID sql.NullString
	if event.PromotionCodeID != "" {
		promotionCodeID = sql.NullString{String: event.PromotionCodeID, Valid: true}
	}
	// A reader can pay two checkouts of the same episode: one started before an
	// editor changed its price or reading period, and one started after. Both
	// are recorded, because each took a payment. A redelivery of a checkout
	// already recorded inserts nothing here and queues no second receipt.
	var created dbmodels.Purchase
	switch {
	case purchase.CoinPackID != uuid.Nil:
		created, err = queries.CreatePurchaseFromProviderCoinPackCheckout(ctx, dbmodels.CreatePurchaseFromProviderCoinPackCheckoutParams{
			ID:                 uuid.New(),
			TenantID:           tenantID,
			UserID:             purchase.ReaderID,
			CoinPackID:         purchase.CoinPackID,
			PriceAtPurchase:    event.AmountPaid,
			Provider:           providerID,
			ProviderCheckoutID: event.CheckoutID,
			ProviderPaymentID:  paymentID,
			IsTest:             event.Test,
			Currency:           purchase.Currency,
		})
	case purchase.SeriesBundleID != uuid.Nil:
		created, err = queries.CreatePurchaseFromProviderSeriesBundleCheckout(ctx, dbmodels.CreatePurchaseFromProviderSeriesBundleCheckoutParams{
			ID:                      uuid.New(),
			TenantID:                tenantID,
			UserID:                  purchase.ReaderID,
			SeriesBundleID:          purchase.SeriesBundleID,
			PriceAtPurchase:         event.AmountPaid,
			Provider:                providerID,
			ProviderCheckoutID:      event.CheckoutID,
			ProviderPaymentID:       paymentID,
			IsTest:                  event.Test,
			Currency:                purchase.Currency,
			ProviderPromotionCodeID: promotionCodeID,
		})
	case purchase.VolumeID != uuid.Nil:
		created, err = queries.CreatePurchaseFromProviderVolumeCheckout(ctx, dbmodels.CreatePurchaseFromProviderVolumeCheckoutParams{
			ID:                      uuid.New(),
			TenantID:                tenantID,
			UserID:                  purchase.ReaderID,
			VolumeID:                purchase.VolumeID,
			PriceAtPurchase:         event.AmountPaid,
			Provider:                providerID,
			ProviderCheckoutID:      event.CheckoutID,
			ProviderPaymentID:       paymentID,
			IsTest:                  event.Test,
			Currency:                purchase.Currency,
			ProviderPromotionCodeID: promotionCodeID,
		})
	default:
		expiresAt := readingPeriodExpiry(purchase.ReadingPeriodHours, time.Now().UTC())
		created, err = queries.CreatePurchaseFromProviderCheckout(ctx, dbmodels.CreatePurchaseFromProviderCheckoutParams{
			ID:                      uuid.New(),
			TenantID:                tenantID,
			UserID:                  purchase.ReaderID,
			EpisodeID:               purchase.EpisodeID,
			Kind:                    string(purchase.Kind),
			PriceAtPurchase:         event.AmountPaid,
			ExpiresAt:               expiresAt,
			Provider:                providerID,
			ProviderCheckoutID:      event.CheckoutID,
			ProviderPaymentID:       paymentID,
			IsTest:                  event.Test,
			Currency:                purchase.Currency,
			ProviderPromotionCodeID: promotionCodeID,
		})
	}
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return fmt.Errorf("create purchase: %w", err)
	default:
		// What each episode of a volume accounts for is written down as the
		// purchase is, so that what a statement credits for the sale stays put
		// however the volume and its episodes' prices change afterwards.
		if created.VolumeID.Valid {
			if err := queries.CreateVolumePurchaseEpisodes(ctx, dbmodels.CreateVolumePurchaseEpisodesParams{
				TenantID:   tenantID,
				PurchaseID: created.ID,
			}); err != nil {
				return fmt.Errorf("record the episodes of the volume purchase: %w", err)
			}
		}
		// The coins are granted on the terms the checkout was started on, which
		// it carried to here, however the pack or the tenant's expiry has
		// changed since.
		if created.CoinPackID.Valid {
			if err := recordCoinPackSale(ctx, queries, created, coinPackTerms{
				coins:      purchase.Coins,
				bonusCoins: purchase.BonusCoins,
				expiryDays: purchase.CoinExpiryDays,
			}); err != nil {
				return err
			}
		}
		if err := enqueuePurchaseReceipt(ctx, queries, tenantID, created.ID); err != nil {
			return err
		}
	}

	if paymentID.Valid {
		if err := s.applyHeldRefund(ctx, queries, tenantID, providerID, paymentID.String); err != nil {
			return err
		}
		if err := s.applyHeldDispute(ctx, queries, tenantID, providerID, paymentID.String); err != nil {
			return err
		}
	}

	// The engagement events are an episode's, and a volume or the rest of a
	// series is not one, so a purchase of either projects none.
	if purchase.EpisodeID != uuid.Nil {
		_, err = queries.ProjectPurchaseContentEvent(ctx, dbmodels.ProjectPurchaseContentEventParams{
			ID:                 uuid.Must(uuid.NewV7()),
			TenantID:           tenantID,
			Provider:           providerID,
			ProviderCheckoutID: event.CheckoutID,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("project purchase content event: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit purchase: %w", err)
	}
	return nil
}

// enqueuePurchaseReceipt queues the receipt of a purchase just recorded. The
// key names the purchase, so a receipt queued once is never queued again.
func enqueuePurchaseReceipt(ctx context.Context, queries *dbmodels.Queries, tenantID, purchaseID uuid.UUID) error {
	payload, err := json.Marshal(outbox.PurchaseReceiptPayload{
		TenantID:   tenantID.String(),
		PurchaseID: purchaseID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal purchase receipt event: %w", err)
	}
	if err := insertPublicOutboxEvent(ctx, queries, tenantID, outbox.EventTypePurchaseReceipt, payload,
		outbox.PurchaseReceiptIdempotencyKey(purchaseID)); err != nil {
		return fmt.Errorf("enqueue purchase receipt: %w", err)
	}
	return nil
}

// applyHeldRefund writes onto the purchase any refund that reached us before it
// existed. Ordinarily nothing is held and this costs one lookup.
func (s *apiServer) applyHeldRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	paymentID string,
) error {
	purchase, err := queries.ApplyUnappliedRefundToPurchase(ctx, dbmodels.ApplyUnappliedRefundToPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: paymentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("apply held refund: %w", err)
	}
	if err := queries.ReleaseUnappliedRefund(ctx, dbmodels.ReleaseUnappliedRefundParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: paymentID,
	}); err != nil {
		return fmt.Errorf("release held refund: %w", err)
	}
	if purchase.CoinPackID.Valid && purchase.RefundedAt.Valid {
		revocation, err := coinledger.RevokePackGrant(ctx, queries, tenantID, purchase.ID)
		if err != nil {
			return fmt.Errorf("revoke the coins of a refunded pack: %w", err)
		}
		s.logRevokedCoins(ctx, purchase, revocation)
	}
	s.logger.InfoContext(ctx, "applied a refund that arrived before its purchase",
		"tenant_id", tenantID,
		"purchase_id", purchase.ID,
		"payment_id", paymentID,
		"refunded_amount", purchase.RefundedAmount.Int32,
		"fully_refunded", purchase.RefundedAt.Valid,
	)
	return nil
}

// applyHeldDispute revokes the purchase for any dispute that reached us before
// it existed, and records it lost if it was reported lost by then. Ordinarily nothing is held and this costs one lookup.
func (s *apiServer) applyHeldDispute(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	paymentID string,
) error {
	purchase, err := queries.ApplyUnappliedDisputeToPurchase(ctx, dbmodels.ApplyUnappliedDisputeToPurchaseParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: paymentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("apply held dispute: %w", err)
	}
	if err := queries.ReleaseUnappliedDispute(ctx, dbmodels.ReleaseUnappliedDisputeParams{
		TenantID:          tenantID,
		Provider:          providerID,
		ProviderPaymentID: paymentID,
	}); err != nil {
		return fmt.Errorf("release held dispute: %w", err)
	}
	if purchase.CoinPackID.Valid {
		revocation, err := coinledger.RevokePackGrant(ctx, queries, tenantID, purchase.ID)
		if err != nil {
			return fmt.Errorf("revoke the coins of a disputed pack: %w", err)
		}
		s.logRevokedCoins(ctx, purchase, revocation)
	}
	s.logger.InfoContext(ctx, "revoked a purchase for a dispute that arrived before it",
		"tenant_id", tenantID,
		"purchase_id", purchase.ID,
		"payment_id", paymentID,
		"revocation_reason", purchase.RevocationReason.String,
	)
	return nil
}

func paymentsNotConfiguredError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "payments are not configured")
}

func (s *apiServer) paymentStore(ctx context.Context) *paymentsettings.Store {
	return paymentsettings.New(s.queriesFor(ctx), s.encryptor, s.paymentProviders, nil, s.logger)
}

// tenantCurrency answers the currency the tenant sells in, read through
// queries so that a caller inside a transaction reads it there.
func (s *apiServer) tenantCurrency(ctx context.Context, queries Querier, tenantID uuid.UUID) (string, error) {
	currency, err := paymentsettings.TenantCurrency(ctx, queries, tenantID)
	if err != nil {
		return "", s.internalDBError(ctx, "failed to read the tenant currency", err, "tenant_id", tenantID.String())
	}
	return currency, nil
}

// loadPaymentProvider answers the tenant's enabled payment provider with its
// settings and credentials, or failed_precondition when the tenant cannot take
// payments.
func (s *apiServer) loadPaymentProvider(ctx context.Context, tenantID uuid.UUID) (paymentprovider.Provider, paymentsettings.PublicConfig, paymentprovider.Credentials, error) {
	config, credentials, err := s.paymentStore(ctx).LoadEnabledSecrets(ctx, tenantID)
	if err != nil {
		if paymentsettings.IsUnavailable(err) {
			s.logger.WarnContext(ctx, "tenant payment settings are unavailable",
				"tenant_id", tenantID,
			)
			return nil, paymentsettings.PublicConfig{}, nil, paymentsNotConfiguredError()
		}
		return nil, paymentsettings.PublicConfig{}, nil, s.internalDBError(ctx, "failed to load tenant payment settings", err, "tenant_id", tenantID.String())
	}
	provider, ok := s.paymentProviders.Lookup(config.Provider)
	if !ok {
		return nil, paymentsettings.PublicConfig{}, nil, paymentsNotConfiguredError()
	}
	return provider, config, credentials, nil
}
