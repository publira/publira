package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/promotioncode"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// promotionCodeOf reads the code a request carries, leaving out the spaces a
// reader pasting it may bring along. Empty is no code.
func promotionCodeOf(raw string) string {
	return strings.TrimSpace(raw)
}

// chargePromotionCodeAttempt spends the reader's allowance for promotion code
// lookups when the request carries a code, before anything reads it, so a
// reader past the limit learns nothing about the code they sent.
func (s *apiServer) chargePromotionCodeAttempt(ctx context.Context, tenantID, userID uuid.UUID, code string) error {
	if code == "" {
		return nil
	}
	return s.chargeReaderAction(ctx, actionPreviewPromotionCode, tenantID, userID)
}

// promotionSale is the sale a code is applied to: the purchase or the rental
// of an episode, or the purchase of a volume, at the price in force.
type promotionSale struct {
	episodeID uuid.UUID
	volumeID  uuid.UUID
	price     int32
}

// appliedPromotionCode is a code applied to one sale. Its zero value is no
// code, which leaves a checkout as it was.
type appliedPromotionCode struct {
	id        uuid.UUID
	listPrice int32
	// discountAmount is what the code takes off listPrice, and price what is
	// left.
	discountAmount int32
	price          int32
}

// discount writes the code onto a checkout: the provider charges the
// discounted price, the purchase it confirms records the price before it and
// the code, and the provider's own code input is closed, so a reader never
// takes two discounts. No code leaves the checkout, and so its idempotency
// key, as it was.
func (a appliedPromotionCode) discount(checkout *paymentprovider.CheckoutRequest) {
	if a.id == uuid.Nil {
		return
	}
	checkout.Purchase.Price = a.price
	checkout.Purchase.ListPrice = a.listPrice
	checkout.Purchase.PromotionCodeID = a.id
	checkout.DisallowProviderCodes = true
}

// promotionCodeRefusalError answers a code that cannot be applied, with the
// reason a client tells the reader.
func promotionCodeRefusalError(refusal promotioncode.Refusal) error {
	reason := map[promotioncode.Refusal]string{
		promotioncode.Invalid:         rpcerrors.ReasonPromotionCodeInvalid,
		promotioncode.Expired:         rpcerrors.ReasonPromotionCodeExpired,
		promotioncode.NotApplicable:   rpcerrors.ReasonPromotionCodeNotApplicable,
		promotioncode.Exhausted:       rpcerrors.ReasonPromotionCodeExhausted,
		promotioncode.AlreadyRedeemed: rpcerrors.ReasonPromotionCodeAlreadyRedeemed,
	}[refusal]
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, fmt.Errorf("%w: %s", promotioncode.ErrRefused, reason), reason)
}

// noStoreProductError refuses a code whose discounted price the tenant's store
// sells no product at.
func noStoreProductError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition,
		fmt.Errorf("%w: the store sells no product at the discounted price", promotioncode.ErrRefused),
		rpcerrors.ReasonPromotionCodeNoStoreProduct)
}

