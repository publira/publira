package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"net/url"

	"connectrpc.com/connect/v2"

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

	queries := s.queriesFor(ctx)
	volume, err := queries.GetPurchasableVolumeForTenant(ctx, dbmodels.GetPurchasableVolumeForTenantParams{
		TenantID: tenant.ID,
		ID:       volumeID,
		Surface:  surface,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "volume not found")
		}
		return nil, s.internalDBError(ctx, "failed to get purchasable volume", err, "tenant_id", tenant.ID.String(), "volume_id", volumeID.String())
	}
	credited, err := queries.ReaderIsCreditedOnVolume(ctx, dbmodels.ReaderIsCreditedOnVolumeParams{
		TenantID: tenant.ID,
		VolumeID: volume.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check the reader's credits on the volume", err, "tenant_id", tenant.ID.String(), "volume_id", volume.ID.String())
	}
	if credited {
		return nil, readerCreditedOnEpisodeError()
	}
	held, err := queries.HoldsStandingVolumePurchase(ctx, dbmodels.HoldsStandingVolumePurchaseParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		VolumeID: volume.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check volume purchase status", err, "tenant_id", tenant.ID.String(), "volume_id", volume.ID.String())
	}
	if held {
		return nil, connect.NewError(connect.CodeAlreadyExists, "volume is already purchased")
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
	checkout := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID: tenant.ID,
			ReaderID: user.ID,
			VolumeID: volume.ID,
			Kind:     paymentprovider.KindPurchase,
			Price:    volume.Price,
			Currency: config.Currency,
		},
		LineItemName: volume.Title,
		SuccessURL:   successURL,
		CancelURL:    cancelURL,
	}
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
