package platformpolicy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

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
// rereads the row within CacheTTL.
func Save(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	actor auditlog.PlatformActor,
	p SaveParams,
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
	saved, err := write(ctx, q, p)
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, err
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

func write(ctx context.Context, q *dbmodels.Queries, p SaveParams) (dbmodels.PlatformPolicyConfig, error) {
	params := p.Policy.ConfigParams()
	current, err := q.LockPlatformPolicyConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformPolicyConfig{}, ErrConflict
		}
		inserted, err := q.InsertPlatformPolicyConfig(ctx, dbmodels.InsertPlatformPolicyConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformPolicyConfig{}, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("insert platform policy: %w", err)
		}
		return inserted, nil
	}
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("lock platform policy: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformPolicyConfig{}, ErrConflict
	}
	updated, err := q.UpdatePlatformPolicyConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, fmt.Errorf("update platform policy: %w", err)
	}
	return updated, nil
}
