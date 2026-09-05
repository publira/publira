package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultCommentListLimit = int32(20)
	maxCommentListLimit     = int32(100)

	// The episode_comments.status values, which are also the accepted values of
	// the list filter.
	commentStatusPending   = "pending"
	commentStatusPublished = "published"
	commentStatusHidden    = "hidden"
	commentStatusWithdrawn = "withdrawn"

	// The removal a moderator makes, as opposed to the 'auto_reports' one the
	// report threshold makes with no actor to name.
	commentHiddenReasonStaff = "staff"
)

// moderationCommentRow is the single shape every comment the console reads
// arrives in.
//
// The three moderation queries select the same columns in the same order, so
// sqlc emits three structurally identical row types; naming one of them lets a
// list row convert into it instead of being copied field by field.
type moderationCommentRow = dbmodels.GetEpisodeCommentForModerationByPublicIDForTenantRow

func moderationCommentRowsFromDesc(rows []dbmodels.ListEpisodeCommentsForModerationByCreatedAtDescRow) []moderationCommentRow {
	mapped := make([]moderationCommentRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, moderationCommentRow(row))
	}
	return mapped
}

func moderationCommentRowsFromAsc(rows []dbmodels.ListEpisodeCommentsForModerationByCreatedAtAscRow) []moderationCommentRow {
	mapped := make([]moderationCommentRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, moderationCommentRow(row))
	}
	return mapped
}

// normalizeCommentStatusFilter accepts the four stored states and nothing else.
// An unrecognised filter is rejected rather than ignored: silently listing every
// state would answer a question the caller did not ask, and a moderator reading
// what they believe is the approval queue would act on published comments.
func normalizeCommentStatusFilter(raw string) (sql.NullString, error) {
	status := strings.TrimSpace(raw)
	switch status {
	case "":
		return sql.NullString{}, nil
	case commentStatusPending, commentStatusPublished, commentStatusHidden, commentStatusWithdrawn:
		return sql.NullString{String: status, Valid: true}, nil
	default:
		return sql.NullString{}, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("status is not a comment status"),
			"status",
		)
	}
}

// commentPageFilter is the part of a page query that stays the same while the
// client walks pages.
type commentPageFilter struct {
	tenantID  uuid.UUID
	status    sql.NullString
	seriesID  uuid.NullUUID
	episodeID uuid.NullUUID
}

// commentPage runs the keyset query for one page. The list reads newest first,
// so a backward page is scanned by the ascending query and put back into display
// order by pagination.Page.
func (s *adminServer) commentPage(
	ctx context.Context,
	filter commentPageFilter,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]moderationCommentRow, error) {
	params := dbmodels.ListEpisodeCommentsForModerationByCreatedAtDescParams{
		TenantID:        filter.tenantID,
		Status:          filter.status,
		EpisodeID:       filter.episodeID,
		SeriesID:        filter.seriesID,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodeCommentsForModerationByCreatedAtAsc(ctx, dbmodels.ListEpisodeCommentsForModerationByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		return moderationCommentRowsFromAsc(rows), nil
	}
	rows, err := queries.ListEpisodeCommentsForModerationByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	return moderationCommentRowsFromDesc(rows), nil
}

// adminComment projects one stored comment for the console.
//
// purge_due_at is derived here rather than stored: the retention window is a
// deployment setting, so a deadline written into the row when the author
// withdrew it would keep promising a date the purge batch no longer honours.
func (s *adminServer) adminComment(row moderationCommentRow) *publiraadminv1.AdminComment {
	comment := &publiraadminv1.AdminComment{
		PublicId:        row.PublicID,
		Body:            row.Body,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		PublishedAt:     formatOptionalTime(row.PublishedAt),
		HiddenAt:        formatOptionalTime(row.HiddenAt),
		HiddenReason:    formatOptionalString(row.HiddenReason),
		WithdrawnAt:     formatOptionalTime(row.WithdrawnAt),
		AuthorPublicId:  row.AuthorPublicID,
		AuthorName:      row.AuthorName,
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesPublicId:  row.SeriesPublicID,
		SeriesTitle:     row.SeriesTitle,
	}
	if row.WithdrawnAt.Valid {
		comment.PurgeDueAt = row.WithdrawnAt.Time.UTC().AddDate(0, 0, s.commentRetentionDays).Format(time.RFC3339)
	}
	return comment
}

// loadCommentForModeration reads the comment an action names. The tenant is part
// of the lookup, so a comment of another tenant is not found rather than
// forbidden: a moderator learns nothing about what exists elsewhere.
func (s *adminServer) loadCommentForModeration(
	ctx context.Context,
	tenantID uuid.UUID,
	publicID string,
) (moderationCommentRow, error) {
	row, err := s.queriesFor(ctx).GetEpisodeCommentForModerationByPublicIDForTenant(ctx, dbmodels.GetEpisodeCommentForModerationByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return moderationCommentRow{}, connect.NewError(connect.CodeNotFound, errors.New("comment not found"))
	}
	if err != nil {
		return moderationCommentRow{}, s.internalDBError(ctx, "failed to get comment for moderation", err, "tenant_id", tenantID.String(), "comment_public_id", publicID)
	}
	return row, nil
}

// commentPublicIDArg is the identifier every moderation action takes.
func commentPublicIDArg(raw string) (string, error) {
	publicID := strings.TrimSpace(raw)
	if publicID == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("public_id is required"), "public_id")
	}
	return publicID, nil
}

