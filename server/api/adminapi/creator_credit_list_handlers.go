package adminapi

import (
	"context"
	"database/sql"
	"strconv"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	defaultCreatorCreditPageSize = int32(20)
	maxCreatorCreditPageSize     = int32(100)

	// creatorCreditInclusiveKey marks a recovery token, as
	// pagination.EncodeTimeUUIDRecovery does for a two-key one.
	creatorCreditInclusiveKey = "inclusive"
)

// creatorCreditKeys is where a credit sits in the list, in the order
// ListCreatorCreditsAsc sorts by. Its zero value means no boundary.
type creatorCreditKeys struct {
	seriesID          uuid.UUID
	kindRank          int32
	episodeOrderIndex int32
	episodeID         uuid.UUID
	roleKey           uuid.UUID
	inclusive         bool
	valid             bool
}

func encodeCreatorCreditKeys(direction pagination.Direction, keys creatorCreditKeys) string {
	parts := []string{
		keys.seriesID.String(),
		strconv.FormatInt(int64(keys.kindRank), 10),
		strconv.FormatInt(int64(keys.episodeOrderIndex), 10),
		keys.episodeID.String(),
		keys.roleKey.String(),
	}
	if keys.inclusive {
		parts = append(parts, creatorCreditInclusiveKey)
	}
	return pagination.Encode(direction, parts...)
}

