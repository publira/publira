package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
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

	read, err := s.queriesFor(ctx).MarkPublishedEpisodeAsRead(ctx, dbmodels.MarkPublishedEpisodeAsReadParams{
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

	return noStorePrivateResponse(&publirav1.MarkEpisodeAsReadResponse{
		ReadAt: read.ReadAt.UTC().Format(time.RFC3339Nano),
	}), nil
}
