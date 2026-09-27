package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) createCreator(t *testing.T, tenant adminDBTenant, name string) *publiraadminv1.CreateCreatorResponse {
	t.Helper()

	res, err := e.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   name,
	}))
	if err != nil {
		t.Fatalf("CreateCreator %q: %v", name, err)
	}
	return res.Msg
}

func (e *adminDBEnv) linkCreatorAccount(tenant adminDBTenant, creatorID string, reader testutil.TenantUser) (*connect.Response[publiraadminv1.LinkCreatorAccountResponse], error) {
	return e.creatorClient().LinkCreatorAccount(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.LinkCreatorAccountRequest{
		Tenant:    tenant.tenantContext(),
		CreatorId: creatorID,
		ReaderId:  reader.ID.String(),
	}))
}

func (e *adminDBEnv) unlinkCreatorAccount(tenant adminDBTenant, creatorID string, reader testutil.TenantUser) (*connect.Response[publiraadminv1.UnlinkCreatorAccountResponse], error) {
	return e.creatorClient().UnlinkCreatorAccount(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UnlinkCreatorAccountRequest{
		Tenant:    tenant.tenantContext(),
		CreatorId: creatorID,
		ReaderId:  reader.ID.String(),
	}))
}

func (e *adminDBEnv) creatorAccountsOf(t *testing.T, tenant adminDBTenant, creatorPublicID string) []*publiraadminv1.CreatorAccount {
	t.Helper()

	res, err := e.creatorClient().GetCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetCreatorRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: creatorPublicID,
	}))
	if err != nil {
		t.Fatalf("GetCreator %s: %v", creatorPublicID, err)
	}
	return res.Msg.Accounts
}

func creatorAccountReaderPublicIDs(accounts []*publiraadminv1.CreatorAccount) []string {
	ids := make([]string, 0, len(accounts))
	for _, account := range accounts {
		ids = append(ids, account.Reader.PublicId)
	}
	return ids
}

func TestDBLinkAndUnlinkCreatorAccountsAreAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "CATENANT0001", "creator-accounts.example.com", "Creator Accounts", "CAADMIN00001", "admin@creator-accounts.example.com")
	penName := env.createCreator(t, admin, "Shared Pen Name").Creator
	ownName := env.createCreator(t, admin, "Own Name").Creator
	alice := env.PG.SeedEndUser(t, admin.Tenant.ID, "CAALICE00001", "alice@creator-accounts.example.com", "Alice")
	bob := env.PG.SeedEndUser(t, admin.Tenant.ID, "CABOB0000001", "bob@creator-accounts.example.com", "Bob")

	// A shared pen name is held by two people, and one of them also writes
	// under a name of their own.
	for _, reader := range []testutil.TenantUser{alice, bob} {
		if _, err := env.linkCreatorAccount(admin, penName.Id, reader); err != nil {
			t.Fatalf("LinkCreatorAccount %s to the pen name: %v", reader.PublicID, err)
		}
	}
	linked, err := env.linkCreatorAccount(admin, ownName.Id, alice)
	if err != nil {
		t.Fatalf("LinkCreatorAccount alice to her own name: %v", err)
	}
	if got := creatorAccountReaderPublicIDs(linked.Msg.Accounts); !slices.Equal(got, []string{alice.PublicID}) {
		t.Fatalf("link response accounts = %v, want %s", got, alice.PublicID)
	}

	// Linking the same pair again changes nothing and records nothing.
	again, err := env.linkCreatorAccount(admin, penName.Id, alice)
	if err != nil {
		t.Fatalf("LinkCreatorAccount the same pair again: %v", err)
	}
	if got := creatorAccountReaderPublicIDs(again.Msg.Accounts); !slices.Equal(got, []string{alice.PublicID, bob.PublicID}) {
		t.Fatalf("relink response accounts = %v, want alice then bob", got)
	}

	accounts := env.creatorAccountsOf(t, admin, penName.PublicId)
	if got := creatorAccountReaderPublicIDs(accounts); !slices.Equal(got, []string{alice.PublicID, bob.PublicID}) {
		t.Fatalf("GetCreator accounts = %v, want alice then bob", got)
	}
	if accounts[0].Reader.Id != alice.ID.String() || accounts[0].Reader.Email != alice.Email || accounts[0].LinkedAt == "" {
		t.Fatalf("first account = %+v, want alice with a link time", accounts[0])
	}

	unlinked, err := env.unlinkCreatorAccount(admin, penName.Id, alice)
	if err != nil {
		t.Fatalf("UnlinkCreatorAccount: %v", err)
	}
	if got := creatorAccountReaderPublicIDs(unlinked.Msg.Accounts); !slices.Equal(got, []string{bob.PublicID}) {
		t.Fatalf("unlink response accounts = %v, want bob", got)
	}
	// Unlinking a pair that is not linked changes nothing and records nothing.
	if _, err := env.unlinkCreatorAccount(admin, penName.Id, alice); err != nil {
		t.Fatalf("UnlinkCreatorAccount a pair that is not linked: %v", err)
	}
	if got := creatorAccountReaderPublicIDs(env.creatorAccountsOf(t, admin, ownName.PublicId)); !slices.Equal(got, []string{alice.PublicID}) {
		t.Fatalf("own name accounts after unlinking the pen name = %v, want alice", got)
	}

	var entries []*publiraadminv1.AdminAuditLog
	for _, entry := range env.readerAuditLogs(t, admin) {
		if entry.TargetType == "creator_account" {
			entries = append(entries, entry)
		}
	}
	want := []struct{ action, targetID string }{
		{"creator_account_unlinked", penName.PublicId + "/" + alice.PublicID},
		{"creator_account_linked", ownName.PublicId + "/" + alice.PublicID},
		{"creator_account_linked", penName.PublicId + "/" + bob.PublicID},
		{"creator_account_linked", penName.PublicId + "/" + alice.PublicID},
	}
	if len(entries) != len(want) {
		t.Fatalf("creator account audit entries = %+v, want %d", entries, len(want))
	}
	// Newest first.
	for i, w := range want {
		entry := entries[i]
		if entry.Action != w.action || entry.TargetId != w.targetID || entry.ActorUserPublicId != admin.User.PublicID || entry.Outcome != "success" {
			t.Fatalf("audit entry %d = %+v, want a successful %s of %s by %s", i, entry, w.action, w.targetID, admin.User.PublicID)
		}
	}
}

