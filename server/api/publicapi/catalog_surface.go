package publicapi

import (
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// catalogSurface resolves the surface a catalog read names into the value the
// catalog queries filter by. Every catalog read resolves it before anything
// else, so a work the caller's surface may not show never reaches a response.
func catalogSurface(surface publirattypesv1.ClientSurface) (string, error) {
	stored, err := protomapper.ClientSurfaceToStored(surface)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("surface is not supported"))
	}
	return stored, nil
}

// anySurface is the surface argument of a query shared with the member reads
// that name no surface: it filters by none.
var anySurface = sql.NullString{}

// surfaceArg is the surface argument of a query shared with the member reads,
// set for a catalog read.
func surfaceArg(surface string) sql.NullString {
	return sql.NullString{String: surface, Valid: true}
}
