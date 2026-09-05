package platformapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// The list is defined by the absence of a tenant role, so a tenant member must
// never appear even though the row lives in the same table.
func TestDBListEndUsersExcludesTenantMembers(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	reader := seedEndUser(t, pg, tenantID, "ENDUSER00001", "reader@example.com", "Reader One")
	member := seedEndUser(t, pg, tenantID, "MEMBER000001", "member@example.com", "Tenant Member")
	seedTenantMember(t, pg, tenantID, member.ID, "tenant_editor")

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	listResp, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	publicIDs := endUserPublicIDs(listResp.Msg.Users)
	if !slices.Equal(publicIDs, []string{reader.PublicID}) {
		t.Fatalf("listed public IDs = %v, want only the end user %q", publicIDs, reader.PublicID)
	}
	if got := listResp.Msg.Users[0].TenantIds; !slices.Equal(got, []string{"TENANT000001"}) {
		t.Fatalf("tenant_ids = %v, want the tenant the user belongs to", got)
	}
	if got := listResp.Msg.Users[0].TenantName; got != "Readers" {
		t.Fatalf("tenant_name = %q, want Readers", got)
	}
}

func TestDBListEndUsersFiltersByTenantPublicID(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	readersID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	writersID := seedTenant(t, pg, "TENANT000002", "writers.example.com", "Writers")
	reader := seedEndUser(t, pg, readersID, "ENDUSER00001", "reader@example.com", "Reader One")
	_ = seedEndUser(t, pg, writersID, "ENDUSER00002", "writer@example.com", "Writer One")

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	listResp, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{
		TenantPublicId: "TENANT000001",
	}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if got := endUserPublicIDs(listResp.Msg.Users); !slices.Equal(got, []string{reader.PublicID}) {
		t.Fatalf("tenant filter public IDs = %v, want only %q", got, reader.PublicID)
	}
	if got := listResp.Msg.Users[0].TenantName; got != "Readers" {
		t.Fatalf("tenant_name = %q, want Readers", got)
	}
}

func TestDBListEndUsersPagesAreStableWhenCreatedAtTies(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	older := seedEndUser(t, pg, tenantID, "ENDUSER00001", "older@example.com", "Older")
	newer := seedEndUser(t, pg, tenantID, "ENDUSER00002", "newer@example.com", "Newer")
	tiedAt := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	setUserCreatedAt(t, pg, older.ID, tiedAt)
	setUserCreatedAt(t, pg, newer.ID, tiedAt)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	first, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{
		Limit: 1,
	}))
	if err != nil {
		t.Fatalf("ListEndUsers first page: %v", err)
	}
	second, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{
		Limit: 1,
		Token: first.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListEndUsers second page: %v", err)
	}
	got := append(endUserPublicIDs(first.Msg.Users), endUserPublicIDs(second.Msg.Users)...)
	want := []string{newer.PublicID, older.PublicID}
	if !slices.Equal(got, want) {
		t.Fatalf("adjacent pages = %v, want %v (id DESC on a created_at tie)", got, want)
	}
}

func TestDBListEndUsersFiltersByStatusAndPublicIDs(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	active := seedEndUser(t, pg, tenantID, "ENDUSER00001", "active@example.com", "Active Reader")
	suspended := seedEndUser(t, pg, tenantID, "ENDUSER00002", "suspended@example.com", "Suspended Reader")
	setUserStatus(t, pg, suspended.PublicID, userStatusSuspended)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)

	byStatus, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{
		Status: userStatusSuspended,
	}))
	if err != nil {
		t.Fatalf("ListEndUsers by status: %v", err)
	}
	if got := endUserPublicIDs(byStatus.Msg.Users); !slices.Equal(got, []string{suspended.PublicID}) {
		t.Fatalf("status filter public IDs = %v, want only %q", got, suspended.PublicID)
	}

	byPublicID, err := client.ListEndUsers(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListEndUsersRequest{
		PublicIds: []string{active.PublicID, active.PublicID, "  "},
	}))
	if err != nil {
		t.Fatalf("ListEndUsers by public_ids: %v", err)
	}
	if got := endUserPublicIDs(byPublicID.Msg.Users); !slices.Equal(got, []string{active.PublicID}) {
		t.Fatalf("public_ids filter = %v, want only %q", got, active.PublicID)
	}
}

func TestDBSuspendAndUnsuspendEndUser(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	reader := seedEndUser(t, pg, tenantID, "ENDUSER00001", "reader@example.com", "Reader One")

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	suspendResp, err := client.SuspendEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.SuspendEndUserRequest{
		PublicId: reader.PublicID,
	}))
	if err != nil {
		t.Fatalf("SuspendEndUser: %v", err)
	}
	if suspendResp.Msg.User.Status != userStatusSuspended {
		t.Fatalf("status = %q, want %s", suspendResp.Msg.User.Status, userStatusSuspended)
	}

	// Suspension has to invalidate the reader's sessions as well as the flag.
	if got := userCredentialsVersion(t, pg, reader.ID); got <= reader.CredentialsVersion {
		t.Fatalf("credentials_version = %d, want a bump from %d", got, reader.CredentialsVersion)
	}

	unsuspendResp, err := client.UnsuspendEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UnsuspendEndUserRequest{
		PublicId: reader.PublicID,
	}))
	if err != nil {
		t.Fatalf("UnsuspendEndUser: %v", err)
	}
	if unsuspendResp.Msg.User.Status != userStatusActive {
		t.Fatalf("status = %q, want %s", unsuspendResp.Msg.User.Status, userStatusActive)
	}

	getResp, err := client.GetEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetEndUserRequest{
		PublicId: reader.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEndUser: %v", err)
	}
	if getResp.Msg.User.Status != userStatusActive {
		t.Fatalf("GetEndUser status = %q, want %s", getResp.Msg.User.Status, userStatusActive)
	}
}

