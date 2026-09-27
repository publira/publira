package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	defaultAccessTicketListLimit = int32(20)
	maxAccessTicketListLimit     = int32(100)

	accessTicketStatusActive  = "active"
	accessTicketStatusExpired = "expired"
	accessTicketStatusRevoked = "revoked"
)

func accessTicketStatus(revokedAt sql.NullTime, expiresAt sql.NullTime, now time.Time) string {
	if revokedAt.Valid {
		return accessTicketStatusRevoked
	}
	if expiresAt.Valid && !expiresAt.Time.After(now) {
		return accessTicketStatusExpired
	}
	return accessTicketStatusActive
}

func formatOptionalTime(t sql.NullTime) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

func formatOptionalString(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

type accessTicketFields struct {
	id              uuid.UUID
	publicID        string
	episodePublicID string
	episodeTitle    string
	seriesPublicID  string
	seriesTitle     string
	userPublicID    string
	userName        string
	userEmail       string
	expiresAt       sql.NullTime
	revokedAt       sql.NullTime
	note            sql.NullString
	createdAt       time.Time
}

func mapAccessTicket(fields accessTicketFields, now time.Time) *publiraadminv1.AdminAccessTicket {
	return &publiraadminv1.AdminAccessTicket{
		Id:              fields.id.String(),
		PublicId:        fields.publicID,
		EpisodePublicId: fields.episodePublicID,
		EpisodeTitle:    fields.episodeTitle,
		SeriesPublicId:  fields.seriesPublicID,
		SeriesTitle:     fields.seriesTitle,
		UserPublicId:    fields.userPublicID,
		UserName:        fields.userName,
		UserEmail:       fields.userEmail,
		ExpiresAt:       formatOptionalTime(fields.expiresAt),
		RevokedAt:       formatOptionalTime(fields.revokedAt),
		Note:            formatOptionalString(fields.note),
		CreatedAt:       fields.createdAt.UTC().Format(time.RFC3339),
		Status:          accessTicketStatus(fields.revokedAt, fields.expiresAt, now),
	}
}

// accessTicketPageRow is one row of an access ticket page, shared by the
// descending and ascending keyset queries so the handler reads a single shape.
// The id is the cursor tiebreaker and is not part of the response.
type accessTicketPageRow struct {
	id     uuid.UUID
	fields accessTicketFields
}

func mapAccessTicketDescRows(rows []dbmodels.ListAccessTicketsForTenantDescRow) []accessTicketPageRow {
	mapped := make([]accessTicketPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, accessTicketPageRow{
			id: row.ID,
			fields: accessTicketFields{
				id:              row.ID,
				publicID:        row.PublicID,
				episodePublicID: row.EpisodePublicID,
				episodeTitle:    row.EpisodeTitle,
				seriesPublicID:  row.SeriesPublicID,
				seriesTitle:     row.SeriesTitle,
				userPublicID:    row.UserPublicID,
				userName:        row.UserName,
				userEmail:       row.UserEmail,
				expiresAt:       row.ExpiresAt,
				revokedAt:       row.RevokedAt,
				note:            row.Note,
				createdAt:       row.CreatedAt,
			},
		})
	}
	return mapped
}

func mapAccessTicketAscRows(rows []dbmodels.ListAccessTicketsForTenantAscRow) []accessTicketPageRow {
	mapped := make([]accessTicketPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, accessTicketPageRow{
			id: row.ID,
			fields: accessTicketFields{
				id:              row.ID,
				publicID:        row.PublicID,
				episodePublicID: row.EpisodePublicID,
				episodeTitle:    row.EpisodeTitle,
				seriesPublicID:  row.SeriesPublicID,
				seriesTitle:     row.SeriesTitle,
				userPublicID:    row.UserPublicID,
				userName:        row.UserName,
				userEmail:       row.UserEmail,
				expiresAt:       row.ExpiresAt,
				revokedAt:       row.RevokedAt,
				note:            row.Note,
				createdAt:       row.CreatedAt,
			},
		})
	}
	return mapped
}

