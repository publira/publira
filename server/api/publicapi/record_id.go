package publicapi

import (
	"database/sql"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
)

// requestRecordID reads the internal ID a request names a record by. A
// missing or malformed one is invalid_argument.
func requestRecordID(field, raw string) (uuid.UUID, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return uuid.Nil, connect.Errorf(connect.CodeInvalidArgument, "%s is required", field)
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, connect.Errorf(connect.CodeInvalidArgument, "%s is invalid", field)
	}
	return parsed, nil
}

// recordIDKey names a record by its ID to a read that a URL also resolves by
// public ID.
func recordIDKey(id uuid.UUID) uuid.NullUUID {
	return uuid.NullUUID{UUID: id, Valid: true}
}

// publicIDKey names a record by the public ID a URL carries.
func publicIDKey(publicID string) sql.NullString {
	return sql.NullString{String: strings.TrimSpace(publicID), Valid: true}
}
