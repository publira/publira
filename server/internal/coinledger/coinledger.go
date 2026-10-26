// Package coinledger holds what the public API and the worker share about the
// coins a pack purchase grants: granting them, and taking back what is left
// of them once the purchase is refunded or disputed.
//
// A reader's coins are a ledger of grants. A pack purchase grants once, and
// closing it takes back the coins of the grant still unspent. The coins of it
// already spent cannot be taken back, since they opened episodes the reader
// keeps, so they are recorded as a shortfall the reader owes, and the next
// grants pay it as they are made, before any coin of them can be spent. What
// those coins were worth is recorded as refunded on the purchases they paid
// for, which takes it back from the sales a royalty statement pays on.
//
// Every write here holds the lock a spend holds (LockCoinSpendsOfUser), so it
// and the reader's spends see each other's grants whole. q therefore has to be
// the querier of a transaction, or the lock is released as soon as it is
// taken.
package coinledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// Values of coin_transactions.kind written here.
const (
	KindGrant               = "grant"
	KindRevocation          = "revocation"
	KindShortfall           = "shortfall"
	KindShortfallSettlement = "shortfall_settlement"
)

// Querier is the persistence the ledger needs.
type Querier interface {
	LockCoinSpendsOfUser(ctx context.Context, arg dbmodels.LockCoinSpendsOfUserParams) error
	GetCoinShortfallOfUser(ctx context.Context, arg dbmodels.GetCoinShortfallOfUserParams) (int64, error)
	CreatePackCoinGrant(ctx context.Context, arg dbmodels.CreatePackCoinGrantParams) (uuid.UUID, error)
	CreateCoinGrantTransaction(ctx context.Context, arg dbmodels.CreateCoinGrantTransactionParams) error
	GetCoinGrantOfPurchase(ctx context.Context, arg dbmodels.GetCoinGrantOfPurchaseParams) (dbmodels.GetCoinGrantOfPurchaseRow, error)
	LockCoinGrant(ctx context.Context, arg dbmodels.LockCoinGrantParams) (dbmodels.LockCoinGrantRow, error)
	GetExpiredCoinsOfGrant(ctx context.Context, arg dbmodels.GetExpiredCoinsOfGrantParams) (int32, error)
	CloseCoinGrant(ctx context.Context, arg dbmodels.CloseCoinGrantParams) error
	RefundCoinSpendsOfGrant(ctx context.Context, arg dbmodels.RefundCoinSpendsOfGrantParams) (int64, error)
}

// Grant is what a pack purchase grants.
type Grant struct {
	TenantID   uuid.UUID
	UserID     uuid.UUID
	PurchaseID uuid.UUID
	// Coins is the pack's coins and bonus coins together.
	Coins int32
	// ExpiresAt is when they stop being spendable: the purchase's own instant
	// plus the tenant's expiry_days the purchase was sold on.
	ExpiresAt time.Time
}

// ExpiresAt is when coins bought at purchasedAt, under an expiry of
// expiryDays, stop being spendable.
func ExpiresAt(purchasedAt time.Time, expiryDays int32) time.Time {
	return purchasedAt.UTC().AddDate(0, 0, int(expiryDays))
}

// GrantPack grants the coins of a pack purchase, taking what the reader owes
// out of them first, and reports whether it granted anything: a purchase
// granted already grants nothing again.
func GrantPack(ctx context.Context, q Querier, grant Grant) (bool, error) {
	if err := q.LockCoinSpendsOfUser(ctx, dbmodels.LockCoinSpendsOfUserParams{TenantID: grant.TenantID, UserID: grant.UserID}); err != nil {
		return false, fmt.Errorf("lock the reader's coin spends: %w", err)
	}
	owed, err := q.GetCoinShortfallOfUser(ctx, dbmodels.GetCoinShortfallOfUserParams{TenantID: grant.TenantID, UserID: grant.UserID})
	if err != nil {
		return false, fmt.Errorf("read what the reader owes: %w", err)
	}
	settled := int32(min(max(owed, 0), int64(grant.Coins)))
	grantID, err := q.CreatePackCoinGrant(ctx, dbmodels.CreatePackCoinGrantParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       grant.TenantID,
		UserID:         grant.UserID,
		PurchaseID:     grant.PurchaseID,
		Coins:          grant.Coins,
		RemainingCoins: grant.Coins - settled,
		ExpiresAt:      grant.ExpiresAt,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("grant the coins of a pack purchase: %w", err)
	}
	user := uuid.NullUUID{UUID: grant.UserID, Valid: true}
	if err := record(ctx, q, grant.TenantID, user, grantID, KindGrant, grant.Coins); err != nil {
		return false, err
	}
	if err := record(ctx, q, grant.TenantID, user, grantID, KindShortfallSettlement, settled); err != nil {
		return false, err
	}
	return true, nil
}

