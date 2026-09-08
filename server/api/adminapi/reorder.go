package adminapi

import (
	"fmt"
	"strings"

	"connectrpc.com/connect"
)

// A reorder request states the whole order twice: the order the client wants,
// and the order it read before composing it. Both lists are permutations of
// the same set, so each is checked the same way and then compared.

// validateReorderPublicIDs rejects a list that cannot be an order: an empty
// list, an empty entry, or an entry that repeats. noun names what is being
// ordered, for the message the console shows.
func validateReorderPublicIDs(ids []string, field, noun string) error {
	if len(ids) == 0 {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s are required", field))
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains empty value", field))
		}
		if _, ok := seen[id]; ok {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains duplicate %s", field, noun))
		}
		seen[id] = struct{}{}
	}
	return nil
}

// samePublicIDSet reports whether two lists hold the same public IDs, in any
// order. Both have already been checked for duplicates, so equal lengths and
// one-way containment settle it.
func samePublicIDSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	want := make(map[string]struct{}, len(left))
	for _, id := range left {
		want[id] = struct{}{}
	}
	for _, id := range right {
		if _, ok := want[id]; !ok {
			return false
		}
	}
	return true
}
