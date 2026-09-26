package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// recordIDArg reads the internal ID a request names a record by, and uuid.Nil
// when the field is empty. An unparseable value is refused here rather than
// reaching a query that would answer not_found for something that is not an
// identifier at all.
func recordIDArg(raw, field string) (uuid.UUID, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return uuid.Nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is not an identifier", field), field)
	}
	return id, nil
}

// recordIDsArg reads a list of internal IDs under the rules
// validateDistinctPublicIDs holds a list of public IDs to.
func recordIDsArg(raw []string, field, noun string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s are required", field))
	}
	ids := make([]uuid.UUID, 0, len(raw))
	seen := make(map[uuid.UUID]struct{}, len(raw))
	for _, value := range raw {
		if strings.TrimSpace(value) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains empty value", field))
		}
		id, err := recordIDArg(value, field)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[id]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains duplicate %s", field, noun))
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

// episodeRef names an episode by id, or by public_id while a client still
// sends that.
type episodeRef struct {
	id       uuid.UUID
	publicID string
}

// seriesIDArg resolves the series a request names: by series_id, or by its
// public_id while a client still sends that.
func (s *adminServer) seriesIDArg(ctx context.Context, tenantID uuid.UUID, rawID, rawPublicID string) (uuid.UUID, error) {
	id, err := recordIDArg(rawID, "series_id")
	if err != nil || id != uuid.Nil {
		return id, err
	}
	publicID := strings.TrimSpace(rawPublicID)
	if publicID == "" {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("series_id is required"), "series_id")
	}
	id, err = s.queriesFor(ctx).GetSeriesIDByPublicIDForTenant(ctx, dbmodels.GetSeriesIDByPublicIDForTenantParams{TenantID: tenantID, PublicID: publicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return uuid.Nil, s.internalDBError(ctx, "failed to resolve series public id", err, "tenant_id", tenantID.String(), "series_public_id", publicID)
	}
	return id, nil
}

// episodeIDArg resolves the episode a request names: by episode_id, or by its
// public_id while a client still sends that.
func (s *adminServer) episodeIDArg(ctx context.Context, tenantID uuid.UUID, rawID, rawPublicID string) (uuid.UUID, error) {
	id, err := recordIDArg(rawID, "episode_id")
	if err != nil || id != uuid.Nil {
		return id, err
	}
	publicID := strings.TrimSpace(rawPublicID)
	if publicID == "" {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("episode_id is required"), "episode_id")
	}
	id, err = s.queriesFor(ctx).GetEpisodeIDByPublicIDForTenant(ctx, dbmodels.GetEpisodeIDByPublicIDForTenantParams{TenantID: tenantID, PublicID: publicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return uuid.Nil, s.internalDBError(ctx, "failed to resolve episode public id", err, "tenant_id", tenantID.String(), "episode_public_id", publicID)
	}
	return id, nil
}
