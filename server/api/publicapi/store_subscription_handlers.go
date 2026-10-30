package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storesubscription"
)

func (s *apiServer) StartStoreSubscription(
	ctx context.Context,
	req *publirav1.StartStoreSubscriptionRequest,
) (*publirav1.StartStoreSubscriptionResponse, error) {
	planID, err := requestRecordID("plan_id", req.PlanId)
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
	if err := s.requireStoreSelling(ctx, tenant.ID, store); err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	plan, err := queries.GetPublishedSubscriptionPlanByIDForTenant(ctx, dbmodels.GetPublishedSubscriptionPlanByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       planID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, "subscription plan not found")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the subscription plan", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", planID.String())
	}
	productID := plan.AppStoreProductID
	if store == publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY {
		productID = plan.GooglePlayProductID
	}
	if !productID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the plan is not sold in this store")
	}
	reader := uuid.NullUUID{UUID: user.ID, Valid: true}
	holds, err := queries.UserHoldsLiveSubscription(ctx, dbmodels.UserHoldsLiveSubscriptionParams{TenantID: tenant.ID, UserID: reader})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check the reader's subscriptions", err, "tenant_id", tenant.ID.String())
	}
	if holds {
		return nil, readerHoldsSubscriptionError()
	}
	intent, err := queries.OpenStoreSubscriptionIntent(ctx, dbmodels.OpenStoreSubscriptionIntentParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  tenant.ID,
		UserID:    user.ID,
		PlanID:    plan.ID,
		ProductID: productID.String,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to open a store subscription intent", err, "tenant_id", tenant.ID.String(), "subscription_plan_id", plan.ID.String())
	}
	return noStorePrivateResponse(ctx, &publirav1.StartStoreSubscriptionResponse{
		IntentId:  intent.ID.String(),
		ProductId: intent.ProductID,
	}), nil
}

// storeSubscription is a subscription the store has vouched for, as it
// reports it now.
type storeSubscription struct {
	provider string
	// subscriptionID is the store's ID of the subscription, the same across
	// its renewals.
	subscriptionID string
	productID      string
	// accountToken is the intent the app set on the purchase.
	accountToken string
	isTest       bool
	state        storesubscription.State
	// acknowledge is a Google Play subscription that has been paid for and
	// that nobody has acknowledged yet.
	acknowledge bool
}

func (s *apiServer) ConfirmStoreSubscription(
	ctx context.Context,
	req *publirav1.ConfirmStoreSubscriptionRequest,
) (*publirav1.ConfirmStoreSubscriptionResponse, error) {
	signed := strings.TrimSpace(req.Transaction)
	if signed == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "transaction is required")
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionConfirmStorePurchase, tenant.ID, user.ID); err != nil {
		return nil, err
	}

	// Which subscription the transaction belongs to is known from what the app
	// sent, so the store is asked about it only under that subscription's lock.
	var (
		provider, subscriptionID string
		verify                   func() (storeSubscription, error)
	)
	switch req.Store {
	case publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE:
		// The app's copy is verified before anything else, so another reader's
		// subscription is refused without asking Apple.
		claimed, err := s.stores.appStoreVerifier.VerifyTransaction(signed)
		if err != nil {
			s.logger.WarnContext(ctx, "store transaction does not verify", "tenant_id", tenant.ID, "store", storesubscription.ProviderAppStore, "error", err)
			return nil, connect.NewError(connect.CodeInvalidArgument, "transaction does not verify")
		}
		if claimed.Type != appstore.TypeAutoRenewableSubscription || claimed.OriginalTransactionID == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "transaction is not for an auto-renewable subscription")
		}
		provider, subscriptionID = storesubscription.ProviderAppStore, claimed.OriginalTransactionID
		verify = func() (storeSubscription, error) { return s.verifyAppStoreSubscription(ctx, tenant.ID, claimed) }
	case publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY:
		productID := strings.TrimSpace(req.ProductId)
		if productID == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "product_id is required for Google Play")
		}
		provider, subscriptionID = storesubscription.ProviderGooglePlay, signed
		verify = func() (storeSubscription, error) {
			return s.verifyGooglePlaySubscription(ctx, tenant.ID, productID, signed)
		}
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, "store is required")
	}
	if err := s.refuseAnotherReadersStoreSubscription(ctx, tenant.ID, user.ID, provider, subscriptionID); err != nil {
		return nil, err
	}

	recorded, err := s.recordStoreSubscription(ctx, tenant.ID, user.ID, provider, subscriptionID, verify)
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.ConfirmStoreSubscriptionResponse{Subscription: recorded}), nil
}

