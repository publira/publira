package publicapi

import (
	"strings"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
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
