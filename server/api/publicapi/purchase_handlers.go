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
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
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

	hasPurchase, err := s.queriesFor(ctx).UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check purchase status", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if hasPurchase {
		return nil, connect.NewError(connect.CodeAlreadyExists, "episode is already purchased")
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
			Price:              episode.Price,
			Currency:           config.Currency,
			ReadingPeriodHours: episode.ReadingPeriodHours.Int32,
		},
		EpisodeTitle: episode.Title,
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
	checkout.IdempotencyKey, err = checkoutIdempotencyKey(checkout, expiredCheckoutID)
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

// checkoutIdempotencyKey names one reader's checkout of one episode by
// everything the request sends, so a retried request reuses the provider's
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
func checkoutIdempotencyKey(req paymentprovider.CheckoutRequest, expiredCheckoutID string) (string, error) {
	req.IdempotencyKey = ""
	encoded, err := json.Marshal(struct {
		Request           paymentprovider.CheckoutRequest
		ExpiredCheckoutID string
	}{req, expiredCheckoutID})
	if err != nil {
		return "", fmt.Errorf("encode checkout request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	purchase := req.Purchase
	return fmt.Sprintf("episode-checkout:%s:%s:%s:%x", purchase.TenantID, purchase.ReaderID, purchase.EpisodeID, sum[:16]), nil
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
	id                uuid.UUID
	priceAtPurchase   int32
	currency          string
	expiresAt         sql.NullTime
	revokedAt         sql.NullTime
	refundedAmount    sql.NullInt32
	refundedAt        sql.NullTime
	purchasedAt       time.Time
	episodeID         uuid.UUID
	episodePublicID   string
	episodeTitle      string
	episodeOrderIndex int32
	seriesID          uuid.UUID
	seriesPublicID    string
	seriesTitle       string
}

func mapPurchaseDescRows(rows []dbmodels.ListMyPurchasesDescRow) []purchasePageRow {
	mapped := make([]purchasePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, purchasePageRow{
			id:                row.ID,
			priceAtPurchase:   row.PriceAtPurchase,
			currency:          row.Currency,
			expiresAt:         row.ExpiresAt,
			revokedAt:         row.RevokedAt,
			refundedAmount:    row.RefundedAmount,
			refundedAt:        row.RefundedAt,
			purchasedAt:       row.PurchasedAt,
			episodeID:         row.EpisodeID,
			episodePublicID:   row.EpisodePublicID,
			episodeTitle:      row.EpisodeTitle,
			episodeOrderIndex: row.EpisodeOrderIndex,
			seriesID:          row.SeriesID,
			seriesPublicID:    row.SeriesPublicID,
			seriesTitle:       row.SeriesTitle,
		})
	}
	return mapped
}

func mapPurchaseAscRows(rows []dbmodels.ListMyPurchasesAscRow) []purchasePageRow {
	mapped := make([]purchasePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, purchasePageRow{
			id:                row.ID,
			priceAtPurchase:   row.PriceAtPurchase,
			currency:          row.Currency,
			expiresAt:         row.ExpiresAt,
			revokedAt:         row.RevokedAt,
			refundedAmount:    row.RefundedAmount,
			refundedAt:        row.RefundedAt,
			purchasedAt:       row.PurchasedAt,
			episodeID:         row.EpisodeID,
			episodePublicID:   row.EpisodePublicID,
			episodeTitle:      row.EpisodeTitle,
			episodeOrderIndex: row.EpisodeOrderIndex,
			seriesID:          row.SeriesID,
			seriesPublicID:    row.SeriesPublicID,
			seriesTitle:       row.SeriesTitle,
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

func purchaseItemFromRow(row purchasePageRow, now time.Time) *publirav1.MyPurchase {
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

	return &publirav1.MyPurchase{
		Id: row.id.String(),
		Episode: &publirattypesv1.Episode{
			Id:         row.episodeID.String(),
			OrderIndex: row.episodeOrderIndex,
			PublicId:   row.episodePublicID,
			Title:      row.episodeTitle,
		},
		Currency:        row.currency,
		ExpiresAt:       expiresAt,
		IsActive:        isActive,
		PriceAtPurchase: row.priceAtPurchase,
		PurchasedAt:     row.purchasedAt.UTC().Format(time.RFC3339),
		RefundedAmount:  row.refundedAmount.Int32,
		RefundedAt:      refundedAt,
		RevokedAt:       revokedAt,
		Series: &publirattypesv1.Series{
			Id:       row.seriesID.String(),
			PublicId: row.seriesPublicID,
			Title:    row.seriesTitle,
		},
	}
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
	now := time.Now()
	items := make([]*publirav1.MyPurchase, 0, len(rows))
	for _, row := range rows {
		items = append(items, purchaseItemFromRow(row, now))
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
		if err := s.recordRefund(ctx, s.queriesFor(ctx), tenant.ID, provider.Declaration().ID, event); err != nil {
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
		if err := s.queriesFor(ctx).RecordExpiredCheckout(ctx, dbmodels.RecordExpiredCheckoutParams{
			TenantID:           tenant.ID,
			UserID:             event.Purchase.ReaderID,
			EpisodeID:          event.Purchase.EpisodeID,
			Provider:           provider.Declaration().ID,
			ProviderCheckoutID: event.CheckoutID,
		}); err != nil {
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
	}
	return &publirav1.ProcessPaymentWebhookResponse{}, nil
}

func (s *apiServer) recordRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	providerID string,
	event paymentprovider.Refunded,
) error {
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
		// The purchase may simply not exist yet: a provider need order neither
		// its notifications nor its retries, so a refund can overtake the one
		// that creates the sale. Holding it lets that notification apply it,
		// and a refund that belongs to no purchase of ours costs one row
		// instead of days of retries.
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
	})
	if errors.Is(err, sql.ErrNoRows) {
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
	return nil
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
	return nil
}

// createPurchase records the purchase a completed checkout paid for, and
// everything that follows from it, in one transaction: the refund or the
// dispute that may have overtaken it, its engagement event, and the receipt the reader is owed.
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
	// A reader can pay two checkouts of the same episode: one started before an
	// editor changed its price or reading period, and one started after. Both
	// are recorded, because each took a payment. A redelivery of a checkout
	// already recorded inserts nothing here and queues no second receipt.
	var expiresAt sql.NullTime
	if hours := purchase.ReadingPeriodHours; hours > 0 {
		now := time.Now().UTC()
		expiresAt = sql.NullTime{Time: now.AddDate(0, 0, int(hours/24)).Add(time.Duration(hours%24) * time.Hour), Valid: true}
	}
	created, err := queries.CreatePurchaseFromProviderCheckout(ctx, dbmodels.CreatePurchaseFromProviderCheckoutParams{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		UserID:             purchase.ReaderID,
		EpisodeID:          purchase.EpisodeID,
		PriceAtPurchase:    purchase.Price,
		ExpiresAt:          expiresAt,
		Provider:           providerID,
		ProviderCheckoutID: event.CheckoutID,
		ProviderPaymentID:  paymentID,
		IsTest:             event.Test,
		Currency:           purchase.Currency,
	})
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return fmt.Errorf("create purchase: %w", err)
	default:
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

	_, err = queries.ProjectPurchaseContentEvent(ctx, dbmodels.ProjectPurchaseContentEventParams{
		ID:                 uuid.Must(uuid.NewV7()),
		TenantID:           tenantID,
		Provider:           providerID,
		ProviderCheckoutID: event.CheckoutID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("project purchase content event: %w", err)
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
