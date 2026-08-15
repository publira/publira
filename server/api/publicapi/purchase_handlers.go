package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	stripeMetadataTenantID           = "tenant_id"
	stripeMetadataUserID             = "user_id"
	stripeMetadataEpisodeID          = "episode_id"
	stripeMetadataPrice              = "price"
	stripeMetadataReadingPeriodHours = "reading_period_hours"

	defaultPurchasePageSize = int32(20)
	maxPurchasePageSize     = int32(100)
)

type stripeCheckoutProvider struct {
	client *stripe.Client
}

func newStripeCheckoutProvider(secretKey string) *stripeCheckoutProvider {
	if strings.TrimSpace(secretKey) == "" {
		return nil
	}
	return &stripeCheckoutProvider{client: stripe.NewClient(secretKey)}
}

func parseWebHostURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("PUBLIRA_WEB_HOST_URL is not set")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("PUBLIRA_WEB_HOST_URL must be an absolute URL")
	}
	return parsed, nil
}

func (s *apiServer) StartEpisodeCheckout(
	ctx context.Context,
	req *connect.Request[publirav1.StartEpisodeCheckoutRequest],
) (*connect.Response[publirav1.StartEpisodeCheckoutResponse], error) {
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	if s.stripe == nil || s.webHostURL == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("payments are not configured"))
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeByPublicIDForTenant(ctx, dbmodels.GetPurchasableEpisodeByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: episodePublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError("failed to get purchasable episode", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if episode.Price <= 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("free episodes do not require checkout"))
	}

	hasPurchase, err := s.queriesFor(ctx).UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return nil, s.internalDBError("failed to check purchase status", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if hasPurchase {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("episode is already purchased"))
	}

	successURL := purchaseReturnURL(s.webHostURL, tenant.PublicID, episode.SeriesPublicID, episode.PublicID, "success")
	cancelURL := purchaseReturnURL(s.webHostURL, tenant.PublicID, episode.SeriesPublicID, episode.PublicID, "cancelled")
	checkoutURL, err := s.stripe.create(ctx, stripeCheckoutInput{
		cancelURL:          cancelURL,
		episodeID:          episode.ID,
		episodeTitle:       episode.Title,
		idempotencyKey:     fmt.Sprintf("episode-checkout:%s:%s:%s", tenant.ID, user.ID, episode.ID),
		price:              episode.Price,
		readingPeriodHours: episode.ReadingPeriodHours,
		successURL:         successURL,
		tenantID:           tenant.ID,
		userID:             user.ID,
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to create Stripe Checkout session", "error", err, "tenant_id", tenant.ID, "episode_public_id", episodePublicID)
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("failed to start checkout"))
	}
	return connect.NewResponse(&publirav1.StartEpisodeCheckoutResponse{CheckoutUrl: checkoutURL}), nil
}

type purchasePageRow struct {
	id                uuid.UUID
	priceAtPurchase   int32
	expiresAt         sql.NullTime
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
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]purchasePageRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyPurchasesDescParams{
		TenantID:          tenantID,
		UserID:            userID,
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
	isActive := true
	if row.expiresAt.Valid {
		expiresAt = row.expiresAt.Time.UTC().Format(time.RFC3339)
		isActive = row.expiresAt.Time.After(now)
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

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultPurchasePageSize, maxPurchasePageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
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

	rows, err := s.purchasePage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError("failed to list purchases", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
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

	return connect.NewResponse(res), nil
}

type stripeCheckoutInput struct {
	cancelURL          string
	episodeID          uuid.UUID
	episodeTitle       string
	idempotencyKey     string
	price              int32
	readingPeriodHours sql.NullInt32
	successURL         string
	tenantID           uuid.UUID
	userID             uuid.UUID
}

func (p *stripeCheckoutProvider) create(ctx context.Context, input stripeCheckoutInput) (string, error) {
	metadata := map[string]string{
		stripeMetadataTenantID:  input.tenantID.String(),
		stripeMetadataUserID:    input.userID.String(),
		stripeMetadataEpisodeID: input.episodeID.String(),
		stripeMetadataPrice:     strconv.FormatInt(int64(input.price), 10),
	}
	if input.readingPeriodHours.Valid {
		metadata[stripeMetadataReadingPeriodHours] = strconv.FormatInt(int64(input.readingPeriodHours.Int32), 10)
	}
	params := &stripe.CheckoutSessionCreateParams{
		CancelURL: stripe.String(input.cancelURL),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{
			PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
				Currency: stripe.String(string(stripe.CurrencyJPY)),
				ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name: stripe.String(input.episodeTitle),
				},
				UnitAmount: stripe.Int64(int64(input.price)),
			},
			Quantity: stripe.Int64(1),
		}},
		Metadata:   metadata,
		Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL: stripe.String(input.successURL),
	}
	params.SetIdempotencyKey(input.idempotencyKey)
	session, err := p.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(session.URL) == "" {
		return "", errors.New("stripe returned an empty Checkout URL")
	}
	return session.URL, nil
}

