package adminapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantlock"
	"github.com/publira/publira/server/internal/testutil"
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

func TestDBAdminListReadersListsEveryAccountAndPages(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RDRTENANT001", "readers.example.com", "Readers", "RDRADMIN0001", "admin@readers.example.com")
	editor := env.PG.SeedTenantUser(t, admin.Tenant.ID, "RDREDITOR001", "editor@readers.example.com", "Editor", auth.RoleTenantEditor)
	first := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDRFIRST0001", "alice@readers.example.com", "Alice")
	second := env.PG.SeedUnverifiedEndUser(t, admin.Tenant.ID, "RDRSECOND001", "bob@readers.example.com", "Bob")
	third := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDRTHIRD0001", "carol@readers.example.com", "Carol")

	other := env.seedTenantWithAdmin(t, "RDOTENANT001", "readers-other.example.com", "Other", "RDOADMIN0001", "admin@readers-other.example.com")
	env.PG.SeedEndUser(t, other.Tenant.ID, "RDOREADER001", "alice@readers-other.example.com", "Alice")

	// The staff of this tenant are listed with their role; readers of another
	// tenant are absent.
	all := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{})
	want := []string{third.PublicID, second.PublicID, first.PublicID, editor.PublicID, admin.User.PublicID}
	if got := adminReaderPublicIDs(all.Readers); !slices.Equal(got, want) {
		t.Fatalf("unfiltered list = %v, want %v", got, want)
	}
	wantRoles := []string{"", "", "", auth.RoleTenantEditor, auth.RoleTenantAdmin}
	for i, reader := range all.Readers {
		if reader.Role != wantRoles[i] {
			t.Fatalf("listed account %s role = %q, want %q", reader.PublicId, reader.Role, wantRoles[i])
		}
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

	page := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 3})
	if got := adminReaderPublicIDs(page.Readers); !slices.Equal(got, want[:3]) {
		t.Fatalf("first page = %v, want the three newest accounts", got)
	}
	if page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first page tokens = (%q, %q), want a next token only", page.PreviousToken, page.NextToken)
	}
	next := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 3, Token: page.NextToken})
	if got := adminReaderPublicIDs(next.Readers); !slices.Equal(got, want[3:]) {
		t.Fatalf("second page = %v, want the two staff accounts", got)
	}
	if next.NextToken != "" || next.PreviousToken == "" {
		t.Fatalf("last page tokens = (%q, %q), want a previous token only", next.PreviousToken, next.NextToken)
	}
	back := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 3, Token: next.PreviousToken})
	if got := adminReaderPublicIDs(back.Readers); !slices.Equal(got, want[:3]) {
		t.Fatalf("page back = %v, want the three newest accounts", got)
	}
}

// Only the single read carries a birth date; a page of readers never does, in
// either direction.
func TestDBAdminListReadersLeavesBirthDatesOut(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RBLTENANT001", "reader-birth-list.example.com", "Birth", "RBLADMIN0001", "admin@reader-birth-list.example.com")
	older := env.PG.SeedEndUser(t, admin.Tenant.ID, "RBLOLDER0001", "older@reader-birth-list.example.com", "Older")
	newer := env.PG.SeedEndUser(t, admin.Tenant.ID, "RBLNEWER0001", "newer@reader-birth-list.example.com", "Newer")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, reader := range []testutil.TenantUser{older, newer} {
		if _, err := dbmodels.New(env.PG.DB).SetUserBirthDateByID(ctx, dbmodels.SetUserBirthDateByIDParams{
			ID:        reader.ID,
			BirthDate: sql.NullTime{Time: time.Date(1990, time.April, 2, 0, 0, 0, 0, time.UTC), Valid: true},
		}); err != nil {
			t.Fatalf("SetUserBirthDateByID: %v", err)
		}
	}

	first := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 1})
	second := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 1, Token: first.NextToken})
	back := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Limit: 1, Token: second.PreviousToken})
	for _, page := range [][]*publiraadminv1.AdminReader{first.Readers, second.Readers, back.Readers} {
		if len(page) != 1 {
			t.Fatalf("page = %+v, want one reader", page)
		}
		if page[0].BirthDate != "" {
			t.Fatalf("listed reader %s birth_date = %q, want empty", page[0].PublicId, page[0].BirthDate)
		}
	}

	res, err := env.userClient().GetReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.GetReaderRequest{
		Tenant:   admin.tenantContext(),
		PublicId: newer.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetReader: %v", err)
	}
	if res.Msg.Reader.BirthDate != "1990-04-02" {
		t.Fatalf("read reader birth_date = %q, want 1990-04-02", res.Msg.Reader.BirthDate)
	}
}

