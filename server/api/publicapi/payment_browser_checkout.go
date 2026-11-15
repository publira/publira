package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// storedCheckoutRequest is what payment_checkouts.request holds of the
// request a checkout was started with beside its purchase: what the checkout
// shows the reader and where it returns them, which the storefront page of a
// [paymentprovider.BrowserCheckout] reads back.
type storedCheckoutRequest struct {
	LineItemName string
	LineItems    []paymentprovider.LineItem `json:",omitempty"`
	Discount     *paymentprovider.Discount  `json:",omitempty"`
	SuccessURL   string
	CancelURL    string
}

// browserCheckoutPageURL answers the storefront page that runs the script of
// the provider providerID for the checkout checkoutID: on the site the
// checkout returns the reader to, which every checkout's success URL is on.
func browserCheckoutPageURL(successURL, providerID, checkoutID string) (string, error) {
	success, err := url.Parse(successURL)
	if err != nil || success.Scheme == "" || success.Host == "" {
		return "", fmt.Errorf("the success URL %q names no site", successURL)
	}
	page := url.URL{Scheme: success.Scheme, Host: success.Host, Path: paymentprovider.BrowserCheckoutPath(providerID, checkoutID)}
	return page.String(), nil
}

// browserCheckoutProvider answers the registered provider providerID names
// when its checkouts run in the browser, or not_found, which is also what a
// checkout the tenant did not start answers, so the two read alike.
func (s *apiServer) browserCheckoutProvider(providerID string) (paymentprovider.BrowserCheckout, error) {
	registered, ok := s.paymentProviders.Lookup(providerID)
	if !ok {
		return nil, browserCheckoutNotFound()
	}
	browser, ok := registered.(paymentprovider.BrowserCheckout)
	if !ok {
		return nil, browserCheckoutNotFound()
	}
	return browser, nil
}

func browserCheckoutNotFound() error {
	return connect.NewError(connect.CodeNotFound, "checkout not found")
}

// browserCheckoutIDs reads the provider and the checkout a request names.
func browserCheckoutIDs(provider, checkoutID string) (string, string, error) {
	providerID, checkoutID := strings.TrimSpace(provider), strings.TrimSpace(checkoutID)
	if providerID == "" {
		return "", "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the request names no provider"), "provider")
	}
	if checkoutID == "" {
		return "", "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the request names no checkout"), "checkout_id")
	}
	return providerID, checkoutID, nil
}

func (s *apiServer) GetBrowserCheckout(
	ctx context.Context,
	req *publirav1.GetBrowserCheckoutRequest,
) (*publirav1.GetBrowserCheckoutResponse, error) {
	providerID, checkoutID, err := browserCheckoutIDs(req.Provider, req.CheckoutId)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	browser, err := s.browserCheckoutProvider(providerID)
	if err != nil {
		return nil, err
	}
	keyvals := []any{"tenant_id", tenant.ID.String(), "provider", providerID, "checkout_id", checkoutID}
	registered, _ := s.paymentProviders.Lookup(providerID)
	row, err := s.queriesFor(ctx).GetBrowserPaymentCheckout(ctx, dbmodels.GetBrowserPaymentCheckoutParams{
		LifetimeSeconds: registered.Declaration().CheckoutLifetime.Seconds(),
		TenantID:        tenant.ID,
		Provider:        providerID,
		CheckoutID:      checkoutID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, browserCheckoutNotFound()
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read a checkout that runs in the browser", err, keyvals...)
	}
	// A payment already completed the checkout, so the page starts no
	// second one of it.
	if row.PaymentID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the checkout is paid already")
	}
	if row.Closed || row.Request == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the checkout can no longer be paid")
	}
	purchase, err := s.decodeStoredPurchase(ctx, row.Purchase, keyvals...)
	if err != nil {
		return nil, err
	}
	var request storedCheckoutRequest
	if err := json.Unmarshal(*row.Request, &request); err != nil {
		return nil, s.internalError(ctx, "failed to decode the request of a checkout", err, keyvals...)
	}
	_, credentials, err := s.loadPaymentProvider(ctx, tenant.ID, providerID)
	if err != nil {
		return nil, err
	}
	buyer, err := s.checkoutBuyer(ctx, tenant.ID, providerID, purchase, keyvals...)
	if err != nil {
		return nil, err
	}
	script, err := browser.CheckoutScript(credentials, paymentprovider.StoredCheckout{
		CheckoutID:   checkoutID,
		Purchase:     purchase,
		LineItemName: request.LineItemName,
		LineItems:    request.LineItems,
		Discount:     request.Discount,
	}, buyer)
	if err != nil {
		return nil, s.internalError(ctx, "the payment provider made no script of a checkout", err, keyvals...)
	}
	return &publirav1.GetBrowserCheckoutResponse{
		Credentials: script.Credentials,
		Payload:     string(script.Payload),
		SuccessUrl:  request.SuccessURL,
		CancelUrl:   request.CancelURL,
	}, nil
}