func decodeCreatorCreditKeys(cursor pagination.Cursor) (creatorCreditKeys, error) {
	if len(cursor.Keys) != 5 && len(cursor.Keys) != 6 {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	keys := creatorCreditKeys{valid: true}
	if len(cursor.Keys) == 6 {
		if cursor.Keys[5] != creatorCreditInclusiveKey {
			return creatorCreditKeys{}, pagination.ErrInvalidToken
		}
		keys.inclusive = true
	}
	var err error
	if keys.seriesID, err = uuid.Parse(cursor.Keys[0]); err != nil {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	kindRank, err := strconv.ParseInt(cursor.Keys[1], 10, 32)
	if err != nil {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	keys.kindRank = int32(kindRank)
	orderIndex, err := strconv.ParseInt(cursor.Keys[2], 10, 32)
	if err != nil {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	keys.episodeOrderIndex = int32(orderIndex)
	if keys.episodeID, err = uuid.Parse(cursor.Keys[3]); err != nil {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	if keys.roleKey, err = uuid.Parse(cursor.Keys[4]); err != nil {
		return creatorCreditKeys{}, pagination.ErrInvalidToken
	}
	return keys, nil
}

// creatorCreditPage runs the keyset query for one page. A backward page is
// scanned by the descending query and put back in ascending order by
// pagination.Page.
func (s *adminServer) creatorCreditPage(
	ctx context.Context,
	tenantID, creatorID uuid.UUID,
	keys creatorCreditKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.ListCreatorCreditsAscRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListCreatorCreditsDesc(ctx, dbmodels.ListCreatorCreditsDescParams{
			TenantID:                tenantID,
			CreatorID:               creatorID,
			CursorSeriesID:          uuid.NullUUID{UUID: keys.seriesID, Valid: keys.valid},
			CursorKindRank:          sql.NullInt32{Int32: keys.kindRank, Valid: keys.valid},
			CursorEpisodeOrderIndex: sql.NullInt32{Int32: keys.episodeOrderIndex, Valid: keys.valid},
			CursorEpisodeID:         uuid.NullUUID{UUID: keys.episodeID, Valid: keys.valid},
			CursorRoleKey:           uuid.NullUUID{UUID: keys.roleKey, Valid: keys.valid},
			CursorInclusive:         keys.inclusive,
			Limit:                   limit,
		})
		if err != nil {
			return nil, err
		}
		mapped := make([]dbmodels.ListCreatorCreditsAscRow, 0, len(rows))
		for _, row := range rows {
			mapped = append(mapped, dbmodels.ListCreatorCreditsAscRow(row))
		}
		return mapped, nil
	}

	return queries.ListCreatorCreditsAsc(ctx, dbmodels.ListCreatorCreditsAscParams{
		TenantID:                tenantID,
		CreatorID:               creatorID,
		CursorSeriesID:          uuid.NullUUID{UUID: keys.seriesID, Valid: keys.valid},
		CursorKindRank:          sql.NullInt32{Int32: keys.kindRank, Valid: keys.valid},
		CursorEpisodeOrderIndex: sql.NullInt32{Int32: keys.episodeOrderIndex, Valid: keys.valid},
		CursorEpisodeID:         uuid.NullUUID{UUID: keys.episodeID, Valid: keys.valid},
		CursorRoleKey:           uuid.NullUUID{UUID: keys.roleKey, Valid: keys.valid},
		CursorInclusive:         keys.inclusive,
		Limit:                   limit,
	})
}

func (s *adminServer) ListCreatorCredits(
	ctx context.Context,
	req *publiraadminv1.ListCreatorCreditsRequest,
) (*publiraadminv1.ListCreatorCreditsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	creatorID, err := parseRecordID(req.CreatorId, "creator_id")
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultCreatorCreditPageSize, maxCreatorCreditPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys creatorCreditKeys
	if !cursor.IsZero() {
		keys, err = decodeCreatorCreditKeys(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	// A creator with no credit and one that does not exist would both be an
	// empty list, so the creator is looked up first: another tenant's is
	// filtered out by tenant_id and lands on the same not_found.
	if _, err := s.creatorByID(ctx, tenant.ID, creatorID); err != nil {
		return nil, err
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.creatorCreditPage(ctx, tenant.ID, creatorID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator credits", err, "tenant_id", tenant.ID.String(), "creator_id", creatorID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	credits := make([]*publiraadminv1.CreatorCredit, 0, len(rows))
	for _, row := range rows {
		credits = append(credits, creatorCreditFromRow(row))
	}

	res := &publiraadminv1.ListCreatorCreditsResponse{Credits: credits}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeCreatorCreditKeys(pagination.Backward, creatorCreditKeysOf(rows[0]))
		}
		if hasNext {
			res.NextToken = encodeCreatorCreditKeys(pagination.Forward, creatorCreditKeysOf(rows[len(rows)-1]))
		}
	// An empty page means the boundary credit was removed after the token was
	// issued. Hand back a token to where the client came from, and recover
	// only once: a recovery token that also comes back empty leaves both
	// tokens empty so the client falls back to the first page.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		keys.inclusive = true
		res.PreviousToken = encodeCreatorCreditKeys(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		keys.inclusive = true
		res.NextToken = encodeCreatorCreditKeys(pagination.Forward, keys)
	}
	return res, nil
}

func creatorCreditKeysOf(row dbmodels.ListCreatorCreditsAscRow) creatorCreditKeys {
	return creatorCreditKeys{
		seriesID:          row.SeriesID,
		kindRank:          row.KindRank,
		episodeOrderIndex: row.EpisodeOrderIndex,
		episodeID:         row.EpisodeID,
		roleKey:           row.RoleKey,
		valid:             true,
	}
}

// creatorCreditFromRow answers one credit. kind_rank 0 is the series' own
// credit, which names no episode and has no source.
func creatorCreditFromRow(row dbmodels.ListCreatorCreditsAscRow) *publiraadminv1.CreatorCredit {
	credit := &publiraadminv1.CreatorCredit{
		Series: &publiraadminv1.CreditedSeries{
			Id:       row.SeriesID.String(),
			PublicId: row.SeriesPublicID,
			Title:    row.SeriesTitle,
		},
	}
	if row.RoleID.Valid {
		credit.Role = &publirattypesv1.CreatorRole{
			Id:       row.RoleID.UUID.String(),
			PublicId: row.RolePublicID.String,
			Name:     row.RoleName.String,
		}
	}
	if row.KindRank == 0 {
		return credit
	}
	credit.Episode = &publiraadminv1.CreditedEpisode{
		Id:       row.EpisodeID.String(),
		PublicId: row.EpisodePublicID,
		Title:    row.EpisodeTitle,
	}
	switch row.Source {
	case "episode":
		credit.Source = publirattypesv1.CreatorCreditSource_CREATOR_CREDIT_SOURCE_EPISODE
	case "series":
		credit.Source = publirattypesv1.CreatorCreditSource_CREATOR_CREDIT_SOURCE_SERIES
	}
	return credit
}
