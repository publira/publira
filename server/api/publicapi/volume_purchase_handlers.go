package publicapi

import (
	"context"
	"database/sql"
	"errors"
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

func (s *apiServer) StartVolumeCheckout(
	ctx context.Context,
	req *publirav1.StartVolumeCheckoutRequest,
) (*publirav1.StartVolumeCheckoutResponse, error) {
	volumeID, err := requestRecordID("volume_id", req.VolumeId)
	if err != nil {
		return nil, err
	}
	surface, err := checkoutSurface(req.Client)
	if err != nil {
		return nil, err
	}

	promotionCode := promotionCodeOf(req.PromotionCode)

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionStartPurchaseCheckout, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	if err := s.chargePromotionCodeAttempt(ctx, tenant.ID, user.ID, promotionCode); err != nil {
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
	provider, checkoutCurrency, credentials, err := s.loadCheckoutProvider(ctx, tenant.ID, req.Provider)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	volume, err := s.resolveVolumeSale(ctx, tenant.ID, user.ID, volumeID, surface)
	if err != nil {
		return nil, err
	}
	var applied appliedPromotionCode
	if promotionCode != "" {
		if applied, err = s.applyPromotionCode(ctx, queries, tenant.ID, user.ID, promotionCode, promotionSale{volumeID: volume.ID, price: volume.Price}); err != nil {
			return nil, err
		}
	}

	successURL := volumePurchaseReturnURL(origin, volume.SeriesPublicID, volume.PublicID, "success")
	cancelURL := volumePurchaseReturnURL(origin, volume.SeriesPublicID, volume.PublicID, "cancelled")
	if req.Client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
		code, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
		}
		successURL = mobileVolumePurchaseReturnURL(origin, code, volume.SeriesPublicID, volume.PublicID, "success")
		cancelURL = mobileVolumePurchaseReturnURL(origin, code, volume.SeriesPublicID, volume.PublicID, "cancelled")
	}
	// A code that takes the whole price off leaves nothing for a provider to
	// charge, as on an episode's checkout.
	if applied.id != uuid.Nil && applied.price == 0 {
		if _, err := s.grantPurchaseWithPromotionCode(ctx, tenant.ID, user.ID, promotionCode, grantedSale{
			volumeID:  volume.ID,
			kind:      paymentprovider.KindPurchase,
			listPrice: volume.Price,
			currency:  checkoutCurrency,
		}); err != nil {
			return nil, err
		}
		return &publirav1.StartVolumeCheckoutResponse{CheckoutUrl: successURL}, nil
	}
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID: tenant.ID,
			ReaderID: user.ID,
			VolumeID: volume.ID,
			Kind:     paymentprovider.KindPurchase,
			Price:    volume.Price,
			Currency: checkoutCurrency,
		},
		LineItemName: volume.Title,
		SuccessURL:   successURL,
		CancelURL:    cancelURL,
	}
	applied.discount(&checkout)
	expiredCheckoutID, err := queries.GetExpiredVolumeCheckoutID(ctx, dbmodels.GetExpiredVolumeCheckoutIDParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		VolumeID: volume.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's expired volume checkout", err, "tenant_id", tenant.ID.String(), "volume_id", volume.ID.String())
	}
	paidCheckoutID, err := queries.GetLastPaidVolumeCheckoutID(ctx, dbmodels.GetLastPaidVolumeCheckoutIDParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		VolumeID: volume.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to read the reader's last paid volume checkout", err, "tenant_id", tenant.ID.String(), "volume_id", volume.ID.String())
	}
	checkout.IdempotencyKey, err = checkoutIdempotencyKey(checkout, expiredCheckoutID, paidCheckoutID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the checkout idempotency key", err, "tenant_id", tenant.ID.String(), "volume_id", volume.ID.String())
	}
	checkoutURL, err := provider.StartCheckout(ctx, credentials, checkout)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to start a checkout with the payment provider", "error", err, "tenant_id", tenant.ID, "provider", provider.Declaration().ID, "volume_id", volume.ID.String())
		return nil, connect.NewError(connect.CodeUnavailable, "failed to start checkout")
	}
	return &publirav1.StartVolumeCheckoutResponse{CheckoutUrl: checkoutURL}, nil
}

// volumePurchaseReturnURL is where the storefront takes the reader back to
// after a checkout of a volume: the series page, which lists the volume.
func volumePurchaseReturnURL(base *url.URL, seriesPublicID, volumePublicID, checkout string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", "series", seriesPublicID)
	query := result.Query()
	query.Set("checkout", checkout)
	query.Set("volume", volumePublicID)
	result.RawQuery = query.Encode()
	return result.String()
}

// mobileVolumePurchaseReturnURL is the app's return link after a checkout of
// a volume, which names the series the app opens and the volume it bought.
func mobileVolumePurchaseReturnURL(base *url.URL, locale, seriesPublicID, volumePublicID, status string) string {
	result := *base
	result.Path, _ = url.JoinPath("/", locale, "checkout", "return")
	query := result.Query()
	query.Set("series", seriesPublicID)
	query.Set("volume", volumePublicID)
	query.Set("status", status)
	result.RawQuery = query.Encode()
	return result.String()
}
