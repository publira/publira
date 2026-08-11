package adminapi

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	defaultTenantUserListLimit = int32(50)
	maxTenantUserListLimit     = int32(200)
)

func (s *adminServer) ListTenantUsers(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListTenantUsersRequest],
) (*connect.Response[publiraadminv1.ListTenantUsersResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 || limit > maxTenantUserListLimit {
		limit = defaultTenantUserListLimit
	}

	keyword := strings.ToLower(strings.TrimSpace(req.Msg.Query))

	rows, err := s.queriesFor(ctx).ListTenantUsers(ctx, dbmodels.ListTenantUsersParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Offset:   0,
		Limit:    maxTenantUserListLimit,
	})
	if err != nil {
		return nil, s.internalDBError("failed to list tenant users", err, "tenant_id", tenant.ID.String())
	}

	users := make([]*publiraadminv1.AdminTenantUser, 0, len(rows))
	for _, row := range rows {
		if keyword != "" {
			haystack := strings.ToLower(row.PublicID + "\n" + row.Name + "\n" + row.Email)
			if !strings.Contains(haystack, keyword) {
				continue
			}
		}

		users = append(users, &publiraadminv1.AdminTenantUser{
			PublicId: row.PublicID,
			Name:     row.Name,
			Role:     row.Role,
		})
		if len(users) >= int(limit) {
			break
		}
	}

	return connect.NewResponse(&publiraadminv1.ListTenantUsersResponse{Users: users}), nil
}
