package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// creatorCredit is one credit a save asked for, with both ends resolved: the
// person, and the role of this tenant they are credited in.
type creatorCredit struct {
	creator  dbmodels.ListCreatorsByIDsForTenantRow
	role     dbmodels.ListCreatorRolesByIDsForTenantRow
	shareBps int32
}

// creatorCreditMessage is what a series credit and an episode credit have in
// common: the identifiers a credit is made of. They are separate messages
// because the two lists are edited separately, and everything below this point
// treats them the same.
type creatorCreditMessage interface {
	GetCreatorId() string
	GetRoleId() string
}

// creditPair is one credit as a request names it: the creator and the role.
type creditPair struct {
	creatorID string
	roleID    string
}

// creatorCreditPairs reduces a request's credit list to the pairs
// resolveCreatorCredits works on, keeping the order it was given in.
func creatorCreditPairs[Credit creatorCreditMessage](credits []Credit) []creditPair {
	pairs := make([]creditPair, 0, len(credits))
	for _, credit := range credits {
		pairs = append(pairs, creditPair{creatorID: credit.GetCreatorId(), roleID: credit.GetRoleId()})
	}
	return pairs
}

// parseCreditID reads one end of a credit. An unparseable id is refused here
// rather than reaching a query that would answer "not found" for a value that
// is not an identifier at all.
func parseCreditID(raw, name, field string) (uuid.UUID, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s_id is required", name), field)
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s_id is not an identifier", name), field)
	}
	return id, nil
}

// distinctIDs lists ids once each, for the query that reads them.
func distinctIDs(ids []uuid.UUID) []uuid.UUID {
	distinct := make([]uuid.UUID, 0, len(ids))
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		distinct = append(distinct, id)
	}
	return distinct
}

func validateCreditShares(shares []int32, field string) error {
	var total int64
	for _, share := range shares {
		if share < 0 || share > 10000 {
			return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("share_bps must be between 0 and 10000"), field)
		}
		total += int64(share)
	}
	if total > 10000 {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the total share_bps must not exceed 10000"), field)
	}
	return nil
}

func setCreatorCreditShares(credits []creatorCredit, shares []int32) {
	for index := range credits {
		credits[index].shareBps = shares[index]
	}
}

// resolveCreatorCredits reads the credits a save asked for, keeping the order
// they were given in. An identifier naming nothing of this tenant is a bad
// request rather than a silently dropped credit, and so is the same person
// credited twice in the same role: the pair is the identity of a credit, which
// is why one person can still appear under two roles.
//
// field is the request field the credits came out of, so the violation points
// at the control the console has to correct: a whole credit list on the series
// and episode forms, one operation on a range edit.
func (s *adminServer) resolveCreatorCredits(
	ctx context.Context,
	tenantID uuid.UUID,
	credits []creditPair,
	field string,
) ([]creatorCredit, error) {
	creatorIDs := make([]uuid.UUID, 0, len(credits))
	roleIDs := make([]uuid.UUID, 0, len(credits))
	for _, credit := range credits {
		creatorID, err := parseCreditID(credit.creatorID, "creator", field)
		if err != nil {
			return nil, err
		}
		roleID, err := parseCreditID(credit.roleID, "role", field)
		if err != nil {
			return nil, err
		}
		creatorIDs = append(creatorIDs, creatorID)
		roleIDs = append(roleIDs, roleID)
	}
	if len(credits) == 0 {
		return []creatorCredit{}, nil
	}

	creatorRows, err := s.queriesFor(ctx).ListCreatorsByIDsForTenant(ctx, dbmodels.ListCreatorsByIDsForTenantParams{
		TenantID: tenantID,
		Ids:      distinctIDs(creatorIDs),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creators by ids", err, "tenant_id", tenantID.String())
	}
	creators := make(map[uuid.UUID]dbmodels.ListCreatorsByIDsForTenantRow, len(creatorRows))
	for _, row := range creatorRows {
		creators[row.ID] = row
	}
	// Checked before the roles are read so a request naming nobody real is
	// refused without a second query.
	for _, id := range creatorIDs {
		if _, ok := creators[id]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
		}
	}

	roleRows, err := s.queriesFor(ctx).ListCreatorRolesByIDsForTenant(ctx, dbmodels.ListCreatorRolesByIDsForTenantParams{
		TenantID: tenantID,
		Ids:      distinctIDs(roleIDs),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator roles by ids", err, "tenant_id", tenantID.String())
	}
	roles := make(map[uuid.UUID]dbmodels.ListCreatorRolesByIDsForTenantRow, len(roleRows))
	for _, row := range roleRows {
		roles[row.ID] = row
	}

	resolved := make([]creatorCredit, 0, len(credits))
	seenPairs := make(map[[2]uuid.UUID]struct{}, len(credits))
	for index := range credits {
		creator := creators[creatorIDs[index]]
		role, ok := roles[roleIDs[index]]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator role not found"))
		}
		pair := [2]uuid.UUID{creator.ID, role.ID}
		if _, ok := seenPairs[pair]; ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s names the same creator twice in one role", field), field)
		}
		seenPairs[pair] = struct{}{}
		resolved = append(resolved, creatorCredit{creator: creator, role: role})
	}
	return resolved, nil
}
