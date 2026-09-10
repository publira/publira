package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/commentmode"
	"github.com/publira/publira/server/internal/contentevents"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
)

const (
	defaultCommentPageSize = int32(20)
	maxCommentPageSize     = int32(100)

	// maxCommentBodyRunes counts Unicode code points rather than bytes, so the
	// same text costs a reader the same length whatever script it is written in.
	maxCommentBodyRunes = 1000

	// The episode_comments.status values this service writes. The removed states
	// belong to moderation and to the author's own withdrawal.
	commentStatusPending   = "pending"
	commentStatusPublished = "published"
)

// resolvePublicEpisode is the entry point of every comment RPC that names an
// episode. Reading, posting, and the author's own list all start from the same
// public query, so an episode of another tenant, an unpublished one, and one
// that never existed are a single not-found answer.
func (s *apiServer) resolvePublicEpisode(
	ctx context.Context,
	tenantID uuid.UUID,
	episodePublicID string,
) (dbmodels.GetPublishedEpisodeByPublicIDForTenantRow, error) {
	publicID := strings.TrimSpace(episodePublicID)
	if publicID == "" {
		return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{}, connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	row, err := s.queriesFor(ctx).GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: publicID,
	})
	if err == nil {
		return row, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{}, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{}, s.internalDBError(ctx, "failed to get episode for comments", err, "tenant_id", tenantID.String(), "episode_public_id", publicID)
}

// tenantCommentMode reads the tenant's publishing policy for comments. A tenant
// with no config row has saved no policy, which is the same answer as the
// column's own default: commenting is off until someone turns it on.
func (s *apiServer) tenantCommentMode(ctx context.Context, tenantID uuid.UUID) (string, error) {
	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return commentmode.Disabled, nil
	}
	if err != nil {
		return "", s.internalDBError(ctx, "failed to get tenant comment mode", err, "tenant_id", tenantID.String())
	}
	return config.CommentMode, nil
}

// validateCommentBody normalises what is stored and rejects what the column
// should never hold. Trimming happens before the length check, so trailing
// whitespace cannot push a comment over the limit, and a body of nothing but
// whitespace is as empty as one of nothing at all.
func validateCommentBody(body string) (string, error) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("body is required"))
	}
	if utf8.RuneCountInString(trimmed) > maxCommentBodyRunes {
		return "", connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("body must be at most %d characters", maxCommentBodyRunes))
	}
	return trimmed, nil
}

// readerCanReadEpisodeBody applies the rule GetEpisodeDetail reports as
// EPISODE_ACCESS_FREE or EPISODE_ACCESS_ENTITLED. A reader who cannot open the
// body has not read what they would be commenting on.
func (s *apiServer) readerCanReadEpisodeBody(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	episode dbmodels.GetPublishedEpisodeByPublicIDForTenantRow,
) (bool, error) {
	if episode.Price == 0 || episode.FreeUntil.Valid {
		return true, nil
	}
	access, err := s.queriesFor(ctx).UserHasEpisodeContentAccess(ctx, dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return false, s.internalDBError(ctx, "failed to check episode content access for comment", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	return access.Valid && access.Bool, nil
}

// commentCursor decodes the shared (created_at, id) keyset token every comment
// list uses.
func commentCursor(token string) (pagination.Cursor, pagination.TimeUUIDKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	cursor, err := pagination.Decode(token)
	if err != nil {
		return pagination.Cursor{}, pagination.TimeUUIDKeys{}, invalid
	}
	if cursor.IsZero() {
		return cursor, pagination.TimeUUIDKeys{}, nil
	}
	keys, err := pagination.DecodeTimeUUID(cursor)
	if err != nil {
		return pagination.Cursor{}, pagination.TimeUUIDKeys{}, invalid
	}
	return cursor, keys, nil
}

// publicCommentPageRow is one row of either direction of the public list,
// reduced to what both queries have in common.
type publicCommentPageRow struct {
	id             uuid.UUID
	publicID       string
	body           string
	createdAt      time.Time
	authorPublicID string
	authorName     string
}

func (s *apiServer) publicCommentPage(
	ctx context.Context,
	tenantID, episodeID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]publicCommentPageRow, error) {
	params := dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:        tenantID,
		EpisodeID:       episodeID,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	mapped := make([]publicCommentPageRow, 0, limit)
	if direction == pagination.Backward {
		rows, err := s.queriesFor(ctx).ListPublishedEpisodeCommentsByCreatedAtAsc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			mapped = append(mapped, publicCommentPageRow{
				id:             row.ID,
				publicID:       row.PublicID,
				body:           row.Body,
				createdAt:      row.CreatedAt,
				authorPublicID: row.AuthorPublicID,
				authorName:     row.AuthorName,
			})
		}
		return mapped, nil
	}
	rows, err := s.queriesFor(ctx).ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		mapped = append(mapped, publicCommentPageRow{
			id:             row.ID,
			publicID:       row.PublicID,
			body:           row.Body,
			createdAt:      row.CreatedAt,
			authorPublicID: row.AuthorPublicID,
			authorName:     row.AuthorName,
		})
	}
	return mapped, nil
}

