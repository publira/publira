package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/commentmode"
)

// How comments are published is decided in two places: the tenant states one
// mode for its whole site, and a series may state its own instead. Every read
// that has to know — the storefront deciding whether to show a comment section,
// and the RPC deciding what to do with a comment it is handed — resolves the
// two here, so neither can answer the reader something the other would refuse.

// tenantCommentMode reads the tenant's publishing policy for comments. A tenant
// with no config row has saved no policy, which is the same answer as the
// column's own default: commenting is off until someone turns it on.
func (s *apiServer) tenantCommentMode(ctx context.Context, tenantID uuid.UUID) (string, error) {
	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return commentmode.Disabled, nil
	}
	if err != nil {
		return "", s.internalDBError(ctx, "failed to get tenant comment mode", err, "tenant_id", tenantID.String())
	}
	return config.CommentMode, nil
}

// effectiveCommentMode answers how one series publishes comments: the mode it
// states itself, and the tenant's when it states none.
//
// The series wins outright rather than being narrowed against the tenant. A
// tenant that turned commenting off site-wide and then opened one series has
// said something about that series, and reading the two as the stricter of the
// pair would refuse the very thing it was asked for.
//
// The tenant setting is read only for a series that states nothing, the way
// requiredMinimumAgeForSeries reads it only for a series that carries a rating:
// an override answers out of a row the caller already had.
func (s *apiServer) effectiveCommentMode(ctx context.Context, tenantID uuid.UUID, seriesOverride sql.NullString) (string, error) {
	if seriesOverride.Valid {
		return seriesOverride.String, nil
	}
	return s.tenantCommentMode(ctx, tenantID)
}
