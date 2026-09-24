package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/appstore"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/storepurchase"
)

func (s *apiServer) ProcessAppStoreNotification(
	ctx context.Context,
	req *connect.Request[publirav1.ProcessAppStoreNotificationRequest],
) (*connect.Response[publirav1.ProcessAppStoreNotificationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if len(req.Msg.Payload) == 0 || len(req.Msg.Payload) > maxPaymentWebhookPayload {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid App Store notification payload"))
	}
	var body struct {
		SignedPayload string `json:"signedPayload"`
	}
	if err := json.Unmarshal(req.Msg.Payload, &body); err != nil || body.SignedPayload == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid App Store notification payload"))
	}
	notification, err := s.stores.appStoreVerifier.VerifyNotification(body.SignedPayload)
	if err != nil {
		s.logger.WarnContext(ctx, "App Store notification does not verify", "tenant_id", tenant.ID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the App Store notification does not verify"))
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
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("the tenant has no iOS app"))
	}
	bundleIdentifier := config.IosBundleIdentifier.String
	if notification.Data.BundleID != bundleIdentifier {
		s.logger.WarnContext(ctx, "App Store notification names another app", "tenant_id", tenant.ID, "notification_uuid", notification.NotificationUUID)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the App Store notification names another app"))
	}

	switch notification.NotificationType {
	case appstore.NotificationTypeRefund, appstore.NotificationTypeRevoke:
	default:
		return connect.NewResponse(&publirav1.ProcessAppStoreNotificationResponse{}), nil
	}
	transaction, err := s.stores.appStoreVerifier.VerifyTransaction(notification.Data.SignedTransactionInfo)
	if err != nil {
		s.logger.WarnContext(ctx, "App Store notification carries a transaction that does not verify", "tenant_id", tenant.ID, "notification_uuid", notification.NotificationUUID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the App Store notification does not verify"))
	}
	if transaction.BundleID != bundleIdentifier {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the App Store notification names another app"))
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
	return connect.NewResponse(&publirav1.ProcessAppStoreNotificationResponse{}), nil
}
