package contentevents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// commentProjectionQuerier is the one generated query publishing a comment
// needs. Both the public service, where a comment is published on posting, and
// the console, where it is published on approval, run it against their own
// transaction.
type commentProjectionQuerier interface {
	ProjectCommentContentEvent(ctx context.Context, arg dbmodels.ProjectCommentContentEventParams) (dbmodels.ContentEvent, error)
}

// ProjectComment files the analytics event for a comment that has just become
// public.
//
// It belongs in the transaction that published the comment rather than beside
// it. The completion projection is best-effort because `batch
// project-episode-reads` files whatever a request path lost; comments have no
// such reconciliation run, so an event written outside the publishing
// transaction would simply be missing, and the reader's own history would show
// a series they wrote about as one they never touched.
//
// A comment that already carries its event — one staff approved after having
// restored it — is a no-op, because the projection is keyed by the comment id.
func ProjectComment(ctx context.Context, queries commentProjectionQuerier, tenantID, commentID uuid.UUID) error {
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate comment event id: %w", err)
	}
	_, err = queries.ProjectCommentContentEvent(ctx, dbmodels.ProjectCommentContentEventParams{
		ID:        eventID,
		TenantID:  tenantID,
		CommentID: commentID,
	})
	// ON CONFLICT DO NOTHING returns no rows, and so does a comment that is not
	// 'published': neither is a failure, and both mean this comment already has
	// whatever event it is owed.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("project comment content event: %w", err)
	}
	return nil
}
