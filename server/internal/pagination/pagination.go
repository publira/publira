// Package pagination implements the cursor token shared by list RPCs.
//
// A token carries the sort key values of the row a page starts or ends at, plus
// the direction the client is moving in, so the next query can resume with a
// WHERE comparison instead of an OFFSET. Clients treat the token as opaque: they
// hand back the `previous_token` / `next_token` they were given and never build one.
//
// The token is base64url without padding, over `v1|<direction>|<key>|<key>...`.
// Keys are query-escaped, so a key containing the separator stays intact.
//
// The field names, defaults, and sort key rules that go with this are in
// proto/README.md.
package pagination

import (
	"encoding/base64"
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Direction is which way the token moves through the sorted result.
type Direction string

const (
	// Forward points at the page after the one the token was built from.
	Forward Direction = "f"
	// Backward points at the page before it.
	Backward Direction = "b"

	tokenVersion = "v1"
	separator    = "|"
	inclusiveKey = "inclusive"
)

// ErrInvalidToken is returned for a token that was not produced by Encode.
// Handlers map it to connect.CodeInvalidArgument without echoing the token back.
var ErrInvalidToken = errors.New("pagination: invalid token")

// Cursor is a decoded token. The zero value means "first page".
type Cursor struct {
	Direction Direction
	Keys      []string
}

// TimeUUIDKeys is a decoded (time.Time, uuid.UUID) keyset boundary. Its zero
// value means that no boundary was supplied.
type TimeUUIDKeys struct {
	Time      time.Time
	ID        uuid.UUID
	Inclusive bool
	Valid     bool
}

// IsZero reports whether the request carried no token.
func (c Cursor) IsZero() bool {
	return c.Direction == ""
}

// Encode builds the token for a boundary row. Pass the sort key values in the
// same order the query sorts by: the last row of the page for Forward, the first
// row for Backward.
func Encode(direction Direction, keys ...string) string {
	parts := make([]string, 0, len(keys)+2)
	parts = append(parts, tokenVersion, string(direction))
	for _, key := range keys {
		parts = append(parts, url.QueryEscape(key))
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Join(parts, separator)))
}

// EncodeTimeUUID builds a token for a (time.Time, uuid.UUID) keyset boundary.
func EncodeTimeUUID(direction Direction, at time.Time, id uuid.UUID) string {
	return Encode(direction, at.UTC().Format(time.RFC3339Nano), id.String())
}

// EncodeTimeUUIDRecovery builds a token that includes its boundary row once.
func EncodeTimeUUIDRecovery(direction Direction, at time.Time, id uuid.UUID) string {
	return Encode(direction, at.UTC().Format(time.RFC3339Nano), id.String(), inclusiveKey)
}

// Decode parses a token. An empty token is the first page, not an error.
func Decode(raw string) (Cursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Cursor{}, nil
	}

	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return Cursor{}, ErrInvalidToken
	}

	parts := strings.Split(string(decoded), separator)
	if len(parts) < 3 || parts[0] != tokenVersion {
		return Cursor{}, ErrInvalidToken
	}

	direction := Direction(parts[1])
	if direction != Forward && direction != Backward {
		return Cursor{}, ErrInvalidToken
	}

	keys := make([]string, 0, len(parts)-2)
	for _, part := range parts[2:] {
		key, unescapeErr := url.QueryUnescape(part)
		if unescapeErr != nil {
			return Cursor{}, ErrInvalidToken
		}
		keys = append(keys, key)
	}

	return Cursor{Direction: direction, Keys: keys}, nil
}

// DecodeTimeUUID parses the keys of a (time.Time, uuid.UUID) cursor. Both
// regular boundary tokens and inclusive recovery tokens are accepted.
func DecodeTimeUUID(cursor Cursor) (TimeUUIDKeys, error) {
	if len(cursor.Keys) != 2 && len(cursor.Keys) != 3 {
		return TimeUUIDKeys{}, ErrInvalidToken
	}

	inclusive := len(cursor.Keys) == 3
	if inclusive && cursor.Keys[2] != inclusiveKey {
		return TimeUUIDKeys{}, ErrInvalidToken
	}

	at, err := time.Parse(time.RFC3339Nano, cursor.Keys[0])
	if err != nil {
		return TimeUUIDKeys{}, ErrInvalidToken
	}
	id, err := uuid.Parse(cursor.Keys[1])
	if err != nil {
		return TimeUUIDKeys{}, ErrInvalidToken
	}

	return TimeUUIDKeys{
		Time:      at.UTC(),
		ID:        id,
		Inclusive: inclusive,
		Valid:     true,
	}, nil
}

// NormalizeLimit clamps a requested page size. Anything out of range falls back
// to the default rather than erroring, so a client cannot ask for a whole table.
func NormalizeLimit(requested, fallback, maximum int32) int32 {
	if requested <= 0 || requested > maximum {
		return fallback
	}
	return requested
}

// Page trims a slice that was over-fetched by one row and reports whether that
// extra row was there. Backward pages come back from the database in reverse, so
// they are flipped into display order here.
//
// Query with limit+1 rows; the extra row is what tells the caller another page
// exists without a second count query.
func Page[T any](rows []T, limit int32, direction Direction) ([]T, bool) {
	hasMore := int32(len(rows)) > limit
	if hasMore {
		rows = rows[:limit]
	}
	if direction == Backward {
		slices.Reverse(rows)
	}
	return rows, hasMore
}

// Neighbors reports which sides of the returned page have more rows.
//
// Only the direction being scanned can be measured by over-fetching; the side
// the client came from is known to exist because they came from it.
func Neighbors(cursor Cursor, hasMore bool) (hasPrevious, hasNext bool) {
	switch cursor.Direction {
	case Backward:
		return hasMore, true
	case Forward:
		return true, hasMore
	default:
		return false, hasMore
	}
}