// refuseAnotherReadersStoreSubscription answers permission_denied when the
// store's subscription is recorded for someone other than the caller: the
// store bills whoever subscribed, and a restore moves nothing between
// accounts. recordStoreSubscription asks again under the subscription's lock;
// this is so neither the store nor the lock is taken for a subscription that
// cannot be the caller's.
func (s *apiServer) refuseAnotherReadersStoreSubscription(ctx context.Context, tenantID, userID uuid.UUID, provider, subscriptionID string) error {
	existing, err := s.queriesFor(ctx).GetStoreSubscription(ctx, dbmodels.GetStoreSubscriptionParams{
		TenantID:            tenantID,
		Provider:            provider,
		StoreSubscriptionID: subscriptionID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to look up a store subscription", err, "tenant_id", tenantID.String(), "store", provider)
	}
	if !existing.UserID.Valid || existing.UserID.UUID != userID {
		return connect.NewError(connect.CodePermissionDenied, "subscription belongs to another reader")
	}
	return nil
}

// verifyAppStoreSubscription asks the App Store for the subscription the
// transaction the app sent belongs to, and reads what Apple answers about it
// now, rather than the app's copy, as the subscription: the app's copy may be
// a renewal ago, or of a subscription Apple has since revoked.
func (s *apiServer) verifyAppStoreSubscription(ctx context.Context, tenantID uuid.UUID, claimed appstore.Transaction) (storeSubscription, error) {
	provider := storesubscription.ProviderAppStore
	credentials, err := s.appStores(ctx).LoadAppStoreCredentials(ctx, tenantID)
	if err != nil {
		return storeSubscription{}, s.storeCredentialsError(ctx, tenantID, provider, err)
	}
	if claimed.BundleID != credentials.BundleIdentifier {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "transaction belongs to another app")
	}
	if claimed.Environment != appstore.EnvironmentProduction && claimed.Environment != appstore.EnvironmentSandbox {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "transaction names no App Store environment")
	}

	statuses, err := s.stores.appStore.GetAllSubscriptionStatuses(ctx, appstore.Credentials{
		IssuerID:         credentials.IssuerID,
		KeyID:            credentials.KeyID,
		PrivateKey:       credentials.PrivateKey,
		BundleIdentifier: credentials.BundleIdentifier,
	}, claimed.Environment, claimed.TransactionID)
	switch {
	case errors.Is(err, appstore.ErrTransactionNotFound):
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "the App Store knows no such transaction")
	case errors.Is(err, appstore.ErrUnauthorized), errors.Is(err, appstore.ErrInvalidCredentials):
		return storeSubscription{}, s.storeRefusedCredentialsError(ctx, tenantID, provider, err)
	case err != nil:
		return storeSubscription{}, s.storeUnavailableError(ctx, tenantID, provider, err)
	}
	var status *appstore.SubscriptionStatus
	for i := range statuses {
		if statuses[i].OriginalTransactionID == claimed.OriginalTransactionID {
			status = &statuses[i]
			break
		}
	}
	if status == nil {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "the App Store knows no such subscription")
	}
	latest, err := s.stores.appStoreVerifier.VerifyTransaction(status.SignedTransactionInfo)
	if err != nil {
		return storeSubscription{}, s.internalError(ctx, "the App Store answered a transaction that does not verify", err, "tenant_id", tenantID.String())
	}
	renewal, err := s.stores.appStoreVerifier.VerifyRenewalInfo(status.SignedRenewalInfo)
	if err != nil {
		return storeSubscription{}, s.internalError(ctx, "the App Store answered renewal info that does not verify", err, "tenant_id", tenantID.String())
	}
	if latest.OriginalTransactionID != claimed.OriginalTransactionID || renewal.OriginalTransactionID != claimed.OriginalTransactionID || latest.BundleID != credentials.BundleIdentifier {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "transaction belongs to another app")
	}
	if latest.Type != appstore.TypeAutoRenewableSubscription {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "transaction is not for an auto-renewable subscription")
	}
	state, err := storesubscription.FromAppStore(status.Status, latest, renewal)
	if err != nil {
		return storeSubscription{}, s.internalError(ctx, "the App Store reports a subscription this build cannot read", err, "tenant_id", tenantID.String())
	}
	// A renewal carries the account token of the purchase that started the
	// subscription; the app's copy is read only when Apple's leaves it out.
	accountToken := latest.AppAccountToken
	if accountToken == "" {
		accountToken = claimed.AppAccountToken
	}
	return storeSubscription{
		provider:       provider,
		subscriptionID: latest.OriginalTransactionID,
		productID:      latest.ProductID,
		accountToken:   accountToken,
		isTest:         latest.Environment == appstore.EnvironmentSandbox,
		state:          state,
	}, nil
}

