package rpcmiddleware

import (
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	// TenantIDHeaderName carries the tenant primary key (UUID) for internal RPC.
	TenantIDHeaderName = "X-Publira-Tenant-Id"
	// TenantPublicIDHeaderName is a legacy alias; values must be a tenant UUID when set.
	// Prefer TenantIDHeaderName for new code.
	TenantPublicIDHeaderName = "X-Publira-Tenant-Public-Id"
)

// TenantIDFromHeader returns the tenant identifier carried by the request
// headers, preferring TenantIDHeaderName over the legacy alias. Callers that
// resolve their own identifier shape (platform public_id, for example) use this
// so the set of accepted header names stays defined in one place.
func TenantIDFromHeader(headers http.Header) string {
	if headers == nil {
		return ""
	}
	for _, key := range []string{TenantIDHeaderName, TenantPublicIDHeaderName} {
		if value := strings.TrimSpace(headers.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

// ResolveTenantID resolves the tenant primary key (UUID) from request body or HTTP headers.
// If both are set, values must match.
func ResolveTenantID(tenantCtx *publirattypesv1.TenantContext, headers http.Header) (uuid.UUID, error) {
	var bodyTenantID string
	if tenantCtx != nil {
		bodyTenantID = strings.TrimSpace(tenantCtx.TenantId)
	}
	headerTenantID := TenantIDFromHeader(headers)

	if bodyTenantID != "" && headerTenantID != "" && bodyTenantID != headerTenantID {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_id header and request body must match"))
	}

	raw := bodyTenantID
	if raw == "" {
		raw = headerTenantID
	}
	if raw == "" {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
	}

	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_id must be a valid UUID"))
	}
	return id, nil
}

// ResolveTenantIDValue resolves tenant primary key (UUID) from a string field or HTTP headers.
// If both are set, values must match.
//
// Note: platform admin APIs that accept human-facing public_id should not use this helper;
// it is for internal UUID wiring only.
func ResolveTenantIDValue(fieldValue string, headers http.Header) (uuid.UUID, error) {
	bodyTenantID := strings.TrimSpace(fieldValue)
	headerTenantID := TenantIDFromHeader(headers)

	if bodyTenantID != "" && headerTenantID != "" && bodyTenantID != headerTenantID {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_id header and request body must match"))
	}

	raw := bodyTenantID
	if raw == "" {
		raw = headerTenantID
	}
	if raw == "" {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_id is required"))
	}

	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_id must be a valid UUID"))
	}
	return id, nil
}
