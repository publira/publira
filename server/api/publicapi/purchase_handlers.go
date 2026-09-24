package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultPurchasePageSize = int32(20)
	maxPurchasePageSize     = int32(100)

	// maxPaymentWebhookPayload bounds the notification body a provider may
	// post.
	maxPaymentWebhookPayload = 64 << 10
)

func tenantSiteURL(tenant dbmodels.Tenant) (*url.URL, error) {
	domain := strings.TrimSpace(tenant.Domain)
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return nil, errors.New("tenant domain is not configured")
	}
	return &url.URL{Scheme: "https", Host: domain}, nil
}

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
	req *connect.Request[publirav1.StartEpisodeCheckoutRequest],
) (*connect.Response[publirav1.StartEpisodeCheckoutResponse], error) {
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	surface, err := checkoutSurface(req.Msg.Client)
	if err != nil {
		return nil, err
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if req.Msg.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		if err := s.refuseCheckoutForStoreRoute(ctx, tenant.ID); err != nil {
			return nil, err
		}
	}
	origin, err := tenantSiteURL(tenant)
	if err != nil {
		s.logger.WarnContext(ctx, "checkout refused because tenant domain is not configured", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	}
	provider, credentials, err := s.loadPaymentProvider(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeByPublicIDForTenant(ctx, dbmodels.GetPurchasableEpisodeByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: episodePublicID,
		Surface:  surface,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get purchasable episode", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if episode.Price <= 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("free episodes do not require checkout"))
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if !soldHere {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("episode is not sold on this surface"))
	}

	hasPurchase, err := s.queriesFor(ctx).UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check purchase status", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if hasPurchase {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("episode is already purchased"))
	}

	successURL := purchaseReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "success")
	cancelURL := purchaseReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "cancelled")
	if req.Msg.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		locale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		successURL = mobilePurchaseReturnURL(origin, locale, episode.PublicID, "success")
		cancelURL = mobilePurchaseReturnURL(origin, locale, episode.PublicID, "cancelled")
	}
	checkoutURL, err := provider.StartCheckout(ctx, credentials, paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:           tenant.ID,
			ReaderID:           user.ID,
			EpisodeID:          episode.ID,
			Price:              episode.Price,
			ReadingPeriodHours: episode.ReadingPeriodHours.Int32,
		},
		EpisodeTitle:   episode.Title,
		SuccessURL:     successURL,
		CancelURL:      cancelURL,
		IdempotencyKey: fmt.Sprintf("episode-checkout:%s:%s:%s", tenant.ID, user.ID, episode.ID),
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "provider", provider.Declaration().ID, "episode_public_id", episodePublicID)
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("failed to start checkout"))
	}
	return connect.NewResponse(&publirav1.StartEpisodeCheckoutResponse{CheckoutUrl: checkoutURL}), nil
}

// refuseCheckoutForStoreRoute answers failed_precondition for a tenant whose
// app sells through the store: that app may not send a reader to the external
// checkout, whatever an out-of-date build asks for.
func (s *apiServer) refuseCheckoutForStoreRoute(ctx context.Context, tenantID uuid.UUID) error {
	stored, err := s.queriesFor(ctx).GetTenantAppPurchaseRoute(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return s.internalDBError(ctx, "failed to get tenant app purchase route", err, "tenant_id", tenantID.String())
	}
	route, err := paymentsettings.ResolveAppPurchaseRoute(stored)
	if err != nil {
		return s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenantID.String())
	}
	if route == paymentsettings.RouteStore {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("the app sells through the store"))
	}
	return nil
}

type purchasePageRow struct {
	id                uuid.UUID
	priceAtPurchase   int32
	expiresAt         sql.NullTime
	refundedAt        sql.NullTime
	purchasedAt       time.Time
	episodePublicID   string
	episodeTitle      string
	episodeOrderIndex int32
	seriesPublicID    string
	seriesTitle       string
}

