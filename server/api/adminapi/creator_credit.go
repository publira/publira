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
	GetCreatorPublicId() string
	GetRoleId() string
	GetRolePublicId() string
}

// creditPair is one credit as a request names it: the creator and the role,
// each by id, or by public_id while a client still sends that.
type creditPair struct {
	creatorID       string
	creatorPublicID string
	roleID          string
	rolePublicID    string
}

// creatorCreditPairs reduces a request's credit list to the pairs
// resolveCreatorCredits works on, keeping the order it was given in.
func creatorCreditPairs[Credit creatorCreditMessage](credits []Credit) []creditPair {
	pairs := make([]creditPair, 0, len(credits))
	for _, credit := range credits {
		pairs = append(pairs, creditPair{
			creatorID:       credit.GetCreatorId(),
			creatorPublicID: credit.GetCreatorPublicId(),
			roleID:          credit.GetRoleId(),
			rolePublicID:    credit.GetRolePublicId(),
		})
	}
	return pairs
}

// creditRef is one end of a credit once its identifier is parsed.
type creditRef struct {
	id       uuid.UUID
	publicID string
}

// parseCreditRef reads one end of a credit. An unparseable id is refused here
// rather than reaching a query that would answer "not found" for a value that
// is not an identifier at all.
func parseCreditRef(rawID, rawPublicID, name, field string) (creditRef, error) {
	if id := strings.TrimSpace(rawID); id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil {
			return creditRef{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s_id is not an identifier", name), field)
		}
		return creditRef{id: parsed}, nil
	}
	if publicID := strings.TrimSpace(rawPublicID); publicID != "" {
		return creditRef{publicID: publicID}, nil
	}
	return creditRef{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s_id is required", name), field)
}

// collectCreditRefs splits refs into the ids and public_ids one query reads
// them by, each once.
func collectCreditRefs(refs []creditRef) ([]uuid.UUID, []string) {
	ids := make([]uuid.UUID, 0, len(refs))
	publicIDs := make([]string, 0, len(refs))
	seen := make(map[creditRef]struct{}, len(refs))
	for _, ref := range refs {
		if _, ok := seen[ref]; ok {
			continue
		}
		seen[ref] = struct{}{}
		if ref.id != uuid.Nil {
			ids = append(ids, ref.id)
		} else {
			publicIDs = append(publicIDs, ref.publicID)
		}
	}
	return ids, publicIDs
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
	creatorRefs := make([]creditRef, 0, len(credits))
	roleRefs := make([]creditRef, 0, len(credits))
	for _, credit := range credits {
		creatorRef, err := parseCreditRef(credit.creatorID, credit.creatorPublicID, "creator", field)
		if err != nil {
			return nil, err
		}
		roleRef, err := parseCreditRef(credit.roleID, credit.rolePublicID, "role", field)
		if err != nil {
			return nil, err
		}
		creatorRefs = append(creatorRefs, creatorRef)
		roleRefs = append(roleRefs, roleRef)
	}
	if len(credits) == 0 {
		return []creatorCredit{}, nil
	}

	creatorIDs, creatorPublicIDs := collectCreditRefs(creatorRefs)
	creatorRows, err := s.queriesFor(ctx).ListCreatorsByIDsForTenant(ctx, dbmodels.ListCreatorsByIDsForTenantParams{
		TenantID:  tenantID,
		Ids:       creatorIDs,
		PublicIds: creatorPublicIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creators by ids", err, "tenant_id", tenantID.String())
	}
	creators := make(map[creditRef]dbmodels.ListCreatorsByIDsForTenantRow, 2*len(creatorRows))
	for _, row := range creatorRows {
		creators[creditRef{id: row.ID}] = row
		creators[creditRef{publicID: row.PublicID}] = row
	}
	// Checked before the roles are read so a request naming nobody real is
	// refused without a second query.
	for _, ref := range creatorRefs {
		if _, ok := creators[ref]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
		}
	}

	roleIDs, rolePublicIDs := collectCreditRefs(roleRefs)
	roleRows, err := s.queriesFor(ctx).ListCreatorRolesByIDsForTenant(ctx, dbmodels.ListCreatorRolesByIDsForTenantParams{
		TenantID:  tenantID,
		Ids:       roleIDs,
		PublicIds: rolePublicIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator roles by ids", err, "tenant_id", tenantID.String())
	}
	roles := make(map[creditRef]dbmodels.ListCreatorRolesByIDsForTenantRow, 2*len(roleRows))
	for _, row := range roleRows {
		roles[creditRef{id: row.ID}] = row
		roles[creditRef{publicID: row.PublicID}] = row
	}

	resolved := make([]creatorCredit, 0, len(credits))
	seenPairs := make(map[[2]uuid.UUID]struct{}, len(credits))
	for index := range credits {
		creator := creators[creatorRefs[index]]
		role, ok := roles[roleRefs[index]]
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
