package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/appstore"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/storeproduct"
	"github.com/publira/publira/server/internal/storepurchase"
)

const (
	storeAppStore   = storepurchase.StoreAppStore
	storeGooglePlay = storepurchase.StoreGooglePlay
)

// appStoreTransactions is the part of the App Store Server API a confirmation
// asks.
type appStoreTransactions interface {
	GetTransactionInfo(ctx context.Context, credentials appstore.Credentials, environment, transactionID string) (string, error)
}

// googlePlayPurchases is the part of the Google Play Developer API a
// confirmation asks.
type googlePlayPurchases interface {
	GetProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) (googleplay.ProductPurchase, error)
}

// storeClients reach the two stores on a tenant's behalf.
type storeClients struct {
	appStoreVerifier *appstore.Verifier
	appStore         appStoreTransactions
	googlePlay       googlePlayPurchases
}

func defaultStoreClients() storeClients {
	return storeClients{
		appStoreVerifier: appstore.NewVerifier(),
		appStore:         appstore.NewClient(appstore.Config{}),
		googlePlay:       googleplay.NewClient(googleplay.Config{}),
	}
}

func (s *apiServer) StartStorePurchase(
	ctx context.Context,
	req *connect.Request[publirav1.StartStorePurchaseRequest],
) (*connect.Response[publirav1.StartStorePurchaseResponse], error) {
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_APP)
	if err != nil {
		return nil, err
	}
	store := req.Msg.Store
	if store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE && store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("store is required"))
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.requireStoreSelling(ctx, tenant.ID, store); err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	episode, err := queries.GetPurchasableEpisodeByPublicIDForTenant(ctx, dbmodels.GetPurchasableEpisodeByPublicIDForTenantParams{
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
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("free episodes are not sold"))
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	if !soldHere {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("episode is not sold in the app"))
	}
	hasPurchase, err := queries.UserHasValidPurchaseForEpisode(ctx, dbmodels.UserHasValidPurchaseForEpisodeParams{
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

	intent, err := queries.OpenStorePurchaseIntent(ctx, dbmodels.OpenStorePurchaseIntentParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
		Price:     episode.Price,
		ProductID: storeproduct.ProductID(episode.Price),
		// The terms the payment sheet opens on, which the purchase keeps however
		// long the confirmation takes to arrive.
		ReadingPeriodHours: episode.ReadingPeriodHours,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to open a store purchase intent", err, "tenant_id", tenant.ID.String(), "episode_public_id", episodePublicID)
	}
	return noStorePrivateResponse(&publirav1.StartStorePurchaseResponse{
		IntentId:  intent.ID.String(),
		ProductId: intent.ProductID,
	}), nil
}

// requireStoreSelling answers failed_precondition unless the tenant's app sells
// through the store and the store the app is about to charge through is ready:
// the route needs only one of the two stores, and a charge through the other
// could not be confirmed.
func (s *apiServer) requireStoreSelling(ctx context.Context, tenantID uuid.UUID, store publirav1.InAppPurchaseStore) error {
	config, err := s.appStores(ctx).Get(ctx, tenantID)
	if err != nil {
		return s.internalDBError(ctx, "failed to get tenant store settings", err, "tenant_id", tenantID.String())
	}
	if config.Route != paymentsettings.RouteStore {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("the app does not sell through the store"))
	}
	ready := config.AppStore.Ready
	if store == publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY {
		ready = config.GooglePlay.Ready
	}
	if !ready {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("the store is not ready"))
	}
	return nil
}

// storeTransaction is a transaction the store has vouched for.
type storeTransaction struct {
	store         string
	transactionID string
	productID     string
	// accountToken is the intent the app set on the purchase.
	accountToken string
	isTest       bool
}

