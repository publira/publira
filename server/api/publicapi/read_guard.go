package publicapi

import (
	"context"
	"strings"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/readguard"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// searchProcedurePrefix names the catalog search procedures, which spend the
// search allowance instead of the public API's.
const searchProcedurePrefix = "/" + publirav1connect.CatalogServiceName + "/SearchPublished"

// readAllowance is the allowance a call of procedure spends.
func readAllowance(procedure string) readguard.Allowance {
	if strings.HasPrefix(procedure, searchProcedurePrefix) {
		return readguard.Search
	}
	return readguard.PublicAPI
}

// readGuardInterceptor charges every publira.v1 call to the calling client's
// allowance before anything else reads the request, so a call past it costs
// no message decode, no connection, and no query. It is outermost but for
// tracing, which keeps the refusals visible in a trace.
func (s *apiServer) readGuardInterceptor() connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			decision, err := s.readGuard.Allow(ctx, readAllowance(spec.Procedure))
			if err != nil {
				return s.internalError(ctx, "failed to apply the read rate limit", err, "procedure", spec.Procedure)
			}
			if !decision.Allowed {
				return rpcerrors.NewRateLimitedError(ctx, decision.RetryAfter)
			}
			return next(ctx, spec, stream)
		}
	}
}
