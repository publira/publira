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
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

const (
	defaultFollowPageSize = int32(20)
	maxFollowPageSize     = int32(100)
	followInclusiveKey    = "inclusive"

	followTargetEpisode = "episode"
	followTargetCreator = "creator"
)

type resolvedFollowTarget struct {
	typeName string
	id       uuid.UUID
}

// resolveFollowTarget always starts from the public catalog query. This gives
// all follow RPCs the same not-found behaviour for foreign, unpublished, and
// missing targets before they read or change a member-specific relation.
func (s *apiServer) resolveFollowTarget(
	ctx context.Context,
	tenantID uuid.UUID,
	target *publirav1.FollowTarget,
) (resolvedFollowTarget, error) {
	if target == nil || strings.TrimSpace(target.PublicId) == "" {
		return resolvedFollowTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target is required"))
	}

	queries := s.queriesFor(ctx)
	switch target.Type {
	case publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_EPISODE:
		row, err := queries.GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{
			TenantID: tenantID,
			PublicID: strings.TrimSpace(target.PublicId),
		})
		if err == nil {
			return resolvedFollowTarget{typeName: followTargetEpisode, id: row.ID}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedFollowTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedFollowTarget{}, s.internalDBError(ctx, "failed to get follow episode target", err, "tenant_id", tenantID.String())
	case publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_AUTHOR:
		row, err := queries.GetPublishedAuthorByPublicID(ctx, dbmodels.GetPublishedAuthorByPublicIDParams{
			TenantID: tenantID,
			PublicID: strings.TrimSpace(target.PublicId),
		})
		if err == nil {
			return resolvedFollowTarget{typeName: followTargetCreator, id: row.ID}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedFollowTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedFollowTarget{}, s.internalDBError(ctx, "failed to get follow author target", err, "tenant_id", tenantID.String())
	default:
		return resolvedFollowTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target type is invalid"))
	}
}

func noStoreFollowResponse[T any](msg *T) *connect.Response[T] {
	response := connect.NewResponse(msg)
	response.Header().Set("Cache-Control", "private, no-store")
	return response
}

func (s *apiServer) scopeFollowUser(ctx context.Context, userID uuid.UUID) error {
	conn, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		// sqlmock and direct handler tests do not borrow a request connection.
		return nil
	}
	if err := tenantconn.SetUser(ctx, conn, userID); err != nil {
		return s.internalDBError(ctx, "failed to set follow member context", err, "user_id", userID.String())
	}
	return nil
}

func (s *apiServer) followStatus(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	target resolvedFollowTarget,
) (bool, error) {
	queries := s.queriesFor(ctx)
	switch target.typeName {
	case followTargetEpisode:
		return queries.UserFollowsPublishedEpisode(ctx, dbmodels.UserFollowsPublishedEpisodeParams{
			TenantID:  tenantID,
			UserID:    userID,
			EpisodeID: target.id,
		})
	case followTargetCreator:
		return queries.UserFollowsPublishedCreator(ctx, dbmodels.UserFollowsPublishedCreatorParams{
			TenantID:  tenantID,
			UserID:    userID,
			CreatorID: target.id,
		})
	default:
		return false, errors.New("unknown follow target type")
	}
}