// applyPromotionCode reads code on q and applies it to sale for the reader,
// or refuses it. The reader's allowance has been charged by then.
func (s *apiServer) applyPromotionCode(ctx context.Context, q Querier, tenantID, userID uuid.UUID, code string, sale promotionSale) (appliedPromotionCode, error) {
	// A code promotion_codes could not hold is answered as one it does not
	// hold, without asking.
	if !promotioncode.ValidCode(code) {
		return appliedPromotionCode{}, promotionCodeRefusalError(promotioncode.Invalid)
	}
	row, err := q.GetPromotionCodeByCode(ctx, dbmodels.GetPromotionCodeByCodeParams{
		TenantID:  tenantID,
		Code:      code,
		UserID:    userID,
		EpisodeID: uuid.NullUUID{UUID: sale.episodeID, Valid: sale.episodeID != uuid.Nil},
		VolumeID:  uuid.NullUUID{UUID: sale.volumeID, Valid: sale.volumeID != uuid.Nil},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return appliedPromotionCode{}, promotionCodeRefusalError(promotioncode.Invalid)
	}
	if err != nil {
		return appliedPromotionCode{}, s.internalDBError(ctx, "failed to read a promotion code", err, "tenant_id", tenantID.String())
	}
	if refusal := promotioncode.Check(promotioncode.State{
		StartsAt:                row.StartsAt,
		EndsAt:                  row.EndsAt,
		PausedAt:                row.PausedAt,
		MaxRedemptions:          row.MaxRedemptions,
		MaxRedemptionsPerReader: row.MaxRedemptionsPerReader,
		RedemptionCount:         row.RedemptionCount,
		ReaderRedemptionCount:   row.ReaderRedemptionCount,
		Applies:                 row.Applies,
	}, time.Now()); refusal != promotioncode.Applicable {
		return appliedPromotionCode{}, promotionCodeRefusalError(refusal)
	}
	discountAmount, price := promotioncode.Discount(row.DiscountKind, row.DiscountValue, sale.price)
	return appliedPromotionCode{
		id:             row.ID,
		listPrice:      sale.price,
		discountAmount: discountAmount,
		price:          price,
	}, nil
}

// episodeSale is an episode a reader may buy now, and the price and reading
// period of the sale they asked for.
type episodeSale struct {
	episode            dbmodels.GetPurchasableEpisodeForTenantRow
	price              int32
	readingPeriodHours int32
}

// resolveEpisodeSale answers the sale of kind of an episode surface sells to
// the reader, or refuses it as a checkout of it is refused.
func (s *apiServer) resolveEpisodeSale(ctx context.Context, tenantID, userID, episodeID uuid.UUID, surface string, kind paymentprovider.Kind, locale string) (episodeSale, error) {
	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeForTenant(ctx, dbmodels.GetPurchasableEpisodeForTenantParams{
		TenantID: tenantID,
		ID:       episodeID,
		Surface:  surface,
		Locale:   locale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return episodeSale{}, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return episodeSale{}, s.internalDBError(ctx, "failed to get purchasable episode", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	if episode.Price <= 0 {
		return episodeSale{}, connect.NewError(connect.CodeFailedPrecondition, "free episodes do not require checkout")
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
			return episodeSale{}, connect.NewError(connect.CodeFailedPrecondition, "episode is not rented")
		}
		price, readingPeriodHours = episode.RentalPrice.Int32, episode.RentalPeriodHours.Int32
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return episodeSale{}, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenantID.String(), "episode_id", episode.ID.String())
	}
	if !soldHere {
		return episodeSale{}, connect.NewError(connect.CodeFailedPrecondition, "episode is not sold on this surface")
	}
	if err := s.refuseCreditedReader(ctx, tenantID, userID, episode.ID); err != nil {
		return episodeSale{}, err
	}
	if err := s.refuseHeldEpisode(ctx, s.queriesFor(ctx), tenantID, userID, episode.ID, kind); err != nil {
		return episodeSale{}, err
	}
	return episodeSale{episode: episode, price: price, readingPeriodHours: readingPeriodHours}, nil
}

// refuseHeldEpisode answers already_exists for a sale of kind the reader has
// nothing left to buy of: a reader who holds the permanent copy has nothing
// left to buy, while one who holds a rental may still buy the permanent copy.
func (s *apiServer) refuseHeldEpisode(ctx context.Context, q Querier, tenantID, userID, episodeID uuid.UUID, kind paymentprovider.Kind) error {
	held, err := q.GetActiveEpisodePurchaseKinds(ctx, dbmodels.GetActiveEpisodePurchaseKindsParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to check purchase status", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	if held.HoldsPurchase {
		return connect.NewError(connect.CodeAlreadyExists, "episode is already purchased")
	}
	if kind == paymentprovider.KindRental && held.HoldsRental {
		return connect.NewError(connect.CodeAlreadyExists, "episode is already rented")
	}
	return nil
}

// resolveVolumeSale answers a volume surface sells to the reader, or refuses
// it as a checkout of it is refused.
func (s *apiServer) resolveVolumeSale(ctx context.Context, tenantID, userID, volumeID uuid.UUID, surface string) (dbmodels.GetPurchasableVolumeForTenantRow, error) {
	queries := s.queriesFor(ctx)
	volume, err := queries.GetPurchasableVolumeForTenant(ctx, dbmodels.GetPurchasableVolumeForTenantParams{
		TenantID: tenantID,
		ID:       volumeID,
		Surface:  surface,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return volume, connect.NewError(connect.CodeNotFound, "volume not found")
		}
		return volume, s.internalDBError(ctx, "failed to get purchasable volume", err, "tenant_id", tenantID.String(), "volume_id", volumeID.String())
	}
	credited, err := queries.ReaderIsCreditedOnVolume(ctx, dbmodels.ReaderIsCreditedOnVolumeParams{
		TenantID: tenantID,
		VolumeID: volume.ID,
		UserID:   userID,
	})
	if err != nil {
		return volume, s.internalDBError(ctx, "failed to check the reader's credits on the volume", err, "tenant_id", tenantID.String(), "volume_id", volume.ID.String())
	}
	if credited {
		return volume, readerCreditedOnEpisodeError()
	}
	if err := s.refuseHeldVolume(ctx, queries, tenantID, userID, volume.ID); err != nil {
		return volume, err
	}
	return volume, nil
}

// refuseHeldVolume answers already_exists for a volume the reader holds a
// purchase of that still opens it.
func (s *apiServer) refuseHeldVolume(ctx context.Context, q Querier, tenantID, userID, volumeID uuid.UUID) error {
	held, err := q.HoldsStandingVolumePurchase(ctx, dbmodels.HoldsStandingVolumePurchaseParams{
		TenantID: tenantID,
		UserID:   userID,
		VolumeID: volumeID,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to check volume purchase status", err, "tenant_id", tenantID.String(), "volume_id", volumeID.String())
	}
	if held {
		return connect.NewError(connect.CodeAlreadyExists, "volume is already purchased")
	}
	return nil
}

// resolveStoreEpisodeSale answers the permanent copy of an episode the app
// sells to the reader through the store, at the price in force, or refuses it
// as StartStorePurchase refuses it.
func (s *apiServer) resolveStoreEpisodeSale(ctx context.Context, tenantID, userID, episodeID uuid.UUID) (episodeSale, error) {
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_APP)
	if err != nil {
		return episodeSale{}, err
	}
	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeForTenant(ctx, dbmodels.GetPurchasableEpisodeForTenantParams{
		TenantID: tenantID,
		ID:       episodeID,
		Surface:  surface,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return episodeSale{}, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return episodeSale{}, s.internalDBError(ctx, "failed to get purchasable episode", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	if episode.Price <= 0 {
		return episodeSale{}, connect.NewError(connect.CodeFailedPrecondition, "free episodes are not sold")
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return episodeSale{}, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenantID.String(), "episode_id", episode.ID.String())
	}
	if !soldHere {
		return episodeSale{}, connect.NewError(connect.CodeFailedPrecondition, "episode is not sold in the app")
	}
	if err := s.refuseCreditedReader(ctx, tenantID, userID, episode.ID); err != nil {
		return episodeSale{}, err
	}
	// A store sells the permanent copy alone, which an active rental does not
	// stand in the way of.
	if err := s.refuseHeldEpisode(ctx, s.queriesFor(ctx), tenantID, userID, episode.ID, paymentprovider.KindPurchase); err != nil {
		return episodeSale{}, err
	}
	// The campaign open now sets the price, as it does at the web checkout.
	price := episode.Price
	if episode.CampaignPrice.Valid {
		price = episode.CampaignPrice.Int32
	}
	return episodeSale{episode: episode, price: price, readingPeriodHours: episode.ReadingPeriodHours.Int32}, nil
}

// requireStoreProduct refuses a discounted price the tenant's store sells no
// product at: one ListTenantStoreProducts does not list, which is every
// product the tenant was told to create. The store would charge no other
// price, so the code cannot be applied in the app.
func (s *apiServer) requireStoreProduct(ctx context.Context, tenantID uuid.UUID, price int32) error {
	rows, err := s.queriesFor(ctx).ListTenantStoreProductPrices(ctx, tenantID)
	if err != nil {
		return s.internalDBError(ctx, "failed to list the tenant's store product prices", err, "tenant_id", tenantID.String())
	}
	if !slices.ContainsFunc(rows, func(row dbmodels.ListTenantStoreProductPricesRow) bool { return row.Price == price }) {
		return noStoreProductError()
	}
	return nil
}

// grantedSale is a sale a code took the whole price off, which is recorded
// at once rather than sent to a provider or a store.
type grantedSale struct {
	episodeID          uuid.UUID
	volumeID           uuid.UUID
	kind               paymentprovider.Kind
	listPrice          int32
	readingPeriodHours int32
	currency           string
}

// grantPurchaseWithPromotionCode records the purchase of a sale code takes the
// whole price off, with its redemption, in one transaction. The code's
// redemptions are serialized for the transaction, and the code and the
// reader's holdings are checked again under that lock, so two requests sent
// at once grant one purchase and never take a code past its limits. Nothing
// is paid, so no provider or store is asked, and the purchase names neither.
func (s *apiServer) grantPurchaseWithPromotionCode(ctx context.Context, tenantID, userID uuid.UUID, code string, sale grantedSale) (dbmodels.Purchase, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to begin the promotion code grant", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	applied, err := s.applyPromotionCode(ctx, txq, tenantID, userID, code, promotionSale{episodeID: sale.episodeID, volumeID: sale.volumeID, price: sale.listPrice})
	if err != nil {
		return dbmodels.Purchase{}, err
	}
	if err := txq.LockPromotionCodeRedemptions(ctx, dbmodels.LockPromotionCodeRedemptionsParams{TenantID: tenantID, ID: applied.id}); err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to lock a promotion code's redemptions", err, "tenant_id", tenantID.String())
	}
	// Read again under the lock, which a concurrent grant held until it
	// committed its redemption.
	if applied, err = s.applyPromotionCode(ctx, txq, tenantID, userID, code, promotionSale{episodeID: sale.episodeID, volumeID: sale.volumeID, price: sale.listPrice}); err != nil {
		return dbmodels.Purchase{}, err
	}
	if applied.price != 0 {
		return dbmodels.Purchase{}, connect.NewError(connect.CodeAborted, "the promotion code changed while the purchase was being recorded")
	}
	if sale.volumeID != uuid.Nil {
		err = s.refuseHeldVolume(ctx, txq, tenantID, userID, sale.volumeID)
	} else {
		err = s.refuseHeldEpisode(ctx, txq, tenantID, userID, sale.episodeID, sale.kind)
	}
	if err != nil {
		return dbmodels.Purchase{}, err
	}

	purchase, err := txq.CreatePurchaseGrantedByPromotionCode(ctx, dbmodels.CreatePurchaseGrantedByPromotionCodeParams{
		ID:              uuid.New(),
		TenantID:        tenantID,
		UserID:          userID,
		EpisodeID:       uuid.NullUUID{UUID: sale.episodeID, Valid: sale.episodeID != uuid.Nil},
		VolumeID:        uuid.NullUUID{UUID: sale.volumeID, Valid: sale.volumeID != uuid.Nil},
		ListPrice:       applied.listPrice,
		PromotionCodeID: applied.id,
		ExpiresAt:       readingPeriodExpiry(sale.readingPeriodHours, time.Now().UTC()),
		Currency:        sale.currency,
		Kind:            string(sale.kind),
	})
	if err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to record a purchase a promotion code granted", err, "tenant_id", tenantID.String())
	}
	if err := recordPromotionCodeRedemption(ctx, txq, purchase); err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to record a promotion code redemption", err, "tenant_id", tenantID.String(), "purchase_id", purchase.ID.String())
	}
	// What each episode of a volume accounts for is written down as for a
	// paid purchase, which is how a statement credits the sale's list price.
	if purchase.VolumeID.Valid {
		if err := txq.CreateVolumePurchaseEpisodes(ctx, dbmodels.CreateVolumePurchaseEpisodesParams{TenantID: tenantID, PurchaseID: purchase.ID}); err != nil {
			return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to record the episodes of a volume a promotion code granted", err, "tenant_id", tenantID.String(), "purchase_id", purchase.ID.String())
		}
	}
	// The engagement events are an episode's, and a volume is not one.
	if purchase.EpisodeID.Valid {
		if _, err := txq.ProjectPurchaseContentEventByID(ctx, dbmodels.ProjectPurchaseContentEventByIDParams{
			ID:         uuid.Must(uuid.NewV7()),
			TenantID:   tenantID,
			PurchaseID: purchase.ID,
		}); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to project a purchase a promotion code granted", err, "tenant_id", tenantID.String(), "purchase_id", purchase.ID.String())
		}
	}
	if err := enqueuePurchaseReceipt(ctx, txq, tenantID, purchase.ID); err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to queue the receipt of a purchase a promotion code granted", err, "tenant_id", tenantID.String(), "purchase_id", purchase.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.Purchase{}, s.internalDBError(ctx, "failed to commit the promotion code grant", err, "tenant_id", tenantID.String())
	}
	s.logger.InfoContext(ctx, "recorded a purchase a promotion code took the whole price off",
		"tenant_id", tenantID,
		"purchase_id", purchase.ID,
		"promotion_code_id", applied.id,
	)
	return purchase, nil
}

