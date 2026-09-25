package webpushsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
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
	updated, err := q.UpdatePlatformWebPushSubject(ctx, NormalizeSubject(p.Subject))
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("update web push subject: %w", err)
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
