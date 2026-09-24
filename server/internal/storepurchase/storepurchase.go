// Package storepurchase holds what the public API and the worker share about a
// purchase made through the App Store or Google Play: the values of
// purchases.store, and how a store's refund lands on the purchase it reverses.
package storepurchase

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// Values of purchases.store.
const (
	StoreAppStore   = "app_store"
	StoreGooglePlay = "google_play"
)

// RefundQuerier is the persistence a refund needs.
type RefundQuerier interface {
	RecordStoreRefundOnPurchase(ctx context.Context, arg dbmodels.RecordStoreRefundOnPurchaseParams) (dbmodels.Purchase, error)
	HoldUnappliedStoreRefund(ctx context.Context, arg dbmodels.HoldUnappliedStoreRefundParams) error
	ApplyUnappliedStoreRefundToPurchase(ctx context.Context, arg dbmodels.ApplyUnappliedStoreRefundToPurchaseParams) (dbmodels.Purchase, error)
	ReleaseUnappliedStoreRefund(ctx context.Context, arg dbmodels.ReleaseUnappliedStoreRefundParams) error
}

// RecordRefund writes a store's refund of transactionID onto its purchase and
// answers true, or holds it and answers false when the transaction has no
// purchase here yet. Either way a repeat changes nothing.
func RecordRefund(ctx context.Context, q RefundQuerier, tenantID uuid.UUID, store, transactionID string) (bool, error) {
	_, err := q.RecordStoreRefundOnPurchase(ctx, dbmodels.RecordStoreRefundOnPurchaseParams{
		TenantID:           tenantID,
		Store:              store,
		StoreTransactionID: transactionID,
	})
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("record store refund: %w", err)
	}
	if err := q.HoldUnappliedStoreRefund(ctx, dbmodels.HoldUnappliedStoreRefundParams{
		TenantID:           tenantID,
		Store:              store,
		StoreTransactionID: transactionID,
	}); err != nil {
		return false, fmt.Errorf("hold store refund: %w", err)
	}
	return false, nil
}

// ApplyHeldRefund writes onto a purchase just recorded any refund of its
// transaction that arrived first, and answers whether there was one. The
// caller runs it in the transaction that records the purchase.
func ApplyHeldRefund(ctx context.Context, q RefundQuerier, tenantID, purchaseID uuid.UUID, store, transactionID string) (bool, error) {
	_, err := q.ApplyUnappliedStoreRefundToPurchase(ctx, dbmodels.ApplyUnappliedStoreRefundToPurchaseParams{
		TenantID:   tenantID,
		PurchaseID: purchaseID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("apply held store refund: %w", err)
	}
	if err := q.ReleaseUnappliedStoreRefund(ctx, dbmodels.ReleaseUnappliedStoreRefundParams{
		TenantID:           tenantID,
		Store:              store,
		StoreTransactionID: transactionID,
	}); err != nil {
		return false, fmt.Errorf("release held store refund: %w", err)
	}
	return true, nil
}