func (s *apiServer) ConfirmStorePurchase(
	ctx context.Context,
	req *connect.Request[publirav1.ConfirmStorePurchaseRequest],
) (*connect.Response[publirav1.ConfirmStorePurchaseResponse], error) {
	signed := strings.TrimSpace(req.Msg.Transaction)
	if signed == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction is required"))
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionConfirmStorePurchase, tenant.ID, user.ID); err != nil {
		return nil, err
	}

	var transaction storeTransaction
	switch req.Msg.Store {
	case publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE:
		// The app's copy is verified before anything else, so a transaction
		// already recorded is answered without asking Apple again.
		claimed, err := s.stores.appStoreVerifier.VerifyTransaction(signed)
		if err != nil {
			s.logger.WarnContext(ctx, "store transaction does not verify", "tenant_id", tenant.ID, "store", storeAppStore, "error", err)
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction does not verify"))
		}
		if purchase, found, err := s.recordedStorePurchase(ctx, s.queriesFor(ctx), tenant.ID, user.ID, storeAppStore, claimed.TransactionID); err != nil || found {
			return confirmedStorePurchase(purchase, err)
		}
		transaction, err = s.verifyAppStoreTransaction(ctx, tenant.ID, claimed)
		if err != nil {
			return nil, err
		}
	case publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY:
		productID := strings.TrimSpace(req.Msg.ProductId)
		if productID == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("product_id is required for Google Play"))
		}
		if purchase, found, err := s.recordedStorePurchase(ctx, s.queriesFor(ctx), tenant.ID, user.ID, storeGooglePlay, signed); err != nil || found {
			return confirmedStorePurchase(purchase, err)
		}
		transaction, err = s.verifyGooglePlayPurchase(ctx, tenant.ID, productID, signed)
		if err != nil {
			return nil, err
		}
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("store is required"))
	}

	purchase, err := s.recordStorePurchase(ctx, tenant.ID, user.ID, transaction)
	return confirmedStorePurchase(purchase, err)
}

func confirmedStorePurchase(purchase *publirav1.MyPurchase, err error) (*connect.Response[publirav1.ConfirmStorePurchaseResponse], error) {
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(&publirav1.ConfirmStorePurchaseResponse{Purchase: purchase}), nil
}

// recordedStorePurchase answers the purchase a transaction was already
// recorded as. Another reader's purchase is permission_denied: the store
// charged whoever opened the intent, and the caller is not them.
func (s *apiServer) recordedStorePurchase(
	ctx context.Context,
	queries Querier,
	tenantID, userID uuid.UUID,
	store, transactionID string,
) (*publirav1.MyPurchase, bool, error) {
	existing, err := queries.GetStorePurchaseByTransaction(ctx, dbmodels.GetStorePurchaseByTransactionParams{
		TenantID:           tenantID,
		Store:              store,
		StoreTransactionID: transactionID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, s.internalDBError(ctx, "failed to look up a store purchase", err, "tenant_id", tenantID.String(), "store", store)
	}
	if !existing.UserID.Valid || existing.UserID.UUID != userID {
		return nil, false, connect.NewError(connect.CodePermissionDenied, errors.New("transaction belongs to another reader"))
	}
	purchase, err := s.myPurchase(ctx, queries, tenantID, userID, existing.ID)
	return purchase, err == nil, err
}

func (s *apiServer) myPurchase(ctx context.Context, queries Querier, tenantID, userID, purchaseID uuid.UUID) (*publirav1.MyPurchase, error) {
	row, err := queries.GetMyPurchase(ctx, dbmodels.GetMyPurchaseParams{
		TenantID: tenantID,
		UserID:   userID,
		ID:       purchaseID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read a store purchase", err, "tenant_id", tenantID.String(), "purchase_id", purchaseID.String())
	}
	return purchaseItemFromRow(purchasePageRow{
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
	}, time.Now()), nil
}

func (s *apiServer) appStores(ctx context.Context) *paymentsettings.AppStores {
	return paymentsettings.NewAppStores(s.queriesFor(ctx), s.encryptor)
}

// storeCredentialsError answers a store the tenant cannot verify through.
func (s *apiServer) storeCredentialsError(ctx context.Context, tenantID uuid.UUID, store string, err error) error {
	if errors.Is(err, paymentsettings.ErrStoreNotReady) || paymentsettings.IsUnavailable(err) {
		s.logger.WarnContext(ctx, "store purchase refused because the store is not ready", "tenant_id", tenantID, "store", store, "error", err)
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("the store is not ready"))
	}
	return s.internalDBError(ctx, "failed to load store credentials", err, "tenant_id", tenantID.String(), "store", store)
}

// storeRefusedCredentialsError answers a store that refused the tenant's own
// key, which no retry by the reader can fix.
func (s *apiServer) storeRefusedCredentialsError(ctx context.Context, tenantID uuid.UUID, store string, err error) error {
	s.logger.ErrorContext(ctx, "the store refused the tenant's credentials", "tenant_id", tenantID, "store", store, "error", err)
	return connect.NewError(connect.CodeFailedPrecondition, errors.New("the store is not ready"))
}

func (s *apiServer) storeUnavailableError(ctx context.Context, tenantID uuid.UUID, store string, err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	s.logger.WarnContext(ctx, "the store could not be reached to verify a transaction", "tenant_id", tenantID, "store", store, "error", err)
	return connect.NewError(connect.CodeUnavailable, errors.New("the store could not be reached"))
}

// verifyAppStoreTransaction asks the App Store for the transaction the app
// sent and reads what Apple answers, rather than the app's copy, as the
// transaction: the app's copy may be one Apple has since revoked.
func (s *apiServer) verifyAppStoreTransaction(ctx context.Context, tenantID uuid.UUID, claimed appstore.Transaction) (storeTransaction, error) {
	credentials, err := s.appStores(ctx).LoadAppStoreCredentials(ctx, tenantID)
	if err != nil {
		return storeTransaction{}, s.storeCredentialsError(ctx, tenantID, storeAppStore, err)
	}
	if claimed.BundleID != credentials.BundleIdentifier {
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction belongs to another app"))
	}
	if claimed.Environment != appstore.EnvironmentProduction && claimed.Environment != appstore.EnvironmentSandbox {
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction names no App Store environment"))
	}

	signed, err := s.stores.appStore.GetTransactionInfo(ctx, appstore.Credentials{
		IssuerID:         credentials.IssuerID,
		KeyID:            credentials.KeyID,
		PrivateKey:       credentials.PrivateKey,
		BundleIdentifier: credentials.BundleIdentifier,
	}, claimed.Environment, claimed.TransactionID)
	switch {
	case errors.Is(err, appstore.ErrTransactionNotFound):
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("the App Store knows no such transaction"))
	case errors.Is(err, appstore.ErrUnauthorized), errors.Is(err, appstore.ErrInvalidCredentials):
		return storeTransaction{}, s.storeRefusedCredentialsError(ctx, tenantID, storeAppStore, err)
	case err != nil:
		return storeTransaction{}, s.storeUnavailableError(ctx, tenantID, storeAppStore, err)
	}
	current, err := s.stores.appStoreVerifier.VerifyTransaction(signed)
	if err != nil {
		return storeTransaction{}, s.internalError(ctx, "the App Store answered a transaction that does not verify", err, "tenant_id", tenantID.String())
	}
	if current.TransactionID != claimed.TransactionID || current.BundleID != credentials.BundleIdentifier {
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction belongs to another app"))
	}
	if current.Type != appstore.TypeConsumable {
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction is not for a consumable product"))
	}
	if current.RevocationDate != 0 {
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction has been revoked"))
	}
	return storeTransaction{
		store:         storeAppStore,
		transactionID: current.TransactionID,
		productID:     current.ProductID,
		accountToken:  current.AppAccountToken,
		isTest:        current.Environment == appstore.EnvironmentSandbox,
	}, nil
}

