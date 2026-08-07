package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
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

func formatOptionalNote(note sql.NullString) string {
	if !note.Valid {
		return ""
	}
	return note.String
}

func mapAccessTicketFromListRow(row dbmodels.ListAccessTicketsForTenantRow, now time.Time) *publiraadminv1.AdminAccessTicket {
	return &publiraadminv1.AdminAccessTicket{
		PublicId:        row.PublicID,
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesPublicId:  row.SeriesPublicID,
		SeriesTitle:     row.SeriesTitle,
		UserPublicId:    row.UserPublicID,
		UserName:        row.UserName,
		UserEmail:       row.UserEmail,
		ExpiresAt:       formatOptionalTime(row.ExpiresAt),
		RevokedAt:       formatOptionalTime(row.RevokedAt),
		Note:            formatOptionalNote(row.Note),
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		Status:          accessTicketStatus(row.RevokedAt, row.ExpiresAt, now),
	}
}

func mapAccessTicketFromGetRow(row dbmodels.GetAccessTicketByPublicIDForTenantRow, now time.Time) *publiraadminv1.AdminAccessTicket {
	return &publiraadminv1.AdminAccessTicket{
		PublicId:        row.PublicID,
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesPublicId:  row.SeriesPublicID,
		SeriesTitle:     row.SeriesTitle,
		UserPublicId:    row.UserPublicID,
		UserName:        row.UserName,
		UserEmail:       row.UserEmail,
		ExpiresAt:       formatOptionalTime(row.ExpiresAt),
		RevokedAt:       formatOptionalTime(row.RevokedAt),
		Note:            formatOptionalNote(row.Note),
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		Status:          accessTicketStatus(row.RevokedAt, row.ExpiresAt, now),
	}
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

	limit := req.Msg.Limit
	if limit <= 0 || limit > maxAccessTicketListLimit {
		limit = defaultAccessTicketListLimit
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}

	params := dbmodels.ListAccessTicketsForTenantParams{
		TenantID:   tenant.ID,
		Limit:      limit,
		Offset:     offset,
		ActiveOnly: req.Msg.ActiveOnly,
	}

	if userPublicID := strings.TrimSpace(req.Msg.UserPublicId); userPublicID != "" {
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
			return nil, connect.NewError(connect.CodeInternal, getUserErr)
		}
		params.UserID = uuid.NullUUID{UUID: userRow.ID, Valid: true}
	}

	if episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId); episodePublicID != "" {
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
			return nil, connect.NewError(connect.CodeInternal, getEpisodeErr)
		}
		params.EpisodeID = uuid.NullUUID{UUID: episode.ID, Valid: true}
	}

	rows, err := s.queriesFor(ctx).ListAccessTicketsForTenant(ctx, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	now := time.Now()
	tickets := make([]*publiraadminv1.AdminAccessTicket, 0, len(rows))
	for _, row := range rows {
		tickets = append(tickets, mapAccessTicketFromListRow(row, now))
	}

	return connect.NewResponse(&publiraadminv1.ListAccessTicketsResponse{
		Tickets: tickets,
	}), nil
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

	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}

	userRow, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: userPublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if userRow.Status != "active" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("user is not active"))
	}

	episode, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: episodePublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	expiresAt, err := parseOptionalExpiresAt(req.Msg.ExpiresAt)
	if err != nil {
		return nil, err
	}

	// Idempotent re-issue: return the existing active ticket when one already covers this pair.
	existing, existingErr := s.queriesFor(ctx).GetActiveAccessTicketForUserEpisode(ctx, dbmodels.GetActiveAccessTicketForUserEpisodeParams{
		TenantID:  tenant.ID,
		UserID:    userRow.ID,
		EpisodeID: episode.ID,
	})
	if existingErr == nil {
		// Optionally extend expiry if the new request asks for a later expiry.
		ticketRow, getErr := s.queriesFor(ctx).GetAccessTicketByPublicIDForTenant(ctx, dbmodels.GetAccessTicketByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: existing.PublicID,
		})
		if getErr != nil {
			return nil, connect.NewError(connect.CodeInternal, getErr)
		}
		return connect.NewResponse(&publiraadminv1.IssueAccessTicketResponse{
			Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
		}), nil
	}
	if existingErr != nil && !errors.Is(existingErr, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeInternal, existingErr)
	}

	note := strings.TrimSpace(req.Msg.Note)
	ticketID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	publicID := generatePublicID()

	created, err := s.queriesFor(ctx).CreateAccessTicket(ctx, dbmodels.CreateAccessTicketParams{
		ID:              ticketID,
		TenantID:        tenant.ID,
		PublicID:        publicID,
		EpisodeID:       episode.ID,
		UserID:          userRow.ID,
		ExpiresAt:       expiresAt,
		Note:            sql.NullString{String: note, Valid: note != ""},
		CreatedByUserID: uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	ticketRow, err := s.queriesFor(ctx).GetAccessTicketByPublicIDForTenant(ctx, dbmodels.GetAccessTicketByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: created.PublicID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	// Confirm existence first so already-revoked tickets return a clear status.
	current, err := s.queriesFor(ctx).GetAccessTicketByPublicIDForTenant(ctx, dbmodels.GetAccessTicketByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("access ticket not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if current.RevokedAt.Valid {
		return connect.NewResponse(&publiraadminv1.RevokeAccessTicketResponse{
			Ticket: mapAccessTicketFromGetRow(current, time.Now()),
		}), nil
	}

	if _, err := s.queriesFor(ctx).RevokeAccessTicketByPublicIDForTenant(ctx, dbmodels.RevokeAccessTicketByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("access ticket not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	ticketRow, err := s.queriesFor(ctx).GetAccessTicketByPublicIDForTenant(ctx, dbmodels.GetAccessTicketByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "access_ticket_revoked",
		TargetType:  "access_ticket",
		TargetID:    publicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.RevokeAccessTicketResponse{
		Ticket: mapAccessTicketFromGetRow(ticketRow, time.Now()),
	}), nil
}
