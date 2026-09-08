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
	"github.com/publira/publira/server/internal/contentevents"
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

	// The episode_comment_reports.status values, which are also the accepted
	// values of the queue filter. 'resolved' is a report staff agreed with and
	// 'rejected' one they did not; both are decisions, and only 'open' counts
	// towards the automatic removal threshold.
	commentReportStatusOpen     = "open"
	commentReportStatusResolved = "resolved"
	commentReportStatusRejected = "rejected"
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

// commentReportRow is the single shape every report the console reads arrives
// in, the same way moderationCommentRow is for comments: the queue queries and
// the single-report read select the same columns in the same order, so sqlc
// emits structurally identical row types.
type commentReportRow = dbmodels.GetEpisodeCommentReportForModerationByIDForTenantRow

func commentReportRowsFromDesc(rows []dbmodels.ListEpisodeCommentReportsForModerationByCreatedAtDescRow) []commentReportRow {
	mapped := make([]commentReportRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, commentReportRow(row))
	}
	return mapped
}

func commentReportRowsFromAsc(rows []dbmodels.ListEpisodeCommentReportsForModerationByCreatedAtAscRow) []commentReportRow {
	mapped := make([]commentReportRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, commentReportRow(row))
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

// normalizeCommentReportStatusFilter accepts the three stored report states and
// nothing else, for the reason normalizeCommentStatusFilter rejects an unknown
// comment status: a moderator who believes they are looking at the open reports
// must not be handed the decided ones as well.
func normalizeCommentReportStatusFilter(raw string) (sql.NullString, error) {
	status := strings.TrimSpace(raw)
	switch status {
	case "":
		return sql.NullString{}, nil
	case commentReportStatusOpen, commentReportStatusResolved, commentReportStatusRejected:
		return sql.NullString{String: status, Valid: true}, nil
	default:
		return sql.NullString{}, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("status is not a comment report status"),
			"status",
		)
	}
}

// commentReportResolutionArg reads which way the decision went. Only the two
// terminal states are accepted: 'open' would be a call that decides nothing,
// and an empty value a decision the caller never made.
func commentReportResolutionArg(raw string) (string, error) {
	resolution := strings.TrimSpace(raw)
	if resolution == commentReportStatusResolved || resolution == commentReportStatusRejected {
		return resolution, nil
	}
	return "", rpcerrors.NewFieldViolationError(
		connect.CodeInvalidArgument,
		errors.New("resolution must be resolved or rejected"),
		"resolution",
	)
}

// commentReportIDArg reads the report a decision names. Reports are identified
// by their uuid, so an unparseable one is refused here rather than reaching a
// query that would answer not_found for a value that is not an identifier at
// all.
func commentReportIDArg(raw string) (uuid.UUID, error) {
	reportID, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.UUID{}, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("report_id is not an identifier"),
			"report_id",
		)
	}
	return reportID, nil
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

