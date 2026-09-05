package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

// scopeEpisodeReadUser applies the member part of episode_reads' RLS policy to
// the request connection. Direct handler tests use sqlmock and therefore have
// no request connection to scope.
func (s *apiServer) scopeEpisodeReadUser(ctx context.Context, userID uuid.UUID) error {
	conn, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		return nil
	}
	if err := tenantconn.SetUser(ctx, conn, userID); err != nil {
		return s.internalDBError(ctx, "failed to set episode read member context", err, "user_id", userID.String())
	}
	return nil
}

// MarkEpisodeAsRead records the authenticated member's first completed read
// of an episode. The single write query repeats publication and paid-body
// access checks, so a stale client notification cannot create a read after the
// episode was unpublished or the member's access was revoked.
func (s *apiServer) MarkEpisodeAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkEpisodeAsReadRequest],
) (*connect.Response[publirav1.MarkEpisodeAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}

	readID, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to allocate episode read id", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	read, err := s.queriesFor(ctx).MarkPublishedEpisodeAsRead(ctx, dbmodels.MarkPublishedEpisodeAsReadParams{
		ID:              readID,
		TenantID:        tenant.ID,
		UserID:          user.ID,
		EpisodePublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Publication, tenant, and entitlement failures deliberately share one
		// response so this member cannot probe for unavailable episode IDs.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to mark episode as read", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	s.projectEpisodeCompleteEvent(ctx, read)

	return noStorePrivateResponse(&publirav1.MarkEpisodeAsReadResponse{
		ReadAt: read.ReadAt.UTC().Format(time.RFC3339Nano),
	}), nil
}

// projectEpisodeCompleteEvent files the analytics counterpart of a stored read.
//
// It reports nothing for the same reason the view instrumentation does not: the
// member's read is already persisted, and failing their request over the
// engagement projection would trade the state they asked for against a number
// nobody is waiting on. What is lost is a row `batch project-episode-reads`
// puts back, because the projection is keyed by the read it came from and can
// be replayed from episode_reads at any time.
func (s *apiServer) projectEpisodeCompleteEvent(ctx context.Context, read dbmodels.EpisodeRead) {
	logAttrs := []any{
		"event_type", "episode_complete",
		"tenant_id", read.TenantID.String(),
		"episode_id", read.EpisodeID.String(),
	}

	eventID, err := uuid.NewV7()
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to allocate episode complete event id", append(logAttrs, "error", err)...)
		return
	}

	_, err = s.queriesFor(ctx).ProjectEpisodeCompleteEvent(ctx, dbmodels.ProjectEpisodeCompleteEventParams{
		ID:        eventID,
		TenantID:  read.TenantID,
		UserID:    read.UserID,
		EpisodeID: read.EpisodeID,
	})
	// ON CONFLICT DO NOTHING returns no rows: this read was already projected,
	// which is a repeated notification rather than a failure.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.ErrorContext(ctx, "failed to project episode complete event", append(logAttrs, "error", err)...)
	}
}
