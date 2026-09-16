package adminapi

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

func (e *adminDBEnv) listReaders(t *testing.T, tenant adminDBTenant, req *publiraadminv1.ListReadersRequest) *publiraadminv1.ListReadersResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.userClient().ListReaders(context.Background(), newAdminDBRequest(tenant, req))
	if err != nil {
		t.Fatalf("ListReaders %+v: %v", req, err)
	}
	return res.Msg
}

func adminReaderPublicIDs(readers []*publiraadminv1.AdminReader) []string {
	ids := make([]string, 0, len(readers))
	for _, reader := range readers {
		ids = append(ids, reader.PublicId)
	}
	return ids
}

func TestDBAdminListReadersListsReadersOnlyAndPages(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RDRTENANT001", "readers.example.com", "Readers", "RDRADMIN0001", "admin@readers.example.com")
	env.PG.SeedTenantUser(t, admin.Tenant.ID, "RDREDITOR001", "editor@readers.example.com", "Editor", auth.RoleTenantEditor)
	first := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDRFIRST0001", "alice@readers.example.com", "Alice")
	second := env.PG.SeedUnverifiedEndUser(t, admin.Tenant.ID, "RDRSECOND001", "bob@readers.example.com", "Bob")
	third := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDRTHIRD0001", "carol@readers.example.com", "Carol")

	other := env.seedTenantWithAdmin(t, "RDOTENANT001", "readers-other.example.com", "Other", "RDOADMIN0001", "admin@readers-other.example.com")
	env.PG.SeedEndUser(t, other.Tenant.ID, "RDOREADER001", "alice@readers-other.example.com", "Alice")

	// Staff of this tenant and readers of another are both absent.
	all := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{})
	if got := adminReaderPublicIDs(all.Readers); !slices.Equal(got, []string{third.PublicID, second.PublicID, first.PublicID}) {
		t.Fatalf("unfiltered list = %v, want the three readers newest first", got)
	}

	byName := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Query: "ALI"})
	if got := adminReaderPublicIDs(byName.Readers); !slices.Equal(got, []string{first.PublicID}) {
		t.Fatalf("name search = %v, want %s", got, first.PublicID)
	}
	byEmail := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Query: "bob@"})
	if got := adminReaderPublicIDs(byEmail.Readers); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("email search = %v, want %s", got, second.PublicID)
	}
	byStatus := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Status: "inactive"})
	if got := adminReaderPublicIDs(byStatus.Readers); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("inactive list = %v, want %s", got, second.PublicID)
	}

	page := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 2})
	if got := adminReaderPublicIDs(page.Readers); !slices.Equal(got, []string{third.PublicID, second.PublicID}) {
		t.Fatalf("first page = %v, want the two newest readers", got)
	}
	if page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first page tokens = (%q, %q), want a next token only", page.PreviousToken, page.NextToken)
	}
	next := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 2, Token: page.NextToken})
	if got := adminReaderPublicIDs(next.Readers); !slices.Equal(got, []string{first.PublicID}) {
		t.Fatalf("second page = %v, want %s", got, first.PublicID)
	}
	if next.NextToken != "" || next.PreviousToken == "" {
		t.Fatalf("last page tokens = (%q, %q), want a previous token only", next.PreviousToken, next.NextToken)
	}
	back := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 2, Token: next.PreviousToken})
	if got := adminReaderPublicIDs(back.Readers); !slices.Equal(got, []string{third.PublicID, second.PublicID}) {
		t.Fatalf("page back = %v, want the two newest readers", got)
	}
}