// checkoutBuyer answers what the server holds of the reader purchase is for,
// as the provider providerID is told it, or failed_precondition once their
// account is gone, as nothing can then be bought for it.
func (s *apiServer) checkoutBuyer(ctx context.Context, tenantID uuid.UUID, providerID string, purchase paymentprovider.Purchase, keyvals ...any) (paymentprovider.Buyer, error) {
	history, err := s.queriesFor(ctx).GetReaderPaymentHistory(ctx, dbmodels.GetReaderPaymentHistoryParams{
		Currency: purchase.Currency,
		Provider: providerID,
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		UserID:   purchase.ReaderID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return paymentprovider.Buyer{}, connect.NewError(connect.CodeFailedPrecondition, "the checkout can no longer be paid")
	}
	if err != nil {
		return paymentprovider.Buyer{}, s.internalDBError(ctx, "failed to read what the reader has paid", err, keyvals...)
	}
	buyer := paymentprovider.Buyer{
		ID:           history.PublicID,
		RegisteredAt: history.RegisteredAt.UTC(),
		Payments:     history.Payments,
		AmountPaid:   history.AmountPaid,
	}
	if history.Payments > 0 {
		buyer.LastPaidAt = history.LastPaidAt.UTC()
		buyer.LastAmount = history.LastAmount
	}
	return buyer, nil
}

func (s *apiServer) CompleteBrowserCheckout(
	ctx context.Context,
	req *publirav1.CompleteBrowserCheckoutRequest,
) (*publirav1.CompleteBrowserCheckoutResponse, error) {
	providerID, checkoutID, err := browserCheckoutIDs(req.Provider, req.CheckoutId)
	if err != nil {
		return nil, err
	}
	paymentID := strings.TrimSpace(req.PaymentId)
	if paymentID == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the request names no payment"), "payment_id")
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.browserCheckoutProvider(providerID); err != nil {
		return nil, err
	}
	purchase, found, err := s.storedCheckoutPurchase(ctx, tenant.ID, providerID, checkoutID, "")
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, browserCheckoutNotFound()
	}
	// Completing a checkout reads and captures the payment on the tenant's
	// credentials, a request the reader who started the checkout makes the
	// storefront send, so it spends the allowance starting one does.
	if err := s.chargeReaderAction(ctx, actionStartPurchaseCheckout, tenant.ID, purchase.ReaderID); err != nil {
		return nil, err
	}
	// A provider the tenant retired still completes what its script took.
	provider, credentials, err := s.loadPaymentProvider(ctx, tenant.ID, providerID)
	if err != nil {
		return nil, err
	}
	if err := s.completeBrowserCheckout(ctx, tenant.ID, provider, credentials, "page:"+paymentID, checkoutID, paymentID); err != nil {
		return nil, err
	}
	return &publirav1.CompleteBrowserCheckoutResponse{}, nil
}

// recordAuthorizedCheckout completes the checkout event reports a payment
// authorized for, as the storefront page completes it, or answers the error
// the webhook answers.
func (s *apiServer) recordAuthorizedCheckout(
	ctx context.Context,
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	event paymentprovider.CheckoutAuthorized,
) error {
	if _, ok := provider.(paymentprovider.BrowserCheckout); !ok {
		return s.internalError(ctx, "a payment provider whose checkouts do not run in the browser reported an authorization", errors.New("unexpected checkout authorization"), "tenant_id", tenantID.String(), "provider", provider.Declaration().ID, "event_id", event.ID)
	}
	return s.completeBrowserCheckout(ctx, tenantID, provider, credentials, event.ID, event.CheckoutID, event.PaymentID)
}