// Tenant members are managed from the tenant console, so the platform end-user
// RPCs refuse them instead of reaching into another console's data.
func TestDBEndUserOperationsRejectTenantMembers(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	member := seedEndUser(t, pg, tenantID, "MEMBER000001", "member@example.com", "Tenant Member")
	seedTenantMember(t, pg, tenantID, member.ID, "tenant_editor")

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)

	if _, err := client.SuspendEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.SuspendEndUserRequest{
		PublicId: member.PublicID,
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SuspendEndUser code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := client.DeleteEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.DeleteEndUserRequest{
		PublicId: member.PublicID,
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteEndUser code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}

	stored, ok := userByPublicID(t, pg, member.PublicID)
	if !ok {
		t.Fatal("tenant member was removed, want it untouched")
	}
	if stored.Status != userStatusActive {
		t.Fatalf("tenant member status = %q, want %s", stored.Status, userStatusActive)
	}
}

// The delete is physical, and the rows hanging off the user go with it through
// the ON DELETE CASCADE foreign keys.
func TestDBDeleteEndUserCascadesRelatedRows(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	reader := seedEndUser(t, pg, tenantID, "ENDUSER00001", "reader@example.com", "Reader One")
	kept := seedEndUser(t, pg, tenantID, "ENDUSER00002", "kept@example.com", "Reader Two")
	seedUserNotificationSetting(t, pg, reader.ID)
	seedUserNotificationSetting(t, pg, kept.ID)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	deleteResp, err := client.DeleteEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.DeleteEndUserRequest{
		PublicId: reader.PublicID,
	}))
	if err != nil {
		t.Fatalf("DeleteEndUser: %v", err)
	}
	if deleteResp.Msg.PublicId != reader.PublicID {
		t.Fatalf("deleted public_id = %q, want %q", deleteResp.Msg.PublicId, reader.PublicID)
	}

	if _, ok := userByPublicID(t, pg, reader.PublicID); ok {
		t.Fatal("deleted user is still readable, want the row gone")
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM user_notification_settings WHERE user_id = $1", reader.ID); got != 0 {
		t.Fatalf("notification settings for the deleted user = %d, want 0", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM user_notification_settings WHERE user_id = $1", kept.ID); got != 1 {
		t.Fatalf("notification settings for the other user = %d, want 1", got)
	}

	_, err = client.GetEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetEndUserRequest{
		PublicId: reader.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEndUser after delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// Purchases are the exception to that cascade. They are commerce records the
// day's revenue figures are recomputed from, so the delete takes the buyer off
// them and leaves them where they are.
func TestDBDeleteEndUserKeepsThePurchasesWithoutTheBuyer(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	reader := seedEndUser(t, pg, tenantID, "ENDUSER00001", "reader@example.com", "Reader One")
	series := pg.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Published: true})
	episode := pg.SeedEpisode(t, tenantID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODE00001",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	pg.SeedPurchase(t, tenantID, reader.ID, episode.ID, 500)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	if _, err := client.DeleteEndUser(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.DeleteEndUserRequest{
		PublicId: reader.PublicID,
	})); err != nil {
		t.Fatalf("DeleteEndUser for a reader who bought an episode: %v", err)
	}

	if _, ok := userByPublicID(t, pg, reader.PublicID); ok {
		t.Fatal("deleted user is still readable, want the row gone")
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM purchases WHERE tenant_id = $1 AND episode_id = $2", tenantID, episode.ID); got != 1 {
		t.Fatalf("purchases of the episode after the delete = %d, want 1", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM purchases WHERE user_id IS NOT NULL"); got != 0 {
		t.Fatalf("purchases still naming their buyer = %d, want 0", got)
	}
}

func TestDBEndUserRPCsRequirePlatformSession(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	tenantID := seedTenant(t, pg, "TENANT000001", "readers.example.com", "Readers")
	seedEndUser(t, pg, tenantID, "ENDUSER00001", "reader@example.com", "Reader One")

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.ListEndUsers(context.Background(), connect.NewRequest(&publirasplatformv1.ListEndUsersRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListEndUsers without a token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func endUserPublicIDs(users []*publirasplatformv1.EndUser) []string {
	publicIDs := make([]string, 0, len(users))
	for _, user := range users {
		publicIDs = append(publicIDs, user.PublicId)
	}
	return publicIDs
}

func setUserCreatedAt(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID, createdAt time.Time) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `UPDATE users SET created_at = $2 WHERE id = $1`, userID, createdAt); err != nil {
		t.Fatalf("set created_at for %s: %v", userID, err)
	}
}

func setUserStatus(t *testing.T, pg *testutil.PostgresEnv, publicID, status string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(pg.DB).UpdateUserStatus(ctx, dbmodels.UpdateUserStatusParams{
		PublicID: publicID,
		Status:   status,
	}); err != nil {
		t.Fatalf("UpdateUserStatus %s: %v", publicID, err)
	}
}

func seedUserNotificationSetting(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(pg.DB).UpsertUserNotificationSettings(ctx, dbmodels.UpsertUserNotificationSettingsParams{
		UserID:                    userID,
		EmailNotificationsEnabled: true,
	}); err != nil {
		t.Fatalf("UpsertUserNotificationSettings: %v", err)
	}
}

func userCredentialsVersion(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID) int32 {
	t.Helper()
	return int32(scanInt(t, pg, "SELECT credentials_version FROM users WHERE id = $1", userID))
}
