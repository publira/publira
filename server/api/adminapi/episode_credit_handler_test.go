package adminapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The whole point of the transaction is the order of the statements in it: the
// episode row is locked before the credits it carries are read, so a second
// editor saving the same episode waits rather than reading provenance the
// first one is about to replace. sqlmock is ordered, so the expectations below
// are that guarantee — a lock taken after the read, or not at all, fails here.
func TestReplaceEpisodeCreditsLocksTheEpisodeBeforeReadingItsCredits(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	roleID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorsByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Aoi Sakura", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorRolesByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Original Author", int32(1)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockEpisodeByIDForTenant)).
		WithArgs(tenantID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(episodeID, "EP001"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCreatorsByEpisodeIDs)).
		WillReturnRows(episodeCreditRows())
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteEpisodeCreatorsByEpisodeID)).
		WithArgs(episodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.CreateEpisodeCreator)).
		WithArgs(tenantID, episodeID, creatorID, roleID, int32(0), "episode", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCreatorsByEpisodeIDs)).
		WillReturnRows(episodeCreditRows(episodeCreditRow{
			episodeID:    episodeID,
			creatorID:    creatorID,
			roleID:       roleID,
			publicID:     "CREATOR001",
			name:         "Aoi Sakura",
			rolePublicID: "ROLE00000001",
			roleName:     "Original Author",
			source:       "episode",
		}))
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: episodeID.String(),
		CreatorCredits: []*publiraadminv1.EpisodeCreatorCredit{
			{CreatorId: creatorID.String(), RoleId: roleID.String()},
		},
	}

	resp, err := client.ReplaceEpisodeCredits(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ReplaceEpisodeCredits: %v", err)
	}
	if len(resp.Creators) != 1 || resp.Creators[0].PublicId != "CREATOR001" {
		t.Fatalf("creators = %v, want the one credit the request named", resp.Creators)
	}
	assertExpectations(t, mock)
}

// The credits and the drop they leave owed commit together. A record the
// database refuses therefore takes the write with it rather than leaving an
// episode whose cached credits nothing will invalidate.
func TestReplaceEpisodeCreditsRollsBackWhenTheCacheInvalidationCannotBeRecorded(t *testing.T) {
	newRevalidateRecorder(t)
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	roleID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorsByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Aoi Sakura", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorRolesByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Original Author", int32(1)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockEpisodeByIDForTenant)).
		WithArgs(tenantID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(episodeID, "EP001"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCreatorsByEpisodeIDs)).
		WillReturnRows(episodeCreditRows())
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteEpisodeCreatorsByEpisodeID)).
		WithArgs(episodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.CreateEpisodeCreator)).
		WithArgs(tenantID, episodeID, creatorID, roleID, int32(0), "episode", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCreatorsByEpisodeIDs)).
		WillReturnRows(episodeCreditRows(episodeCreditRow{
			episodeID:    episodeID,
			creatorID:    creatorID,
			roleID:       roleID,
			publicID:     "CREATOR001",
			name:         "Aoi Sakura",
			rolePublicID: "ROLE00000001",
			roleName:     "Original Author",
			source:       "episode",
		}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WillReturnError(errors.New("outbox is unavailable"))
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: episodeID.String(),
		CreatorCredits: []*publiraadminv1.EpisodeCreatorCredit{
			{CreatorId: creatorID.String(), RoleId: roleID.String()},
		},
	}

	if _, err := client.ReplaceEpisodeCredits(testutil.WithBearer(context.Background(), sessionToken), req); err == nil {
		t.Fatal("ReplaceEpisodeCredits() error = nil, want the unrecordable invalidation reported")
	} else if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ReplaceEpisodeCredits() code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	assertExpectations(t, mock)
}

func TestReplaceEpisodeCreditsRefusesCreditSharesAboveOneWholeEpisode(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		CreatorCredits: []*publiraadminv1.EpisodeCreatorCredit{
			{CreatorId: episodeTestID(11).String(), RoleId: episodeTestID(21).String(), ShareBps: 6000},
			{CreatorId: episodeTestID(12).String(), RoleId: episodeTestID(21).String(), ShareBps: 5000},
		},
	}

	_, err := client.ReplaceEpisodeCredits(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ReplaceEpisodeCredits code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertExpectations(t, mock)
}

// episodeCreditRow is one row of the credit read, named the way the response
// shows it.
type episodeCreditRow struct {
	episodeID    uuid.UUID
	creatorID    uuid.UUID
	roleID       uuid.UUID
	publicID     string
	name         string
	rolePublicID string
	roleName     string
	source       string
	shareBps     int32
}

func episodeCreditRows(credits ...episodeCreditRow) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"episode_id", "creator_id", "public_id", "name", "profile_text", "icon_image_id", "icon_image_updated_at", "role_id", "role_public_id", "role_name", "display_order", "source", "share_bps"})
	for index, credit := range credits {
		rows.AddRow(credit.episodeID, credit.creatorID, credit.publicID, credit.name, nil, nil, nil, uuid.NullUUID{UUID: credit.roleID, Valid: credit.roleID != uuid.Nil}, credit.rolePublicID, credit.roleName, int32(index), credit.source, credit.shareBps)
	}
	return rows
}