func TestDBAdminListReadersBindsTokensToTheFilters(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RTKTENANT001", "reader-token.example.com", "Token", "RTKADMIN0001", "admin@reader-token.example.com")
	first := env.PG.SeedEndUser(t, admin.Tenant.ID, "RTKFIRST0001", "first@reader-token.example.com", "Match First")
	env.PG.SeedUnverifiedEndUser(t, admin.Tenant.ID, "RTKOTHER0001", "other@reader-token.example.com", "Match Other")
	second := env.PG.SeedEndUser(t, admin.Tenant.ID, "RTKSECOND001", "second@reader-token.example.com", "Match Second")

	filtered := &publiraadminv1.ListReadersRequest{Query: "match", Status: "active", Limit: 1}
	page := env.listReaders(t, admin, filtered)
	if got := adminReaderPublicIDs(page.Readers); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("first filtered page = %v, want %s", got, second.PublicID)
	}
	next := env.listReaders(t, admin, &publiraadminv1.ListReadersRequest{Query: "match", Status: "active", Limit: 1, Token: page.NextToken})
	if got := adminReaderPublicIDs(next.Readers); !slices.Equal(got, []string{first.PublicID}) {
		t.Fatalf("second filtered page = %v, want %s", got, first.PublicID)
	}
	if next.NextToken != "" {
		t.Fatalf("second filtered page next_token = %q, want empty on the last page", next.NextToken)
	}

	// A token names a position in one filtered list, so any other list refuses it.
	for _, req := range []*publiraadminv1.ListReadersRequest{
		{Query: "match", Limit: 1},
		{Status: "active", Limit: 1},
		{Query: "match first", Status: "active", Limit: 1},
		{Limit: 1},
	} {
		req.Tenant = admin.tenantContext()
		req.Token = page.NextToken
		if _, err := env.userClient().ListReaders(context.Background(), newAdminDBRequest(admin, req)); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ListReaders query=%q status=%q with another filter's token error = %v, want invalid_argument", req.Query, req.Status, err)
		}
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
	if got.Id != reader.ID.String() || got.PublicId != reader.PublicID || got.Name != "Reader" || got.Email != "reader@reader-get.example.com" || got.Status != "active" {
		t.Fatalf("reader = %+v, want the seeded active reader", got)
	}
	if got.CreatedAt == "" || got.EmailVerifiedAt == "" || got.BirthDate != "2000-01-02" || got.Role != "" {
		t.Fatalf("reader = %+v, want created_at, email_verified_at, the recorded birth date and no role", got)
	}

	// A staff account is read like any other, with its role.
	staff, err := client.GetReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.GetReaderRequest{
		Tenant:   admin.tenantContext(),
		PublicId: admin.User.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetReader for a staff account: %v", err)
	}
	if staff.Msg.Reader.Id != admin.User.ID.String() || staff.Msg.Reader.Role != auth.RoleTenantAdmin {
		t.Fatalf("staff account = %+v, want %s as %s", staff.Msg.Reader, admin.User.PublicID, auth.RoleTenantAdmin)
	}

	// A public id of another tenant is absent here.
	_, err = client.GetReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.GetReaderRequest{
		Tenant:   admin.tenantContext(),
		PublicId: outsider.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetReader %s error = %v, want not_found", outsider.PublicID, err)
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
	if _, err := client.SuspendReader(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.SuspendReaderRequest{
		Tenant:   asEditor.tenantContext(),
		ReaderId: reader.ID.String(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SuspendReader as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.UnsuspendReader(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.UnsuspendReaderRequest{
		Tenant:   asEditor.tenantContext(),
		ReaderId: reader.ID.String(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UnsuspendReader as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.DeleteReader(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.DeleteReaderRequest{
		Tenant:   asEditor.tenantContext(),
		ReaderId: reader.ID.String(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteReader as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.SetReaderBirthDate(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.SetReaderBirthDateRequest{
		Tenant:    asEditor.tenantContext(),
		ReaderId:  reader.ID.String(),
		BirthDate: "1990-01-01",
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SetReaderBirthDate as an editor error = %v, want permission_denied", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND birth_date IS NULL", reader.ID); count != 1 {
		t.Fatal("an editor's attempt stored a birth date")
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND status = 'active'", reader.ID); count != 1 {
		t.Fatalf("active rows for the reader after an editor's attempts = %d, want 1", count)
	}
}

func (e *adminDBEnv) readerAuditLogs(t *testing.T, tenant adminDBTenant) []*publiraadminv1.AdminAuditLog {
	t.Helper()

	res, err := e.auditClient().ListAuditLogs(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListAuditLogsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	return res.Msg.AuditLogs
}

func assertReaderAuditLog(t *testing.T, entry *publiraadminv1.AdminAuditLog, action string, actor adminDBTenant, readerPublicID string) {
	t.Helper()

	if entry.Action != action || entry.TargetType != "user" || entry.TargetId != readerPublicID ||
		entry.ActorUserPublicId != actor.User.PublicID || entry.Outcome != "success" {
		t.Fatalf("audit entry = %+v, want a successful %s of %s by %s", entry, action, readerPublicID, actor.User.PublicID)
	}
}

func TestDBAdminSuspendAndUnsuspendReaderAreAuditedOncePerChange(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RSUTENANT001", "reader-suspend.example.com", "Suspend", "RSUADMIN0001", "admin@reader-suspend.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RSUREADER001", "reader@reader-suspend.example.com", "Reader")
	client := env.userClient()

	suspend := func() *publiraadminv1.AdminReader {
		t.Helper()
		res, err := client.SuspendReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.SuspendReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: reader.ID.String(),
		}))
		if err != nil {
			t.Fatalf("SuspendReader: %v", err)
		}
		return res.Msg.Reader
	}
	unsuspend := func() *publiraadminv1.AdminReader {
		t.Helper()
		res, err := client.UnsuspendReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.UnsuspendReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: reader.ID.String(),
		}))
		if err != nil {
			t.Fatalf("UnsuspendReader: %v", err)
		}
		return res.Msg.Reader
	}

	// Lifting a suspension that is not there changes nothing and records nothing.
	if got := unsuspend(); got.Status != "active" {
		t.Fatalf("unsuspending an active reader status = %q, want active", got.Status)
	}
	if got := suspend(); got.Status != "suspended" || got.PublicId != reader.PublicID {
		t.Fatalf("suspended reader = %+v, want %s suspended", got, reader.PublicID)
	}
	// A second suspension neither bumps the version again nor adds a row.
	if got := suspend(); got.Status != "suspended" {
		t.Fatalf("suspending a suspended reader status = %q, want suspended", got.Status)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND credentials_version = $2", reader.ID, reader.CredentialsVersion+1); count != 1 {
		t.Fatal("credentials_version was not bumped exactly once by two suspensions")
	}
	if got := unsuspend(); got.Status != "active" {
		t.Fatalf("unsuspended reader status = %q, want active", got.Status)
	}

	logs := env.readerAuditLogs(t, admin)
	if len(logs) != 2 {
		t.Fatalf("audit log count = %d, want 2 (%+v)", len(logs), logs)
	}
	// Newest first.
	assertReaderAuditLog(t, logs[0], "reader_unsuspended", admin, reader.PublicID)
	assertReaderAuditLog(t, logs[1], "reader_suspended", admin, reader.PublicID)
}

func TestDBAdminDeleteReaderIsAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RDLTENANT001", "reader-delete.example.com", "Delete", "RDLADMIN0001", "admin@reader-delete.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDLREADER001", "reader@reader-delete.example.com", "Reader")
	client := env.userClient()

	req := &publiraadminv1.DeleteReaderRequest{Tenant: admin.tenantContext(), ReaderId: reader.ID.String()}
	if _, err := client.DeleteReader(context.Background(), newAdminDBRequest(admin, req)); err != nil {
		t.Fatalf("DeleteReader: %v", err)
	}
	if _, err := client.DeleteReader(context.Background(), newAdminDBRequest(admin, req)); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteReader for a deleted reader error = %v, want not_found", err)
	}

	logs := env.readerAuditLogs(t, admin)
	if len(logs) != 1 {
		t.Fatalf("audit log count = %d, want 1 (%+v)", len(logs), logs)
	}
	assertReaderAuditLog(t, logs[0], "reader_deleted", admin, reader.PublicID)
}

func TestDBAdminSetReaderBirthDateCorrectsAWrittenOnceDate(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RBDTENANT001", "reader-birth.example.com", "Birth", "RBDADMIN0001", "admin@reader-birth.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RBDREADER001", "reader@reader-birth.example.com", "Reader")
	client := env.userClient()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// The date the reader wrote themselves, which UpdateMe will not rewrite.
	if _, err := dbmodels.New(env.PG.DB).SetUserBirthDateByID(ctx, dbmodels.SetUserBirthDateByIDParams{
		ID:        reader.ID,
		BirthDate: sql.NullTime{Time: time.Date(2015, time.March, 4, 0, 0, 0, 0, time.UTC), Valid: true},
	}); err != nil {
		t.Fatalf("SetUserBirthDateByID: %v", err)
	}

	set := func(birthDate string) *publiraadminv1.AdminReader {
		t.Helper()
		res, err := client.SetReaderBirthDate(context.Background(), newAdminDBRequest(admin, &publiraadminv1.SetReaderBirthDateRequest{
			Tenant:    admin.tenantContext(),
			ReaderId:  reader.ID.String(),
			BirthDate: birthDate,
		}))
		if err != nil {
			t.Fatalf("SetReaderBirthDate %q: %v", birthDate, err)
		}
		return res.Msg.Reader
	}

	if got := set("1995-03-04"); got.BirthDate != "1995-03-04" || got.PublicId != reader.PublicID {
		t.Fatalf("corrected reader = %+v, want %s born 1995-03-04", got, reader.PublicID)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND birth_date = '1995-03-04'", reader.ID); count != 1 {
		t.Fatal("stored birth_date was not corrected")
	}
	// The same date again changes nothing and records nothing.
	if got := set(" 1995-03-04 "); got.BirthDate != "1995-03-04" {
		t.Fatalf("rewriting the stored date birth_date = %q, want 1995-03-04", got.BirthDate)
	}
	if got := set(""); got.BirthDate != "" {
		t.Fatalf("cleared reader birth_date = %q, want empty", got.BirthDate)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND birth_date IS NULL", reader.ID); count != 1 {
		t.Fatal("stored birth_date was not cleared")
	}
	if got := set(""); got.BirthDate != "" {
		t.Fatalf("clearing again birth_date = %q, want empty", got.BirthDate)
	}

	logs := env.readerAuditLogs(t, admin)
	if len(logs) != 2 {
		t.Fatalf("audit log count = %d, want 2 (%+v)", len(logs), logs)
	}
	// Newest first.
	assertReaderAuditLog(t, logs[0], "reader_birth_date_cleared", admin, reader.PublicID)
	assertReaderAuditLog(t, logs[1], "reader_birth_date_changed", admin, reader.PublicID)
}

func TestDBAdminSetReaderBirthDateRejectsWhatAReaderCouldNotStore(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RBVTENANT001", "reader-birth-invalid.example.com", "Birth", "RBVADMIN0001", "admin@reader-birth-invalid.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RBVREADER001", "reader@reader-birth-invalid.example.com", "Reader")
	client := env.userClient()

	future := time.Now().UTC().AddDate(0, 0, 2).Format("2006-01-02")
	for _, birthDate := range []string{"1995-3-4", "1995-02-30", "04/03/1995", future, "1800-01-01"} {
		_, err := client.SetReaderBirthDate(context.Background(), newAdminDBRequest(admin, &publiraadminv1.SetReaderBirthDateRequest{
			Tenant:    admin.tenantContext(),
			ReaderId:  reader.ID.String(),
			BirthDate: birthDate,
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("SetReaderBirthDate %q error = %v, want invalid_argument", birthDate, err)
		}
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND birth_date IS NULL", reader.ID); count != 1 {
		t.Fatal("a rejected date was stored")
	}
	if logs := env.readerAuditLogs(t, admin); len(logs) != 0 {
		t.Fatalf("audit log count = %d, want 0 (%+v)", len(logs), logs)
	}
}

// A reader of another tenant is out of reach of every action, as it is of
// GetReader.
func TestDBAdminReaderActionsLeaveOtherTenantsAlone(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RSCTENANT001", "reader-scope.example.com", "Scope", "RSCADMIN0001", "admin@reader-scope.example.com")
	other := env.seedTenantWithAdmin(t, "RSOTENANT001", "reader-scope-other.example.com", "Other", "RSOADMIN0001", "admin@reader-scope-other.example.com")
	outsider := env.PG.SeedEndUser(t, other.Tenant.ID, "RSOREADER001", "reader@reader-scope-other.example.com", "Outsider")
	client := env.userClient()

	for _, readerID := range []string{outsider.ID.String(), other.User.ID.String(), uuid.Must(uuid.NewV7()).String()} {
		if _, err := client.SuspendReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.SuspendReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: readerID,
		})); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("SuspendReader %s error = %v, want not_found", readerID, err)
		}
		if _, err := client.UnsuspendReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.UnsuspendReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: readerID,
		})); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("UnsuspendReader %s error = %v, want not_found", readerID, err)
		}
		if _, err := client.DeleteReader(context.Background(), newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: readerID,
		})); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("DeleteReader %s error = %v, want not_found", readerID, err)
		}
		if _, err := client.SetReaderBirthDate(context.Background(), newAdminDBRequest(admin, &publiraadminv1.SetReaderBirthDateRequest{
			Tenant:    admin.tenantContext(),
			ReaderId:  readerID,
			BirthDate: "1990-01-01",
		})); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("SetReaderBirthDate %s error = %v, want not_found", readerID, err)
		}
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM users WHERE id IN ($1, $2) AND birth_date IS NULL AND status = 'active'",
		outsider.ID, other.User.ID,
	); count != 2 {
		t.Fatalf("untouched accounts of the other tenant = %d, want 2", count)
	}
	if logs := env.readerAuditLogs(t, admin); len(logs) != 0 {
		t.Fatalf("audit log count = %d, want 0 (%+v)", len(logs), logs)
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

// A staff account is acted on like any other account: suspended, lifted,
// corrected and deleted, and deleting it takes its roles with it.
func TestDBAdminReaderActionsReachStaffAccounts(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RSFTENANT001", "reader-staff.example.com", "Staff", "RSFADMIN0001", "admin@reader-staff.example.com")
	editor := env.PG.SeedTenantUser(t, admin.Tenant.ID, "RSFEDITOR001", "editor@reader-staff.example.com", "Editor", auth.RoleTenantEditor)
	client := env.userClient()
	ctx := context.Background()
	// A staff account the console creates has its address confirmed, so lifting
	// its suspension makes it active again rather than inactive.
	if _, err := dbmodels.New(env.PG.DB).UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              editor.ID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("UpdateUserEmailVerifiedAtByID: %v", err)
	}

	suspended, err := client.SuspendReader(ctx, newAdminDBRequest(admin, &publiraadminv1.SuspendReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: editor.ID.String(),
	}))
	if err != nil {
		t.Fatalf("SuspendReader for a staff account: %v", err)
	}
	if got := suspended.Msg.Reader; got.Status != "suspended" || got.Role != auth.RoleTenantEditor {
		t.Fatalf("suspended staff account = %+v, want suspended as %s", got, auth.RoleTenantEditor)
	}
	unsuspended, err := client.UnsuspendReader(ctx, newAdminDBRequest(admin, &publiraadminv1.UnsuspendReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: editor.ID.String(),
	}))
	if err != nil {
		t.Fatalf("UnsuspendReader for a staff account: %v", err)
	}
	if got := unsuspended.Msg.Reader; got.Status != "active" || got.Role != auth.RoleTenantEditor {
		t.Fatalf("unsuspended staff account = %+v, want active as %s", got, auth.RoleTenantEditor)
	}
	corrected, err := client.SetReaderBirthDate(ctx, newAdminDBRequest(admin, &publiraadminv1.SetReaderBirthDateRequest{
		Tenant:    admin.tenantContext(),
		ReaderId:  editor.ID.String(),
		BirthDate: "1990-01-01",
	}))
	if err != nil {
		t.Fatalf("SetReaderBirthDate for a staff account: %v", err)
	}
	if got := corrected.Msg.Reader; got.BirthDate != "1990-01-01" || got.Role != auth.RoleTenantEditor {
		t.Fatalf("corrected staff account = %+v, want born 1990-01-01 as %s", got, auth.RoleTenantEditor)
	}

	if _, err := client.DeleteReader(ctx, newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: editor.ID.String(),
	})); err != nil {
		t.Fatalf("DeleteReader for a staff account: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", editor.ID); count != 0 {
		t.Fatal("the deleted staff account is still there")
	}
	if count := env.countRows(t, "SELECT count(*) FROM tenant_user_roles WHERE user_id = $1", editor.ID); count != 0 {
		t.Fatalf("roles of the deleted staff account = %d, want none", count)
	}

	logs := env.readerAuditLogs(t, admin)
	if len(logs) != 4 {
		t.Fatalf("audit log count = %d, want 4 (%+v)", len(logs), logs)
	}
	// Newest first.
	assertReaderAuditLog(t, logs[0], "reader_deleted", admin, editor.PublicID)
	assertReaderAuditLog(t, logs[1], "reader_birth_date_changed", admin, editor.PublicID)
	assertReaderAuditLog(t, logs[2], "reader_unsuspended", admin, editor.PublicID)
	assertReaderAuditLog(t, logs[3], "reader_suspended", admin, editor.PublicID)
}