// Revocation is what closing a grant did.
type Revocation struct {
	// Closed is false for a purchase whose grant was closed before, or that
	// granted nothing, and every count is then 0.
	Closed bool
	// Revoked is the coins of the grant taken back, and Shortfall the coins of
	// it already spent, which the reader now owes.
	Revoked   int32
	Shortfall int32
	// RefundedAmount is what the coins of it already spent were worth, now
	// refunded on the purchases they paid for.
	RefundedAmount int64
}

// RevokePackGrant closes the grant a pack purchase made, because the purchase
// has been refunded or disputed: what it has left is taken back, and what of
// it was spent is recorded as the reader's shortfall, and as a refund of the
// purchases it paid for. Coins of it that lapsed unspent were never spent, so
// they are no part of the shortfall. A grant closed already is left as it is.
func RevokePackGrant(ctx context.Context, q Querier, tenantID, purchaseID uuid.UUID) (Revocation, error) {
	owner, err := q.GetCoinGrantOfPurchase(ctx, dbmodels.GetCoinGrantOfPurchaseParams{TenantID: tenantID, PurchaseID: purchaseID})
	if errors.Is(err, sql.ErrNoRows) {
		return Revocation{}, nil
	}
	if err != nil {
		return Revocation{}, fmt.Errorf("read the grant of a pack purchase: %w", err)
	}
	// The reader's spends are held before the grant, in the order a spend
	// takes them. A reader who has deleted their account spends nothing more.
	if owner.UserID.Valid {
		if err := q.LockCoinSpendsOfUser(ctx, dbmodels.LockCoinSpendsOfUserParams{TenantID: tenantID, UserID: owner.UserID.UUID}); err != nil {
			return Revocation{}, fmt.Errorf("lock the reader's coin spends: %w", err)
		}
	}
	grant, err := q.LockCoinGrant(ctx, dbmodels.LockCoinGrantParams{TenantID: tenantID, ID: owner.ID})
	if err != nil {
		return Revocation{}, fmt.Errorf("lock the grant of a pack purchase: %w", err)
	}
	if grant.RevokedAt.Valid {
		return Revocation{}, nil
	}
	lapsed, err := q.GetExpiredCoinsOfGrant(ctx, dbmodels.GetExpiredCoinsOfGrantParams{TenantID: tenantID, GrantID: grant.ID})
	if err != nil {
		return Revocation{}, fmt.Errorf("read the coins of a grant that lapsed: %w", err)
	}
	revocation := Revocation{
		Closed:    true,
		Revoked:   grant.RemainingCoins,
		Shortfall: max(grant.Coins-grant.RemainingCoins-lapsed, 0),
	}
	if err := q.CloseCoinGrant(ctx, dbmodels.CloseCoinGrantParams{TenantID: tenantID, ID: grant.ID}); err != nil {
		return Revocation{}, fmt.Errorf("close the grant of a pack purchase: %w", err)
	}
	if err := record(ctx, q, tenantID, owner.UserID, grant.ID, KindRevocation, revocation.Revoked); err != nil {
		return Revocation{}, err
	}
	if err := record(ctx, q, tenantID, owner.UserID, grant.ID, KindShortfall, revocation.Shortfall); err != nil {
		return Revocation{}, err
	}
	revocation.RefundedAmount, err = q.RefundCoinSpendsOfGrant(ctx, dbmodels.RefundCoinSpendsOfGrantParams{TenantID: tenantID, GrantID: grant.ID})
	if err != nil {
		return Revocation{}, fmt.Errorf("refund the purchases a grant's coins paid for: %w", err)
	}
	return revocation, nil
}

// record writes one entry of the reader's history about a grant, and none for
// no coins, which the history has no entry for.
func record(ctx context.Context, q Querier, tenantID uuid.UUID, userID uuid.NullUUID, grantID uuid.UUID, kind string, coins int32) error {
	if coins <= 0 {
		return nil
	}
	if err := q.CreateCoinGrantTransaction(ctx, dbmodels.CreateCoinGrantTransactionParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenantID,
		UserID:   userID,
		Kind:     kind,
		Coins:    coins,
		GrantID:  grantID,
	}); err != nil {
		return fmt.Errorf("record a coin %s: %w", kind, err)
	}
	return nil
}