func TestDBAdminListReadersRejectsAnUnknownStatus(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RSTTENANT001", "reader-status.example.com", "Status", "RSTADMIN0001", "admin@reader-status.example.com")

	_, err := env.userClient().ListReaders(context.Background(), newAdminDBRequest(admin, &publiraadminv1.ListReadersRequest{
		Tenant: admin.tenantContext(),
		Status: "deleted",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListReaders with an unknown status error = %v, want invalid_argument", err)
	}
}

func TestDBAdminGetReaderReadsOneReaderOfTheTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RGTTENANT001", "reader-get.example.com", "Get", "RGTADMIN0001", "admin@reader-get.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RGTREADER001", "reader@reader-get.example.com", "Reader")
	other := env.seedTenantWithAdmin(t, "RGOTENANT001", "reader-get-other.example.com", "Other", "RGOADMIN0001", "admin@reader-get-other.example.com")
	outsider := env.PG.SeedEndUser(t, other.Tenant.ID, "RGOREADER001", "reader@reader-get-other.example.com", "Outsider")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(env.PG.DB).SetUserBirthDateByID(ctx, dbmodels.SetUserBirthDateByIDParams{
		ID:        reader.ID,
		BirthDate: sql.NullTime{Time: time.Date(2000, time.January, 2, 0, 0, 0, 0, time.UTC), Valid: true},
	}); err != nil {
		t.Fatalf("SetUserBirthDateByID: %v", err)
	}

	client := env.userClient()
	res, err := client.GetReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.GetReaderRequest{
		Tenant:   admin.tenantContext(),
		PublicId: reader.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetReader: %v", err)
	}
	got := res.Msg.Reader
	if got.PublicId != reader.PublicID || got.Name != "Reader" || got.Email != "reader@reader-get.example.com" || got.Status != "active" {
		t.Fatalf("reader = %+v, want the seeded active reader", got)
	}
	if got.CreatedAt == "" || got.EmailVerifiedAt == "" || !got.HasBirthDate {
		t.Fatalf("reader = %+v, want created_at, email_verified_at and a recorded birth date", got)
	}

	// A public id of another tenant and a staff account are both absent here.
	for _, publicID := range []string{outsider.PublicID, admin.User.PublicID} {
		_, err := client.GetReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.GetReaderRequest{
			Tenant:   admin.tenantContext(),
			PublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetReader %s error = %v, want not_found", publicID, err)
		}
	}
}

func TestDBAdminReaderRPCsRequireTheAdminRole(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RRLTENANT001", "reader-role.example.com", "Role", "RRLADMIN0001", "admin@reader-role.example.com")
	editor := env.PG.SeedTenantUser(t, admin.Tenant.ID, "RRLEDITOR001", "editor@reader-role.example.com", "Editor", auth.RoleTenantEditor)
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RRLREADER001", "reader@reader-role.example.com", "Reader")
	asEditor := admin.as(editor)
	client := env.userClient()

	if _, err := client.ListReaders(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.ListReadersRequest{
		Tenant: asEditor.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListReaders as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.GetReader(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.GetReaderRequest{
		Tenant:   asEditor.tenantContext(),
		PublicId: reader.PublicID,
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetReader as an editor error = %v, want permission_denied", err)
	}
}

func TestDBAdminListCommentsFiltersByAuthor(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "AUT", "author.example.com")
	another := env.PG.SeedEndUser(t, fixture.admin.Tenant.ID, "AUTREADER002", "another@author.example.com", "Another")

	mine := fixture.seedComment(t, "AUTMINE00001", "published")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	theirs, err := dbmodels.New(env.PG.DB).CreateEpisodeComment(ctx, dbmodels.CreateEpisodeCommentParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  fixture.admin.Tenant.ID,
		PublicID:  "AUTTHEIRS001",
		EpisodeID: fixture.episode.ID,
		UserID:    another.ID,
		Body:      "A comment by another reader.",
		Status:    "pending",
	})
	if err != nil {
		t.Fatalf("create another reader's comment: %v", err)
	}

	byMine := fixture.list(t, &publiraadminv1.ListCommentsRequest{AuthorPublicId: fixture.readerPublicID})
	if got := adminCommentPublicIDs(byMine.Comments); !slices.Equal(got, []string{mine.PublicID}) {
		t.Fatalf("author list = %v, want %s", got, mine.PublicID)
	}
	byTheirs := fixture.list(t, &publiraadminv1.ListCommentsRequest{AuthorPublicId: another.PublicID, Status: "pending"})
	if got := adminCommentPublicIDs(byTheirs.Comments); !slices.Equal(got, []string{theirs.PublicID}) {
		t.Fatalf("author and status list = %v, want %s", got, theirs.PublicID)
	}
	if got := adminCommentPublicIDs(fixture.list(t, &publiraadminv1.ListCommentsRequest{AuthorPublicId: "NOSUCHREADER"}).Comments); len(got) != 0 {
		t.Fatalf("unknown author list = %v, want an empty page", got)
	}
}