func requireReaderRefusal(t *testing.T, err error, reason string) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err = %v)", connect.CodeOf(err), err)
	}
	if got := errorInfoReason(t, err); got != reason {
		t.Fatalf("reason = %q, want %q (err = %v)", got, reason, err)
	}
}

func TestDBAdminSuspendAndDeleteReaderRefuseTheCallersOwnAccount(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RSLTENANT001", "reader-self.example.com", "Self", "RSLADMIN0001", "admin@reader-self.example.com")
	// Another active administrator, so the last-administrator guard is not
	// what refuses.
	env.PG.SeedTenantAdmin(t, admin.Tenant.ID, "RSLADMIN0002", "second@reader-self.example.com", "Second")
	client := env.userClient()
	ctx := context.Background()

	_, err := client.SuspendReader(ctx, newAdminDBRequest(admin, &publiraadminv1.SuspendReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: admin.User.ID.String(),
	}))
	requireReaderRefusal(t, err, rpcerrors.ReasonOwnAccount)
	_, err = client.DeleteReader(ctx, newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: admin.User.ID.String(),
	}))
	requireReaderRefusal(t, err, rpcerrors.ReasonOwnAccount)

	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND status = 'active'", admin.User.ID); count != 1 {
		t.Fatal("the caller's own account is no longer active")
	}
	if logs := env.readerAuditLogs(t, admin); len(logs) != 0 {
		t.Fatalf("audit log count = %d, want 0 (%+v)", len(logs), logs)
	}
}

