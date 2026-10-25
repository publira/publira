package platformpolicy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
)

// The fields of UpdatePlatformPolicyRequest a save is refused over. A value
// Policy.Validate refuses is named as a field inside FieldPolicy.
const (
	FieldPolicy           = "policy"
	FieldExpectedRevision = "expected_revision"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past.
	ErrConflict = errors.New("platform policy has changed since it was read")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

// CatalogRevalidator records on q, inside the transaction of a save, that the
// cached series and episode reads of tenantID are owed a drop once
// availableAt has passed. Every caller passes [revalidate.RecordCatalogDrop];
// it is handed in rather than imported because the outbox that function
// writes to reaches this package through the test helpers.
type CatalogRevalidator func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, availableAt time.Time) error

// SaveParams replaces every value of the saved policy.
type SaveParams struct {
	Policy Policy
	// ExpectedRevision is the revision Policy was derived from, 0 when nothing
	// was saved. Nil saves over whatever is stored, for a caller that read
	// nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveParams) Validate() error {
	if err := p.Policy.Validate(); err != nil {
		return fielderr.Within(FieldPolicy, err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return nil
}

// Save writes p in one transaction on db, with its entry filed under actor, so
// a change to the security policy never goes unrecorded. Every Resolver
// rereads the row within CacheTTL. A save that changes no stored value writes
// nothing and files nothing.
func Save(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	actor auditlog.PlatformActor,
	p SaveParams,
	recordCatalogDrop CatalogRevalidator,
) (dbmodels.PlatformPolicyConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformPolicyConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, previous, changed, err := write(ctx, q, p)
	if err != nil || !changed {
		return saved, err
	}
	if saved.TenantCoinsAllowed != previous.TenantCoinsAllowed {
		if err := recordCoinPriceDrops(ctx, q, recordCatalogDrop); err != nil {
			return dbmodels.PlatformPolicyConfig{}, err
		}
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_policy_updated",
		TargetType: "platform_policy",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("audit platform_policy_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

// recordCoinPriceDrops writes down, on q, that the storefront of every tenant
// whose coins are on is owed a drop of its series and episode reads, which
// price each episode in coins only while the platform allows tenant coins.
// The drop waits out CacheTTL, because the API reads the allowance through a
// Resolver and would fill the entry back with the previous answer until then.
func recordCoinPriceDrops(ctx context.Context, q *dbmodels.Queries, recordCatalogDrop CatalogRevalidator) error {
	tenants, err := q.ListTenantsWithCoinsEnabled(ctx)
	if err != nil {
		return fmt.Errorf("list the tenants whose coins are on: %w", err)
	}
	availableAt := time.Now().Add(CacheTTL)
	for _, tenantID := range tenants {
		if err := recordCatalogDrop(ctx, q, tenantID, availableAt); err != nil {
			return fmt.Errorf("record the coin price drop of tenant %s: %w", tenantID, err)
		}
	}
	return nil
}

// write saves p over the stored row, and answers the row it saved, the row it
// replaced (the zero row when there was none), and whether anything changed.
func write(ctx context.Context, q *dbmodels.Queries, p SaveParams) (saved, previous dbmodels.PlatformPolicyConfig, changed bool, err error) {
	params := p.Policy.ConfigParams()
	current, err := q.LockPlatformPolicyConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, ErrConflict
		}
		inserted, err := q.InsertPlatformPolicyConfig(ctx, dbmodels.InsertPlatformPolicyConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, fmt.Errorf("insert platform policy: %w", err)
		}
		return inserted, dbmodels.PlatformPolicyConfig{}, true, nil
	}
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, fmt.Errorf("lock platform policy: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, ErrConflict
	}
	if FromConfig(current).ConfigParams() == params {
		return current, current, false, nil
	}
	updated, err := q.UpdatePlatformPolicyConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, dbmodels.PlatformPolicyConfig{}, false, fmt.Errorf("update platform policy: %w", err)
	}
	return updated, current, true, nil
}
