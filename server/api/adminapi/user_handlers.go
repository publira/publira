package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

const (
	defaultTenantUserListLimit = int32(20)
	maxTenantUserListLimit     = int32(100)
)

type tenantUserPageRow struct {
	id        uuid.UUID
	publicID  string
	name      string
	role      string
	createdAt time.Time
}

func mapTenantUserDescRows(rows []dbmodels.ListTenantUsersDescRow) []tenantUserPageRow {
	mapped := make([]tenantUserPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, tenantUserPageRow{
			id:        row.UserID,
			publicID:  row.PublicID,
			name:      row.Name,
			role:      row.Role,
			createdAt: row.CreatedAt,
		})
	}
	return mapped
}

func mapTenantUserAscRows(rows []dbmodels.ListTenantUsersAscRow) []tenantUserPageRow {
	mapped := make([]tenantUserPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, tenantUserPageRow{
			id:        row.UserID,
			publicID:  row.PublicID,
			name:      row.Name,
			role:      row.Role,
			createdAt: row.CreatedAt,
		})
	}
	return mapped
}

// tenantUserPage loads one over-fetched page. Admin ListTenantUsers is sorted
// (created_at, id) DESC. Forward uses the DESC query; backward uses ASC so the
// index can be scanned in reverse. pagination.Page flips ASC rows back into
// display order.
func (s *adminServer) tenantUserPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keyword string,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]tenantUserPageRow, error) {
	queries := s.queriesFor(ctx)
	query := sql.NullString{String: keyword, Valid: keyword != ""}
	if direction == pagination.Backward {
		rows, err := queries.ListTenantUsersAsc(ctx, dbmodels.ListTenantUsersAscParams{
			TenantID:        uuid.NullUUID{UUID: tenantID, Valid: true},
			Query:           query,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapTenantUserAscRows(rows), nil
	}

	rows, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID:        uuid.NullUUID{UUID: tenantID, Valid: true},
		Query:           query,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapTenantUserDescRows(rows), nil
}

func (s *adminServer) ListTenantUsers(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListTenantUsersRequest],
) (*connect.Response[publiraadminv1.ListTenantUsersResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultTenantUserListLimit, maxTenantUserListLimit)
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

	keyword := strings.TrimSpace(req.Msg.Query)

	rows, err := s.tenantUserPage(ctx, tenant.ID, keyword, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant users", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	users := make([]*publiraadminv1.AdminTenantUser, 0, len(rows))
	for _, row := range rows {
		users = append(users, &publiraadminv1.AdminTenantUser{
			PublicId: row.publicID,
			Name:     row.name,
			Role:     row.role,
		})
	}

	res := &publiraadminv1.ListTenantUsersResponse{Users: users}
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
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}