// commentReportPage runs the keyset query for one page of the report queue,
// the same way commentPage does for the comment list.
func (s *adminServer) commentReportPage(
	ctx context.Context,
	tenantID uuid.UUID,
	status sql.NullString,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]commentReportRow, error) {
	params := dbmodels.ListEpisodeCommentReportsForModerationByCreatedAtDescParams{
		TenantID:        tenantID,
		Status:          status,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodeCommentReportsForModerationByCreatedAtAsc(ctx, dbmodels.ListEpisodeCommentReportsForModerationByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		return commentReportRowsFromAsc(rows), nil
	}
	rows, err := queries.ListEpisodeCommentReportsForModerationByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	return commentReportRowsFromDesc(rows), nil
}

// commentProjection is the part of a stored comment that AdminComment is built
// from.
//
// Two queries return that comment in row shapes of their own — the moderation
// list, and the report queue that joins the same comment beside the report it
// is about — so the projection names what it reads instead of one of them, and
// purge_due_at is derived in one place for both.
type commentProjection struct {
	publicID        string
	body            string
	status          string
	createdAt       time.Time
	publishedAt     sql.NullTime
	hiddenAt        sql.NullTime
	hiddenReason    sql.NullString
	withdrawnAt     sql.NullTime
	openReportCount int32
	authorPublicID  string
	authorName      string
	episodePublicID string
	episodeTitle    string
	seriesPublicID  string
	seriesTitle     string
}

func commentProjectionOf(row moderationCommentRow) commentProjection {
	return commentProjection{
		publicID:        row.PublicID,
		body:            row.Body,
		status:          row.Status,
		createdAt:       row.CreatedAt,
		publishedAt:     row.PublishedAt,
		hiddenAt:        row.HiddenAt,
		hiddenReason:    row.HiddenReason,
		withdrawnAt:     row.WithdrawnAt,
		openReportCount: row.OpenReportCount,
		authorPublicID:  row.AuthorPublicID,
		authorName:      row.AuthorName,
		episodePublicID: row.EpisodePublicID,
		episodeTitle:    row.EpisodeTitle,
		seriesPublicID:  row.SeriesPublicID,
		seriesTitle:     row.SeriesTitle,
	}
}

func commentProjectionOfReport(row commentReportRow) commentProjection {
	return commentProjection{
		publicID:        row.PublicID,
		body:            row.Body,
		status:          row.Status,
		createdAt:       row.CreatedAt,
		publishedAt:     row.PublishedAt,
		hiddenAt:        row.HiddenAt,
		hiddenReason:    row.HiddenReason,
		withdrawnAt:     row.WithdrawnAt,
		openReportCount: row.OpenReportCount,
		authorPublicID:  row.AuthorPublicID,
		authorName:      row.AuthorName,
		episodePublicID: row.EpisodePublicID,
		episodeTitle:    row.EpisodeTitle,
		seriesPublicID:  row.SeriesPublicID,
		seriesTitle:     row.SeriesTitle,
	}
}

// adminComment projects one stored comment for the console.
//
// purge_due_at is derived here rather than stored: the retention window is a
// deployment setting, so a deadline written into the row when the author
// withdrew it would keep promising a date the purge batch no longer honours.
func (s *adminServer) adminComment(row commentProjection) *publiraadminv1.AdminComment {
	comment := &publiraadminv1.AdminComment{
		PublicId:        row.publicID,
		Body:            row.body,
		Status:          row.status,
		CreatedAt:       row.createdAt.UTC().Format(time.RFC3339),
		PublishedAt:     formatOptionalTime(row.publishedAt),
		HiddenAt:        formatOptionalTime(row.hiddenAt),
		HiddenReason:    formatOptionalString(row.hiddenReason),
		WithdrawnAt:     formatOptionalTime(row.withdrawnAt),
		AuthorPublicId:  row.authorPublicID,
		AuthorName:      row.authorName,
		EpisodePublicId: row.episodePublicID,
		EpisodeTitle:    row.episodeTitle,
		SeriesPublicId:  row.seriesPublicID,
		SeriesTitle:     row.seriesTitle,
		OpenReportCount: row.openReportCount,
	}
	if row.withdrawnAt.Valid {
		comment.PurgeDueAt = row.withdrawnAt.Time.UTC().AddDate(0, 0, s.commentRetentionDays).Format(time.RFC3339)
	}
	return comment
}

// adminCommentReport projects one stored report, with the comment it is about.
func (s *adminServer) adminCommentReport(row commentReportRow) *publiraadminv1.CommentReport {
	return &publiraadminv1.CommentReport{
		ReportId:         row.ReportID.String(),
		Reason:           row.Reason,
		Note:             formatOptionalString(row.Note),
		Status:           row.ReportStatus,
		CreatedAt:        row.ReportCreatedAt.UTC().Format(time.RFC3339),
		ResolvedAt:       formatOptionalTime(row.ResolvedAt),
		ReporterPublicId: row.ReporterPublicID,
		ReporterName:     row.ReporterName,
		Comment:          s.adminComment(commentProjectionOfReport(row)),
	}
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

// commentAuditEntry is the audit row a moderation action owes.
//
// The reason travels with it because a tenant may have to hand the author a
// statement of reasons for the removal, and this row is where it reads one back.
func commentAuditEntry(
	headers http.Header,
	sessionCtx rpcmiddleware.SessionContext,
	action, commentPublicID, reason string,
) auditlog.TenantEntry {
	return auditlog.TenantEntry{
		TenantID:    sessionCtx.Tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "comment",
		TargetID:    commentPublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      reason,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	}
}

// revalidateCommentList drops the storefront's cached comment list for one
// episode.
//
// Every moderation action changes what that list answers — an approval adds a
// comment to it, a removal or a purge takes one out — and the console cannot
// reach web-host's cache itself, so the invalidation is made here, beside the
// write. Best-effort like the audit row: a stale list catches up when the
// entry expires, and failing the action the moderator already performed would
// be worse.
func (s *adminServer) revalidateCommentList(ctx context.Context, tenantID uuid.UUID, episodePublicID string) {
	if s.reval == nil {
		return
	}
	tag := fmt.Sprintf("tenant:%s:episode:%s:comments", tenantID.String(), episodePublicID)
	if err := s.reval.RevalidateTags(ctx, []string{tag}); err != nil {
		s.logger.Warn("failed to request next revalidate after a comment moderation action", "tenant_id", tenantID.String(), "episode_public_id", episodePublicID, "error", err)
	}
}

// recordCommentAction writes that row the ordinary way: best-effort, so a
// failing audit write never fails a reversible action whose own effect is still
// readable in the comment row afterwards.
func (s *adminServer) recordCommentAction(
	ctx context.Context,
	headers http.Header,
	sessionCtx rpcmiddleware.SessionContext,
	action, commentPublicID, reason string,
) {
	s.recorderFor(ctx).RecordTenant(ctx, commentAuditEntry(headers, sessionCtx, action, commentPublicID, reason))
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
		comments = append(comments, s.adminComment(commentProjectionOf(row)))
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

// CountPendingComments answers how many comments are waiting for approval.
//
// The console navigation shows this on every screen, so it is a COUNT rather
// than the length of a ListComments page: a page is bounded by its limit and
// could only ever report "20 or more", and fetching rows to discard them would
// put the list query in front of every navigation.
func (s *adminServer) CountPendingComments(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CountPendingCommentsRequest],
) (*connect.Response[publiraadminv1.CountPendingCommentsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	pending, err := s.queriesFor(ctx).CountPendingEpisodeCommentsForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count pending comments", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.CountPendingCommentsResponse{PendingCount: pending}), nil
}

// ApproveComment publishes one comment that was waiting for staff approval.
//
// Approval is the second of the two ways a comment becomes public, so it is
// also where the engagement event for it is filed. The two writes share a
// transaction: nothing replays this projection afterwards, and a comment that
// is public without one is a comment its author's reading history has no
// record of.
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

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin comment approval transaction", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := dbmodels.New(tx)
	if _, err := qtx.ApproveEpisodeCommentByPublicIDForTenant(ctx, dbmodels.ApproveEpisodeCommentByPublicIDForTenantParams{
		TenantID:   tenant.ID,
		PublicID:   publicID,
		ApprovedBy: sessionCtx.User.ID,
	}); err != nil {
		return nil, s.commentTransitionError(ctx, "approve", "approved", tenant.ID, publicID, err)
	}
	if err := contentevents.ProjectComment(ctx, qtx, tenant.ID, current.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to project the engagement event of an approved comment", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the comment approval", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}

	updated, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_approved", publicID, strings.TrimSpace(req.Msg.Reason))
	s.revalidateCommentList(ctx, tenant.ID, updated.EpisodePublicID)

	return connect.NewResponse(&publiraadminv1.ApproveCommentResponse{Comment: s.adminComment(commentProjectionOf(updated))}), nil
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
	s.revalidateCommentList(ctx, tenant.ID, updated.EpisodePublicID)

	return connect.NewResponse(&publiraadminv1.HideCommentResponse{Comment: s.adminComment(commentProjectionOf(updated))}), nil
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

	// The restore and the reports it settles are one transaction. Putting the
	// comment back is staff saying it stands, so the reports against it do not,
	// and leaving them open would let the very same reports carry it past the
	// automatic removal threshold again the moment it came back. The restore's
	// own audit row accounts for all of it: what a tenant has to be able to
	// state afterwards is that staff put the comment back, and by whom.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin comment restore transaction", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := dbmodels.New(tx)
	if _, err := qtx.RestoreEpisodeCommentByPublicIDForTenant(ctx, dbmodels.RestoreEpisodeCommentByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		return nil, s.commentTransitionError(ctx, "restore", "restored", tenant.ID, publicID, err)
	}
	if _, err := qtx.RejectOpenEpisodeCommentReportsForComment(ctx, dbmodels.RejectOpenEpisodeCommentReportsForCommentParams{
		TenantID:   tenant.ID,
		CommentID:  current.ID,
		ResolvedBy: sessionCtx.User.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to reject the open reports on a restored comment", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	// Recomputed rather than zeroed, so the counter is what the report rows say
	// it is even if one of them was decided between the two statements.
	if _, err := qtx.RefreshEpisodeCommentOpenReportCount(ctx, dbmodels.RefreshEpisodeCommentOpenReportCountParams{
		TenantID:  tenant.ID,
		CommentID: current.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to refresh the report count of a restored comment", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the comment restore", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}

	updated, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	s.recordCommentAction(ctx, req.Header(), sessionCtx, "comment_restored", publicID, strings.TrimSpace(req.Msg.Reason))
	s.revalidateCommentList(ctx, tenant.ID, updated.EpisodePublicID)

	return connect.NewResponse(&publiraadminv1.RestoreCommentResponse{Comment: s.adminComment(commentProjectionOf(updated))}), nil
}

// PurgeComment deletes one comment for good, whatever state it is in.
//
// The audit row it leaves behind is the only record that the comment ever
// existed, which is why the reason is required rather than optional and why the
// row and the deletion are committed together.
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

	// Read before the delete: the episode the list belongs to is on the row
	// that is about to stop existing.
	current, err := s.loadCommentForModeration(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}

	// The delete and its audit row are one transaction, unlike every other
	// action here. Those leave the comment behind, so a dropped audit write
	// loses only the note; this one leaves nothing, and a purge whose entry
	// failed to land would be a deletion nobody can account for.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin comment purge transaction", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := dbmodels.New(tx)
	// A zero row count is another moderator having purged the same comment in
	// between, which is the outcome this call asked for either way.
	if _, err := qtx.DeleteEpisodeCommentByPublicIDForTenant(ctx, dbmodels.DeleteEpisodeCommentByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to purge comment", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	entry := commentAuditEntry(req.Header(), sessionCtx, "comment_purged", publicID, reason)
	if err := auditlog.WriteTenant(ctx, qtx, s.logger, entry); err != nil {
		return nil, s.internalDBError(ctx, "failed to record the comment purge", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the comment purge", err, "tenant_id", tenant.ID.String(), "comment_public_id", publicID)
	}
	s.revalidateCommentList(ctx, tenant.ID, current.EpisodePublicID)

	return connect.NewResponse(&publiraadminv1.PurgeCommentResponse{}), nil
}

// ListCommentReports returns the tenant's comment reports, newest first.
//
// One entry per report: a report is what staff decide on, and each carries the
// reason and the sentence one reader wrote. A comment several readers reported
// is therefore in the queue once per report, with open_report_count on it
// saying how many of those are still waiting.
func (s *adminServer) ListCommentReports(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCommentReportsRequest],
) (*connect.Response[publiraadminv1.ListCommentReportsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	status, err := normalizeCommentReportStatusFilter(req.Msg.Status)
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

	// One row past the page: its presence is what says another page exists.
	rows, err := s.commentReportPage(ctx, tenant.ID, status, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list comment reports", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	reports := make([]*publiraadminv1.CommentReport, 0, len(rows))
	for _, row := range rows {
		reports = append(reports, s.adminCommentReport(row))
	}

	res := &publiraadminv1.ListCommentReportsResponse{Reports: reports}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].ReportCreatedAt, rows[0].ReportID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.ReportCreatedAt, last.ReportID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued — purging a comment takes its reports with it. Hand back a token
	// to where the client came from, and only once.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

// ResolveCommentReport marks one open report resolved or rejected.
//
// The comment is left exactly as it was, whichever way the decision goes:
// agreeing with a report is not the same act as removing what it is about, and
// rejecting the last open report on an automatically removed comment does not
// bring it back — only RestoreComment does. What does follow is the comment's
// open report count, since a decided report no longer counts towards the
// automatic removal threshold.
func (s *adminServer) ResolveCommentReport(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ResolveCommentReportRequest],
) (*connect.Response[publiraadminv1.ResolveCommentReportResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	reportID, err := commentReportIDArg(req.Msg.ReportId)
	if err != nil {
		return nil, err
	}
	resolution, err := commentReportResolutionArg(req.Msg.Resolution)
	if err != nil {
		return nil, err
	}

	current, err := s.loadCommentReport(ctx, tenant.ID, reportID)
	if err != nil {
		return nil, err
	}
	if current.ReportStatus != commentReportStatusOpen {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("a %s report cannot be decided again", current.ReportStatus))
	}

	// The decision and the counter it moves are one write, for the reason the
	// report itself was: open_report_count is what the removal threshold reads
	// and what the queues show, so a decision the counter did not follow would
	// leave a comment carrying reports nobody is waiting on any more.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin comment report transaction", err, "tenant_id", tenant.ID.String(), "report_id", reportID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := dbmodels.New(tx)
	if _, err := qtx.ResolveEpisodeCommentReportByIDForTenant(ctx, dbmodels.ResolveEpisodeCommentReportByIDForTenantParams{
		TenantID:   tenant.ID,
		ID:         reportID,
		Status:     resolution,
		ResolvedBy: sessionCtx.User.ID,
	}); err != nil {
		// The UPDATE names 'open' as the state it moves from, so no row means
		// another moderator decided this report between the read and the write.
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("the report was already decided"))
		}
		return nil, s.internalDBError(ctx, "failed to resolve comment report", err, "tenant_id", tenant.ID.String(), "report_id", reportID.String())
	}
	if _, err := qtx.RefreshEpisodeCommentOpenReportCount(ctx, dbmodels.RefreshEpisodeCommentOpenReportCountParams{
		TenantID:  tenant.ID,
		CommentID: current.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to refresh comment open report count", err, "tenant_id", tenant.ID.String(), "report_id", reportID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the comment report decision", err, "tenant_id", tenant.ID.String(), "report_id", reportID.String())
	}

	updated, err := s.loadCommentReport(ctx, tenant.ID, reportID)
	if err != nil {
		return nil, err
	}
	// The audit row names the comment rather than the report: what a tenant has
	// to be able to account for afterwards is what was decided about a piece of
	// content, and every other entry about that comment is filed under the same
	// target. The action says which way this decision went.
	s.recordCommentAction(ctx, req.Header(), sessionCtx, commentReportAuditAction(resolution), updated.PublicID, strings.TrimSpace(req.Msg.Reason))

	return connect.NewResponse(&publiraadminv1.ResolveCommentReportResponse{Report: s.adminCommentReport(updated)}), nil
}

// commentReportAuditAction names the decision in the audit log.
func commentReportAuditAction(resolution string) string {
	if resolution == commentReportStatusResolved {
		return "comment_report_resolved"
	}
	return "comment_report_rejected"
}

// loadCommentReport reads the report a decision names. The tenant is part of
// the lookup, so a report of another tenant is not found rather than forbidden:
// a moderator learns nothing about what exists elsewhere.
func (s *adminServer) loadCommentReport(
	ctx context.Context,
	tenantID uuid.UUID,
	reportID uuid.UUID,
) (commentReportRow, error) {
	row, err := s.queriesFor(ctx).GetEpisodeCommentReportForModerationByIDForTenant(ctx, dbmodels.GetEpisodeCommentReportForModerationByIDForTenantParams{
		TenantID: tenantID,
		ID:       reportID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return commentReportRow{}, connect.NewError(connect.CodeNotFound, errors.New("comment report not found"))
	}
	if err != nil {
		return commentReportRow{}, s.internalDBError(ctx, "failed to get comment report", err, "tenant_id", tenantID.String(), "report_id", reportID.String())
	}
	return row, nil
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
