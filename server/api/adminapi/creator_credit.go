package adminapi

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// creatorCredit is one credit a save asked for, with both ends resolved: the
// person, and the role of this tenant they are credited in.
type creatorCredit struct {
	creator dbmodels.ListCreatorsByPublicIDsForTenantRow
	role    dbmodels.ListCreatorRolesByPublicIDsForTenantRow
}

// creatorCreditMessage is what a series credit and an episode credit have in
// common: the two public IDs a credit is made of. They are separate messages
// because the two lists are edited separately, and everything below this point
// treats them the same.
type creatorCreditMessage interface {
	GetCreatorPublicId() string
	GetRolePublicId() string
}

// creatorCreditPairs reduces a request's credit list to the (creator, role)
// pairs resolveCreatorCredits works on, keeping the order it was given in.
func creatorCreditPairs[Credit creatorCreditMessage](credits []Credit) [][2]string {
	pairs := make([][2]string, 0, len(credits))
	for _, credit := range credits {
		pairs = append(pairs, [2]string{credit.GetCreatorPublicId(), credit.GetRolePublicId()})
	}
	return pairs
}

// resolveCreatorCredits reads the credits a save asked for, keeping the order
// they were given in. A public_id naming nothing of this tenant is a bad
// request rather than a silently dropped credit, and so is the same person
// credited twice in the same role: the pair is the identity of a credit, which
// is why one person can still appear under two roles.
func (s *adminServer) resolveCreatorCredits(
	ctx context.Context,
	tenantID uuid.UUID,
	credits [][2]string,
) ([]creatorCredit, error) {
	creatorPublicIDs := make([]string, 0, len(credits))
	rolePublicIDs := make([]string, 0, len(credits))
	seenCreators := make(map[string]struct{}, len(credits))
	seenRoles := make(map[string]struct{}, len(credits))
	seenPairs := make(map[[2]string]struct{}, len(credits))
	normalized := make([][2]string, 0, len(credits))
	for _, credit := range credits {
		creatorPublicID := strings.TrimSpace(credit[0])
		if creatorPublicID == "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("creator_public_id is required"), "creator_credits")
		}
		rolePublicID := strings.TrimSpace(credit[1])
		if rolePublicID == "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("role_public_id is required"), "creator_credits")
		}
		pair := [2]string{creatorPublicID, rolePublicID}
		if _, ok := seenPairs[pair]; ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("creator_credits contains the same creator twice in one role"), "creator_credits")
		}
		seenPairs[pair] = struct{}{}
		normalized = append(normalized, pair)
		if _, ok := seenCreators[creatorPublicID]; !ok {
			seenCreators[creatorPublicID] = struct{}{}
			creatorPublicIDs = append(creatorPublicIDs, creatorPublicID)
		}
		if _, ok := seenRoles[rolePublicID]; !ok {
			seenRoles[rolePublicID] = struct{}{}
			rolePublicIDs = append(rolePublicIDs, rolePublicID)
		}
	}
	if len(normalized) == 0 {
		return []creatorCredit{}, nil
	}

	creatorRows, err := s.queriesFor(ctx).ListCreatorsByPublicIDsForTenant(ctx, dbmodels.ListCreatorsByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: creatorPublicIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creators by public ids", err, "tenant_id", tenantID.String())
	}
	// Checked before the roles are read so a request naming nobody real is
	// refused without a second query, the way it was before credits carried a
	// role.
	if len(creatorRows) != len(creatorPublicIDs) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
	}
	creatorsByPublicID := make(map[string]dbmodels.ListCreatorsByPublicIDsForTenantRow, len(creatorRows))
	for _, row := range creatorRows {
		creatorsByPublicID[row.PublicID] = row
	}

	roleRows, err := s.queriesFor(ctx).ListCreatorRolesByPublicIDsForTenant(ctx, dbmodels.ListCreatorRolesByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: rolePublicIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator roles by public ids", err, "tenant_id", tenantID.String())
	}
	if len(roleRows) != len(rolePublicIDs) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator role not found"))
	}
	rolesByPublicID := make(map[string]dbmodels.ListCreatorRolesByPublicIDsForTenantRow, len(roleRows))
	for _, row := range roleRows {
		rolesByPublicID[row.PublicID] = row
	}

	resolved := make([]creatorCredit, 0, len(normalized))
	for _, pair := range normalized {
		creator, ok := creatorsByPublicID[pair[0]]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
		}
		role, ok := rolesByPublicID[pair[1]]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator role not found"))
		}
		resolved = append(resolved, creatorCredit{creator: creator, role: role})
	}
	return resolved, nil
}