func mapAccessTicketFromGetRow(row dbmodels.GetAccessTicketForTenantRow, now time.Time) *publiraadminv1.AdminAccessTicket {
	return mapAccessTicket(accessTicketFields{
		id:              row.ID,
		publicID:        row.PublicID,
		episodePublicID: row.EpisodePublicID,
		episodeTitle:    row.EpisodeTitle,
		seriesPublicID:  row.SeriesPublicID,
		seriesTitle:     row.SeriesTitle,
		userPublicID:    row.UserPublicID,
		userName:        row.UserName,
		userEmail:       row.UserEmail,
		expiresAt:       row.ExpiresAt,
		revokedAt:       row.RevokedAt,
		note:            row.Note,
		createdAt:       row.CreatedAt,
	}, now)
}

func parseOptionalExpiresAt(raw string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("expires_at must be RFC3339"))
	}
	if !parsed.After(time.Now()) {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("expires_at must be in the future"))
	}
	return sql.NullTime{Time: parsed.UTC(), Valid: true}, nil
}

// accessTicketPageFilter is the part of a page query that stays the same while
// the client walks pages: the tenant and the optional list filters.
type accessTicketPageFilter struct {
	tenantID   uuid.UUID
	userID     uuid.NullUUID
	episodeID  uuid.NullUUID
	activeOnly bool
}

// accessTicketPage runs the keyset query for one page. The list reads newest
// first, so a backward page is scanned by the ascending query and put back into
// display order by pagination.Page.
func (s *adminServer) accessTicketPage(
	ctx context.Context,
	filter accessTicketPageFilter,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]accessTicketPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListAccessTicketsForTenantAsc(ctx, dbmodels.ListAccessTicketsForTenantAscParams{
			TenantID:        filter.tenantID,
			UserID:          filter.userID,
			EpisodeID:       filter.episodeID,
			ActiveOnly:      filter.activeOnly,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapAccessTicketAscRows(rows), nil
	}

	rows, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID:        filter.tenantID,
		UserID:          filter.userID,
		EpisodeID:       filter.episodeID,
		ActiveOnly:      filter.activeOnly,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapAccessTicketDescRows(rows), nil
}

func (s *adminServer) loadAccessTicket(
	ctx context.Context,
	tenantID uuid.UUID,
	ticketID uuid.UUID,
) (dbmodels.GetAccessTicketForTenantRow, error) {
	return s.queriesFor(ctx).GetAccessTicketForTenant(ctx, dbmodels.GetAccessTicketForTenantParams{
		TenantID: tenantID,
		ID:       ticketID,
	})
}

// accessTicketIDArg parses the access_ticket_id RevokeAccessTicket names.
func accessTicketIDArg(raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("access_ticket_id is required"), "access_ticket_id")
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("access_ticket_id must be a UUID"), "access_ticket_id")
	}
	return id, nil
}

