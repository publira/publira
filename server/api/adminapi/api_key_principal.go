package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantapikeys"
)

// apiKeyProcedures are the reads a tenant's API key may make, by the scope
// that admits each. Nothing that writes belongs here, and neither does a read
// that needs a person: ListEpisodeImages answers images signed for the
// operator who asked, and ListEpisodeReviews is the editors' own workflow.
// TestAPIKeyProceduresAreReads keeps the list to reads.
var apiKeyProcedures = map[string]string{
	publiraadminv1connect.AdminSeriesServiceListSeriesProcedure:                    tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceGetSeriesProcedure:                     tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListEpisodesProcedure:                  tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListEpisodesByPublicationDateProcedure: tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceGetEpisodeProcedure:                    tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListEpisodeCreditsProcedure:            tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListEpisodeFreeWindowsProcedure:        tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListEpisodeCampaignPricesProcedure:     tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceGetSeriesWaitFreeSettingsProcedure:     tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceGetSeriesFreeAfterSettingsProcedure:    tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminSeriesServiceListVolumesProcedure:                   tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminLabelServiceListLabelsProcedure:                     tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminLabelServiceGetLabelProcedure:                       tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminGenreServiceListGenresProcedure:                     tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminCreatorServiceListCreatorsProcedure:                 tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminCreatorServiceGetCreatorProcedure:                   tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminCreatorRoleServiceListCreatorRolesProcedure:         tenantapikeys.ScopeCatalogRead,
	publiraadminv1connect.AdminPurchaseServiceListPurchasesProcedure:               tenantapikeys.ScopePurchasesRead,
	publiraadminv1connect.AdminPurchaseServiceGetPurchaseProcedure:                 tenantapikeys.ScopePurchasesRead,
	publiraadminv1connect.AdminPurchaseServiceListReaderPurchasesProcedure:         tenantapikeys.ScopePurchasesRead,
}

func invalidAPIKeyError() error {
	return connect.NewError(connect.CodeUnauthenticated, "invalid API key")
}

// apiKeyScopeDeniedError refuses a procedure the key's scopes do not admit,
// or one no scope admits.
func apiKeyScopeDeniedError() error {
	return connect.NewError(connect.CodePermissionDenied, "procedure is not available to this API key")
}

// apiKeyContext authenticates a request carrying one of the tenant's API keys.
// The key is looked up on the request's tenant-scoped connection, so a key of
// another tenant's is one that does not exist. The refusals come in this
// order: unauthenticated for a key that does not open, permission_denied for a
// procedure its scopes do not admit, and resource_exhausted past its
// allowance, which is charged only to a key that opened.
func (s *adminServer) apiKeyContext(ctx context.Context, spec connect.Spec, req proto.Message) (context.Context, error) {
	build := rpcmiddleware.BuildAdminSessionContext(func(ctx context.Context, tenantCtx *publirattypesv1.TenantContext, headers *connect.Header) (rpcmiddleware.SessionContext, error) {
		tenant, err := s.tenantByContext(ctx, tenantCtx)
		if err != nil {
			return rpcmiddleware.SessionContext{}, err
		}
		key, err := s.authenticateAPIKey(ctx, tenant, headers, spec.Procedure)
		if err != nil {
			return rpcmiddleware.SessionContext{}, err
		}
		return rpcmiddleware.SessionContext{Tenant: tenant, APIKeyID: key.ID}, nil
	})
	return build(ctx, spec, req)
}

func (s *adminServer) authenticateAPIKey(ctx context.Context, tenant dbmodels.Tenant, headers *connect.Header, procedure string) (dbmodels.TenantApiKey, error) {
	bearer, _ := auth.BearerTokenFromHeader(headers)
	prefix, ok := tenantapikeys.Parse(bearer)
	if !ok {
		return dbmodels.TenantApiKey{}, invalidAPIKeyError()
	}
	key, err := s.queriesFor(ctx).GetTenantApiKeyByPrefix(ctx, dbmodels.GetTenantApiKeyByPrefixParams{TenantID: tenant.ID, Prefix: prefix})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.TenantApiKey{}, invalidAPIKeyError()
	}
	if err != nil {
		return dbmodels.TenantApiKey{}, s.internalDBError(ctx, "failed to look up an API key", err, "tenant_id", tenant.ID.String())
	}
	if !tenantapikeys.Matches(bearer, key.KeyHash) || key.RevokedAt.Valid {
		return dbmodels.TenantApiKey{}, invalidAPIKeyError()
	}
	scope, listed := apiKeyProcedures[procedure]
	if !listed || !slices.Contains(key.Scopes, scope) {
		return dbmodels.TenantApiKey{}, apiKeyScopeDeniedError()
	}
	if err := s.chargeAPIKey(ctx, key); err != nil {
		return dbmodels.TenantApiKey{}, err
	}
	if err := s.queriesFor(ctx).TouchTenantApiKey(ctx, dbmodels.TouchTenantApiKeyParams{TenantID: tenant.ID, ID: key.ID}); err != nil {
		// Only the console's "last used" is behind; the request is not.
		s.logger.WarnContext(ctx, "failed to record the use of an API key", "tenant_id", tenant.ID.String(), "api_key_id", key.ID.String(), "error", err)
	}
	return key, nil
}

// chargeAPIKey spends one request of the key's allowance under the platform
// policy, on the counters the deployment shares. The subject names the tenant
// as well as the key, as every counter kept for a tenant does, so the erasure
// of a deleted tenant finds the key's counters by the tenant alone.
func (s *adminServer) chargeAPIKey(ctx context.Context, key dbmodels.TenantApiKey) error {
	policy, err := s.policy.Policy(ctx)
	if err != nil {
		return s.internalError(ctx, "failed to resolve the platform policy", err)
	}
	decision, err := s.apiKeyLimiter.Allow(ctx, "api_key.request:"+key.TenantID.String()+":"+key.ID.String(),
		ratelimit.Rule{Limit: policy.APIKeyRequest.PerMinute, Window: time.Minute},
		ratelimit.Rule{Limit: policy.APIKeyRequest.PerDay, Window: 24 * time.Hour},
	)
	if err != nil {
		return s.internalError(ctx, "failed to apply the API key rate limit", err, "api_key_id", key.ID.String())
	}
	if !decision.Allowed {
		return rpcerrors.NewRateLimitedError(ctx, decision.RetryAfter)
	}
	return nil
}
