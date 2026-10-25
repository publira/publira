package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/coinledger"
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

// coinsPath is the storefront page a checkout of a pack returns the reader to
// when it was started for no episode.
const coinsPath = "/my/coins"

var errCoinPacksNotSelling = errors.New("the tenant is not selling coin packs")

// coinPackTerms is what a purchase of a pack grants: the pack's coins and
// bonus coins and the tenant's expiry_days, as the reader was shown them when
// the checkout or the payment sheet opened.
type coinPackTerms struct {
	coins      int32
	bonusCoins int32
	expiryDays int32
}

// requireCoinPackSale answers the tenant's coins as a reader in locale sees
// them, or refuses a sale of a pack: while the tenant does not offer coins, as
// every coin RPC is, and while it has stopped selling packs, which leaves the
// coins readers hold to spend.
func (s *apiServer) requireCoinPackSale(ctx context.Context, tenantID uuid.UUID, locale string) (coinOffer, error) {
	offer, err := s.requireCoinOffer(ctx, tenantID, locale)
	if err != nil {
		return coinOffer{}, err
	}
	if !offer.settings.Selling {
		return coinOffer{}, connect.NewError(connect.CodeFailedPrecondition, errCoinPacksNotSelling.Error()).WithCause(errCoinPacksNotSelling)
	}
	// Coins cannot be turned on without an expiry, so this is a row written
	// past the constraint that requires one.
	if !offer.settings.ExpiryDays.Valid {
		return coinOffer{}, s.internalError(ctx, "the tenant offers coins with no expiry", errors.New("expiry_days is NULL"), "tenant_id", tenantID.String())
	}
	return offer, nil
}

