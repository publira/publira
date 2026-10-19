package publicapi

import (
	"context"
	"log/slog"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// readerLocaleOf is the locale a reader asked to read pages and the catalog
// in: the tenant's default for an empty value, since that is what the
// unprefixed public URLs are served in. A translation in it is picked where
// one exists, and the fallback rule of page_translation_for and
// series_translation_for where none does.
func readerLocaleOf(raw string, tenant dbmodels.Tenant) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return tenant.DefaultLocale, nil
	}
	code, err := locale.Normalize(raw)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, "locale must be a supported locale")
	}
	return code, nil
}

// localeRequest is a request that names the locale its reader reads in.
type localeRequest interface {
	GetLocale() string
}

// readerLocaleInterceptor records the locale a request names as the last
// locale of the reader its access token signs in, whichever RPC it is. Many
// public reads accept a token without authenticating it, because the token
// changes nothing they answer, so the record cannot wait for a handler to
// resolve the session.
func (s *apiServer) readerLocaleInterceptor() connect.ServerInterceptor {
	return rpcmiddleware.NewUnaryRequestInterceptor(func(ctx context.Context, _ connect.Spec, req proto.Message, next func(context.Context) error) error {
		if localed, ok := req.(localeRequest); ok {
			s.recordLastLocale(ctx, localed.GetLocale())
		}
		return next(ctx)
	})
}

// recordLastLocale keeps raw as the last locale of the reader the request's
// access token names, the language the notifications written for them are in.
// A request naming no locale, a locale that does not normalize, and a request
// with no token or one that does not verify for the tenant record nothing: the
// handler is what refuses a bad locale or a bad session, if it cares.
//
// A failed write is logged rather than returned: the request reads or does
// something else, and the reader's next request in that locale tries again.
func (s *apiServer) recordLastLocale(ctx context.Context, raw string) {
	if strings.TrimSpace(raw) == "" || s.tokens == nil {
		return
	}
	code, err := locale.Normalize(raw)
	if err != nil {
		return
	}
	tenant, ok := rpcmiddleware.TenantContextFromContext(ctx)
	if !ok {
		return
	}
	headers := rpcmiddleware.RequestHeader(ctx)
	if headers == nil {
		return
	}
	rawToken, ok := auth.BearerTokenFromHeader(headers)
	if !ok {
		return
	}
	claims, err := s.tokens.Verify(rawToken, auth.AudiencePublic)
	if err != nil || (claims.TenantID != "" && claims.TenantID != tenant.TenantID.String()) {
		return
	}
	if err := s.queriesFor(ctx).SetUserLastLocale(ctx, dbmodels.SetUserLastLocaleParams{
		LastLocale:         code,
		TenantID:           uuid.NullUUID{UUID: tenant.TenantID, Valid: true},
		PublicID:           claims.Subject,
		CredentialsVersion: claims.CredentialsVersion,
	}); err != nil {
		slog.WarnContext(ctx, "failed to record the reader's last locale",
			"tenant_id", tenant.TenantID.String(),
			"locale", code,
			"error", err,
		)
	}
}