// verifyGooglePlayPurchase asks Google Play for the purchase a token names.
// The token is looked up in the tenant's own app, so a purchase made in
// another app is one Google Play does not find.
func (s *apiServer) verifyGooglePlayPurchase(ctx context.Context, tenantID uuid.UUID, productID, token string) (storeTransaction, error) {
	credentials, err := s.appStores(ctx).LoadGooglePlayCredentials(ctx, tenantID)
	if err != nil {
		return storeTransaction{}, s.storeCredentialsError(ctx, tenantID, storeGooglePlay, err)
	}
	purchase, err := s.stores.googlePlay.GetProductPurchase(ctx, []byte(credentials.ServiceAccountKey), credentials.PackageName, productID, token)
	switch {
	case errors.Is(err, googleplay.ErrPurchaseNotFound):
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("no such purchase is known to Google Play"))
	case errors.Is(err, googleplay.ErrUnauthorized), errors.Is(err, googleplay.ErrInvalidCredentials):
		return storeTransaction{}, s.storeRefusedCredentialsError(ctx, tenantID, storeGooglePlay, err)
	case err != nil:
		return storeTransaction{}, s.storeUnavailableError(ctx, tenantID, storeGooglePlay, err)
	}
	switch purchase.PurchaseState {
	case googleplay.PurchaseStatePurchased:
	case googleplay.PurchaseStatePending:
		return storeTransaction{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("the purchase is still pending"))
	default:
		return storeTransaction{}, connect.NewError(connect.CodeInvalidArgument, errors.New("the purchase was canceled"))
	}
	return storeTransaction{
		store:         storeGooglePlay,
		transactionID: token,
		productID:     productID,
		accountToken:  purchase.ObfuscatedExternalAccountID,
		isTest:        purchase.IsTest(),
	}, nil
}

