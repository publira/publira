package publicapi

import (
	"context"
	"log/slog"
	"strings"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

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

type requestedLocaleKey struct{}

// requestedLocaleInterceptor keeps the locale a request names on its context,
// so authenticateAccessToken can record it for the reader the request signs in
// as, whichever RPC it is.
func requestedLocaleInterceptor() connect.ServerInterceptor {
	return rpcmiddleware.NewUnaryRequestInterceptor(func(ctx context.Context, _ connect.Spec, req proto.Message, next func(context.Context) error) error {
		if localed, ok := req.(localeRequest); ok {
			ctx = context.WithValue(ctx, requestedLocaleKey{}, localed.GetLocale())
		}
		return next(ctx)
	})
}

// recordLastLocale keeps the locale a signed-in reader's request named as
// their last locale, the language the notifications written for them are in.
// A request naming no locale, or the one already recorded, writes nothing, and
// a locale that does not normalize is left for the handler to refuse.
//
// A failed write is logged rather than returned: the request reads or does
// something else, and the reader's next request in that locale tries again.
func (s *apiServer) recordLastLocale(ctx context.Context, user dbmodels.User) {
	raw, _ := ctx.Value(requestedLocaleKey{}).(string)
	if strings.TrimSpace(raw) == "" {
		return
	}
	code, err := locale.Normalize(raw)
	if err != nil {
		return
	}
	if user.LastLocale.Valid && user.LastLocale.String == code {
		return
	}
	if err := s.queriesFor(ctx).SetUserLastLocale(ctx, dbmodels.SetUserLastLocaleParams{
		ID:         user.ID,
		LastLocale: code,
	}); err != nil {
		slog.WarnContext(ctx, "failed to record the reader's last locale",
			"user_id", user.ID.String(),
			"locale", code,
			"error", err,
		)
	}
}
