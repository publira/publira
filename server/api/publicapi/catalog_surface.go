package publicapi

import (
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// callingSurface resolves the surface a read or write names into the value the
// queries filter by. Every catalog read, and every member read or write that
// acts on a work, resolves it before anything else, so a work the caller's
// surface may not show never reaches a response.
func callingSurface(surface publirattypesv1.ClientSurface) (string, error) {
	stored, err := protomapper.ClientSurfaceToStored(surface)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("surface is not supported"))
	}
	return stored, nil
}

// surfaceTokenKey is the leading key of every token of a list read that names a
// surface. The surface decides which rows a list holds, as a filter does, so a
// token names the surface it was built on and a read from another surface
// refuses it rather than applying its boundary to a different list. A web URL opened in the app
// through a deep link is where one would otherwise cross over.
func surfaceTokenKey(surface string) string {
	return "surface:" + surface
}

// decodeSurfaceToken decodes a token and strips the surface it was built on,
// answering pagination.ErrInvalidToken when that is not the surface of the
// read.
func decodeSurfaceToken(raw, surface string) (pagination.Cursor, error) {
	cursor, err := pagination.Decode(raw)
	if err != nil || cursor.IsZero() {
		return cursor, err
	}
	if len(cursor.Keys) == 0 || cursor.Keys[0] != surfaceTokenKey(surface) {
		return pagination.Cursor{}, pagination.ErrInvalidToken
	}
	cursor.Keys = cursor.Keys[1:]
	return cursor, nil
}

// bindSurfaceTokens puts the surface of the read in front of each token a
// response hands back. An empty token stays empty.
func bindSurfaceTokens(surface string, tokens ...*string) {
	for _, token := range tokens {
		if *token == "" {
			continue
		}
		cursor, err := pagination.Decode(*token)
		if err != nil {
			continue
		}
		*token = pagination.Encode(cursor.Direction, append([]string{surfaceTokenKey(surface)}, cursor.Keys...)...)
	}
}
