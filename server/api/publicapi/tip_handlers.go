package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"slices"
	"strconv"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storeproduct"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// tenantTipAmounts answers the amounts the tenant takes tips in, empty while
// it takes none.
func (s *apiServer) tenantTipAmounts(ctx context.Context, tenantID uuid.UUID) ([]int32, error) {
	amounts, err := s.queriesFor(ctx).GetTenantTipAmounts(ctx, tenantID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the tenant's tip amounts", err, "tenant_id", tenantID.String())
	}
	return amounts, nil
}

// tippableEpisode answers the episode a reader asks to tip the Authors of, once
// the tenant takes tips in amount, the calling surface lists the episode as
// published, and the reader is not one of its Authors.
func (s *apiServer) tippableEpisode(
	ctx context.Context,
	tenantID, userID, episodeID uuid.UUID,
	amount int32,
	surface, readerLocale string,
) (dbmodels.GetTippableEpisodeForTenantRow, error) {
	amounts, err := s.tenantTipAmounts(ctx, tenantID)
	if err != nil {
		return dbmodels.GetTippableEpisodeForTenantRow{}, err
	}
	if len(amounts) == 0 {
		return dbmodels.GetTippableEpisodeForTenantRow{}, connect.NewError(connect.CodeFailedPrecondition, "the tenant takes no tips")
	}
	if !slices.Contains(amounts, amount) {
		return dbmodels.GetTippableEpisodeForTenantRow{}, rpcerrors.NewFieldViolationError(connect.CodeFailedPrecondition,
			errors.New("amount is not one of the tenant's tip amounts"), "amount")
	}
	episode, err := s.queriesFor(ctx).GetTippableEpisodeForTenant(ctx, dbmodels.GetTippableEpisodeForTenantParams{
		TenantID: tenantID,
		ID:       episodeID,
		Surface:  surface,
		Locale:   readerLocale,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetTippableEpisodeForTenantRow{}, connect.NewError(connect.CodeFailedPrecondition, "episode is not published")
	}
	if err != nil {
		return dbmodels.GetTippableEpisodeForTenantRow{}, s.internalDBError(ctx, "failed to get the episode to tip", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	if err := s.refuseCreditedReader(ctx, tenantID, userID, episode.ID); err != nil {
		return dbmodels.GetTippableEpisodeForTenantRow{}, err
	}
	return episode, nil
}

func (s *apiServer) StartTipCheckout(
	ctx context.Context,
	req *publirav1.StartTipCheckoutRequest,
) (*publirav1.StartTipCheckoutResponse, error) {
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
	// A tip asks the tenant's provider for a checkout as a purchase does, so it
	// spends the same allowance.
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
		s.logger.WarnContext(ctx, "tip checkout refused because tenant domain is not configured", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the tenant site origin", err, "tenant_id", tenant.ID.String())
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	episode, err := s.tippableEpisode(ctx, tenant.ID, user.ID, episodeID, req.Amount, surface, readerLocale)
	if err != nil {
		return nil, err
	}
	provider, checkoutCurrency, credentials, err := s.loadCheckoutProvider(ctx, tenant.ID, req.Provider)
	if err != nil {
		return nil, err
	}

	code, err := locale.Resolve(readerLocale)
	if err != nil {
		return nil, s.internalError(ctx, "reader locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}
	lineItemName, err := locale.Message(code, "checkout.tip_line_item", map[string]any{"episode_title": episode.Title})
	if err != nil {
		return nil, s.internalError(ctx, "failed to name the tip line item", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	amount := strconv.FormatInt(int64(req.Amount), 10)
	successURL := tipReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "success")
	cancelURL := tipReturnURL(origin, episode.SeriesPublicID, episode.PublicID, "cancelled")
	if req.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		appLocale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		successURL = mobileTipReturnURL(origin, appLocale, episode.PublicID, amount, "success")
		cancelURL = mobileTipReturnURL(origin, appLocale, episode.PublicID, amount, "cancelled")
	}
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:  tenant.ID,
			ReaderID:  user.ID,
			EpisodeID: episode.ID,
			Kind:      paymentprovider.KindTip,
			Price:     req.Amount,
			Currency:  checkoutCurrency,
		},
		LineItemName: lineItemName,
		SuccessURL:   successURL,
		CancelURL:    cancelURL,
	}
	// A tip is keyed by the episode's checkouts as a purchase of it is, so a
	// tip just paid, or one let expire, starts the next tip afresh, while a
	// tip of the same amount asked for again reuses the checkout still open.
	queries := s.queriesFor(ctx)
	expiredCheckoutID, err := queries.GetExpiredCheckoutID(ctx, dbmodels.GetExpiredCheckoutIDParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's expired checkout", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	paidCheckoutID, err := queries.GetLastPaidCheckoutID(ctx, dbmodels.GetLastPaidCheckoutIDParams{
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
	checkoutURL, err := s.startCheckout(ctx, provider, credentials, checkout, "failed to start a tip checkout with the payment provider", "episode_id", episode.ID.String())
	if err != nil {
		return nil, err
	}
	return &publirav1.StartTipCheckoutResponse{CheckoutUrl: checkoutURL}, nil
}

// tipReturnURL is where the storefront takes the reader back to after a
// checkout of a tip: the episode they tipped, with how the checkout ended.
func tipReturnURL(base *url.URL, seriesPublicID, episodePublicID, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", "series", seriesPublicID, "episodes", episodePublicID)
	query := result.Query()
	query.Set("tip", status)
	result.RawQuery = query.Encode()
	return result.String()
}

// mobileTipReturnURL is the app's return link after a checkout of a tip, which
// names the episode and the amount given.
func mobileTipReturnURL(base *url.URL, locale, episodePublicID, amount, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", locale, "checkout", "return")
	query := result.Query()
	query.Set("episode", episodePublicID)
	query.Set("tip", amount)
	query.Set("status", status)
	result.RawQuery = query.Encode()
	return result.String()
}

func (s *apiServer) StartStoreTip(
	ctx context.Context,
	req *publirav1.StartStoreTipRequest,
) (*publirav1.StartStoreTipResponse, error) {
	episodeID, err := requestRecordID("episode_id", req.EpisodeId)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_APP)
	if err != nil {
		return nil, err
	}
	store := req.Store
	if store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE && store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY {
		return nil, connect.NewError(connect.CodeInvalidArgument, "store is required")
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	// An intent is written again on every start, as a purchase's is, so a tip
	// spends the allowance a store purchase does.
	if err := s.chargeReaderAction(ctx, actionStartPurchaseCheckout, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	if err := s.requireStoreSelling(ctx, tenant.ID, store); err != nil {
		return nil, err
	}
	episode, err := s.tippableEpisode(ctx, tenant.ID, user.ID, episodeID, req.Amount, surface, tenant.DefaultLocale)
	if err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	currency, err := s.tenantCurrency(ctx, queries, tenant.ID)
	if err != nil {
		return nil, err
	}
	intent, err := queries.OpenStoreTipIntent(ctx, dbmodels.OpenStoreTipIntentParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
		Price:     req.Amount,
		ProductID: storeproduct.TipProductID(req.Amount),
		Currency:  currency,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to open a store tip intent", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	return noStorePrivateResponse(ctx, &publirav1.StartStoreTipResponse{
		IntentId:  intent.ID.String(),
		ProductId: intent.ProductID,
	}), nil
}