// afterConcurrentSuspension runs call while another transaction, holding the
// tenant's administrator lock, suspends the calling administrator, and commits
// that transaction once call waits on the lock. It is the moment two
// administrators acting on each other at once would otherwise both get
// through: the caller's session was still active when the request arrived. The
// caller is active again when it returns.
func (e *adminDBEnv) afterConcurrentSuspension(t *testing.T, caller adminDBTenant, call func() error) error {
	t.Helper()

	ctx := context.Background()
	tx, err := e.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if err := tenantlock.Take(ctx, tx, "tenant-admins:"+caller.Tenant.ID.String()); err != nil {
		t.Fatalf("take the administrator lock: %v", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE users SET status = 'suspended' WHERE id = $1", caller.User.ID); err != nil {
		t.Fatalf("suspend the caller: %v", err)
	}

	result := make(chan error, 1)
	go func() { result <- call() }()
	e.waitForBlockedBackend(t)
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	select {
	case err = <-result:
	case <-time.After(30 * time.Second):
		t.Fatal("the racing request never finished")
	}
	if _, execErr := e.PG.DB.ExecContext(ctx, "UPDATE users SET status = 'active' WHERE id = $1", caller.User.ID); execErr != nil {
		t.Fatalf("reactivate the caller: %v", execErr)
	}
	return err
}

func TestDBAdminSuspendAndDeleteReaderKeepAnActiveTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RLATENANT001", "reader-last-admin.example.com", "Last", "RLAADMIN0001", "admin@reader-last-admin.example.com")
	second := env.PG.SeedTenantAdmin(t, admin.Tenant.ID, "RLAADMIN0002", "second@reader-last-admin.example.com", "Second")
	client := env.userClient()
	ctx := context.Background()

	suspend := func() error {
		_, err := client.SuspendReader(ctx, newAdminDBRequest(admin, &publiraadminv1.SuspendReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: second.ID.String(),
		}))
		return err
	}
	deleteSecond := func() error {
		_, err := client.DeleteReader(ctx, newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: second.ID.String(),
		}))
		return err
	}

	// The second administrator suspended the caller a moment before: the
	// second one is the last active administrator by the time the caller's
	// request gets the lock.
	requireLastTenantAdminRefusal(t, env.afterConcurrentSuspension(t, admin, suspend))
	requireLastTenantAdminRefusal(t, env.afterConcurrentSuspension(t, admin, deleteSecond))
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND status = 'active'", second.ID); count != 1 {
		t.Fatal("the last active administrator was suspended or deleted")
	}

	// With the caller active beside them, the second administrator can be
	// suspended, and deleted.
	if err := suspend(); err != nil {
		t.Fatalf("SuspendReader for a second administrator: %v", err)
	}
	if err := deleteSecond(); err != nil {
		t.Fatalf("DeleteReader for a second administrator: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM tenant_user_roles WHERE user_id = $1", second.ID); count != 0 {
		t.Fatalf("roles of the deleted administrator = %d, want none", count)
	}
}

