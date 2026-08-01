package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
)

func (s *apiServer) GetTenantByDomain(
	ctx context.Context,
	req *connect.Request[publirav1.GetTenantByDomainRequest],
) (*connect.Response[publirav1.GetTenantByDomainResponse], error) {
	domains := make([]string, 0, len(req.Msg.Domains))
	for _, candidate := range req.Msg.Domains {
		domain := strings.TrimSpace(candidate)
		if domain == "" {
			continue
		}
		domains = append(domains, domain)
	}
	if len(domains) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("domains are required"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByDomains(ctx, domains)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirav1.GetTenantByDomainResponse{
		TenantId: tenant.ID.String(),
	}), nil
}