func purchaseReturnURL(base *url.URL, tenantPublicID, seriesPublicID, episodePublicID, checkout string) string {
	result := *base
	result.Path, _ = url.JoinPath(result.Path, tenantPublicID, "series", seriesPublicID, "episodes", episodePublicID)
	query := result.Query()
	query.Set("checkout", checkout)
	if checkout == "success" {
		query.Set("session_id", "{CHECKOUT_SESSION_ID}")
	}
	result.RawQuery = query.Encode()
	return result.String()
}

func (s *apiServer) ProcessStripeWebhook(
	ctx context.Context,
	req *connect.Request[publirav1.ProcessStripeWebhookRequest],
) (*connect.Response[publirav1.ProcessStripeWebhookResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	webhookSecret := strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET"))
	if webhookSecret == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("stripe webhook is not configured"))
	}
	if len(req.Msg.Payload) == 0 || len(req.Msg.Payload) > 64<<10 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid Stripe webhook payload"))
	}
	event, err := webhook.ConstructEvent(req.Msg.Payload, req.Msg.StripeSignature, webhookSecret)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid Stripe signature"))
	}
	if event.Type != stripe.EventTypeCheckoutSessionCompleted && event.Type != stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded {
		return connect.NewResponse(&publirav1.ProcessStripeWebhookResponse{}), nil
	}
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid Stripe Checkout event"))
	}
	metadataTenantID, _, _, _, _, err := stripePurchaseMetadata(&session)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid Stripe Checkout metadata"))
	}
	if metadataTenantID != tenant.ID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("stripe Checkout tenant does not match webhook path"))
	}
	if err := s.createPurchaseFromStripeSession(ctx, s.queriesFor(ctx), tenant.ID, &session); err != nil {
		return nil, s.internalDBError("failed to create purchase from Stripe Checkout", err, "event_id", event.ID, "checkout_session_id", session.ID)
	}
	return connect.NewResponse(&publirav1.ProcessStripeWebhookResponse{}), nil
}

func (s *apiServer) createPurchaseFromStripeSession(
	ctx context.Context,
	queries Querier,
	expectedTenantID uuid.UUID,
	session *stripe.CheckoutSession,
) error {
	if session.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid || session.Currency != stripe.CurrencyJPY {
		return errors.New("checkout session was not paid in JPY")
	}
	metadataTenantID, userID, episodeID, price, readingPeriodHours, err := stripePurchaseMetadata(session)
	if err != nil {
		return err
	}
	if metadataTenantID != expectedTenantID {
		return errors.New("stripe Checkout tenant does not match webhook path")
	}
	if session.AmountTotal != int64(price) || strings.TrimSpace(session.ID) == "" {
		return errors.New("checkout session amount or ID is invalid")
	}
	hasPurchase, err := queries.UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  expectedTenantID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if err != nil {
		return err
	}
	if hasPurchase {
		return nil
	}
	var expiresAt sql.NullTime
	if readingPeriodHours > 0 {
		now := time.Now().UTC()
		expiresAt = sql.NullTime{Time: now.AddDate(0, 0, int(readingPeriodHours/24)).Add(time.Duration(readingPeriodHours%24) * time.Hour), Valid: true}
	}
	_, err = queries.CreatePurchaseFromStripeCheckout(ctx, dbmodels.CreatePurchaseFromStripeCheckoutParams{
		ID:                      uuid.New(),
		TenantID:                expectedTenantID,
		UserID:                  userID,
		EpisodeID:               episodeID,
		PriceAtPurchase:         price,
		ExpiresAt:               expiresAt,
		StripeCheckoutSessionID: sql.NullString{String: session.ID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func stripePurchaseMetadata(session *stripe.CheckoutSession) (uuid.UUID, uuid.UUID, uuid.UUID, int32, int32, error) {
	parseID := func(key string) (uuid.UUID, error) {
		id, err := uuid.Parse(session.Metadata[key])
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid %s metadata: %w", key, err)
		}
		return id, nil
	}
	tenantID, err := parseID(stripeMetadataTenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, 0, 0, err
	}
	userID, err := parseID(stripeMetadataUserID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, 0, 0, err
	}
	episodeID, err := parseID(stripeMetadataEpisodeID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, 0, 0, err
	}
	price, err := strconv.ParseInt(session.Metadata[stripeMetadataPrice], 10, 32)
	if err != nil || price <= 0 {
		return uuid.Nil, uuid.Nil, uuid.Nil, 0, 0, errors.New("invalid price metadata")
	}
	readingPeriodHours := int64(0)
	if value, ok := session.Metadata[stripeMetadataReadingPeriodHours]; ok {
		readingPeriodHours, err = strconv.ParseInt(value, 10, 32)
		if err != nil || readingPeriodHours < 0 {
			return uuid.Nil, uuid.Nil, uuid.Nil, 0, 0, errors.New("invalid reading period metadata")
		}
	}
	return tenantID, userID, episodeID, int32(price), int32(readingPeriodHours), nil
}