// heldAuditQueries holds every tenant entry the async recorder writes until
// release is closed, so a test can delete the actor while its entry is still
// queued.
type heldAuditQueries struct {
	auditlog.Querier
	held    chan struct{}
	release chan struct{}
}

func (q heldAuditQueries) InsertAuditLog(ctx context.Context, arg dbmodels.InsertAuditLogParams) error {
	select {
	case q.held <- struct{}{}:
	default:
	}
	<-q.release
	return q.Querier.InsertAuditLog(ctx, arg)
}

// An entry the async recorder writes after the request answered can land once
// its actor is already deleted. It is filed under the public ID and name the
// session carried rather than refused by the foreign key and dropped.
func TestDBAdminDeleteReaderKeepsAnEntryStillQueuedForTheAccount(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenAdminDB(t)
	queries := heldAuditQueries{Querier: dbmodels.New(pg.DB), held: make(chan struct{}, 1), release: make(chan struct{})}
	recorder := auditlog.NewAsyncWithConfig(queries, nil, slog.Default(), auditlog.AsyncConfig{})
	t.Cleanup(recorder.Close)
	released := false
	release := func() {
		if !released {
			released = true
			close(queries.release)
		}
	}
	t.Cleanup(release)
	api, err := newAPI(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), newAdminTestEncryptor(t), nil, testutil.TokenManager(), nil, recorder, openMailGuard())
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	server := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(server.Close)
	env := &adminDBEnv{Server: server, PG: pg}

	admin := env.seedTenantWithAdmin(t, "RAQTENANT001", "reader-queued.example.com", "Queued", "RAQADMIN0001", "admin@reader-queued.example.com")
	second := admin.as(env.PG.SeedTenantAdmin(t, admin.Tenant.ID, "RAQADMIN0002", "second@reader-queued.example.com", "Second"))
	ctx := context.Background()

	page, err := env.pagesClient().CreatePage(ctx, newAdminDBRequest(second, &publiraadminv1.CreatePageRequest{
		Tenant: second.tenantContext(),
		Slug:   "queued",
		Title:  "Queued",
	}))
	if err != nil {
		t.Fatalf("CreatePage by the second administrator: %v", err)
	}
	select {
	case <-queries.held:
	case <-time.After(10 * time.Second):
		t.Fatal("the page's audit entry never reached the recorder")
	}
	if _, err := env.userClient().DeleteReader(ctx, newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: second.User.ID.String(),
	})); err != nil {
		t.Fatalf("DeleteReader while the account's entry is queued: %v", err)
	}
	release()
	if err := recorder.Shutdown(ctx); err != nil {
		t.Fatalf("drain the recorder: %v", err)
	}

	if count := env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = 'page_created' AND target_id = $2
			AND actor_user_id IS NULL AND actor_public_id = $3 AND actor_name = $4
	`, admin.Tenant.ID, page.Msg.Page.Id, second.User.PublicID, "Second"); count != 1 {
		t.Fatalf("queued entries kept under the deleted administrator = %d, want 1", count)
	}
}

// A staff account that has acted in the console can be deleted. Its audit
// entries keep its name and public ID, so the record still says who did what
// and can still be filtered by them, and the page versions it wrote stay
// without naming it.
func TestDBAdminDeleteReaderKeepsTheRecordOfAStaffAccount(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RAHTENANT001", "reader-history.example.com", "History", "RAHADMIN0001", "admin@reader-history.example.com")
	second := admin.as(env.PG.SeedTenantAdmin(t, admin.Tenant.ID, "RAHADMIN0002", "second@reader-history.example.com", "Second"))
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RAHREADER001", "reader@reader-history.example.com", "Reader")
	client := env.userClient()
	ctx := context.Background()

	if _, err := client.SuspendReader(ctx, newAdminDBRequest(second, &publiraadminv1.SuspendReaderRequest{
		Tenant:   second.tenantContext(),
		ReaderId: reader.ID.String(),
	})); err != nil {
		t.Fatalf("SuspendReader by the second administrator: %v", err)
	}
	pageID := createDBPage(t, env, second, "history", "History", true)

	if _, err := client.DeleteReader(ctx, newAdminDBRequest(admin, &publiraadminv1.DeleteReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: second.User.ID.String(),
	})); err != nil {
		t.Fatalf("DeleteReader for the account the audit log names: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", second.User.ID); count != 0 {
		t.Fatal("the account the audit log names is still there")
	}

	res, err := env.auditClient().ListAuditLogs(ctx, newAdminDBRequest(admin, &publiraadminv1.ListAuditLogsRequest{
		Tenant:            admin.tenantContext(),
		ActorUserPublicId: second.User.PublicID,
	}))
	if err != nil {
		t.Fatalf("ListAuditLogs by the deleted actor: %v", err)
	}
	if len(res.Msg.AuditLogs) == 0 {
		t.Fatal("no audit entries are filed under the deleted actor")
	}
	var suspension *publiraadminv1.AdminAuditLog
	for _, entry := range res.Msg.AuditLogs {
		if entry.ActorUserPublicId != second.User.PublicID || entry.ActorName != "Second" || entry.ActorRole != auth.RoleTenantAdmin {
			t.Fatalf("entry %s names (%q, %q, %q), want the deleted administrator", entry.Action, entry.ActorUserPublicId, entry.ActorName, entry.ActorRole)
		}
		if entry.Action == "reader_suspended" {
			suspension = entry
		}
	}
	if suspension == nil {
		t.Fatalf("the deleted administrator's suspension is missing from %+v", res.Msg.AuditLogs)
	}
	assertReaderAuditLog(t, suspension, "reader_suspended", second, reader.PublicID)

	if count := env.countRows(t, "SELECT count(*) FROM page_versions WHERE page_id = $1 AND author_user_id IS NULL", pageID); count != 1 {
		t.Fatalf("page versions left without an author = %d, want the one the deleted account wrote", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_translations WHERE page_id = $1 AND published_version_id IS NOT NULL", pageID); count != 1 {
		t.Fatal("the page the deleted account published is no longer published")
	}
}
