package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

// defaultViewerPreferences is what a reader who has saved nothing reads back.
//
// The same values are what the insert branch of UpsertUserViewerPreferences
// writes for a preference the request omitted, and what the columns default to.
// TestDBViewerPreferenceDefaultsAgreeAcrossPaths is what fails when the three
// stop agreeing.
func defaultViewerPreferences() *publirav1.ViewerPreferences {
	return &publirav1.ViewerPreferences{WideViewerEnabled: false}
}

func viewerPreferencesFromRow(row dbmodels.UserViewerPreference) *publirav1.ViewerPreferences {
	return &publirav1.ViewerPreferences{WideViewerEnabled: row.WideViewerEnabled}
}

// scopeViewerPreferencesUser applies the member half of the
// user_viewer_preferences policy to the request connection, so a reader reads
// and rewrites their own row and reaches nobody else's. Direct handler tests use
// sqlmock and borrow no request connection.
func (s *apiServer) scopeViewerPreferencesUser(ctx context.Context, userID uuid.UUID) error {
	conn, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		return nil
	}
	if err := tenantconn.SetUser(ctx, conn, userID); err != nil {
		return s.internalDBError(ctx, "failed to set viewer preferences member context", err, "user_id", userID.String())
	}
	return nil
}

// GetViewerPreferences answers how the authenticated reader wants the viewer
// laid out. A reader who has saved nothing gets the defaults rather than an
// error or an empty message: the viewer renders either way, and "nothing saved"
// is not a layout it can show.
func (s *apiServer) GetViewerPreferences(
	ctx context.Context,
	req *connect.Request[publirav1.GetViewerPreferencesRequest],
) (*connect.Response[publirav1.GetViewerPreferencesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeViewerPreferencesUser(ctx, user.ID); err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).GetUserViewerPreferences(ctx, dbmodels.GetUserViewerPreferencesParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return noStorePrivateResponse(&publirav1.GetViewerPreferencesResponse{Preferences: defaultViewerPreferences()}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get viewer preferences", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStorePrivateResponse(&publirav1.GetViewerPreferencesResponse{Preferences: viewerPreferencesFromRow(row)}), nil
}

// UpdateViewerPreferences stores the preferences the request carries and leaves
// the ones it omits as they are, so a viewer writing the single control the
// reader just pressed cannot reset the settings it knows nothing about.
func (s *apiServer) UpdateViewerPreferences(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateViewerPreferencesRequest],
) (*connect.Response[publirav1.UpdateViewerPreferencesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionUpdateViewerPreferences, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	if err := s.scopeViewerPreferencesUser(ctx, user.ID); err != nil {
		return nil, err
	}

	updated, err := s.queriesFor(ctx).UpsertUserViewerPreferences(ctx, dbmodels.UpsertUserViewerPreferencesParams{
		TenantID:          tenant.ID,
		UserID:            user.ID,
		WideViewerEnabled: sql.NullBool{Bool: req.Msg.GetWideViewerEnabled(), Valid: req.Msg.WideViewerEnabled != nil},
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update viewer preferences", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return noStorePrivateResponse(&publirav1.UpdateViewerPreferencesResponse{Preferences: viewerPreferencesFromRow(updated)}), nil
}
