package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/storepurchase"
	"github.com/publira/publira/server/internal/storesubscription"
	"github.com/publira/publira/server/internal/tenantorigin"
)

func (s *apiServer) ProcessAppStoreNotification(
	ctx context.Context,
	req *publirav1.ProcessAppStoreNotificationRequest,
) (*publirav1.ProcessAppStoreNotificationResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxPaymentWebhookPayload {
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid App Store notification payload")
	}
	var body struct {
		SignedPayload string `json:"signedPayload"`
	}
	if err := json.Unmarshal(req.Payload, &body); err != nil || body.SignedPayload == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid App Store notification payload")
	}
	notification, err := s.stores.appStoreVerifier.VerifyNotification(body.SignedPayload)
	if err != nil {
		s.logger.WarnContext(ctx, "App Store notification does not verify", "tenant_id", tenant.ID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, "the App Store notification does not verify")
	}

	// The app is read from the association rather than from the App Store
	// settings: a refund is taken back even after the tenant stopped selling
	// through the store.
	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get tenant config", err, "tenant_id", tenant.ID.String())
	}
	if !config.IosBundleIdentifier.Valid || config.IosBundleIdentifier.String == "" {
		s.logger.WarnContext(ctx, "App Store notification for a tenant with no iOS app", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant has no iOS app")
	}
	bundleIdentifier := config.IosBundleIdentifier.String
	if notification.Data.BundleID != bundleIdentifier {
		s.logger.WarnContext(ctx, "App Store notification names another app", "tenant_id", tenant.ID, "notification_uuid", notification.NotificationUUID)
		return nil, connect.NewError(connect.CodeInvalidArgument, "the App Store notification names another app")
	}

	// A notification about no transaction, as TEST is, changes nothing.
	if notification.Data.SignedTransactionInfo == "" {
		return &publirav1.ProcessAppStoreNotificationResponse{}, nil
	}
	transaction, err := s.stores.appStoreVerifier.VerifyTransaction(notification.Data.SignedTransactionInfo)
	if err != nil {
		s.logger.WarnContext(ctx, "App Store notification carries a transaction that does not verify", "tenant_id", tenant.ID, "notification_uuid", notification.NotificationUUID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, "the App Store notification does not verify")
	}
	if transaction.BundleID != bundleIdentifier {
		return nil, connect.NewError(connect.CodeInvalidArgument, "the App Store notification names another app")
	}
	if transaction.Type == appstore.TypeAutoRenewableSubscription {
		if transaction.OriginalTransactionID == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "the App Store notification names no subscription")
		}
		err := s.followStoreSubscription(ctx, tenant.ID, storesubscription.ProviderAppStore, transaction.OriginalTransactionID, func() (storeSubscription, error) {
			return s.verifyAppStoreSubscription(ctx, tenant.ID, transaction)
		}, nil, "notification_uuid", notification.NotificationUUID, "notification_type", notification.NotificationType, "subtype", notification.Subtype)
		if err != nil {
			return nil, err
		}
		return &publirav1.ProcessAppStoreNotificationResponse{}, nil
	}

	switch notification.NotificationType {
	case appstore.NotificationTypeRefund, appstore.NotificationTypeRevoke:
	default:
		return &publirav1.ProcessAppStoreNotificationResponse{}, nil
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin App Store refund transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	applied, err := storepurchase.RecordRefund(ctx, dbmodels.New(tx), tenant.ID, storepurchase.StoreAppStore, transaction.TransactionID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record an App Store refund", err, "tenant_id", tenant.ID.String(), "notification_uuid", notification.NotificationUUID)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit an App Store refund", err, "tenant_id", tenant.ID.String(), "notification_uuid", notification.NotificationUUID)
	}
	s.logger.InfoContext(ctx, "recorded an App Store refund",
		"tenant_id", tenant.ID,
		"notification_uuid", notification.NotificationUUID,
		"notification_type", notification.NotificationType,
		"held_for_purchase", !applied,
	)
	return &publirav1.ProcessAppStoreNotificationResponse{}, nil
}

// googlePlayNotificationPath is where on the tenant's site Cloud Pub/Sub
// pushes Google Play's notifications, and so the audience of the token it
// pushes them with.
const googlePlayNotificationPath = "/api/v1/webhook/payment/google-play"

// googlePlayPushVerifier checks the token Cloud Pub/Sub pushes with.
type googlePlayPushVerifier interface {
	VerifyPush(ctx context.Context, authorization, audience, serviceAccountEmail string) error
}