func TestDBLinkCreatorAccountRefusesAnythingButAnActiveReaderOfTheTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	mine := env.createCreator(t, first, "Tenant A Creator").Creator
	theirs := env.createCreator(t, second, "Tenant B Creator").Creator
	reader := env.PG.SeedEndUser(t, first.Tenant.ID, "CXREADER0001", "reader@tenant-a.example.com", "Reader")
	outsider := env.PG.SeedEndUser(t, second.Tenant.ID, "CXREADER0002", "reader@tenant-b.example.com", "Outsider")
	editor := env.PG.SeedTenantUser(t, first.Tenant.ID, "CXEDITOR0001", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor)
	unverified := env.PG.SeedUnverifiedEndUser(t, first.Tenant.ID, "CXREADER0003", "unverified@tenant-a.example.com", "Unverified")

	cases := []struct {
		name      string
		creatorID string
		reader    testutil.TenantUser
		want      connect.Code
	}{
		{"an account of another tenant", mine.Id, outsider, connect.CodeNotFound},
		{"a creator of another tenant", theirs.Id, reader, connect.CodeNotFound},
		{"a staff account", mine.Id, editor, connect.CodeNotFound},
		{"a reader who has not confirmed their address", mine.Id, unverified, connect.CodeFailedPrecondition},
	}
	for _, tc := range cases {
		if _, err := env.linkCreatorAccount(first, tc.creatorID, tc.reader); connect.CodeOf(err) != tc.want {
			t.Fatalf("link %s error = %v, want %v", tc.name, err, tc.want)
		}
	}
	if _, err := env.unlinkCreatorAccount(first, theirs.Id, reader); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unlink from a creator of another tenant error = %v, want not_found", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM creator_accounts"); count != 0 {
		t.Fatalf("creator accounts = %d, want none", count)
	}
}

// Readers are the tenant admin's to see, so an editor can neither change a
// link nor read who is linked.
func TestDBCreatorAccountsAreTheTenantAdminsAlone(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "CETENANT0001", "creator-editor.example.com", "Creator Editor", "CEADMIN00001", "admin@creator-editor.example.com")
	editor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "CEEDITOR0001", "editor@creator-editor.example.com", "Editor", auth.RoleTenantEditor))
	creator := env.createCreator(t, admin, "Pen Name").Creator
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "CEREADER0001", "reader@creator-editor.example.com", "Reader")

	if _, err := env.linkCreatorAccount(editor, creator.Id, reader); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("editor link error = %v, want permission_denied", err)
	}
	if _, err := env.linkCreatorAccount(admin, creator.Id, reader); err != nil {
		t.Fatalf("LinkCreatorAccount: %v", err)
	}
	if _, err := env.unlinkCreatorAccount(editor, creator.Id, reader); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("editor unlink error = %v, want permission_denied", err)
	}
	if got := env.creatorAccountsOf(t, editor, creator.PublicId); len(got) != 0 {
		t.Fatalf("editor GetCreator accounts = %+v, want none", got)
	}
	if got := creatorAccountReaderPublicIDs(env.creatorAccountsOf(t, admin, creator.PublicId)); !slices.Equal(got, []string{reader.PublicID}) {
		t.Fatalf("admin GetCreator accounts = %v, want %s", got, reader.PublicID)
	}
}
