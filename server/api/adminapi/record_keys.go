package adminapi

import (
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/rpcerrors"
)

// recordRef is how a request names the one record it acts on: by primary key
// when its ID field is set, and by public_id otherwise.
type recordRef struct {
	id       uuid.UUID
	publicID string
}

// recordRefArg reads a request's ID field and its public_id into a recordRef.
// field names the ID field, which is what the console is told to fill in.
func recordRefArg(rawID, rawPublicID, field string) (recordRef, error) {
	if strings.TrimSpace(rawID) != "" {
		id, err := parseRecordID(rawID, field)
		if err != nil {
			return recordRef{}, err
		}
		return recordRef{id: id}, nil
	}
	publicID := strings.TrimSpace(rawPublicID)
	if publicID == "" {
		return recordRef{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is required", field), field)
	}
	return recordRef{publicID: publicID}, nil
}

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

// reorderList is one of the two lists a reorder request states, with the
// field it came from.
type reorderList struct {
	values []string
	field  string
}

// reorderKeys picks the pair of lists a reorder request names its rows by: the
// primary keys when either ID list is set, and the public IDs otherwise. Each
// primary key is returned in canonical form, so the caller compares it with
// uuid.UUID.String of a locked row; byID says which key of the row to use.
func reorderKeys(ids, expectedIDs, publicIDs, expectedPublicIDs reorderList, noun string) (order, expected []string, byID bool, err error) {
	orderList, expectedList := publicIDs, expectedPublicIDs
	if len(ids.values) > 0 || len(expectedIDs.values) > 0 {
		orderList, expectedList, byID = ids, expectedIDs, true
		if orderList.values, err = canonicalIDs(ids); err != nil {
			return nil, nil, false, err
		}
		if expectedList.values, err = canonicalIDs(expectedIDs); err != nil {
			return nil, nil, false, err
		}
	}
	if err := validateDistinctPublicIDs(orderList.values, orderList.field, noun); err != nil {
		return nil, nil, false, err
	}
	if err := validateDistinctPublicIDs(expectedList.values, expectedList.field, noun); err != nil {
		return nil, nil, false, err
	}
	if !samePublicIDSet(orderList.values, expectedList.values) {
		return nil, nil, false, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s must be a permutation of %s", orderList.field, expectedList.field))
	}
	return orderList.values, expectedList.values, byID, nil
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
