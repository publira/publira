package adminapi

import (
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/rpcerrors"
)

// parseRecordID reads a primary key a request names. An unparseable value is
// refused here rather than reaching a query that would answer not_found for
// something that is not an identifier at all.
func parseRecordID(raw, field string) (uuid.UUID, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is required", field), field)
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is not an identifier", field), field)
	}
	return id, nil
}

// recordIDArg reads a primary key a request may leave empty, returning uuid.Nil
// for an empty field.
func recordIDArg(raw, field string) (uuid.UUID, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return uuid.Nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is not an identifier", field), field)
	}
	return id, nil
}

// recordIDsArg reads a list of internal IDs under the rules
// validateDistinctPublicIDs holds a list of public IDs to.
func recordIDsArg(raw []string, field, noun string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, connect.Errorf(connect.CodeInvalidArgument, "%s are required", field)
	}
	ids := make([]uuid.UUID, 0, len(raw))
	seen := make(map[uuid.UUID]struct{}, len(raw))
	for _, value := range raw {
		if strings.TrimSpace(value) == "" {
			return nil, connect.Errorf(connect.CodeInvalidArgument, "%s contains empty value", field)
		}
		id, err := recordIDArg(value, field)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[id]; ok {
			return nil, connect.Errorf(connect.CodeInvalidArgument, "%s contains duplicate %s", field, noun)
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

// reorderList is one of the two lists a reorder request states, with the
// field it came from.
type reorderList struct {
	values []string
	field  string
}

// reorderIDs reads the two primary key lists a reorder request states: the
// order to write and the order the client read. Each key is returned in
// canonical form, so the caller compares it with uuid.UUID.String of a locked
// row.
func reorderIDs(order, expected reorderList, noun string) ([]string, []string, error) {
	orderIDs, err := canonicalIDs(order)
	if err != nil {
		return nil, nil, err
	}
	expectedIDs, err := canonicalIDs(expected)
	if err != nil {
		return nil, nil, err
	}
	if err := validateDistinctPublicIDs(orderIDs, order.field, noun); err != nil {
		return nil, nil, err
	}
	if err := validateDistinctPublicIDs(expectedIDs, expected.field, noun); err != nil {
		return nil, nil, err
	}
	if !samePublicIDSet(orderIDs, expectedIDs) {
		return nil, nil, connect.Errorf(connect.CodeInvalidArgument, "%s must be a permutation of %s", order.field, expected.field)
	}
	return orderIDs, expectedIDs, nil
}

// canonicalIDs parses each entry of an ID list. An empty entry is kept as it
// is, for validateDistinctPublicIDs to report.
func canonicalIDs(list reorderList) ([]string, error) {
	canonical := make([]string, 0, len(list.values))
	for _, value := range list.values {
		if strings.TrimSpace(value) == "" {
			canonical = append(canonical, "")
			continue
		}
		id, err := parseRecordID(value, list.field)
		if err != nil {
			return nil, err
		}
		canonical = append(canonical, id.String())
	}
	return canonical, nil
}
