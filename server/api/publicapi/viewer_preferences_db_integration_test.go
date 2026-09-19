package publicapi

import (
	"context"
	"database/sql"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func getViewerPreferencesRequest(tenant testutil.Tenant, token string) *connect.Request[publirav1.GetViewerPreferencesRequest] {
	return newBearerRequest(&publirav1.GetViewerPreferencesRequest{Tenant: tenantContext(tenant)}, token)
}

func updateViewerPreferencesRequest(tenant testutil.Tenant, token string, wideViewerEnabled *bool) *connect.Request[publirav1.UpdateViewerPreferencesRequest] {
	return newBearerRequest(&publirav1.UpdateViewerPreferencesRequest{
		Tenant:            tenantContext(tenant),
		WideViewerEnabled: wideViewerEnabled,
	}, token)
}

func TestDBViewerPreferencesFollowTheReaderToTheirNextDevice(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPA", "viewer-pref-a.example.com", "Viewer Pref A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPA", "member-viewer-pref-a@example.com", "Member A", "tenant_member")
	client := env.authClient()

	saved, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, tokenFor(t, tenant, member), proto.Bool(true)))
	if err != nil {
		t.Fatalf("UpdateViewerPreferences: %v", err)
	}
	if !saved.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("saved wide_viewer_enabled = false, want true")
	}

	// A second session of the same account, which is all the reader's next
	// device shares with the one they made the setting on.
	read, err := client.GetViewerPreferences(context.Background(), getViewerPreferencesRequest(tenant, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("GetViewerPreferences from another session: %v", err)
	}
	if !read.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("read wide_viewer_enabled = false, want the stored true")
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM user_viewer_preferences WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 1 {
		t.Fatalf("viewer preference rows = %d, want 1", got)
	}
}

func TestDBViewerPreferencesAnswerTheDefaultsWhenNothingWasSaved(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPB", "viewer-pref-b.example.com", "Viewer Pref B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPB", "member-viewer-pref-b@example.com", "Member B", "tenant_member")

	read, err := env.authClient().GetViewerPreferences(context.Background(), getViewerPreferencesRequest(tenant, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("GetViewerPreferences for a reader who saved nothing: %v", err)
	}
	if read.Msg.Preferences == nil {
		t.Fatalf("preferences = nil, want the defaults")
	}
	if read.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("default wide_viewer_enabled = true, want false")
	}
	// Reading saves nothing: the defaults are an answer, not a row.
	if got := env.countRows(t, "SELECT COUNT(*) FROM user_viewer_preferences WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 0 {
		t.Fatalf("viewer preference rows after a read = %d, want 0", got)
	}
}

// The defaults are written in three places — the column defaults, the insert
// branch of UpsertUserViewerPreferences, and defaultViewerPreferences — because
// a VALUES list cannot ask for a column default conditionally. This is what
// fails when they stop agreeing.
func TestDBViewerPreferenceDefaultsAgreeAcrossPaths(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPC", "viewer-pref-c.example.com", "Viewer Pref C")
	unsaved := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPC", "member-viewer-pref-c@example.com", "Member C", "tenant_member")
	inserted := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPD", "member-viewer-pref-d@example.com", "Member D", "tenant_member")
	client := env.authClient()

	fromDefaults, err := client.GetViewerPreferences(context.Background(), getViewerPreferencesRequest(tenant, tokenFor(t, tenant, unsaved)))
	if err != nil {
		t.Fatalf("GetViewerPreferences for a reader who saved nothing: %v", err)
	}

	// An update naming no preference at all, so the row is created from the
	// insert branch's defaults alone.
	fromInsert, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, tokenFor(t, tenant, inserted), nil))
	if err != nil {
		t.Fatalf("UpdateViewerPreferences naming no preference: %v", err)
	}

	if got, want := fromInsert.Msg.Preferences.GetWideViewerEnabled(), fromDefaults.Msg.Preferences.GetWideViewerEnabled(); got != want {
		t.Fatalf("inserted wide_viewer_enabled = %t, want the default %t the unsaved reader reads", got, want)
	}
}

func TestDBViewerPreferencesKeepThePreferencesAnUpdateOmits(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPE", "viewer-pref-e.example.com", "Viewer Pref E")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPE", "member-viewer-pref-e@example.com", "Member E", "tenant_member")
	client := env.authClient()
	token := tokenFor(t, tenant, member)

	if _, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, token, proto.Bool(true))); err != nil {
		t.Fatalf("UpdateViewerPreferences: %v", err)
	}

	kept, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, token, nil))
	if err != nil {
		t.Fatalf("UpdateViewerPreferences naming no preference: %v", err)
	}
	if !kept.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("wide_viewer_enabled = false after an update that omitted it, want the stored true")
	}

	off, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, token, proto.Bool(false)))
	if err != nil {
		t.Fatalf("UpdateViewerPreferences turning the setting off: %v", err)
	}
	if off.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("wide_viewer_enabled = true after the reader turned it off")
	}
}

func TestDBViewerPreferencesAreMemberScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPF", "viewer-pref-f.example.com", "Viewer Pref F")
	first := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPF", "member-viewer-pref-f@example.com", "Member F", "tenant_member")
	second := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPG", "member-viewer-pref-g@example.com", "Member G", "tenant_member")
	// The insert below is aimed at a reader who has saved nothing, so the row it
	// writes collides with no primary key: a policy that stopped refusing the
	// write would be the only thing left that could refuse it.
	unsaved := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPJ", "member-viewer-pref-j@example.com", "Member J", "tenant_member")
	client := env.authClient()

	if _, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, tokenFor(t, tenant, first), proto.Bool(true))); err != nil {
		t.Fatalf("UpdateViewerPreferences as the first member: %v", err)
	}

	otherRead, err := client.GetViewerPreferences(context.Background(), getViewerPreferencesRequest(tenant, tokenFor(t, tenant, second)))
	if err != nil {
		t.Fatalf("GetViewerPreferences as the second member: %v", err)
	}
	if otherRead.Msg.Preferences.GetWideViewerEnabled() {
		t.Fatalf("second member read the first member's wide_viewer_enabled")
	}

	env.withTenantConn(t, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", second.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_viewer_preferences").Scan(&visible); err != nil {
			t.Fatalf("count viewer preferences: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other member visible viewer preferences = %d, want 0", visible)
		}
		created, err := conn.ExecContext(ctx,
			"INSERT INTO user_viewer_preferences (tenant_id, user_id, wide_viewer_enabled) VALUES ($1, $2, false)",
			tenant.ID, unsaved.ID,
		)
		if err == nil {
			t.Fatalf("write another member's preference succeeded: %#v", created)
		}
		// The SQLSTATE rather than any error, so a constraint the row happened to
		// break cannot stand in for the policy that has to refuse it.
		assertInsufficientPrivilege(t, err, "write another member's preference")
		updated, err := conn.ExecContext(ctx,
			"UPDATE user_viewer_preferences SET wide_viewer_enabled = false WHERE tenant_id = $1 AND user_id = $2",
			tenant.ID, first.ID,
		)
		if err != nil {
			t.Fatalf("attempt to update another member preference: %v", err)
		}
		if changed, err := updated.RowsAffected(); err != nil {
			t.Fatalf("other member update rows affected: %v", err)
		} else if changed != 0 {
			t.Fatalf("other member updated %d viewer preferences, want 0", changed)
		}
	})
}

func TestDBViewerPreferencesAreTenantScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPH", "member-viewer-pref-h@example.com", "Member H", "tenant_member")

	if _, err := env.authClient().UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, tokenFor(t, tenant, member), proto.Bool(true))); err != nil {
		t.Fatalf("UpdateViewerPreferences: %v", err)
	}

	// The other tenant's connection carries the same member id, which is the
	// only thing member isolation would match on: the tenant half of the policy
	// is what has to hide the row.
	env.withTenantConn(t, otherTenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", member.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_viewer_preferences").Scan(&visible); err != nil {
			t.Fatalf("count viewer preferences: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other tenant visible viewer preferences = %d, want 0", visible)
		}
	})
}

func TestDBViewerPreferencesNeedASession(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTVPI", "viewer-pref-i.example.com", "Viewer Pref I")
	client := env.authClient()

	_, err := client.GetViewerPreferences(context.Background(), connect.NewRequest(&publirav1.GetViewerPreferencesRequest{Tenant: tenantContext(tenant)}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetViewerPreferences without a session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.UpdateViewerPreferences(context.Background(), connect.NewRequest(&publirav1.UpdateViewerPreferencesRequest{
		Tenant:            tenantContext(tenant),
		WideViewerEnabled: proto.Bool(true),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdateViewerPreferences without a session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateViewerPreferencesChargesTheReaderAllowance(t *testing.T) {
	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.Community.ViewerPreferencesUpdate = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	}))
	tenant := env.seedTenant(t, "TENANTVPJ", "viewer-pref-j.example.com", "Viewer Pref J")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERVPI", "member-viewer-pref-i@example.com", "Member I", "tenant_member")
	client := env.authClient()
	token := tokenFor(t, tenant, member)

	for range 2 {
		if _, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, token, proto.Bool(true))); err != nil {
			t.Fatalf("UpdateViewerPreferences within the allowance: %v", err)
		}
	}
	_, err := client.UpdateViewerPreferences(context.Background(), updateViewerPreferencesRequest(tenant, token, proto.Bool(false)))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("UpdateViewerPreferences past the allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}