// verifyGooglePlaySubscription asks Google Play for the subscription a token
// names. The token is looked up in the tenant's own app, so a subscription
// bought in another app is one Google Play does not find.
func (s *apiServer) verifyGooglePlaySubscription(ctx context.Context, tenantID uuid.UUID, productID, token string) (storeSubscription, error) {
	provider := storesubscription.ProviderGooglePlay
	credentials, err := s.appStores(ctx).LoadGooglePlayCredentials(ctx, tenantID)
	if err != nil {
		return storeSubscription{}, s.storeCredentialsError(ctx, tenantID, provider, err)
	}
	purchase, err := s.stores.googlePlay.GetSubscriptionPurchase(ctx, []byte(credentials.ServiceAccountKey), credentials.PackageName, token)
	switch {
	case errors.Is(err, googleplay.ErrPurchaseNotFound):
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "no such subscription is known to Google Play")
	case errors.Is(err, googleplay.ErrUnauthorized), errors.Is(err, googleplay.ErrInvalidCredentials):
		return storeSubscription{}, s.storeRefusedCredentialsError(ctx, tenantID, provider, err)
	case err != nil:
		return storeSubscription{}, s.storeUnavailableError(ctx, tenantID, provider, err)
	}
	item, ok := purchase.LineItem(productID)
	if !ok {
		return storeSubscription{}, connect.NewError(connect.CodeInvalidArgument, "the subscription does not bill that product")
	}
	state, err := storesubscription.FromGooglePlay(purchase, item)
	if err != nil {
		return storeSubscription{}, s.internalError(ctx, "Google Play reports a subscription this build cannot read", err, "tenant_id", tenantID.String())
	}
	// Google Play takes no acknowledgement of a purchase that is still
	// pending; the app confirms again once it is paid.
	paid := purchase.SubscriptionState != googleplay.SubscriptionStatePending && purchase.SubscriptionState != googleplay.SubscriptionStatePendingPurchaseCanceled
	return storeSubscription{
		provider:       provider,
		subscriptionID: token,
		productID:      productID,
		accountToken:   purchase.ExternalAccountIdentifiers.ObfuscatedExternalAccountID,
		isTest:         purchase.IsTest(),
		state:          state,
		acknowledge:    paid && purchase.AcknowledgementState != googleplay.AcknowledgementStateAcknowledged,
	}, nil
}