// completeBrowserCheckout completes the tenant's checkout checkoutID through
// a [paymentprovider.BrowserCheckout] with the payment paymentID, which
// eventID names in logs: the provider captures it, the server keeps it beside
// the checkout, and the purchase is recorded as a provider's
// [paymentprovider.PurchaseCompleted] is. It answers the error the RPC or the
// webhook answers, which is [connect.CodeInvalidArgument] for a payment no
// retry makes the checkout's.
//
// The checkout's row is held from before the payment is read until the
// payment is kept, so that the page and the provider's notification
// completing the same checkout at once capture the payment once, and a second
// payment of a checkout another already completed is refused before anything
// captures it. The purchase is recorded after the row is let go, as a
// notification's is: recording it is what makes a redelivery a no-op, so a
// failure there is one a retry by either of the two completes.
func (s *apiServer) completeBrowserCheckout(
	ctx context.Context,
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	eventID, checkoutID, paymentID string,
) error {
	browser := provider.(paymentprovider.BrowserCheckout)
	providerID := provider.Declaration().ID
	keyvals := []any{"tenant_id", tenantID.String(), "provider", providerID, "event_id", eventID, "checkout_id", checkoutID, "payment_id", paymentID}
	completed, err := func() (paymentprovider.PurchaseCompleted, error) {
		tx, err := s.beginTenantTx(ctx)
		if err != nil {
			return paymentprovider.PurchaseCompleted{}, s.internalDBError(ctx, "failed to begin the checkout transaction", err, keyvals...)
		}
		defer tx.Rollback() //nolint:errcheck
		queries := dbmodels.New(tx)
		held, err := queries.LockPaymentCheckout(ctx, dbmodels.LockPaymentCheckoutParams{
			TenantID:   tenantID,
			Provider:   providerID,
			CheckoutID: checkoutID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			s.logger.WarnContext(ctx, "a payment names a checkout the tenant did not start", keyvals...)
			return paymentprovider.PurchaseCompleted{}, connect.NewError(connect.CodeInvalidArgument, "checkout tenant does not match webhook path")
		}
		if err != nil {
			return paymentprovider.PurchaseCompleted{}, s.internalDBError(ctx, "failed to hold a checkout", err, keyvals...)
		}
		if held.PaymentID.Valid && held.PaymentID.String != paymentID {
			s.logger.WarnContext(ctx, "a second payment names a checkout another payment completed", append(keyvals, "completed_by", held.PaymentID.String)...)
			return paymentprovider.PurchaseCompleted{}, connect.NewError(connect.CodeInvalidArgument, "the checkout is paid already")
		}
		purchase, err := s.decodeStoredPurchase(ctx, held.Purchase, keyvals...)
		if err != nil {
			return paymentprovider.PurchaseCompleted{}, err
		}
		completed, err := browser.CompleteCheckout(ctx, credentials, paymentprovider.StoredCheckout{CheckoutID: checkoutID, Purchase: purchase}, paymentID)
		switch {
		case errors.Is(err, paymentprovider.ErrPaymentMismatch):
			s.logger.WarnContext(ctx, "a payment does not match the checkout it names", append(keyvals, "error", err)...)
			return paymentprovider.PurchaseCompleted{}, connect.NewError(connect.CodeInvalidArgument, "the payment does not match its checkout")
		case errors.Is(err, paymentprovider.ErrCredentialsRefused):
			s.logger.WarnContext(ctx, "the payment provider refused the tenant's credentials", append(keyvals, "error", err)...)
			return paymentprovider.PurchaseCompleted{}, paymentsNotConfiguredError()
		case err != nil:
			s.logger.ErrorContext(ctx, "failed to complete a checkout with the payment provider", append(keyvals, "error", err)...)
			return paymentprovider.PurchaseCompleted{}, connect.NewError(connect.CodeUnavailable, "failed to complete checkout")
		}
		if completed.CheckoutID != checkoutID || completed.PaymentID != paymentID {
			return paymentprovider.PurchaseCompleted{}, s.internalError(ctx, "the payment provider completed another checkout or payment than it was asked to", fmt.Errorf("completed %s with %s", completed.CheckoutID, completed.PaymentID), keyvals...)
		}
		if err := queries.KeepPaymentCheckoutPayment(ctx, dbmodels.KeepPaymentCheckoutPaymentParams{
			PaymentID:  sql.NullString{String: paymentID, Valid: true},
			TenantID:   tenantID,
			Provider:   providerID,
			CheckoutID: checkoutID,
		}); err != nil {
			return paymentprovider.PurchaseCompleted{}, s.internalDBError(ctx, "failed to keep the payment of a checkout", err, keyvals...)
		}
		if err := tx.Commit(); err != nil {
			return paymentprovider.PurchaseCompleted{}, s.internalDBError(ctx, "failed to commit the checkout transaction", err, keyvals...)
		}
		return completed, nil
	}()
	if err != nil {
		return err
	}
	completed.ID = eventID
	return s.recordCompletedCheckout(ctx, tenantID, provider, credentials, completed)
}

// decodeStoredPurchase reads the purchase payment_checkouts.purchase holds,
// by the rules a provider reads the one it carried by, or answers the error
// the RPC answers, logged with keyvals.
func (s *apiServer) decodeStoredPurchase(ctx context.Context, encoded json.RawMessage, keyvals ...any) (paymentprovider.Purchase, error) {
	var purchase paymentprovider.Purchase
	if err := json.Unmarshal(encoded, &purchase); err != nil {
		return paymentprovider.Purchase{}, s.internalError(ctx, "failed to decode the purchase of a checkout", err, keyvals...)
	}
	kind, err := paymentprovider.ParseKind(string(purchase.Kind), int64(purchase.ReadingPeriodHours))
	if err != nil {
		return paymentprovider.Purchase{}, s.internalError(ctx, "the purchase of a checkout names no kind it can be", err, keyvals...)
	}
	purchase.Kind = kind
	return purchase, nil
}
