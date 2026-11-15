// Package paymentrefund asks a payment provider for a refund while no other
// refund of the same payment is at the provider, which is what
// [paymentprovider.RefundRequest.IdempotencyKey] promises a provider.
package paymentrefund

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
)

// ErrNotSent reports a refund that was never sent to the provider, because
// the payment could not be locked against another refund of it.
var ErrNotSent = errors.New("the refund was not sent to the payment provider")

// Send asks provider, under credentials, for the refund req describes, and
// answers what [paymentprovider.Provider.Refund] answers.
//
// The request is made inside a transaction begin opens, which holds a lock on
// the tenant's payment in PostgreSQL until the provider has answered, so a
// refund of the same payment sent from any replica of publira server or
// publira worker waits for it. Waiting is bounded by ctx. A failure to begin
// the transaction or to take the lock is [ErrNotSent].
func Send(
	ctx context.Context,
	begin func(context.Context) (*sql.Tx, error),
	tenantID uuid.UUID,
	provider paymentprovider.Provider,
	credentials paymentprovider.Credentials,
	req paymentprovider.RefundRequest,
) (bool, error) {
	tx, err := begin(ctx)
	if err != nil {
		return false, fmt.Errorf("%w: begin: %w", ErrNotSent, err)
	}
	// The transaction writes nothing, so ending it either way releases the
	// lock and nothing else.
	defer tx.Rollback() //nolint:errcheck
	if err := dbmodels.New(tx).LockPaymentRefund(ctx, dbmodels.LockPaymentRefundParams{
		TenantID:  tenantID,
		Provider:  provider.Declaration().ID,
		PaymentID: req.PaymentID,
	}); err != nil {
		return false, fmt.Errorf("%w: lock the payment: %w", ErrNotSent, err)
	}
	return provider.Refund(ctx, credentials, req)
}