// ListEpisodeComments returns the published comments of one currently public
// episode, newest first.
//
// It takes no session and answers every reader identically, which is what makes
// it cacheable. A comment in any other state reaches its author through
// ListMyEpisodeComments, so nothing here depends on who is asking.
func (s *apiServer) ListEpisodeComments(
	ctx context.Context,
	req *connect.Request[publirav1.ListEpisodeCommentsRequest],
) (*connect.Response[publirav1.ListEpisodeCommentsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episode, err := s.resolvePublicEpisode(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCommentPageSize, maxCommentPageSize)
	cursor, keys, err := commentCursor(req.Msg.Token)
	if err != nil {
		return nil, err
	}

	rows, err := s.publicCommentPage(ctx, tenant.ID, episode.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode comments", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirav1.EpisodeComment, 0, len(rows))
	for _, row := range rows {
		items = append(items, &publirav1.EpisodeComment{
			PublicId:       row.publicID,
			Body:           row.body,
			CreatedAt:      row.createdAt.UTC().Format(time.RFC3339),
			AuthorPublicId: row.authorPublicID,
			AuthorName:     row.authorName,
		})
	}

	res := &publirav1.ListEpisodeCommentsResponse{Comments: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(res), nil
}

// myCommentPageRow is one row of either direction of the caller's own list.
type myCommentPageRow struct {
	id          uuid.UUID
	publicID    string
	body        string
	createdAt   time.Time
	publishedAt sql.NullTime
}

func (s *apiServer) myCommentPage(
	ctx context.Context,
	tenantID, userID, episodeID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]myCommentPageRow, error) {
	params := dbmodels.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		EpisodeID:       episodeID,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	mapped := make([]myCommentPageRow, 0, limit)
	if direction == pagination.Backward {
		rows, err := s.queriesFor(ctx).ListUserPendingOrHiddenEpisodeCommentsByCreatedAtAsc(ctx, dbmodels.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			mapped = append(mapped, myCommentPageRow{id: row.ID, publicID: row.PublicID, body: row.Body, createdAt: row.CreatedAt, publishedAt: row.PublishedAt})
		}
		return mapped, nil
	}
	rows, err := s.queriesFor(ctx).ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		mapped = append(mapped, myCommentPageRow{id: row.ID, publicID: row.PublicID, body: row.Body, createdAt: row.CreatedAt, publishedAt: row.PublishedAt})
	}
	return mapped, nil
}

// myEpisodeComment projects one of the caller's own comments. It carries no
// status: awaiting_approval reports whether the comment has ever been public,
// so a removal — which the author is never told about — changes nothing here.
func myEpisodeComment(publicID, body string, createdAt time.Time, publishedAt sql.NullTime) *publirav1.MyEpisodeComment {
	return &publirav1.MyEpisodeComment{
		PublicId:         publicID,
		Body:             body,
		CreatedAt:        createdAt.UTC().Format(time.RFC3339),
		AwaitingApproval: !publishedAt.Valid,
	}
}

// ListMyEpisodeComments returns the caller's own comments on one episode that
// the public list omits: the ones still awaiting approval, and the ones staff
// or the report threshold removed. The author reads a removed comment exactly
// as they left it.
func (s *apiServer) ListMyEpisodeComments(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyEpisodeCommentsRequest],
) (*connect.Response[publirav1.ListMyEpisodeCommentsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	episode, err := s.resolvePublicEpisode(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCommentPageSize, maxCommentPageSize)
	cursor, keys, err := commentCursor(req.Msg.Token)
	if err != nil {
		return nil, err
	}

	rows, err := s.myCommentPage(ctx, tenant.ID, user.ID, episode.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list own episode comments", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirav1.MyEpisodeComment, 0, len(rows))
	for _, row := range rows {
		items = append(items, myEpisodeComment(row.publicID, row.body, row.createdAt, row.publishedAt))
	}

	res := &publirav1.ListMyEpisodeCommentsResponse{Comments: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return noStorePrivateResponse(res), nil
}

// staffCommentSubject is the episode a staff alert is about. An alert stands
// for a window's worth of comments rather than for one of them, so it names the
// episode the queue is on and never the comment that happened to raise it.
type staffCommentSubject struct {
	episodePublicID string
	episodeTitle    string
	seriesPublicID  string
	seriesTitle     string
}

// enqueueStaffCommentNotification queues one window's alert for the tenant's
// staff, in the transaction that writes what it announces.
//
// The worker owns the fan-out: the recipients are every member of staff the
// tenant has, and a reader waiting for their comment to be accepted must not
// wait on an insert per person. The idempotency key holds the window open, so
// the second comment of an hour writes nothing here and the staff bell keeps
// one row per episode instead of one per reader.
func enqueueStaffCommentNotification(
	ctx context.Context,
	queries *dbmodels.Queries,
	eventType string,
	tenantID uuid.UUID,
	subject staffCommentSubject,
) error {
	subjectKey := outbox.StaffCommentSubjectKey(subject.episodePublicID, time.Now())
	payload, err := json.Marshal(outbox.StaffCommentNotificationPayload{
		TenantID:     tenantID.String(),
		SubjectKey:   subjectKey,
		EpisodeID:    subject.episodePublicID,
		EpisodeTitle: subject.episodeTitle,
		SeriesID:     subject.seriesPublicID,
		SeriesTitle:  subject.seriesTitle,
	})
	if err != nil {
		return fmt.Errorf("marshal staff comment notification event: %w", err)
	}
	return insertPublicOutboxEvent(ctx, queries, tenantID, eventType, payload,
		outbox.StaffCommentIdempotencyKey(eventType, tenantID, subjectKey))
}

// storeComment writes the comment and, in the same transaction, whichever
// follow-on write its status calls for: the alert that tells staff a comment is
// waiting in the approval queue, or the engagement event a comment that is
// already public has earned. One transaction, so a queue entry nobody is told
// about cannot outlive the request that made it, and neither can a public
// comment the reader's own history never records.
//
// The public ID is generated here rather than by the caller: a collision is
// resolved by retrying the insert, and inside a transaction that retry has to
// roll back to a savepoint, which is what publicid.InsertTx does.
func (s *apiServer) storeComment(
	ctx context.Context,
	params dbmodels.CreateEpisodeCommentParams,
	subject staffCommentSubject,
) (dbmodels.EpisodeComment, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return dbmodels.EpisodeComment{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	comment, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.EpisodeComment, error) {
		params.PublicID = publicID
		return txq.CreateEpisodeComment(ctx, params)
	})
	if err != nil {
		return dbmodels.EpisodeComment{}, err
	}
	if params.Status == commentStatusPending {
		if err := enqueueStaffCommentNotification(
			ctx, txq, outbox.EventTypeCommentAwaitingApprovalNotification, params.TenantID, subject,
		); err != nil {
			return dbmodels.EpisodeComment{}, err
		}
	}
	if params.Status == commentStatusPublished {
		if err := contentevents.ProjectComment(ctx, txq, params.TenantID, comment.ID); err != nil {
			return dbmodels.EpisodeComment{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.EpisodeComment{}, err
	}
	return comment, nil
}

// PostEpisodeComment stores one comment by the authenticated reader.
//
// The checks run from the tenant-wide to the episode-specific: a tenant with
// commenting off answers the same way for every episode, so a reader cannot use
// this RPC to find out which episodes exist there.
func (s *apiServer) PostEpisodeComment(
	ctx context.Context,
	req *connect.Request[publirav1.PostEpisodeCommentRequest],
) (*connect.Response[publirav1.PostEpisodeCommentResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	body, err := validateCommentBody(req.Msg.Body)
	if err != nil {
		return nil, err
	}
	// Charged before the stored policy is read, so a reader hammering this RPC
	// is stopped at the allowance rather than at a query per attempt.
	if err := s.chargeReaderAction(ctx, actionPostComment, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	mode, err := s.tenantCommentMode(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	var status string
	var publishedAt sql.NullTime
	switch mode {
	case commentmode.Immediate:
		status = commentStatusPublished
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	case commentmode.ApprovalRequired:
		status = commentStatusPending
	case commentmode.Disabled:
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("comments are disabled"))
	default:
		// The column has a CHECK constraint listing the three modes, so any other
		// value is a stored value this build cannot act on. Guessing a mode would
		// either publish text the tenant wanted reviewed or silently swallow it.
		return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", fmt.Errorf("unsupported comment mode %q", mode), "tenant_id", tenant.ID.String())
	}

	episode, err := s.resolvePublicEpisode(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	canRead, err := s.readerCanReadEpisodeBody(ctx, tenant.ID, user.ID, episode)
	if err != nil {
		return nil, err
	}
	if !canRead {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("episode body is not readable"))
	}

	// The reader takes their place for this body before it is written, so two
	// requests carrying the same text cannot both find nothing to repeat.
	duplicateKey := duplicateCommentKey(tenant.ID, user.ID, episode.ID, body)
	if err := s.claimCommentBody(ctx, duplicateKey); err != nil {
		return nil, err
	}

	commentID, err := uuid.NewV7()
	if err != nil {
		// The claim is given back only here, before anything has been sent to the
		// database: the write provably did not happen, so the reader may say the
		// same thing again straight away.
		s.guards.limiter.Release(ctx, duplicateKey)
		return nil, s.internalDBError(ctx, "failed to allocate comment id", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	comment, err := s.storeComment(ctx, dbmodels.CreateEpisodeCommentParams{
		ID:          commentID,
		TenantID:    tenant.ID,
		EpisodeID:   episode.ID,
		UserID:      user.ID,
		Body:        body,
		Status:      status,
		PublishedAt: publishedAt,
	}, staffCommentSubject{
		episodePublicID: episode.PublicID,
		episodeTitle:    episode.Title,
		seriesPublicID:  episode.SeriesPublicID,
		seriesTitle:     episode.SeriesTitle,
	})
	if err != nil {
		// The claim stands. An INSERT that reports a failure has not necessarily
		// failed — a connection lost after the commit and before the returned row
		// arrives looks exactly like one that stored nothing — and of the two
		// wrong answers, a duplicate comment is the permanent, public one while a
		// reader held off for the rest of the window is temporary.
		return nil, s.internalDBError(ctx, "failed to create episode comment", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.PostEpisodeCommentResponse{
		Comment: myEpisodeComment(comment.PublicID, comment.Body, comment.CreatedAt, comment.PublishedAt),
	}), nil
}

// WithdrawEpisodeComment deletes one of the caller's own comments.
//
// The row is kept in the 'withdrawn' state instead of being removed, so staff
// can still read a comment whose author took it down while a report about it is
// open; the retention purge is what finally deletes it.
func (s *apiServer) WithdrawEpisodeComment(
	ctx context.Context,
	req *connect.Request[publirav1.WithdrawEpisodeCommentRequest],
) (*connect.Response[publirav1.WithdrawEpisodeCommentResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.CommentPublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("comment public id is required"))
	}

	_, err = s.queriesFor(ctx).WithdrawEpisodeCommentByPublicIDForUser(ctx, dbmodels.WithdrawEpisodeCommentByPublicIDForUserParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		PublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Another reader's comment, a comment of another tenant, one already
		// withdrawn, and one that never existed share this answer: the caller has
		// nothing here to take down, and no way to tell which case they hit.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("comment not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to withdraw episode comment", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.WithdrawEpisodeCommentResponse{}), nil
}

// The episode_comment_reports.reason values, matching the CHECK constraint on
// the column.
const (
	commentReportReasonSpam    = "spam"
	commentReportReasonAbuse   = "abuse"
	commentReportReasonSpoiler = "spoiler"
	commentReportReasonOther   = "other"

	// maxCommentReportNoteRunes counts Unicode code points, as the body limit
	// does, so a note costs the same length whatever script it is written in.
	maxCommentReportNoteRunes = 1000
)

// commentReportReason maps the wire enum onto the stored value. UNSPECIFIED is
// rejected rather than read as 'other': a reporter who picked nothing has not
// said what is wrong, and the queue is worked from the reason.
func commentReportReason(reason publirav1.CommentReportReason) (string, error) {
	switch reason {
	case publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM:
		return commentReportReasonSpam, nil
	case publirav1.CommentReportReason_COMMENT_REPORT_REASON_ABUSE:
		return commentReportReasonAbuse, nil
	case publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPOILER:
		return commentReportReasonSpoiler, nil
	case publirav1.CommentReportReason_COMMENT_REPORT_REASON_OTHER:
		return commentReportReasonOther, nil
	case publirav1.CommentReportReason_COMMENT_REPORT_REASON_UNSPECIFIED:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("reason is required"))
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("reason is not a supported reason"))
	}
}

// validateCommentReportNote normalises the reporter's own sentence. It is
// optional, so a blank one is stored as no note rather than as an empty string
// the report queue would render as a line with nothing on it.
func validateCommentReportNote(note string) (sql.NullString, error) {
	trimmed := strings.TrimSpace(note)
	if trimmed == "" {
		return sql.NullString{}, nil
	}
	if utf8.RuneCountInString(trimmed) > maxCommentReportNoteRunes {
		return sql.NullString{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("note must be at most %d characters", maxCommentReportNoteRunes))
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

// autoHideReportedComment applies the tenant's report threshold to the comment
// the caller has just reported, and reports whether it took the comment down.
//
// The removal and its audit row are written on the transaction that holds the
// report, so a tenant never ends up with a comment hidden by a threshold no
// stored report reached, nor with reports that reached it and a comment still
// on the site. The entry names no actor: the reader pressed "report", and what
// removed the comment is the number the tenant itself saved.
func (s *apiServer) autoHideReportedComment(
	ctx context.Context,
	txq *dbmodels.Queries,
	tenantID, commentID uuid.UUID,
) (bool, error) {
	hiddenPublicID, err := txq.AutoHideEpisodeCommentAtReportThreshold(ctx, dbmodels.AutoHideEpisodeCommentAtReportThresholdParams{
		TenantID:  tenantID,
		CommentID: commentID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, s.internalDBError(ctx, "failed to apply the comment report threshold", err, "tenant_id", tenantID.String(), "comment_id", commentID.String())
	}

	if err := auditlog.WriteTenant(ctx, txq, s.logger, auditlog.TenantEntry{
		TenantID:   tenantID,
		ActorRole:  auditlog.RoleSystem,
		Action:     "comment_auto_hidden",
		TargetType: "comment",
		TargetID:   hiddenPublicID,
		Outcome:    auditlog.OutcomeSuccess,
	}); err != nil {
		return false, s.internalDBError(ctx, "failed to record the automatic comment removal", err, "tenant_id", tenantID.String(), "comment_public_id", hiddenPublicID)
	}

	return true, nil
}

// revalidateCommentList drops the storefront's cached comment list for one
// episode.
//
// A comment the report threshold removed is gone from every answer this API
// gives, but the section a reader sees is served from a cached page, so the
// removal only reaches them once that entry is dropped. Best-effort: the
// report itself is already committed, and a list that kept the comment until
// its entry expired would be worse than a warning in the log.
func (s *apiServer) revalidateCommentList(ctx context.Context, tenantID uuid.UUID, episodePublicID string) {
	if s.reval == nil {
		return
	}
	tag := fmt.Sprintf("tenant:%s:episode:%s:comments", tenantID.String(), episodePublicID)
	if err := s.reval.RevalidateTags(ctx, []string{tag}); err != nil {
		s.logger.Warn("failed to request next revalidate after an automatic comment removal", "tenant_id", tenantID.String(), "episode_public_id", episodePublicID, "error", err)
	}
}

// ReportEpisodeComment flags one published comment as breaking the rules.
//
// The report, the counter it moves, and the tenant's threshold applied to that
// counter are one write. open_report_count is what the threshold checks and
// what the moderation queues show, so a report stored without the counter
// following it would be a report nothing acts on, and a threshold checked
// after the commit would let two reports arriving together each see a count
// below it.
//
// The reader is told the same thing either way. Whether their report was the
// one that removed the comment is not something the answer to a report may
// reveal, for the reason a removal is silent at all.
func (s *apiServer) ReportEpisodeComment(
	ctx context.Context,
	req *connect.Request[publirav1.ReportEpisodeCommentRequest],
) (*connect.Response[publirav1.ReportEpisodeCommentResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.CommentPublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("comment public id is required"))
	}
	reason, err := commentReportReason(req.Msg.Reason)
	if err != nil {
		return nil, err
	}
	note, err := validateCommentReportNote(req.Msg.Note)
	if err != nil {
		return nil, err
	}
	// A reporter who has spent their allowance is stopped before the lookup, so
	// this RPC cannot be walked to find out which comments exist.
	if err := s.chargeReaderAction(ctx, actionReportComment, tenant.ID, user.ID); err != nil {
		return nil, err
	}

	comment, err := s.queriesFor(ctx).GetReportableEpisodeCommentByPublicIDForTenant(ctx, dbmodels.GetReportableEpisodeCommentByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// A comment awaiting approval, one staff removed, one its author withdrew,
		// one of another tenant, one on an episode that is no longer public, and
		// one that never existed share this answer: the reporter can see none of
		// them, so none of them may be confirmed to exist either.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("comment not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get comment to report", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	if comment.UserID == user.ID {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot report your own comment"))
	}

	reportID, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to allocate comment report id", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin comment report transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	_, err = txq.CreateEpisodeCommentReport(ctx, dbmodels.CreateEpisodeCommentReportParams{
		ID:             reportID,
		TenantID:       tenant.ID,
		CommentID:      comment.ID,
		ReporterUserID: user.ID,
		Reason:         reason,
		Note:           note,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// This reader has already reported this comment. Nothing is written, the
		// count does not move, and they are told what the reader whose report was
		// the first is told: what the platform has since done with that earlier
		// report is not something a second submission may reveal.
		return noStorePrivateResponse(&publirav1.ReportEpisodeCommentResponse{}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create comment report", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	if _, err := txq.RefreshEpisodeCommentOpenReportCount(ctx, dbmodels.RefreshEpisodeCommentOpenReportCountParams{
		TenantID:  tenant.ID,
		CommentID: comment.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to refresh comment open report count", err, "tenant_id", tenant.ID.String(), "comment_id", comment.ID.String())
	}

	autoHidden, err := s.autoHideReportedComment(ctx, txq, tenant.ID, comment.ID)
	if err != nil {
		return nil, err
	}

	if err := enqueueStaffCommentNotification(ctx, txq, outbox.EventTypeCommentReportedNotification, tenant.ID, staffCommentSubject{
		episodePublicID: comment.EpisodePublicID,
		episodeTitle:    comment.EpisodeTitle,
		seriesPublicID:  comment.SeriesPublicID,
		seriesTitle:     comment.SeriesTitle,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to enqueue comment report notification", err, "tenant_id", tenant.ID.String(), "comment_id", comment.ID.String())
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit comment report", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	if autoHidden {
		s.revalidateCommentList(ctx, tenant.ID, comment.EpisodePublicID)
	}

	return noStorePrivateResponse(&publirav1.ReportEpisodeCommentResponse{}), nil
}
