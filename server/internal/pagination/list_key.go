package pagination

import (
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrListMismatch is returned for a well-formed token that was issued for
// another list, such as the same RPC under different filters.
var ErrListMismatch = errors.New("pagination: token was issued for another list")

// ListKey names the list a token points into: the order name, then each filter
// that is on, since a boundary row sits elsewhere once the filters change. With
// no filter on it encodes the plain (time, id) token.
type ListKey struct {
	order   string
	filters []string
}

// NewListKey starts the key of a list sorted by the named order.
func NewListKey(order string) ListKey {
	return ListKey{order: order}
}

// Flag appends a filter that is either on or off.
func (k ListKey) Flag(name string, on bool) ListKey {
	if !on {
		return k
	}
	return k.with(name)
}

// Value appends a filter that narrows to one value, escaped so that it cannot
// spell another filter. An empty value means the filter is off.
func (k ListKey) Value(name, value string) ListKey {
	if value == "" {
		return k
	}
	return k.with(name + ":" + url.QueryEscape(value))
}

// Time appends a filter bounded by an instant, written in UTC so that one
// instant names one list whatever offset the request used.
func (k ListKey) Time(name string, at time.Time, on bool) ListKey {
	if !on {
		return k
	}
	return k.Value(name, at.UTC().Format(time.RFC3339Nano))
}

// Values appends a filter that narrows to a set of values, sorted so that one
// set names one list. An empty set means the filter is off.
func (k ListKey) Values(name string, values []string) ListKey {
	if len(values) == 0 {
		return k
	}
	escaped := make([]string, 0, len(values))
	for _, value := range values {
		escaped = append(escaped, url.QueryEscape(value))
	}
	slices.Sort(escaped)
	return k.with(name + ":" + strings.Join(slices.Compact(escaped), ","))
}

func (k ListKey) with(filter string) ListKey {
	return ListKey{order: k.order, filters: append(slices.Clip(k.filters), filter)}
}

// String is the first key of a token issued for a filtered list.
func (k ListKey) String() string {
	return strings.Join(append([]string{k.order}, k.filters...), "+")
}

func (k ListKey) filtered() bool {
	return len(k.filters) > 0
}

// Encode builds a token of this list from the boundary row's sort keys.
func (k ListKey) Encode(direction Direction, keys ...string) string {
	if !k.filtered() {
		return Encode(direction, keys...)
	}
	return Encode(direction, append([]string{k.String()}, keys...)...)
}

// Decode strips this list's key off a cursor, leaving the sort keys, and
// returns ErrListMismatch for a token issued under other filters.
func (k ListKey) Decode(cursor Cursor) (Cursor, error) {
	if len(cursor.Keys) > 0 {
		first := cursor.Keys[0]
		if k.filtered() && first == k.String() {
			return Cursor{Direction: cursor.Direction, Keys: cursor.Keys[1:]}, nil
		}
		if first == k.order || strings.HasPrefix(first, k.order+"+") {
			return Cursor{}, ErrListMismatch
		}
	}
	if k.filtered() {
		return Cursor{}, ErrListMismatch
	}
	return cursor, nil
}

// EncodeTimeUUID builds a token for a (time.Time, uuid.UUID) boundary of this list.
func (k ListKey) EncodeTimeUUID(direction Direction, at time.Time, id uuid.UUID) string {
	return k.Encode(direction, at.UTC().Format(time.RFC3339Nano), id.String())
}

// EncodeTimeUUIDRecovery builds a token of this list that includes its boundary
// row once.
func (k ListKey) EncodeTimeUUIDRecovery(direction Direction, at time.Time, id uuid.UUID) string {
	return k.Encode(direction, at.UTC().Format(time.RFC3339Nano), id.String(), inclusiveKey)
}

// DecodeTimeUUID parses a (time.Time, uuid.UUID) cursor issued for this list.
func (k ListKey) DecodeTimeUUID(cursor Cursor) (TimeUUIDKeys, error) {
	inner, err := k.Decode(cursor)
	if err != nil {
		return TimeUUIDKeys{}, err
	}
	return DecodeTimeUUID(inner)
}
