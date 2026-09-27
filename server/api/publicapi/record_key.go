package publicapi

import (
	"database/sql"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// recordKey is how a reader request names one record: by its ID, or by the
// public ID a URL carries. Exactly one of the two is set.
type recordKey struct {
	id       uuid.NullUUID
	publicID sql.NullString
}

// requestRecordKey reads the pair of fields a request names a record by. The
// ID takes precedence; a malformed one is invalid_argument, and so is naming
// neither.
func requestRecordKey(field, rawID, rawPublicID string) (recordKey, error) {
	if id := strings.TrimSpace(rawID); id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil {
			return recordKey{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s is invalid", field))
		}
		return recordKey{id: uuid.NullUUID{UUID: parsed, Valid: true}}, nil
	}
	if publicID := strings.TrimSpace(rawPublicID); publicID != "" {
		return recordKey{publicID: sql.NullString{String: publicID, Valid: true}}, nil
	}
	return recordKey{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s is required", field))
}

// publicIDKey names a record by the public ID a URL carries.
func publicIDKey(publicID string) sql.NullString {
	return sql.NullString{String: strings.TrimSpace(publicID), Valid: true}
}

// String is the key for a log line.
func (k recordKey) String() string {
	if k.id.Valid {
		return k.id.UUID.String()
	}
	return k.publicID.String
}
