package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

// PaymentRefundFollowConfig is what the worker resolves once at startup for
// [NewPaymentRefundFollowHandler]. The tenant's credentials are read per
// event.
type PaymentRefundFollowConfig struct {
	DB        *sql.DB
	Encryptor paymentsettings.SecretManager
	Providers *paymentprovider.Registry
	Logger    *slog.Logger
}

// NewPaymentRefundFollowHandler handles [outbox.EventTypePaymentRefundFollow]:
// it reads back the refunds of the payment an event names from a provider
// that sends no notification of them, through the notification the provider
// answers for that, and records what it reads as [apiServer.ProcessPaymentWebhook]
// records a refund the provider notified.
//
// A refund the provider has neither made nor failed yet, and settings only
// the tenant can put right, are [outbox.Blocked]: the event waits, without
// spending an attempt, for the provider to settle the refund or the tenant to
// save credentials that work, since a refund staff asked for waits on it.
func NewPaymentRefundFollowHandler(cfg PaymentRefundFollowConfig) outbox.Handler {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	s := &apiServer{
		db:               cfg.DB,
		queries:          dbmodels.New(cfg.DB),
		encryptor:        cfg.Encryptor,
		logger:           logger,
		paymentProviders: cfg.Providers,
	}
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Providers == nil {
			return errors.New("payment refund follow handler is not configured")
		}
		tenantID, payload, err := outbox.DecodePaymentRefundFollow(event)
		if err != nil {
			return err
		}
		registered, ok := cfg.Providers.Lookup(payload.Provider)
		if !ok {
			return outbox.Blocked(fmt.Errorf("payment provider %q is not registered", payload.Provider))
		}
		follower, ok := registered.(paymentprovider.RefundFollower)
		if !ok {
			return outbox.Permanent(fmt.Errorf("payment provider %q notifies its own refunds", payload.Provider))
		}

		// The refund is recorded through the tenant-scoped connection a
		// request of the tenant's would be served on.
		conn, release, err := tenantconn.Acquire(ctx, cfg.DB, tenantID, logger)
		if err != nil {
			return fmt.Errorf("acquire a tenant connection: %w", err)
		}
		defer release()
		ctx = rpcmiddleware.WithTenantConn(ctx, conn)
		ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))

		// A provider the tenant retired still answers for what it took.
		_, credentials, err := s.paymentStore(ctx).LoadProvider(ctx, tenantID, payload.Provider)
		if paymentsettings.IsUnavailable(err) {
			return outbox.Blocked(fmt.Errorf("load the payment settings: %w", err))
		}
		if err != nil {
			return fmt.Errorf("load the payment settings: %w", err)
		}
		parsed, err := registered.ParseNotification(ctx, follower.RefundNotification(payload.PaymentID), http.Header{}, credentials)
		switch {
		case errors.Is(err, paymentprovider.ErrRefundPending), errors.Is(err, paymentprovider.ErrCredentialsRefused):
			return outbox.Blocked(fmt.Errorf("read the refunds of payment %s: %w", payload.PaymentID, err))
		case errors.Is(err, paymentprovider.ErrInvalidSignature), errors.Is(err, paymentprovider.ErrMalformedNotification):
			// The provider holds no such payment under the tenant's
			// credentials, which no later read changes.
			return outbox.Permanent(fmt.Errorf("read the refunds of payment %s: %w", payload.PaymentID, err))
		case err != nil:
			return fmt.Errorf("read the refunds of payment %s: %w", payload.PaymentID, err)
		}
		switch parsed := parsed.(type) {
		case paymentprovider.Refunded:
			return s.recordRefund(ctx, s.queriesFor(ctx), tenantID, registered, credentials, parsed)
		case paymentprovider.RefundFailed:
			return s.recordFailedRefund(ctx, s.queriesFor(ctx), tenantID, payload.Provider, parsed)
		case paymentprovider.Ignored:
			return nil
		default:
			return outbox.Permanent(fmt.Errorf("the refunds of payment %s read as %T", payload.PaymentID, parsed))
		}
	}
}
