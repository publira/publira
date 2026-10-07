package webpushsettings

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
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/revalidate"
)

// The fields a save is refused over.
const (
	FieldSubject          = "subject"
	FieldExpectedRevision = "expected_revision"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past, or on a read of a row that is no longer there.
	ErrConflict = errors.New("platform web push settings have changed since they were read")

	errNonPositiveRevision = errors.New("expected_revision must be positive")
)

// siteRevalidationDelay is how long after a save turning Web Push on each
// tenant's site cache is dropped. The storefront API keeps the key it publishes
// for [CacheTTL], so a drop sent at once would have the site ask again while
// that process still answers no key, and cache the answer without one for as
// long as it did before. Twice the TTL also covers a read that began before the
// commit and finished after it.
const siteRevalidationDelay = 2 * CacheTTL

// siteCacheTags names the storefront cache entry that carries the key a
// tenant's site offers browser notifications with.
func siteCacheTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:site", tenantID.String())}
}

// Get reads the stored settings without generating a key pair, reporting false
// when none is stored.
func Get(ctx context.Context, q CredentialsQuerier) (dbmodels.PlatformWebpushConfig, bool, error) {
	config, err := q.GetPlatformWebPushConfig(ctx)
	if isNoRows(err) {
		return dbmodels.PlatformWebpushConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, false, fmt.Errorf("read web push settings: %w", err)
	}
	return config, true, nil
}

// SaveParams saves the subject deliveries are signed with.
type SaveParams struct {
	Subject string
	// ExpectedRevision is the revision the subject was read at. Nil generates
	// the key pair when none is stored and saves over whatever is, for a
	// caller that read nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveParams) Validate() error {
	if err := ValidateSubject(NormalizeSubject(p.Subject)); err != nil {
		return &fielderr.Invalid{Field: FieldSubject, Err: err}
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision <= 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNonPositiveRevision}
	}
	return nil
}

// SaveSubject writes p in one transaction on db, with its entry filed under
// actor. The stored key pair is kept, because replacing it would invalidate
// every subscription made against it; mgr seals one only when none is stored.
//
// The first subject turns Web Push on, which every tenant's site shows by
// offering browser notifications, so that save also owes each site a drop of
// its cache entry, recorded in the same transaction. A later subject changes
// nothing a site shows and owes none.
func SaveSubject(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	mgr SecretManager,
	actor auditlog.PlatformActor,
	p SaveParams,
) (dbmodels.PlatformWebpushConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformWebpushConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if p.ExpectedRevision == nil {
		if _, err := Ensure(ctx, q, mgr); err != nil {
			return dbmodels.PlatformWebpushConfig{}, err
		}
	}
	current, err := q.LockPlatformWebPushConfig(ctx)
	if isNoRows(err) {
		// The read that yields a revision generates the row, so none means
		// the caller read nothing that is still here.
		return dbmodels.PlatformWebpushConfig{}, ErrConflict
	}
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("lock web push settings: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformWebpushConfig{}, ErrConflict
	}
	// A pair Ensure generated just now has no subject yet, so this only ever
	// skips a row that was already complete.
	subject := NormalizeSubject(p.Subject)
	if current.Subject.Valid && current.Subject.String == subject {
		return current, nil
	}
	updated, err := q.UpdatePlatformWebPushSubject(ctx, subject)
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("update web push subject: %w", err)
	}
	if !current.Subject.Valid {
		if err := recordSiteRevalidations(ctx, q); err != nil {
			return dbmodels.PlatformWebpushConfig{}, err
		}
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_webpush_subject_updated",
		TargetType: "webpush_config",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("audit platform_webpush_subject_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("commit: %w", err)
	}
	return updated, nil
}

// recordSiteRevalidations records a drop of every tenant's site cache entry on
// q, for the outbox worker to send after [siteRevalidationDelay].
//
// A tenant created after the list is read gets no drop, and serializing tenant
// creation with this save would not give it one: a site first asked for within
// [CacheTTL] of the commit is answered without a key by an API process that has
// not reread it, whether its tenant was created before the commit or after.
// Covering that would take a drop recorded with every tenant ever created, for
// a window of seconds an install passes through once, and a site caught in it
// recovers when its entry expires.
func recordSiteRevalidations(ctx context.Context, q *dbmodels.Queries) error {
	tenantIDs, err := q.ListWebPushTenantIDs(ctx)
	if err != nil {
		return fmt.Errorf("list tenants to revalidate: %w", err)
	}
	availableAt := time.Now().Add(siteRevalidationDelay)
	for _, tenantID := range tenantIDs {
		if err := revalidate.RecordDeferred(ctx, q, tenantID, siteCacheTags(tenantID), availableAt); err != nil {
			return fmt.Errorf("record the site revalidation of tenant %s: %w", tenantID, err)
		}
	}
	return nil
}