func (s *apiServer) ProcessGooglePlayNotification(
	ctx context.Context,
	req *publirav1.ProcessGooglePlayNotificationRequest,
) (*publirav1.ProcessGooglePlayNotificationResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxPaymentWebhookPayload {
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid Google Play notification payload")
	}

	// The app and the service account are read from the association and the
	// saved key rather than from whether Google Play is on: a refund is taken
	// back even after the tenant stopped selling through the store.
	queries := s.queriesFor(ctx)
	config, err := queries.GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get tenant config", err, "tenant_id", tenant.ID.String())
	}
	if !config.AndroidApplicationID.Valid || config.AndroidApplicationID.String == "" {
		s.logger.WarnContext(ctx, "Google Play notification for a tenant with no Android app", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant has no Android app")
	}
	play, err := queries.GetTenantGooglePlayConfigByTenantID(ctx, tenant.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get the Google Play settings", err, "tenant_id", tenant.ID.String())
	}
	if !play.ServiceAccountEmail.Valid || play.ServiceAccountEmail.String == "" {
		s.logger.WarnContext(ctx, "Google Play notification for a tenant with no service account", "tenant_id", tenant.ID)
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant has no Google Play service account")
	}
	site, err := tenantorigin.Site(tenant)
	if errors.Is(err, tenantorigin.ErrDomainNotConfigured) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the tenant site origin", err, "tenant_id", tenant.ID.String())
	}
	headers := make(http.Header, len(req.Headers))
	for name, value := range req.Headers {
		headers.Set(name, value)
	}
	err = s.stores.googlePlayPush.VerifyPush(ctx, headers.Get("Authorization"), site.String()+googlePlayNotificationPath, play.ServiceAccountEmail.String)
	switch {
	case errors.Is(err, googleplay.ErrInvalidPushToken):
		s.logger.WarnContext(ctx, "Google Play notification does not verify", "tenant_id", tenant.ID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, "the Google Play notification does not verify")
	case err != nil:
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		s.logger.WarnContext(ctx, "Google's keys could not be read to verify a Google Play notification", "tenant_id", tenant.ID, "error", err)
		return nil, connect.NewError(connect.CodeUnavailable, "the Google Play notification cannot be verified now")
	}

	push, err := googleplay.ParsePush(req.Payload)
	if err != nil {
		s.logger.WarnContext(ctx, "malformed Google Play notification", "tenant_id", tenant.ID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid Google Play notification payload")
	}
	notification := push.Notification
	if notification.PackageName != config.AndroidApplicationID.String {
		s.logger.WarnContext(ctx, "Google Play notification names another app", "tenant_id", tenant.ID, "message_id", push.MessageID)
		return nil, connect.NewError(connect.CodeInvalidArgument, "the Google Play notification names another app")
	}

	follow := func(token string, attrs ...any) error {
		return s.followStoreSubscription(ctx, tenant.ID, storesubscription.ProviderGooglePlay, token, func() (storeSubscription, error) {
			return s.verifyGooglePlaySubscription(ctx, tenant.ID, "", token)
		}, s.googlePlaySubscriptionReader(ctx, tenant.ID), append([]any{"message_id", push.MessageID}, attrs...)...)
	}
	switch {
	case notification.SubscriptionNotification != nil && notification.SubscriptionNotification.PurchaseToken != "":
		if err := follow(notification.SubscriptionNotification.PurchaseToken, "notification_type", notification.SubscriptionNotification.NotificationType); err != nil {
			return nil, err
		}
	case notification.VoidedPurchaseNotification != nil && notification.VoidedPurchaseNotification.PurchaseToken != "":
		voided := notification.VoidedPurchaseNotification
		switch voided.ProductType {
		case googleplay.VoidedProductTypeSubscription:
			if err := follow(voided.PurchaseToken, "voided", true); err != nil {
				return nil, err
			}
		case googleplay.VoidedProductTypeOneTime:
			if err := s.recordGooglePlayRefund(ctx, tenant.ID, voided.PurchaseToken, push.MessageID); err != nil {
				return nil, err
			}
		}
	}
	return &publirav1.ProcessGooglePlayNotificationResponse{}, nil
}

// recordGooglePlayRefund takes back the one-time product purchase token was
// bought by, as the hourly sync of voided purchases does: whichever of the two
// reads the refund first records it, and the other changes nothing.
func (s *apiServer) recordGooglePlayRefund(ctx context.Context, tenantID uuid.UUID, token, messageID string) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin Google Play refund transaction", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	applied, err := storepurchase.RecordRefund(ctx, dbmodels.New(tx), tenantID, storepurchase.StoreGooglePlay, token)
	if err != nil {
		return s.internalDBError(ctx, "failed to record a Google Play refund", err, "tenant_id", tenantID.String(), "message_id", messageID)
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit a Google Play refund", err, "tenant_id", tenantID.String(), "message_id", messageID)
	}
	s.logger.InfoContext(ctx, "recorded a Google Play refund", "tenant_id", tenantID, "message_id", messageID, "held_for_purchase", !applied)
	return nil
}

// followStoreSubscription records a subscription a store notified about as the
// store reports it now. A subscription nobody has claimed is logged and left
// unrecorded.
func (s *apiServer) followStoreSubscription(ctx context.Context, tenantID uuid.UUID, provider, subscriptionID string, verify func() (storeSubscription, error), predecessor storeSubscriptionReader, attrs ...any) error {
	_, err := s.recordStoreSubscription(ctx, tenantID, uuid.NullUUID{}, provider, subscriptionID, verify, predecessor)
	if errors.Is(err, errStoreSubscriptionUnclaimed) {
		s.logger.WarnContext(ctx, "a store notified about a subscription no reader has claimed",
			append([]any{"tenant_id", tenantID, "store", provider}, attrs...)...)
		return nil
	}
	return err
}