func (s *apiServer) GetMyFollowStatus(
	ctx context.Context,
	req *connect.Request[publirav1.GetMyFollowStatusRequest],
) (*connect.Response[publirav1.GetMyFollowStatusResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeFollowUser(ctx, user.ID); err != nil {
		return nil, err
	}
	target, err := s.resolveFollowTarget(ctx, tenant.ID, req.Msg.Target)
	if err != nil {
		return nil, err
	}
	following, err := s.followStatus(ctx, tenant.ID, user.ID, target)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get follow status", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStoreFollowResponse(&publirav1.GetMyFollowStatusResponse{IsFollowing: following}), nil
}

func (s *apiServer) Follow(
	ctx context.Context,
	req *connect.Request[publirav1.FollowRequest],
) (*connect.Response[publirav1.FollowResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeFollowUser(ctx, user.ID); err != nil {
		return nil, err
	}
	target, err := s.resolveFollowTarget(ctx, tenant.ID, req.Msg.Target)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	switch target.typeName {
	case followTargetEpisode:
		_, err = queries.CreateEpisodeFollow(ctx, dbmodels.CreateEpisodeFollowParams{TenantID: tenant.ID, UserID: user.ID, EpisodeID: target.id})
	case followTargetCreator:
		_, err = queries.CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{TenantID: tenant.ID, UserID: user.ID, CreatorID: target.id})
	}
	// INSERT .. ON CONFLICT DO NOTHING RETURNING produces sql.ErrNoRows for an
	// already-followed target. Treat that as the same successful final state.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to follow target", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStoreFollowResponse(&publirav1.FollowResponse{IsFollowing: true}), nil
}

func (s *apiServer) Unfollow(
	ctx context.Context,
	req *connect.Request[publirav1.UnfollowRequest],
) (*connect.Response[publirav1.UnfollowResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeFollowUser(ctx, user.ID); err != nil {
		return nil, err
	}
	target, err := s.resolveFollowTarget(ctx, tenant.ID, req.Msg.Target)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	switch target.typeName {
	case followTargetEpisode:
		_, err = queries.DeleteEpisodeFollow(ctx, dbmodels.DeleteEpisodeFollowParams{TenantID: tenant.ID, UserID: user.ID, EpisodeID: target.id})
	case followTargetCreator:
		_, err = queries.DeleteCreatorFollow(ctx, dbmodels.DeleteCreatorFollowParams{TenantID: tenant.ID, UserID: user.ID, CreatorID: target.id})
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to unfollow target", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStoreFollowResponse(&publirav1.UnfollowResponse{IsFollowing: false}), nil
}

type followCursorKeys struct {
	createdAt  sql.NullTime
	targetType sql.NullString
	targetID   uuid.NullUUID
	inclusive  bool
}

func decodeFollowCursorKeys(cursor pagination.Cursor) (followCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return followCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != followInclusiveKey {
		return followCursorKeys{}, invalid
	}
	createdAt, err := time.Parse(time.RFC3339Nano, cursor.Keys[0])
	if err != nil {
		return followCursorKeys{}, invalid
	}
	if cursor.Keys[1] != followTargetEpisode && cursor.Keys[1] != followTargetCreator {
		return followCursorKeys{}, invalid
	}
	targetID, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return followCursorKeys{}, invalid
	}
	return followCursorKeys{
		createdAt:  sql.NullTime{Time: createdAt.UTC(), Valid: true},
		targetType: sql.NullString{String: cursor.Keys[1], Valid: true},
		targetID:   uuid.NullUUID{UUID: targetID, Valid: true},
		inclusive:  inclusive,
	}, nil
}

type followPageRow struct {
	targetType string
	targetID   uuid.UUID
	createdAt  time.Time
}

func mapFollowDescRows(rows []dbmodels.ListUserFollowsByCreatedAtDescRow) []followPageRow {
	mapped := make([]followPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, followPageRow{targetType: row.TargetType, targetID: row.TargetID, createdAt: row.CreatedAt})
	}
	return mapped
}

func mapFollowAscRows(rows []dbmodels.ListUserFollowsByCreatedAtAscRow) []followPageRow {
	mapped := make([]followPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, followPageRow{targetType: row.TargetType, targetID: row.TargetID, createdAt: row.CreatedAt})
	}
	return mapped
}

type followTargetPublicIDs struct {
	episodes map[uuid.UUID]string
	creators map[uuid.UUID]string
}