func (s *adminServer) ListAccessTickets(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListAccessTicketsRequest],
) (*connect.Response[publiraadminv1.ListAccessTicketsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultAccessTicketListLimit, maxAccessTicketListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	listKey := pagination.NewListKey("created_at_desc").
		Value("user_public_id", userPublicID).
		Value("episode_public_id", episodePublicID).
		Flag("active_only", req.Msg.ActiveOnly)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	filter := accessTicketPageFilter{
		tenantID:   tenant.ID,
		activeOnly: req.Msg.ActiveOnly,
	}

	if userPublicID != "" {
		userRow, getUserErr := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID: userPublicID,
		})
		if getUserErr != nil {
			if errors.Is(getUserErr, sql.ErrNoRows) {
				return connect.NewResponse(&publiraadminv1.ListAccessTicketsResponse{
					Tickets: []*publiraadminv1.AdminAccessTicket{},
				}), nil
			}
			return nil, s.internalDBError(ctx, "failed to resolve user for list access tickets", getUserErr, "tenant_id", tenant.ID.String())
		}
		filter.userID = uuid.NullUUID{UUID: userRow.ID, Valid: true}
	}

	if episodePublicID != "" {
		episode, getEpisodeErr := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: episodePublicID,
		})
		if getEpisodeErr != nil {
			if errors.Is(getEpisodeErr, sql.ErrNoRows) {
				return connect.NewResponse(&publiraadminv1.ListAccessTicketsResponse{
					Tickets: []*publiraadminv1.AdminAccessTicket{},
				}), nil
			}
			return nil, s.internalDBError(ctx, "failed to resolve episode for list access tickets", getEpisodeErr, "tenant_id", tenant.ID.String())
		}
		filter.episodeID = uuid.NullUUID{UUID: episode.ID, Valid: true}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.accessTicketPage(ctx, filter, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list access tickets", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	now := time.Now()
	tickets := make([]*publiraadminv1.AdminAccessTicket, 0, len(rows))
	for _, row := range rows {
		tickets = append(tickets, mapAccessTicket(row.fields, now))
	}

	res := &publiraadminv1.ListAccessTicketsResponse{Tickets: tickets}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].fields.createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.fields.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *adminServer) IssueAccessTicket(
	ctx context.Context,
	req *connect.Request[publiraadminv1.IssueAccessTicketRequest],
) (*connect.Response[publiraadminv1.IssueAccessTicketResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	userID, episodeID, err := s.resolveAccessTicketRecipient(ctx, tenant.ID, req.Msg)
	if err != nil {
		return nil, err
	}

	expiresAt, err := parseOptionalExpiresAt(req.Msg.ExpiresAt)
	if err != nil {
		return nil, err
	}

	// Idempotent re-issue: return the existing non-revoked ticket when one already
	// covers this pair. Requested expires_at and note are ignored; revoke and
	// re-issue to change them. Includes expired-but-not-revoked rows so the
	// unique partial index on non-revoked (tenant, user, episode) stays consistent.
	existing, existingErr := s.queriesFor(ctx).GetNonRevokedAccessTicketForUserEpisode(ctx, dbmodels.GetNonRevokedAccessTicketForUserEpisodeParams{
		TenantID:  tenant.ID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if existingErr == nil {
		ticketRow, getErr := s.loadAccessTicket(ctx, tenant.ID, existing.ID)
		if getErr != nil {
			return nil, s.internalDBError(ctx, "failed to load existing access ticket", getErr, "tenant_id", tenant.ID.String(), "access_ticket_id", existing.ID.String())
		}
		return connect.NewResponse(&publiraadminv1.IssueAccessTicketResponse{
			Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
		}), nil
	}
	if existingErr != nil && !errors.Is(existingErr, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get non-revoked access ticket", existingErr, "tenant_id", tenant.ID.String(), "user_id", userID.String(), "episode_id", episodeID.String())
	}

	note := strings.TrimSpace(req.Msg.Note)
	ticketID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := publicid.Insert(func(publicID string) (dbmodels.AccessTicket, error) {
		return s.queriesFor(ctx).CreateAccessTicket(ctx, dbmodels.CreateAccessTicketParams{
			ID:              ticketID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			EpisodeID:       episodeID,
			UserID:          userID,
			ExpiresAt:       expiresAt,
			Note:            sql.NullString{String: note, Valid: note != ""},
			CreatedByUserID: uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true},
		})
	})
	if err != nil {
		// Concurrent issue: the unique partial index may reject the insert after
		// both requests observed no non-revoked ticket. Return the winner's row.
		if dberr.IsUniqueViolation(err) {
			winner, getWinnerErr := s.queriesFor(ctx).GetNonRevokedAccessTicketForUserEpisode(ctx, dbmodels.GetNonRevokedAccessTicketForUserEpisodeParams{
				TenantID:  tenant.ID,
				UserID:    userID,
				EpisodeID: episodeID,
			})
			if getWinnerErr != nil {
				return nil, s.internalDBError(ctx, "failed to get winning access ticket after conflict", getWinnerErr, "tenant_id", tenant.ID.String(), "user_id", userID.String(), "episode_id", episodeID.String())
			}
			ticketRow, getErr := s.loadAccessTicket(ctx, tenant.ID, winner.ID)
			if getErr != nil {
				return nil, s.internalDBError(ctx, "failed to load winning access ticket", getErr, "tenant_id", tenant.ID.String(), "access_ticket_id", winner.ID.String())
			}
			return connect.NewResponse(&publiraadminv1.IssueAccessTicketResponse{
				Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to create access ticket", err, "tenant_id", tenant.ID.String(), "user_id", userID.String(), "episode_id", episodeID.String())
	}

	ticketRow, err := s.loadAccessTicket(ctx, tenant.ID, created.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load created access ticket", err, "tenant_id", tenant.ID.String(), "access_ticket_id", created.ID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "access_ticket_issued",
		TargetType:  "access_ticket",
		TargetID:    created.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.IssueAccessTicketResponse{
		Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
	}), nil
}

func (s *adminServer) RevokeAccessTicket(
	ctx context.Context,
	req *connect.Request[publiraadminv1.RevokeAccessTicketRequest],
) (*connect.Response[publiraadminv1.RevokeAccessTicketResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	ticketID, err := accessTicketIDArg(req.Msg.AccessTicketId)
	if err != nil {
		return nil, err
	}

	// Confirm existence first so already-revoked tickets return a clear status.
	current, err := s.loadAccessTicket(ctx, tenant.ID, ticketID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("access ticket not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get access ticket for revoke", err, "tenant_id", tenant.ID.String(), "access_ticket_id", ticketID.String())
	}
	if current.RevokedAt.Valid {
		return connect.NewResponse(&publiraadminv1.RevokeAccessTicketResponse{
			Ticket: mapAccessTicketFromGetRow(current, time.Now()),
		}), nil
	}

	if _, err := s.queriesFor(ctx).RevokeAccessTicketForTenant(ctx, dbmodels.RevokeAccessTicketForTenantParams{
		TenantID: tenant.ID,
		ID:       ticketID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Concurrent revoke: another request may have revoked between the
			// existence check and the conditional update. Re-read and return
			// the revoked ticket instead of NotFound.
			ticketRow, getErr := s.loadAccessTicket(ctx, tenant.ID, ticketID)
			if getErr != nil {
				if errors.Is(getErr, sql.ErrNoRows) {
					return nil, connect.NewError(connect.CodeNotFound, errors.New("access ticket not found"))
				}
				return nil, s.internalDBError(ctx, "failed to load concurrently revoked access ticket", getErr, "tenant_id", tenant.ID.String(), "access_ticket_id", ticketID.String())
			}
			return connect.NewResponse(&publiraadminv1.RevokeAccessTicketResponse{
				Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to revoke access ticket", err, "tenant_id", tenant.ID.String(), "access_ticket_id", ticketID.String())
	}

	ticketRow, err := s.loadAccessTicket(ctx, tenant.ID, ticketID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load revoked access ticket", err, "tenant_id", tenant.ID.String(), "access_ticket_id", ticketID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "access_ticket_revoked",
		TargetType:  "access_ticket",
		TargetID:    current.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.RevokeAccessTicketResponse{
		Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
	}), nil
}

// resolveAccessTicketRecipient resolves the user and the episode a new ticket
// names by their primary keys.
func (s *adminServer) resolveAccessTicketRecipient(
	ctx context.Context,
	tenantID uuid.UUID,
	msg *publiraadminv1.IssueAccessTicketRequest,
) (uuid.UUID, uuid.UUID, error) {
	userID, err := parseRecordID(msg.GetUserId(), "user_id")
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	episodeID, err := parseRecordID(msg.GetEpisodeId(), "episode_id")
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	queries := s.queriesFor(ctx)

	user, err := queries.GetUserByIDForTenant(ctx, dbmodels.GetUserByIDForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		ID:       userID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("user not found"), "user_id")
		}
		return uuid.Nil, uuid.Nil, s.internalDBError(ctx, "failed to get user for issue access ticket", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	if user.Status != "active" {
		return uuid.Nil, uuid.Nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("user is not active"))
	}

	if _, err := queries.GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenantID, ID: episodeID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("episode not found"), "episode_id")
		}
		return uuid.Nil, uuid.Nil, s.internalDBError(ctx, "failed to get episode for issue access ticket", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	return userID, episodeID, nil
}