// recordStorePurchase turns a verified transaction into the purchase of the
// intent it names, once.
func (s *apiServer) recordStorePurchase(ctx context.Context, tenantID, userID uuid.UUID, transaction storeTransaction) (*publirav1.MyPurchase, error) {
	intentID, err := uuid.Parse(transaction.accountToken)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction names no purchase intent"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin store purchase transaction", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	intent, err := txq.LockStorePurchaseIntent(ctx, dbmodels.LockStorePurchaseIntentParams{TenantID: tenantID, ID: intentID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction names no purchase intent"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock a store purchase intent", err, "tenant_id", tenantID.String())
	}
	// Checked under the intent's lock: a concurrent confirmation of the same
	// transaction has committed its purchase by the time this one holds it.
	if purchase, found, err := s.recordedStorePurchase(ctx, txq, tenantID, userID, transaction.store, transaction.transactionID); err != nil || found {
		return purchase, err
	}
	if intent.UserID != userID {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("purchase intent belongs to another reader"))
	}
	if intent.ConsumedAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("purchase intent has already been used"))
	}
	if intent.ProductID != transaction.productID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("transaction bought another product than the intent"))
	}

	var expiresAt sql.NullTime
	if hours := intent.ReadingPeriodHours.Int32; intent.ReadingPeriodHours.Valid && hours > 0 {
		now := time.Now().UTC()
		expiresAt = sql.NullTime{Time: now.AddDate(0, 0, int(hours/24)).Add(time.Duration(hours%24) * time.Hour), Valid: true}
	}
	purchase, err := txq.CreateStorePurchase(ctx, dbmodels.CreateStorePurchaseParams{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		UserID:             userID,
		EpisodeID:          intent.EpisodeID,
		PriceAtPurchase:    intent.Price,
		ExpiresAt:          expiresAt,
		Store:              transaction.store,
		StoreTransactionID: transaction.transactionID,
		IsTest:             transaction.isTest,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record a store purchase", err, "tenant_id", tenantID.String(), "store", transaction.store)
	}
	refunded, err := storepurchase.ApplyHeldRefund(ctx, txq, tenantID, purchase.ID, transaction.store, transaction.transactionID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to apply a held store refund", err, "tenant_id", tenantID.String())
	}
	if refunded {
		s.logger.InfoContext(ctx, "applied a store refund that arrived before its purchase",
			"tenant_id", tenantID, "purchase_id", purchase.ID, "store", transaction.store)
	}
	if err := txq.ConsumeStorePurchaseIntent(ctx, dbmodels.ConsumeStorePurchaseIntentParams{TenantID: tenantID, ID: intent.ID}); err != nil {
		return nil, s.internalDBError(ctx, "failed to consume a store purchase intent", err, "tenant_id", tenantID.String())
	}
	if _, err := txq.ProjectPurchaseContentEventByID(ctx, dbmodels.ProjectPurchaseContentEventByIDParams{
		ID:         uuid.Must(uuid.NewV7()),
		TenantID:   tenantID,
		PurchaseID: purchase.ID,
	}); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to project a store purchase", err, "tenant_id", tenantID.String())
	}
	// A purchase Google Play has already voided is not one to consume.
	if transaction.store == storeGooglePlay && !refunded {
		payload, err := json.Marshal(outbox.GooglePlayPurchaseConsumePayload{
			TenantID:      tenantID.String(),
			PurchaseID:    purchase.ID.String(),
			ProductID:     transaction.productID,
			PurchaseToken: transaction.transactionID,
		})
		if err != nil {
			return nil, s.internalError(ctx, "failed to encode a google play consume event", err, "tenant_id", tenantID.String())
		}
		if err := insertPublicOutboxEvent(ctx, txq, tenantID, outbox.EventTypeGooglePlayPurchaseConsume, payload, fmt.Sprintf("google-play-consume:%s", purchase.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue a google play consume event", err, "tenant_id", tenantID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit a store purchase", err, "tenant_id", tenantID.String())
	}
	s.logger.InfoContext(ctx, "recorded a store purchase",
		"tenant_id", tenantID,
		"purchase_id", purchase.ID,
		"store", transaction.store,
		"is_test", transaction.isTest,
	)
	return s.myPurchase(ctx, s.queriesFor(ctx), tenantID, userID, purchase.ID)
}