func mapPurchaseDescRows(rows []dbmodels.ListMyPurchasesDescRow) []purchasePageRow {
	mapped := make([]purchasePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, purchasePageRow{
			id:                row.ID,
			priceAtPurchase:   row.PriceAtPurchase,
			expiresAt:         row.ExpiresAt,
			refundedAt:        row.RefundedAt,
			purchasedAt:       row.PurchasedAt,
			episodePublicID:   row.EpisodePublicID,
			episodeTitle:      row.EpisodeTitle,
			episodeOrderIndex: row.EpisodeOrderIndex,
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
			expiresAt:         row.ExpiresAt,
			refundedAt:        row.RefundedAt,
			purchasedAt:       row.PurchasedAt,
			episodePublicID:   row.EpisodePublicID,
			episodeTitle:      row.EpisodeTitle,
			episodeOrderIndex: row.EpisodeOrderIndex,
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
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]purchasePageRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyPurchasesDescParams{
		TenantID:          tenantID,
		UserID:            userID,
		Surface:           surface,
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
	// A refunded purchase opens nothing, so the library must not offer it as
	// one the reader can still open.
	isActive := !row.refundedAt.Valid
	if row.expiresAt.Valid {
		expiresAt = row.expiresAt.Time.UTC().Format(time.RFC3339)
		isActive = isActive && row.expiresAt.Time.After(now)
	}

	return &publirav1.MyPurchase{
		Id: row.id.String(),
		Episode: &publirattypesv1.Episode{
			OrderIndex: row.episodeOrderIndex,
			PublicId:   row.episodePublicID,
			Title:      row.episodeTitle,
		},
		ExpiresAt:       expiresAt,
		IsActive:        isActive,
		PriceAtPurchase: row.priceAtPurchase,
		PurchasedAt:     row.purchasedAt.UTC().Format(time.RFC3339),
		Series: &publirattypesv1.Series{
			PublicId: row.seriesPublicID,
			Title:    row.seriesTitle,
		},
	}
}

func (s *apiServer) ListMyPurchases(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyPurchasesRequest],
) (*connect.Response[publirav1.ListMyPurchasesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultPurchasePageSize, maxPurchasePageSize)
	cursor, err := decodeSurfaceToken(req.Msg.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	rows, err := s.purchasePage(ctx, tenant.ID, user.ID, surface, keys, cursor.Direction, limit+1)
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

	return connect.NewResponse(res), nil
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
	req *connect.Request[publirav1.ProcessPaymentWebhookRequest],
) (*connect.Response[publirav1.ProcessPaymentWebhookResponse], error) {
	providerID := strings.TrimSpace(req.Msg.Provider)
	if _, ok := s.paymentProviders.Lookup(providerID); !ok {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("payment provider not found"))
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	provider, credentials, err := s.loadPaymentProvider(ctx, tenant.ID)
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
	if len(req.Msg.Payload) == 0 || len(req.Msg.Payload) > maxPaymentWebhookPayload {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid payment webhook payload"))
	}
	headers := make(http.Header, len(req.Msg.Headers))
	for name, value := range req.Msg.Headers {
		headers.Set(name, value)
	}
	event, err := provider.ParseNotification(req.Msg.Payload, headers, credentials)
	switch {
	case errors.Is(err, paymentprovider.ErrInvalidSignature):
		s.logger.WarnContext(ctx, "invalid payment webhook signature", "tenant_id", tenant.ID, "provider", providerID)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid payment webhook signature"))
	case errors.Is(err, paymentprovider.ErrMalformedNotification):
		s.logger.WarnContext(ctx, "malformed payment webhook", "tenant_id", tenant.ID, "provider", providerID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid payment webhook"))
	case err != nil:
		return nil, s.internalError(ctx, "payment webhook could not be processed", err, "tenant_id", tenant.ID.String(), "provider", providerID)
	}

	switch event := event.(type) {
	case paymentprovider.Refunded:
		if err := s.recordRefund(ctx, s.queriesFor(ctx), tenant.ID, event); err != nil {
			return nil, err
		}
	case paymentprovider.PurchaseCompleted:
		if event.Purchase.TenantID != tenant.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("checkout tenant does not match webhook path"))
		}
		if err := s.createPurchase(ctx, s.queriesFor(ctx), tenant.ID, event); err != nil {
			return nil, s.internalDBError(ctx, "failed to create purchase from a completed checkout", err, "event_id", event.ID, "checkout_id", event.CheckoutID)
		}
	}
	return connect.NewResponse(&publirav1.ProcessPaymentWebhookResponse{}), nil
}

func (s *apiServer) recordRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	event paymentprovider.Refunded,
) error {
	// An amount is only comparable to price_at_purchase when it arrives in the
	// currency the checkout charged, and a refund of nothing is not a refund.
	// Either way the purchase is recorded as refunded in full, which is what a
	// refund notification means when it says nothing more precise.
	var refundedAmount sql.NullInt32
	if event.Currency == "JPY" && event.AmountRefunded > 0 && event.AmountRefunded <= math.MaxInt32 {
		refundedAmount = sql.NullInt32{Int32: int32(event.AmountRefunded), Valid: true}
	} else {
		s.logger.WarnContext(ctx, "refund reported no comparable amount and is recorded as a full refund",
			"tenant_id", tenantID,
			"event_id", event.ID,
			"payment_id", event.PaymentID,
			"currency", event.Currency,
			"amount_refunded", event.AmountRefunded,
		)
	}

	purchase, err := queries.RecordStripeRefundOnPurchase(ctx, dbmodels.RecordStripeRefundOnPurchaseParams{
		TenantID:              tenantID,
		StripePaymentIntentID: event.PaymentID,
		RefundedAmount:        refundedAmount,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// The purchase may simply not exist yet: a provider need order neither
		// its notifications nor its retries, so a refund can overtake the one
		// that creates the sale. Holding it lets that notification apply it,
		// and a refund that belongs to no purchase of ours costs one row
		// instead of days of retries.
		if err := queries.HoldUnappliedStripeRefund(ctx, dbmodels.HoldUnappliedStripeRefundParams{
			TenantID:              tenantID,
			StripePaymentIntentID: event.PaymentID,
			RefundedAmount:        refundedAmount,
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
	s.logger.InfoContext(ctx, "recorded a refund on a purchase",
		"tenant_id", tenantID,
		"event_id", event.ID,
		"purchase_id", purchase.ID,
		"refunded_amount", purchase.RefundedAmount.Int32,
		"fully_refunded", purchase.RefundedAt.Valid,
	)
	return nil
}

func (s *apiServer) createPurchase(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	event paymentprovider.PurchaseCompleted,
) error {
	purchase := event.Purchase
	var paymentID sql.NullString
	if event.PaymentID != "" {
		paymentID = sql.NullString{String: event.PaymentID, Valid: true}
	}
	hasPurchase, err := queries.UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  tenantID,
		UserID:    purchase.ReaderID,
		EpisodeID: purchase.EpisodeID,
	})
	if err != nil {
		return fmt.Errorf("check existing purchase: %w", err)
	}
	if hasPurchase {
		// A prior delivery may have committed purchases before the projection
		// failed. Continue so the provider's retry repairs that derived event.
	} else {
		var expiresAt sql.NullTime
		if hours := purchase.ReadingPeriodHours; hours > 0 {
			now := time.Now().UTC()
			expiresAt = sql.NullTime{Time: now.AddDate(0, 0, int(hours/24)).Add(time.Duration(hours%24) * time.Hour), Valid: true}
		}
		_, err = queries.CreatePurchaseFromStripeCheckout(ctx, dbmodels.CreatePurchaseFromStripeCheckoutParams{
			ID:                      uuid.New(),
			TenantID:                tenantID,
			UserID:                  purchase.ReaderID,
			EpisodeID:               purchase.EpisodeID,
			PriceAtPurchase:         purchase.Price,
			ExpiresAt:               expiresAt,
			StripeCheckoutSessionID: sql.NullString{String: event.CheckoutID, Valid: true},
			StripePaymentIntentID:   paymentID,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("create purchase: %w", err)
		}
	}

	if paymentID.Valid {
		if err := s.applyHeldRefund(ctx, queries, tenantID, paymentID.String); err != nil {
			return err
		}
	}

	_, err = queries.ProjectPurchaseContentEvent(ctx, dbmodels.ProjectPurchaseContentEventParams{
		ID:                      uuid.Must(uuid.NewV7()),
		TenantID:                tenantID,
		StripeCheckoutSessionID: event.CheckoutID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("project purchase content event: %w", err)
	}
	return nil
}

// applyHeldRefund writes onto the purchase any refund that reached us before it
// existed. Ordinarily nothing is held and this costs one lookup.
func (s *apiServer) applyHeldRefund(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	paymentID string,
) error {
	purchase, err := queries.ApplyUnappliedStripeRefundToPurchase(ctx, dbmodels.ApplyUnappliedStripeRefundToPurchaseParams{
		TenantID:              tenantID,
		StripePaymentIntentID: paymentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("apply held refund: %w", err)
	}
	if err := queries.ReleaseUnappliedStripeRefund(ctx, dbmodels.ReleaseUnappliedStripeRefundParams{
		TenantID:              tenantID,
		StripePaymentIntentID: paymentID,
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

func paymentsNotConfiguredError() error {
	return connect.NewError(connect.CodeFailedPrecondition, errors.New("payments are not configured"))
}

func (s *apiServer) paymentStore(ctx context.Context) *paymentsettings.Store {
	return paymentsettings.New(s.queriesFor(ctx), s.encryptor, nil, s.logger)
}

// loadPaymentProvider answers the tenant's enabled payment provider with its
// credentials, or failed_precondition when the tenant cannot take payments.
func (s *apiServer) loadPaymentProvider(ctx context.Context, tenantID uuid.UUID) (paymentprovider.Provider, paymentprovider.Credentials, error) {
	config, secrets, err := s.paymentStore(ctx).LoadEnabledSecrets(ctx, tenantID)
	if err != nil {
		if paymentsettings.IsUnavailable(err) {
			s.logger.WarnContext(ctx, "tenant payment settings are unavailable",
				"tenant_id", tenantID,
			)
			return nil, nil, paymentsNotConfiguredError()
		}
		return nil, nil, s.internalDBError(ctx, "failed to load tenant payment settings", err, "tenant_id", tenantID.String())
	}
	provider, ok := s.paymentProviders.Lookup(config.Provider)
	if !ok {
		s.logger.WarnContext(ctx, "tenant payment provider is not registered",
			"tenant_id", tenantID,
			"provider", config.Provider,
		)
		return nil, nil, paymentsNotConfiguredError()
	}
	credentials := secrets.Credentials()
	if missing := provider.Declaration().Missing(credentials); len(missing) > 0 {
		s.logger.WarnContext(ctx, "tenant payment credentials are incomplete",
			"tenant_id", tenantID,
			"provider", config.Provider,
			"missing_fields", missing,
		)
		return nil, nil, paymentsNotConfiguredError()
	}
	return provider, credentials, nil
}