// recordCommentAction writes the audit row a moderation action owes.
//
// The reason travels with it because a tenant may have to hand the author a
// statement of reasons for the removal, and this row is where it reads one back.
func (s *adminServer) recordCommentAction(
	ctx context.Context,
	headers http.Header,
	sessionCtx rpcmiddleware.SessionContext,
	action, commentPublicID, reason string,
) {
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    sessionCtx.Tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "comment",
		TargetID:    commentPublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      reason,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	})
}

// ListComments returns the tenant's comments for moderation, newest first.
//
// Every filter is optional and they compose, so the approval queue, one series'
// removed comments, and the whole history of a single episode are all this one
// list with different arguments.
func (s *adminServer) ListComments(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCommentsRequest],
) (*connect.Response[publiraadminv1.ListCommentsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	status, err := normalizeCommentStatusFilter(req.Msg.Status)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCommentListLimit, maxCommentListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	filter := commentPageFilter{tenantID: tenant.ID, status: status}

	// A filter naming nothing this tenant has is an empty list rather than an
	// error: the console reaches these RPCs with identifiers it read from its
	// own screens, and a series deleted since then is no reason to refuse.
	if seriesPublicID := strings.TrimSpace(req.Msg.SeriesPublicId); seriesPublicID != "" {
		series, seriesErr := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: seriesPublicID,
		})
		if seriesErr != nil {
			if errors.Is(seriesErr, sql.ErrNoRows) {
				return connect.NewResponse(&publiraadminv1.ListCommentsResponse{Comments: []*publiraadminv1.AdminComment{}}), nil
			}
			return nil, s.internalDBError(ctx, "failed to resolve series for list comments", seriesErr, "tenant_id", tenant.ID.String())
		}
		filter.seriesID = uuid.NullUUID{UUID: series.ID, Valid: true}
	}

	if episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId); episodePublicID != "" {
		episode, episodeErr := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: episodePublicID,
		})
		if episodeErr != nil {
			if errors.Is(episodeErr, sql.ErrNoRows) {
				return connect.NewResponse(&publiraadminv1.ListCommentsResponse{Comments: []*publiraadminv1.AdminComment{}}), nil
			}
			return nil, s.internalDBError(ctx, "failed to resolve episode for list comments", episodeErr, "tenant_id", tenant.ID.String())
		}
		filter.episodeID = uuid.NullUUID{UUID: episode.ID, Valid: true}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.commentPage(ctx, filter, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list comments", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	comments := make([]*publiraadminv1.AdminComment, 0, len(rows))
	for _, row := range rows {
		comments = append(comments, s.adminComment(row))
	}

	res := &publiraadminv1.ListCommentsResponse{Comments: comments}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// when the recovery query is itself empty the boundary row is gone too, so
	// both tokens stay empty and the client starts over from the first page.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

// ApproveComment publishes one comment that was waiting for staff approval.
func (s *adminServer) ApproveComment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ApproveCommentRequest],
) (*connect.Response[publiraadminv1.ApproveCommentResponse], error) {
	tenant, sessionCtx, publicID, err := s.commentActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	current, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	if current.Status != commentStatusPending {
		return nil, commentStateError("approved", current.Status)
	}

	if _, err := s.queriesFor(ctx).ApproveEpisodeCommentByPublicIDForTenant(ctx, dbmodels.ApproveEpisodeCommentByPublicIDForTenantParams{
		TenantID:   tenant.ID,
		PublicID:   publicID,
		ApprovedBy: sessionCtx.User.ID,
	}); err != nil {
		return nil, s.commentTransitionError(ctx, "approve", "approved", tenant.ID, publicID, err)
	}

	updated, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_approved", publicID, strings.TrimSpace(req.Msg.Reason))

	return connect.NewResponse(&publiraadminv1.ApproveCommentResponse{Comment: s.adminComment(updated)}), nil
}

