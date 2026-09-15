package adminapi

import (
	"fmt"
	"strings"

	"connectrpc.com/connect"
)

// validateDistinctPublicIDs rejects a list that cannot name a set of rows: an
// empty list, an empty entry, or an entry that repeats. A reorder and a range
// edit both fail on exactly those, because both read the list as "these rows,
// each once". noun names what is being listed, for the message the console
// shows.
func validateDistinctPublicIDs(ids []string, field, noun string) error {
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