// purchasableCoinPack reads the pack a request names, which has to be on sale.
func (s *apiServer) purchasableCoinPack(ctx context.Context, tenantID, packID uuid.UUID) (dbmodels.GetPurchasableCoinPackForTenantRow, error) {
	pack, err := s.queriesFor(ctx).GetPurchasableCoinPackForTenant(ctx, dbmodels.GetPurchasableCoinPackForTenantParams{
		TenantID: tenantID,
		ID:       packID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetPurchasableCoinPackForTenantRow{}, connect.NewError(connect.CodeNotFound, "coin pack not found")
	}
	if err != nil {
		return dbmodels.GetPurchasableCoinPackForTenantRow{}, s.internalDBError(ctx, "failed to get purchasable coin pack", err, "tenant_id", tenantID.String(), "coin_pack_id", packID.String())
	}
	return pack, nil
}

func (s *apiServer) StartCoinPackCheckout(
	ctx context.Context,
	req *publirav1.StartCoinPackCheckoutRequest,
) (*publirav1.StartCoinPackCheckoutResponse, error) {
	packID, err := requestRecordID("coin_pack_id", req.CoinPackId)
	if err != nil {
		return nil, err
	}
	var returnEpisodeID uuid.UUID
	if req.ReturnEpisodeId != "" {
		if returnEpisodeID, err = requestRecordID("return_episode_id", req.ReturnEpisodeId); err != nil {
			return nil, err
		}
	}
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB)
	if err != nil {
		return nil, err
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	offer, err := s.requireCoinPackSale(ctx, tenant.ID, readerLocale)
	if err != nil {
		return nil, err
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
	pack, err := s.purchasableCoinPack(ctx, tenant.ID, packID)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	returnPath := coinsPath
	if returnEpisodeID != uuid.Nil {
		episode, err := queries.GetCoinPackCheckoutReturnEpisode(ctx, dbmodels.GetCoinPackCheckoutReturnEpisodeParams{
			TenantID: tenant.ID,
			ID:       returnEpisodeID,
			Surface:  surface,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("return_episode_id names no episode the storefront shows"), "return_episode_id")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get the episode a coin pack checkout returns to", err, "tenant_id", tenant.ID.String(), "episode_id", returnEpisodeID.String())
		}
		returnPath, _ = url.JoinPath("/", "series", episode.SeriesPublicID, "episodes", episode.PublicID)
	}
	code, err := locale.Resolve(readerLocale)
	if err != nil {
		return nil, s.internalError(ctx, "reader locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}
	lineItemName, err := coinPackLineItemName(code, offer.name, pack.Coins, pack.BonusCoins)
	if err != nil {
		return nil, s.internalError(ctx, "failed to name the coin pack line item", err, "tenant_id", tenant.ID.String(), "coin_pack_id", pack.ID.String())
	}
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:       tenant.ID,
			ReaderID:       user.ID,
			CoinPackID:     pack.ID,
			Coins:          pack.Coins,
			BonusCoins:     pack.BonusCoins,
			CoinExpiryDays: offer.settings.ExpiryDays.Int32,
			Kind:           paymentprovider.KindPurchase,
			Price:          pack.Price,
			Currency:       config.Currency,
		},
		LineItemName: lineItemName,
		SuccessURL:   coinPackReturnURL(origin, returnPath, pack.PublicID, "success"),
		CancelURL:    coinPackReturnURL(origin, returnPath, pack.PublicID, "cancelled"),
	}
	expiredCheckoutID, err := queries.GetExpiredCoinPackCheckoutID(ctx, dbmodels.GetExpiredCoinPackCheckoutIDParams{
		TenantID:   tenant.ID,
		UserID:     user.ID,
		CoinPackID: pack.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's expired coin pack checkout", err, "tenant_id", tenant.ID.String(), "coin_pack_id", pack.ID.String())
	}
	paidCheckoutID, err := queries.GetLastPaidCoinPackCheckoutID(ctx, dbmodels.GetLastPaidCoinPackCheckoutIDParams{
		TenantID:   tenant.ID,
		UserID:     user.ID,
		CoinPackID: pack.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's last paid coin pack checkout", err, "tenant_id", tenant.ID.String(), "coin_pack_id", pack.ID.String())
	}
	checkout.IdempotencyKey, err = checkoutIdempotencyKey(checkout, expiredCheckoutID, paidCheckoutID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the checkout idempotency key", err, "tenant_id", tenant.ID.String(), "coin_pack_id", pack.ID.String())
	}
	checkoutURL, err := provider.StartCheckout(ctx, credentials, checkout)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "provider", provider.Declaration().ID, "coin_pack_id", pack.ID.String())
		return nil, connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	return &publirav1.StartCoinPackCheckoutResponse{CheckoutUrl: checkoutURL}, nil
}

// coinPackLineItemName is what the checkout of a pack calls the sale: the
// coins it grants, under the tenant's word for them, in the reader's locale,
// and the bonus coins among them when it grants any.
func coinPackLineItemName(code, coinName string, coins, bonusCoins int32) (string, error) {
	if bonusCoins == 0 {
		return locale.Message(code, "checkout.coin_pack_line_item", map[string]any{
			"count":     int(coins),
			"coin_name": coinName,
		})
	}
	return locale.Message(code, "checkout.coin_pack_line_item_bonus", map[string]any{
		"count":     int(coins) + int(bonusCoins),
		"bonus":     int(bonusCoins),
		"coin_name": coinName,
	})
}

// coinPackReturnURL is where the storefront takes the reader back to after a
// checkout of a pack: path, the episode they were short of coins for or the
// coins page, naming the pack bought.
func coinPackReturnURL(base *url.URL, path, packPublicID, checkout string) string {
	result := *base
	result.Path = path
	query := result.Query()
	query.Set("checkout", checkout)
	query.Set("coin_pack", packPublicID)
	result.RawQuery = query.Encode()
	return result.String()
}

// startStoreCoinPackPurchase opens the reader's intent to buy a pack through
// the store, on the terms it is sold on now.
func (s *apiServer) startStoreCoinPackPurchase(ctx context.Context, tenantID, userID, packID uuid.UUID) (*publirav1.StartStorePurchaseResponse, error) {
	// The intent names no coin, so the coin's name in any locale serves.
	offer, err := s.requireCoinPackSale(ctx, tenantID, "")
	if err != nil {
		return nil, err
	}
	pack, err := s.purchasableCoinPack(ctx, tenantID, packID)
	if err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	currency, err := s.tenantCurrency(ctx, queries, tenantID)
	if err != nil {
		return nil, err
	}
	intent, err := queries.OpenStoreCoinPackPurchaseIntent(ctx, dbmodels.OpenStoreCoinPackPurchaseIntentParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       tenantID,
		UserID:         userID,
		CoinPackID:     pack.ID,
		Price:          pack.Price,
		ProductID:      storeproduct.CoinPackProductID(pack.PublicID),
		Currency:       currency,
		Coins:          pack.Coins,
		BonusCoins:     pack.BonusCoins,
		CoinExpiryDays: offer.settings.ExpiryDays.Int32,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to open a store purchase intent for a coin pack", err, "tenant_id", tenantID.String(), "coin_pack_id", pack.ID.String())
	}
	return noStorePrivateResponse(ctx, &publirav1.StartStorePurchaseResponse{
		IntentId:  intent.ID.String(),
		ProductId: intent.ProductID,
	}), nil
}

// recordCoinPackSale writes down what a purchase of a pack just recorded
// bought and grants its coins, in the transaction that recorded it: the pack
// as the reader was shown it, the pack's first sale, which fixes its terms
// from then on, and the grant, which expires terms.expiryDays after the
// purchase.
func recordCoinPackSale(ctx context.Context, queries *dbmodels.Queries, purchase dbmodels.Purchase, terms coinPackTerms) error {
	if err := queries.CreateCoinPackPurchase(ctx, dbmodels.CreateCoinPackPurchaseParams{
		TenantID:   purchase.TenantID,
		PurchaseID: purchase.ID,
		Coins:      terms.coins,
		BonusCoins: terms.bonusCoins,
	}); err != nil {
		return fmt.Errorf("record the pack a purchase bought: %w", err)
	}
	if err := queries.MarkCoinPackSold(ctx, dbmodels.MarkCoinPackSoldParams{
		TenantID: purchase.TenantID,
		ID:       purchase.CoinPackID.UUID,
	}); err != nil {
		return fmt.Errorf("record the first sale of a coin pack: %w", err)
	}
	if _, err := coinledger.GrantPack(ctx, queries, coinledger.Grant{
		TenantID:   purchase.TenantID,
		UserID:     purchase.UserID.UUID,
		PurchaseID: purchase.ID,
		Coins:      terms.coins + terms.bonusCoins,
		ExpiresAt:  coinledger.ExpiresAt(purchase.PurchasedAt, terms.expiryDays),
	}); err != nil {
		return fmt.Errorf("grant the coins of a pack purchase: %w", err)
	}
	return nil
}
