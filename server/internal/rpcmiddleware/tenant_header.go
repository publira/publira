package rpcmiddleware

import (
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

const (
	TenantPublicIDHeaderName = "X-Publira-Tenant-Public-Id"
	TenantIDHeaderName       = "X-Publira-Tenant-Id"
)

func tenantPublicIDFromHeader(headers http.Header) string {
	if headers == nil {
		return ""
	}
	for _, key := range []string{TenantPublicIDHeaderName, TenantIDHeaderName} {
		if value := strings.TrimSpace(headers.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

// ResolveTenantPublicID resolves tenant_public_id from request body or HTTP headers.
// If both are set, values must match.
func ResolveTenantPublicID(tenantCtx *publirattypesv1.TenantContext, headers http.Header) (string, error) {
	var bodyTenantPublicID string
	if tenantCtx != nil {
		bodyTenantPublicID = strings.TrimSpace(tenantCtx.TenantPublicId)
	}
	headerTenantPublicID := tenantPublicIDFromHeader(headers)

	if bodyTenantPublicID != "" && headerTenantPublicID != "" && bodyTenantPublicID != headerTenantPublicID {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id header and request body must match"))
	}
	if bodyTenantPublicID != "" {
		return bodyTenantPublicID, nil
	}
	if headerTenantPublicID != "" {
		return headerTenantPublicID, nil
	}
	return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
}

// ResolveTenantPublicIDValue resolves tenant_public_id from a string field or HTTP headers.
// If both are set, values must match.
func ResolveTenantPublicIDValue(fieldValue string, headers http.Header) (string, error) {
	bodyTenantPublicID := strings.TrimSpace(fieldValue)
	headerTenantPublicID := tenantPublicIDFromHeader(headers)

	if bodyTenantPublicID != "" && headerTenantPublicID != "" && bodyTenantPublicID != headerTenantPublicID {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id header and request body must match"))
	}
	if bodyTenantPublicID != "" {
		return bodyTenantPublicID, nil
	}
	if headerTenantPublicID != "" {
		return headerTenantPublicID, nil
	}
	return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
}