// recordStoreSubscription asks the store for the subscription provider knows
// as subscriptionID through verify, writes it as the store reports it now, on
// the plan its product is sold as, and answers it. The first confirmation of a
// subscription consumes the intent its account token names; a later one, as
// an app restoring its purchases sends, updates the subscription already
// recorded for the caller.
//
// The read from the store, the read of the recorded row, and the write all
// happen under the subscription's lock, as recordSubscription does for a
// Stripe one: of two confirmations that overlap, the one that writes last is
// also the one that asked the store last, so a state the store has moved past
// is never written over the newer one, and the subscription is never recorded
// twice.
func (s *apiServer) recordStoreSubscription(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	provider, subscriptionID string,
	verify func() (storeSubscription, error),
) (*publirav1.Subscription, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin store subscription transaction", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.LockStoreSubscription(ctx, dbmodels.LockStoreSubscriptionParams{
		TenantID:            tenantID,
		Provider:            provider,
		StoreSubscriptionID: subscriptionID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock a store subscription", err, "tenant_id", tenantID.String())
	}
	subscription, err := verify()
	if err != nil {
		return nil, err
	}
	existing, err := txq.GetStoreSubscription(ctx, dbmodels.GetStoreSubscriptionParams{
		TenantID:            tenantID,
		Provider:            subscription.provider,
		StoreSubscriptionID: subscription.subscriptionID,
	})
	recorded := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to look up a store subscription", err, "tenant_id", tenantID.String(), "store", subscription.provider)
	}
	if recorded && (!existing.UserID.Valid || existing.UserID.UUID != userID) {
		return nil, connect.NewError(connect.CodePermissionDenied, "subscription belongs to another reader")
	}

	// A subscription already recorded stays on its plan when staff have since
	// taken its product off every plan; a new one has no plan to be recorded
	// on.
	planID, err := txq.GetSubscriptionPlanForStoreProductForTenant(ctx, dbmodels.GetSubscriptionPlanForStoreProductForTenantParams{
		TenantID:  tenantID,
		Provider:  subscription.provider,
		ProductID: subscription.productID,
	})
	switch {
	case errors.Is(err, sql.ErrNoRows) && recorded:
		planID = existing.PlanID
	case errors.Is(err, sql.ErrNoRows):
		return nil, connect.NewError(connect.CodeInvalidArgument, "the store product is not sold as any plan of the tenant")
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to find the plan of a store product", err, "tenant_id", tenantID.String(), "store", subscription.provider)
	}

	var intent dbmodels.StoreSubscriptionIntent
	if !recorded {
		if intent, err = s.lockStoreSubscriptionIntent(ctx, txq, tenantID, userID, subscription); err != nil {
			return nil, err
		}
	}
	// Taken only now, after everything that can refuse the confirmation, so a
	// deletion of the account waits on the write alone.
	if err := txq.LockSubscriptionsOfUser(ctx, dbmodels.LockSubscriptionsOfUserParams{TenantID: tenantID, UserID: userID}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the reader's subscriptions", err, "tenant_id", tenantID.String())
	}
	var currentPeriodEnd sql.NullTime
	if !subscription.state.CurrentPeriodEnd.IsZero() {
		currentPeriodEnd = sql.NullTime{Time: subscription.state.CurrentPeriodEnd, Valid: true}
	}
	row, err := txq.RecordStoreSubscription(ctx, dbmodels.RecordStoreSubscriptionParams{
		ID:                  uuid.Must(uuid.NewV7()),
		TenantID:            tenantID,
		UserID:              userID,
		PlanID:              planID,
		Provider:            subscription.provider,
		StoreSubscriptionID: subscription.subscriptionID,
		StoreProductID:      subscription.productID,
		IsTest:              subscription.isTest,
		Status:              string(subscription.state.Status),
		CurrentPeriodEnd:    currentPeriodEnd,
		CancelAtPeriodEnd:   subscription.state.CancelAtPeriodEnd,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record a store subscription", err, "tenant_id", tenantID.String(), "store", subscription.provider)
	}
	if !recorded {
		if err := txq.ConsumeStoreSubscriptionIntent(ctx, dbmodels.ConsumeStoreSubscriptionIntentParams{TenantID: tenantID, ID: intent.ID}); err != nil {
			return nil, s.internalDBError(ctx, "failed to consume a store subscription intent", err, "tenant_id", tenantID.String())
		}
	}
	if subscription.acknowledge {
		if err := outbox.QueueGooglePlaySubscriptionAcknowledgement(ctx, txq, tenantID, row.ID, subscription.productID, subscription.subscriptionID); err != nil {
			return nil, s.internalError(ctx, "failed to queue a google play subscription acknowledgement", err, "tenant_id", tenantID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit a store subscription", err, "tenant_id", tenantID.String())
	}
	s.logger.InfoContext(ctx, "recorded a store subscription",
		"tenant_id", tenantID,
		"subscription_id", row.ID,
		"subscription_plan_id", row.PlanID,
		"store", subscription.provider,
		"status", row.Status,
		"is_test", subscription.isTest,
	)

	queries := s.queriesFor(ctx)
	mine, err := queries.GetMySubscriptionByID(ctx, dbmodels.GetMySubscriptionByIDParams{TenantID: tenantID, UserID: userID, ID: row.ID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read a store subscription", err, "tenant_id", tenantID.String(), "subscription_id", row.ID.String())
	}
	return s.mySubscription(ctx, queries, tenantID, dbmodels.GetMySubscriptionRow(mine))
}

// lockStoreSubscriptionIntent takes the intent a subscription not recorded yet
// names, which has to be the caller's, still open, and for the product the
// store bills.
func (s *apiServer) lockStoreSubscriptionIntent(ctx context.Context, txq *dbmodels.Queries, tenantID, userID uuid.UUID, subscription storeSubscription) (dbmodels.StoreSubscriptionIntent, error) {
	intentID, err := uuid.Parse(subscription.accountToken)
	if err != nil {
		return dbmodels.StoreSubscriptionIntent{}, connect.NewError(connect.CodeInvalidArgument, "transaction names no subscription intent")
	}
	intent, err := txq.LockStoreSubscriptionIntent(ctx, dbmodels.LockStoreSubscriptionIntentParams{TenantID: tenantID, ID: intentID})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.StoreSubscriptionIntent{}, connect.NewError(connect.CodeInvalidArgument, "transaction names no subscription intent")
	}
	if err != nil {
		return dbmodels.StoreSubscriptionIntent{}, s.internalDBError(ctx, "failed to lock a store subscription intent", err, "tenant_id", tenantID.String())
	}
	if intent.UserID != userID {
		return dbmodels.StoreSubscriptionIntent{}, connect.NewError(connect.CodePermissionDenied, "subscription intent belongs to another reader")
	}
	if intent.ConsumedAt.Valid {
		return dbmodels.StoreSubscriptionIntent{}, connect.NewError(connect.CodeFailedPrecondition, "subscription intent has already been used")
	}
	if intent.ProductID != subscription.productID {
		return dbmodels.StoreSubscriptionIntent{}, connect.NewError(connect.CodeInvalidArgument, "the store bills another product than the intent")
	}
	return intent, nil
}
