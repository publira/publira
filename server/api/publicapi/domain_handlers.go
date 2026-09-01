package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/locale"
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
		return nil, s.internalDBError(ctx, "failed to get tenant by domain", err, "domains", domains)
	}

	defaultLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publirav1.GetTenantByDomainResponse{
		TenantId:      tenant.ID.String(),
		DefaultLocale: defaultLocale,
	}), nil
}
