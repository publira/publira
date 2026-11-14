package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

// NewPaymentCheckoutFollowHandler handles
// [outbox.EventTypePaymentCheckoutFollow]: it reads back the payment of the
// checkout an event names from a provider that may notify it only once,
// through the notification the provider answers for that, and records what it
// reads as [apiServer.ProcessPaymentWebhook] records a checkout the provider
// notified, so a notification that also arrives records nothing more.
//
// A checkout the provider holds no payment of yet is [outbox.Blocked], read
// again later without spending an attempt, until
// [paymentprovider.Declaration.CheckoutLifetime] has passed since its last
// start, after which nothing can pay it and the event is done. Settings only
// the tenant can put right are [outbox.Blocked] as well, whatever the
// checkout's lifetime, since the reader may have paid in the meantime.
func NewPaymentCheckoutFollowHandler(cfg PaymentFollowConfig) outbox.Handler {
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
			return errors.New("payment checkout follow handler is not configured")
		}
		tenantID, payload, err := outbox.DecodePaymentCheckoutFollow(event)
		if err != nil {
			return err
		}
		registered, ok := cfg.Providers.Lookup(payload.Provider)
		if !ok {
			return outbox.Blocked(fmt.Errorf("payment provider %q is not registered", payload.Provider))
		}
		follower, ok := registered.(paymentprovider.CheckoutFollower)
		if !ok {
			return outbox.Permanent(fmt.Errorf("payment provider %q does not follow its checkouts", payload.Provider))
		}

		// The purchase is recorded through the tenant-scoped connection a
		// request of the tenant's would be served on.
		conn, release, err := tenantconn.Acquire(ctx, cfg.DB, tenantID, logger)
		if err != nil {
			return fmt.Errorf("acquire a tenant connection: %w", err)
		}
		defer release()
		ctx = rpcmiddleware.WithTenantConn(ctx, conn)
		ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))

		// Whether the checkout can still be paid is settled before its payment
		// is read, so that a read finding it unpaid once it cannot be has seen
		// every payment it could have taken.
		closed, err := s.queriesFor(ctx).IsPaymentCheckoutClosed(ctx, dbmodels.IsPaymentCheckoutClosedParams{
			LifetimeSeconds: registered.Declaration().CheckoutLifetime.Seconds(),
			TenantID:        tenantID,
			Provider:        payload.Provider,
			CheckoutID:      payload.CheckoutID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return outbox.Permanent(fmt.Errorf("the tenant started no checkout %s", payload.CheckoutID))
		}
		if err != nil {
			return fmt.Errorf("read whether checkout %s can still be paid: %w", payload.CheckoutID, err)
		}
		unpaid := func(reason error) error {
			if closed {
				return nil
			}
			return outbox.Blocked(fmt.Errorf("checkout %s is not paid yet: %w", payload.CheckoutID, reason))
		}

		// A provider the tenant retired still answers for what it took.
		_, credentials, err := s.paymentStore(ctx).LoadProvider(ctx, tenantID, payload.Provider)
		if paymentsettings.IsUnavailable(err) {
			return outbox.Blocked(fmt.Errorf("load the payment settings: %w", err))
		}
		if err != nil {
			return fmt.Errorf("load the payment settings: %w", err)
		}
		parsed, err := registered.ParseNotification(ctx, follower.CheckoutNotification(payload.CheckoutID), http.Header{}, credentials)
		switch {
		case errors.Is(err, paymentprovider.ErrCredentialsRefused):
			return outbox.Blocked(fmt.Errorf("read the payment of checkout %s: %w", payload.CheckoutID, err))
		case errors.Is(err, paymentprovider.ErrInvalidSignature):
			// The provider holds no such checkout under the tenant's
			// credentials, as it does not until a start of it reaches the
			// provider, which a retry may do while the checkout is open.
			return unpaid(err)
		case errors.Is(err, paymentprovider.ErrMalformedNotification):
			return outbox.Permanent(fmt.Errorf("read the payment of checkout %s: %w", payload.CheckoutID, err))
		case err != nil:
			return fmt.Errorf("read the payment of checkout %s: %w", payload.CheckoutID, err)
		}
		switch parsed := parsed.(type) {
		case paymentprovider.PurchaseCompleted:
			return followedCheckoutError(s.recordCompletedCheckout(ctx, tenantID, registered, credentials, parsed))
		case paymentprovider.CheckoutExpired:
			return followedCheckoutError(s.recordCheckoutExpiry(ctx, tenantID, registered, parsed))
		case paymentprovider.Ignored:
			return unpaid(errors.New("the provider reports no payment"))
		default:
			return outbox.Permanent(fmt.Errorf("the payment of checkout %s read as %T", payload.CheckoutID, parsed))
		}
	}
}

// followedCheckoutError answers what the worker makes of err, which recording
// a checkout answered with as the webhook would: a payment no retry makes one
// of the tenant's checkouts is [outbox.Permanent], and anything else is tried
// again.
func followedCheckoutError(err error) error {
	if connect.CodeOf(err) == connect.CodeInvalidArgument {
		return outbox.Permanent(err)
	}
	return err
}