// HideComment removes one comment from every reader-facing response but its
// author's, who is never told about it.
func (s *adminServer) HideComment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.HideCommentRequest],
) (*connect.Response[publiraadminv1.HideCommentResponse], error) {
	tenant, sessionCtx, publicID, err := s.commentActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	current, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	if current.Status != commentStatusPending && current.Status != commentStatusPublished {
		return nil, commentStateError("removed", current.Status)
	}

	if _, err := s.queriesFor(ctx).HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     tenant.ID,
		PublicID:     publicID,
		HiddenBy:     uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true},
		HiddenReason: commentHiddenReasonStaff,
	}); err != nil {
		return nil, s.commentTransitionError(ctx, "hide", "removed", tenant.ID, publicID, err)
	}

	updated, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_hidden", publicID, strings.TrimSpace(req.Msg.Reason))

	return connect.NewResponse(&publiraadminv1.HideCommentResponse{Comment: s.adminComment(updated)}), nil
}

// RestoreComment puts a removed comment back into the state its removal
// interrupted.
//
// Only a hidden comment is restorable. A withdrawn one was taken down by its own
// author, and staff putting it back would republish text its author deleted.
func (s *adminServer) RestoreComment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.RestoreCommentRequest],
) (*connect.Response[publiraadminv1.RestoreCommentResponse], error) {
	tenant, sessionCtx, publicID, err := s.commentActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	current, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	if current.Status != commentStatusHidden {
		return nil, commentStateError("restored", current.Status)
	}

	if _, err := s.queriesFor(ctx).RestoreEpisodeCommentByPublicIDForTenant(ctx, dbmodels.RestoreEpisodeCommentByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		return nil, s.commentTransitionError(ctx, "restore", "restored", tenant.ID, publicID, err)
	}

	updated, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_restored", publicID, strings.TrimSpace(req.Msg.Reason))

	return connect.NewResponse(&publiraadminv1.RestoreCommentResponse{Comment: s.adminComment(updated)}), nil
}

// PurgeComment deletes one comment for good, whatever state it is in.
//
// The audit row it leaves behind is the only record that the comment ever
// existed, which is why the reason is required rather than optional.
func (s *adminServer) PurgeComment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.PurgeCommentRequest],
) (*connect.Response[publiraadminv1.PurgeCommentResponse], error) {
	tenant, sessionCtx, publicID, err := s.commentActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	reason := strings.TrimSpace(req.Msg.Reason)
	if reason == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("reason is required"), "reason")
	}

	if _, err := s.loadCommentForModeration(ctx, tenant.ID, publicID); err != nil {
		return nil, err
	}

	// A zero row count is another moderator having purged the same comment in
	// between, which is the outcome this call asked for either way.
	if _, err := s.queriesFor(ctx).DeleteEpisodeCommentByPublicIDForTenant(ctx, dbmodels.DeleteEpisodeCommentByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to purge comment", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}

	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_purged", publicID, reason)

	return connect.NewResponse(&publiraadminv1.PurgeCommentResponse{}), nil
}

// commentActionContext is the opening every moderation action shares: the
// tenant, the tenant_admin session acting, and the comment being named.
func (s *adminServer) commentActionContext(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	rawPublicID string,
) (dbmodels.Tenant, rpcmiddleware.SessionContext, string, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", err
	}
	publicID, err := commentPublicIDArg(rawPublicID)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", err
	}
	return tenant, sessionCtx, publicID, nil
}

// commentStateError refuses a transition the comment's current state does not
// allow. It names the state so a console that is showing a stale queue can say
// what happened instead of retrying.
func commentStateError(action, status string) error {
	return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("a %s comment cannot be %s", status, action))
}

// commentTransitionError reads the conditional UPDATE that wrote no row. Each
// moderation query names the states it may move from, so no rows means another
// moderator moved the comment between the check and the write.
func (s *adminServer) commentTransitionError(
	ctx context.Context,
	verb, action string,
	tenantID uuid.UUID,
	publicID string,
	err error,
) error {
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("the comment was already moved and cannot be %s", action))
	}
	return s.internalDBError(ctx, "failed to "+verb+" comment", err, "tenant_id", tenantID.String(), "comment_public_id", publicID)
}
