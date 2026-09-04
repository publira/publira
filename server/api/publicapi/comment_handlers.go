package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
)

const (
	defaultCommentPageSize = int32(20)
	maxCommentPageSize     = int32(100)

	// maxCommentBodyRunes counts Unicode code points rather than bytes, so the
	// same text costs a reader the same length whatever script it is written in.
	maxCommentBodyRunes = 1000

	// The values of tenant_config.comment_mode.
	commentModeDisabled         = "disabled"
	commentModeImmediate        = "immediate"
	commentModeApprovalRequired = "approval_required"

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
		return commentModeDisabled, nil
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
	if episode.Price == 0 {
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
	mode, err := s.tenantCommentMode(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	var status string
	var publishedAt sql.NullTime
	switch mode {
	case commentModeImmediate:
		status = commentStatusPublished
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	case commentModeApprovalRequired:
		status = commentStatusPending
	case commentModeDisabled:
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

	commentID, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to allocate comment id", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	comment, err := publicid.Insert(func(publicID string) (dbmodels.EpisodeComment, error) {
		return s.queriesFor(ctx).CreateEpisodeComment(ctx, dbmodels.CreateEpisodeCommentParams{
			ID:          commentID,
			TenantID:    tenant.ID,
			PublicID:    publicID,
			EpisodeID:   episode.ID,
			UserID:      user.ID,
			Body:        body,
			Status:      status,
			PublishedAt: publishedAt,
		})
	})
	if err != nil {
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