// followTargetPublicIDs resolves public identifiers only at the API boundary.
// Follow rows and cursor keys retain just their internal UUID target IDs.
func (s *apiServer) followTargetPublicIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	follows []followPageRow,
) (followTargetPublicIDs, error) {
	ids := followTargetPublicIDs{
		episodes: make(map[uuid.UUID]string),
		creators: make(map[uuid.UUID]string),
	}
	episodeIDs := make([]uuid.UUID, 0, len(follows))
	creatorIDs := make([]uuid.UUID, 0, len(follows))
	for _, follow := range follows {
		switch follow.targetType {
		case followTargetEpisode:
			episodeIDs = append(episodeIDs, follow.targetID)
		case followTargetCreator:
			creatorIDs = append(creatorIDs, follow.targetID)
		}
	}

	queries := s.queriesFor(ctx)
	if len(episodeIDs) > 0 {
		rows, err := queries.ListPublishedEpisodeFollowTargetPublicIDsByIDs(ctx, dbmodels.ListPublishedEpisodeFollowTargetPublicIDsByIDsParams{
			TenantID: tenantID,
			Ids:      episodeIDs,
		})
		if err != nil {
			return followTargetPublicIDs{}, err
		}
		for _, row := range rows {
			ids.episodes[row.ID] = row.PublicID
		}
	}
	if len(creatorIDs) > 0 {
		rows, err := queries.ListPublishedCreatorFollowTargetPublicIDsByIDs(ctx, dbmodels.ListPublishedCreatorFollowTargetPublicIDsByIDsParams{
			TenantID: tenantID,
			Ids:      creatorIDs,
		})
		if err != nil {
			return followTargetPublicIDs{}, err
		}
		for _, row := range rows {
			ids.creators[row.ID] = row.PublicID
		}
	}
	return ids, nil
}

func (s *apiServer) followPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	keys followCursorKeys,
	direction pagination.Direction,
	limit int32,
) ([]followPageRow, error) {
	params := dbmodels.ListUserFollowsByCreatedAtDescParams{
		TenantID:         tenantID,
		UserID:           userID,
		CursorCreatedAt:  keys.createdAt,
		CursorInclusive:  keys.inclusive,
		CursorTargetType: keys.targetType,
		CursorTargetID:   keys.targetID,
		Limit:            limit,
	}
	if direction == pagination.Backward {
		rows, err := s.queriesFor(ctx).ListUserFollowsByCreatedAtAsc(ctx, dbmodels.ListUserFollowsByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		return mapFollowAscRows(rows), nil
	}
	rows, err := s.queriesFor(ctx).ListUserFollowsByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	return mapFollowDescRows(rows), nil
}

func followTargetTypeFromRow(typeName string) (publirav1.FollowTargetType, bool) {
	switch typeName {
	case followTargetEpisode:
		return publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_EPISODE, true
	case followTargetCreator:
		return publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_AUTHOR, true
	default:
		return publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_UNSPECIFIED, false
	}
}

func encodeFollowCursor(direction pagination.Direction, row followPageRow) string {
	return pagination.Encode(direction, row.createdAt.UTC().Format(time.RFC3339Nano), row.targetType, row.targetID.String())
}

func encodeFollowRecoveryToken(direction pagination.Direction, keys followCursorKeys) string {
	return pagination.Encode(direction, keys.createdAt.Time.UTC().Format(time.RFC3339Nano), keys.targetType.String, keys.targetID.UUID.String(), followInclusiveKey)
}

func (s *apiServer) ListMyFollows(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyFollowsRequest],
) (*connect.Response[publirav1.ListMyFollowsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeFollowUser(ctx, user.ID); err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultFollowPageSize, maxFollowPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys followCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeFollowCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}

	rows, err := s.followPage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list follows", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	publicIDs, err := s.followTargetPublicIDs(ctx, tenant.ID, rows)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve public follow targets", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	items := make([]*publirav1.MyFollow, 0, len(rows))
	for _, row := range rows {
		targetType, ok := followTargetTypeFromRow(row.targetType)
		if !ok {
			return nil, s.internalDBError(ctx, "invalid follow target type from database", errors.New("unknown follow target type"), "tenant_id", tenant.ID.String())
		}
		var publicID string
		switch row.targetType {
		case followTargetEpisode:
			publicID = publicIDs.episodes[row.targetID]
		case followTargetCreator:
			publicID = publicIDs.creators[row.targetID]
		}
		// A target can lose publication between the cursor query and this public
		// projection. Omit it rather than reveal its identifier.
		if publicID == "" {
			continue
		}
		items = append(items, &publirav1.MyFollow{
			TargetType:     targetType,
			TargetPublicId: publicID,
			FollowedAt:     row.createdAt.UTC().Format(time.RFC3339),
		})
	}

	res := &publirav1.ListMyFollowsResponse{Follows: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeFollowCursor(pagination.Backward, rows[0])
		}
		if hasNext {
			res.NextToken = encodeFollowCursor(pagination.Forward, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeFollowRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeFollowRecoveryToken(pagination.Forward, keys)
	}
	return noStoreFollowResponse(res), nil
}
