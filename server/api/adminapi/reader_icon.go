package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/usericon"
)

// appendIconImageID adds the icon an account elects to the ids one read of
// icons covers, once however many rows of a page name the same account, and
// not at all for an account that shows none.
func appendIconImageID(imageIDs []uuid.UUID, imageID uuid.NullUUID) []uuid.UUID {
	if !imageID.Valid || slices.Contains(imageIDs, imageID.UUID) {
		return imageIDs
	}
	return append(imageIDs, imageID.UUID)
}

// userIcons reads the icons the given images are, keyed by image id. They are
// read in one query rather than joined into the rows that name the accounts:
// an icon has a row per stored variant, and a page has a row per account or
// comment. An id with no stored variant is absent, and so answers the zero
// icon.
func userIcons(ctx context.Context, q Querier, tenantID uuid.UUID, imageIDs []uuid.UUID) (map[uuid.UUID]protomapper.UserIcon, error) {
	if len(imageIDs) == 0 {
		return nil, nil
	}
	rows, err := q.ListUserIconImageVariantsByImageIDs(ctx, dbmodels.ListUserIconImageVariantsByImageIDsParams{
		TenantID: tenantID,
		ImageIds: imageIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("list user icon variants: %w", err)
	}
	return protomapper.UserIconsByImageID(rows), nil
}

// adminReaderWithIcon projects one account with the icon it shows, read
// through q so a reader action inside a transaction answers from what it has
// just written.
func adminReaderWithIcon(ctx context.Context, q Querier, tenantID uuid.UUID, row readerRow) (*publiraadminv1.AdminReader, error) {
	icons, err := userIcons(ctx, q, tenantID, appendIconImageID(nil, row.IconImageID))
	if err != nil {
		return nil, err
	}
	return adminReader(row, icons), nil
}

// recordReaderCommentListsRevalidation owes a drop of the storefront's comment
// list of every episode the account has a published comment on. Each list
// carries the URL of the author's icon, and that URL stops answering once the
// icon is removed, so a list left cached would show a broken image rather than
// only an old one.
func (s *adminServer) recordReaderCommentListsRevalidation(ctx context.Context, q *dbmodels.Queries, tenantID, userID uuid.UUID) (revalidate.Owed, error) {
	episodePublicIDs, err := q.ListEpisodePublicIDsWithPublishedCommentsByUser(ctx, dbmodels.ListEpisodePublicIDsWithPublishedCommentsByUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		return revalidate.Owed{}, fmt.Errorf("list the episodes the reader commented on: %w", err)
	}
	tags := make([]string, 0, len(episodePublicIDs))
	for _, episodePublicID := range episodePublicIDs {
		tags = append(tags, commentListRevalidateTag(tenantID, episodePublicID))
	}
	return s.reval.Record(ctx, q, tenantID, tags)
}

// RemoveReaderIcon leaves an account of the tenant with no icon, for one that
// breaks the tenant's rules. It clears the election the way the reader's own
// DeleteMyIcon does, so image-server stops serving the image at once and the
// orphan sweep reclaims its objects; the account is otherwise untouched and
// may set another icon afterwards.
func (s *adminServer) RemoveReaderIcon(
	ctx context.Context,
	req *publiraadminv1.RemoveReaderIconRequest,
) (*publiraadminv1.RemoveReaderIconResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	readerID, err := readerIDArg(req.ReaderId)
	if err != nil {
		return nil, err
	}

	var reader *publiraadminv1.AdminReader
	var owed revalidate.Owed
	err = s.changeReader(ctx, sessionCtx, "reader_icon_removed", readerID, func(_ *sql.Tx, queries *dbmodels.Queries) (string, error) {
		row, err := queries.GetTenantReaderByID(ctx, dbmodels.GetTenantReaderByIDParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			ID:       readerID,
		})
		if err != nil {
			return "", err
		}
		if !row.IconImageID.Valid {
			return "", sql.ErrNoRows
		}
		if err := usericon.Clear(ctx, queries, tenant.ID, readerID); err != nil {
			if errors.Is(err, usericon.ErrAccountNotFound) {
				return "", sql.ErrNoRows
			}
			return "", err
		}
		if owed, err = s.recordReaderCommentListsRevalidation(ctx, queries, tenant.ID, readerID); err != nil {
			return "", err
		}
		row.IconImageID = uuid.NullUUID{}
		reader = adminReader(readerRow(row), nil)
		return row.PublicID, nil
	})
	if errors.Is(err, errReaderUnchanged) {
		// Either no such reader or one who shows no icon; the read tells which.
		row, err := s.tenantReaderByID(ctx, tenant.ID, readerID)
		if err != nil {
			return nil, err
		}
		unchanged, err := adminReaderWithIcon(ctx, s.queriesFor(ctx), tenant.ID, row)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to read the reader icon", err, "tenant_id", tenant.ID.String(), "reader_id", readerID.String())
		}
		return &publiraadminv1.RemoveReaderIconResponse{Reader: unchanged}, nil
	}
	if err != nil {
		return nil, err
	}
	s.reval.Send(ctx, owed)

	return &publiraadminv1.RemoveReaderIconResponse{Reader: reader}, nil
}
