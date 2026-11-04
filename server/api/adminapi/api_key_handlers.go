package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantapikeys"
)

const auditTargetAPIKey = "api_key"

var apiKeyScopes = map[publiraadminv1.ApiKeyScope]string{
	publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ:   tenantapikeys.ScopeCatalogRead,
	publiraadminv1.ApiKeyScope_API_KEY_SCOPE_PURCHASES_READ: tenantapikeys.ScopePurchasesRead,
}

func apiKeyToProto(row dbmodels.TenantApiKey) *publiraadminv1.ApiKey {
	scopes := make([]publiraadminv1.ApiKeyScope, 0, len(row.Scopes))
	for _, scope := range row.Scopes {
		scopes = append(scopes, storedKindToProto(apiKeyScopes, scope))
	}
	return &publiraadminv1.ApiKey{
		Id:         row.ID.String(),
		Name:       row.Name,
		Prefix:     tenantapikeys.DisplayPrefix(row.Prefix),
		Scopes:     scopes,
		CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
		LastUsedAt: formatOptionalTime(row.LastUsedAt),
		RevokedAt:  formatOptionalTime(row.RevokedAt),
	}
}

func (s *adminServer) ListApiKeys(
	ctx context.Context,
	req *publiraadminv1.ListApiKeysRequest,
) (*publiraadminv1.ListApiKeysResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListTenantApiKeys(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list API keys", err, "tenant_id", tenant.ID.String())
	}
	keys := make([]*publiraadminv1.ApiKey, 0, len(rows))
	for _, row := range rows {
		keys = append(keys, apiKeyToProto(row))
	}
	return &publiraadminv1.ListApiKeysResponse{ApiKeys: keys}, nil
}

func (s *adminServer) CreateApiKey(
	ctx context.Context,
	req *publiraadminv1.CreateApiKeyRequest,
) (*publiraadminv1.CreateApiKeyResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if length := utf8.RuneCountInString(name); length < 1 || length > 100 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must be 1 to 100 characters"), "name")
	}
	scopes := make([]string, 0, len(req.Scopes))
	for _, requested := range req.Scopes {
		scope, ok := apiKeyScopes[requested]
		if !ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("names a scope that does not exist"), "scopes")
		}
		if !slices.Contains(scopes, scope) {
			scopes = append(scopes, scope)
		}
	}
	if len(scopes) == 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must name at least one scope"), "scopes")
	}
	slices.Sort(scopes)

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create API key transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	// The prefix is 60 random bits and unique across every tenant, so a
	// collision is not worth a retry: it fails this one request.
	key, err := tenantapikeys.New()
	if err != nil {
		return nil, s.internalError(ctx, "failed to generate an API key", err, "tenant_id", tenant.ID.String())
	}
	row, err := queries.CreateTenantApiKey(txCtx, dbmodels.CreateTenantApiKeyParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        tenant.ID,
		Name:            name,
		Prefix:          key.Prefix,
		KeyHash:         key.Hash,
		Scopes:          scopes,
		CreatedByUserID: uuid.NullUUID{UUID: session.User.ID, Valid: true},
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create API key", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "api_key_created", auditTargetAPIKey, row.ID.String()); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create API key", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.CreateApiKeyResponse{ApiKey: apiKeyToProto(row), Key: key.Key}, nil
}

func (s *adminServer) RevokeApiKey(
	ctx context.Context,
	req *publiraadminv1.RevokeApiKeyRequest,
) (*publiraadminv1.RevokeApiKeyResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.ApiKeyId, "api_key_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin revoke API key transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	row, err := queries.RevokeTenantApiKey(txCtx, dbmodels.RevokeTenantApiKeyParams{TenantID: tenant.ID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		// Revoked already, or not the tenant's: answer the one as it stands and
		// the other as not found.
		row, err = queries.GetTenantApiKey(txCtx, dbmodels.GetTenantApiKeyParams{TenantID: tenant.ID, ID: id})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "API key not found")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get API key", err, "tenant_id", tenant.ID.String())
		}
		return &publiraadminv1.RevokeApiKeyResponse{ApiKey: apiKeyToProto(row)}, nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to revoke API key", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "api_key_revoked", auditTargetAPIKey, row.ID.String()); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit revoke API key", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.RevokeApiKeyResponse{ApiKey: apiKeyToProto(row)}, nil
}
