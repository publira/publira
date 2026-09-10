package adminapi

import (
	"context"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByPublicIDsForTenantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Aoi Sakura", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(listCreatorRolesByPublicIDsForTenantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Original Author", int32(1)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(lockEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EP001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(episodeID, "EP001"))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeCreatorsByEpisodeIDsQuery)).
		WillReturnRows(episodeCreditRows())
	mock.ExpectExec(regexp.QuoteMeta(deleteEpisodeCreatorsByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(createEpisodeCreatorQuery)).
		WithArgs(tenantID, episodeID, creatorID, roleID, int32(0), "episode").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeCreatorsByEpisodeIDsQuery)).
		WillReturnRows(episodeCreditRows(episodeCreditRow{
			episodeID:    episodeID,
			publicID:     "CREATOR001",
			name:         "Aoi Sakura",
			rolePublicID: "ROLE00000001",
			roleName:     "Original Author",
			source:       "episode",
		}))
	mock.ExpectCommit()
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EP001",
		CreatorCredits: []*publiraadminv1.EpisodeCreatorCredit{
			{CreatorPublicId: "CREATOR001", RolePublicId: "ROLE00000001"},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ReplaceEpisodeCredits(context.Background(), req)
	if err != nil {
		t.Fatalf("ReplaceEpisodeCredits: %v", err)
	}
	if len(resp.Msg.Creators) != 1 || resp.Msg.Creators[0].PublicId != "CREATOR001" {
		t.Fatalf("creators = %v, want the one credit the request named", resp.Msg.Creators)
	}
	assertExpectations(t, mock)
}

// episodeCreditRow is one row of the credit read, named the way the response
// shows it.
type episodeCreditRow struct {
	episodeID    uuid.UUID
	publicID     string
	name         string
	rolePublicID string
	roleName     string
	source       string
}

func episodeCreditRows(credits ...episodeCreditRow) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"episode_id", "public_id", "name", "profile_text", "icon_image_id", "icon_image_updated_at", "role_public_id", "role_name", "display_order", "source"})
	for index, credit := range credits {
		rows.AddRow(credit.episodeID, credit.publicID, credit.name, nil, nil, nil, credit.rolePublicID, credit.roleName, int32(index), credit.source)
	}
	return rows
}