// recordPromotionCodeRedemption records that purchase redeemed the tenant's
// promotion code it names, and does nothing for one that names none. A
// purchase redeems once, so writing it again writes nothing.
func recordPromotionCodeRedemption(ctx context.Context, q *dbmodels.Queries, purchase dbmodels.Purchase) error {
	if !purchase.PromotionCodeID.Valid {
		return nil
	}
	return q.CreatePromotionCodeRedemption(ctx, dbmodels.CreatePromotionCodeRedemptionParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        purchase.TenantID,
		PromotionCodeID: purchase.PromotionCodeID.UUID,
		UserID:          purchase.UserID,
		PurchaseID:      purchase.ID,
	})
}

func (s *apiServer) PreviewPromotionCode(
	ctx context.Context,
	req *publirav1.PreviewPromotionCodeRequest,
) (*publirav1.PreviewPromotionCodeResponse, error) {
	code := promotionCodeOf(req.Code)
	if code == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("code is required"), "code")
	}
	var episodeID, volumeID uuid.UUID
	var err error
	switch {
	case req.EpisodeId != "" && req.VolumeId != "":
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name an episode or a volume, not both"), "volume_id")
	case req.VolumeId != "":
		volumeID, err = requestRecordID("volume_id", req.VolumeId)
	default:
		episodeID, err = requestRecordID("episode_id", req.EpisodeId)
	}
	if err != nil {
		return nil, err
	}
	kind, err := protomapper.PurchaseKindFromRequest(req.Kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "kind")
	}
	surface, err := checkoutSurface(req.Client)
	if err != nil {
		return nil, err
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargePromotionCodeAttempt(ctx, tenant.ID, user.ID, code); err != nil {
		return nil, err
	}
	currency, err := s.tenantCurrency(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, err
	}

	// A store sells the permanent copy of an episode alone.
	if req.Store && (volumeID != uuid.Nil || kind != paymentprovider.KindPurchase) {
		return nil, promotionCodeRefusalError(promotioncode.NotApplicable)
	}
	var sale promotionSale
	switch {
	case req.Store:
		resolved, err := s.resolveStoreEpisodeSale(ctx, tenant.ID, user.ID, episodeID)
		if err != nil {
			return nil, err
		}
		sale = promotionSale{episodeID: resolved.episode.ID, price: resolved.price}
	case volumeID != uuid.Nil:
		volume, err := s.resolveVolumeSale(ctx, tenant.ID, user.ID, volumeID, surface)
		if err != nil {
			return nil, err
		}
		sale = promotionSale{volumeID: volume.ID, price: volume.Price}
	default:
		resolved, err := s.resolveEpisodeSale(ctx, tenant.ID, user.ID, episodeID, surface, kind, tenant.DefaultLocale)
		if err != nil {
			return nil, err
		}
		sale = promotionSale{episodeID: resolved.episode.ID, price: resolved.price}
	}
	applied, err := s.applyPromotionCode(ctx, s.queriesFor(ctx), tenant.ID, user.ID, code, sale)
	if err != nil {
		return nil, err
	}
	if req.Store && applied.price > 0 {
		if err := s.requireStoreProduct(ctx, tenant.ID, applied.price); err != nil {
			return nil, err
		}
	}
	return noStorePrivateResponse(ctx, &publirav1.PreviewPromotionCodeResponse{
		ListPrice:      applied.listPrice,
		DiscountAmount: applied.discountAmount,
		Price:          applied.price,
		Currency:       currency,
	}), nil
}
