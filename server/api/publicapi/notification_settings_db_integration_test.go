package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func updateNotificationSettingsRequest(tenant testutil.Tenant, enabled bool) *publirav1.UpdateNotificationSettingsRequest {
	return &publirav1.UpdateNotificationSettingsRequest{Tenant: tenantContext(tenant), EmailNotificationsEnabled: enabled}
}

func TestDBUpdateNotificationSettingsChargesTheReaderAllowance(t *testing.T) {
	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.Community.NotificationSettingsUpdate = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	}))
	tenant := env.seedTenant(t, "TENANTNSA", "notification-settings-a.example.com", "Notification Settings A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNSA", "member-notification-settings-a@example.com", "Member A", "tenant_member")
	client := env.authClient()
	token := tokenFor(t, tenant, member)

	for _, enabled := range []bool{true, false} {
		if _, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), token), updateNotificationSettingsRequest(tenant, enabled)); err != nil {
			t.Fatalf("UpdateNotificationSettings within the allowance: %v", err)
		}
	}
	_, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), token), updateNotificationSettingsRequest(tenant, true))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("UpdateNotificationSettings past the allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM user_notification_settings WHERE tenant_id = $1 AND user_id = $2 AND email_notifications_enabled", tenant.ID, member.ID); got != 0 {
		t.Fatalf("settings rows switched on after the refused request = %d, want 0", got)
	}
}

// A tenant's own override is stricter than the platform's and is what the
// reader runs into first.
func TestDBUpdateNotificationSettingsFollowsTheTenantOverride(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTNSB", "notification-settings-b.example.com", "Notification Settings B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNSB", "member-notification-settings-b@example.com", "Member B", "tenant_member")
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"INSERT INTO tenant_community_limit_overrides (tenant_id, notification_settings_limit_per_minute, notification_settings_limit_per_day) VALUES ($1, 1, 1)",
		tenant.ID,
	); err != nil {
		t.Fatalf("seed the tenant override: %v", err)
	}
	client := env.authClient()
	token := tokenFor(t, tenant, member)

	if _, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), token), updateNotificationSettingsRequest(tenant, false)); err != nil {
		t.Fatalf("UpdateNotificationSettings within the tenant's allowance: %v", err)
	}
	_, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), token), updateNotificationSettingsRequest(tenant, true))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("UpdateNotificationSettings past the tenant's allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

func getNotificationSettingsRequest(tenant testutil.Tenant) *publirav1.GetNotificationSettingsRequest {
	return &publirav1.GetNotificationSettingsRequest{Tenant: tenantContext(tenant)}
}

// allNotificationPreferencesOn is the grid of a reader who has turned nothing
// off, which is what a reader who has saved nothing reads.
func allNotificationPreferencesOn() *publirav1.NotificationPreferences {
	return &publirav1.NotificationPreferences{
		FollowedEpisodesInboxEnabled:      true,
		FollowedEpisodesWebPushEnabled:    true,
		FollowedEpisodesMobilePushEnabled: true,
		FollowedCreatorsInboxEnabled:      true,
		FollowedCreatorsWebPushEnabled:    true,
		FollowedCreatorsMobilePushEnabled: true,
		CommentsInboxEnabled:              true,
		AnnouncementsInboxEnabled:         true,
	}
}

func assertNotificationPreferences(t *testing.T, label string, got, want *publirav1.NotificationPreferences) {
	t.Helper()
	if !proto.Equal(got, want) {
		t.Fatalf("%s preferences = %v, want %v", label, got, want)
	}
}

func TestDBNotificationSettingsAnswerEveryCellOnWhenNothingWasSaved(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTNPA", "notification-pref-a.example.com", "Notification Pref A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPA", "member-notification-pref-a@example.com", "Member A", "tenant_member")

	read, err := env.authClient().GetNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, member)), getNotificationSettingsRequest(tenant))
	if err != nil {
		t.Fatalf("GetNotificationSettings for a reader who saved nothing: %v", err)
	}
	if !read.GetEmailNotificationsEnabled() {
		t.Fatal("email_notifications_enabled = false, want true")
	}
	assertNotificationPreferences(t, "default", read.GetPreferences(), allNotificationPreferencesOn())
	// Reading saves nothing: the defaults are an answer, not a row.
	if got := env.countRows(t, "SELECT COUNT(*) FROM user_notification_settings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 0 {
		t.Fatalf("notification settings rows after a read = %d, want 0", got)
	}
}

func TestDBNotificationSettingsRoundTripAGridWithOneCellOff(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTNPB", "notification-pref-b.example.com", "Notification Pref B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPB", "member-notification-pref-b@example.com", "Member B", "tenant_member")
	client := env.authClient()

	saved, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, member)), &publirav1.UpdateNotificationSettingsRequest{
		Tenant:                            tenantContext(tenant),
		EmailNotificationsEnabled:         true,
		FollowedEpisodesInboxEnabled:      proto.Bool(true),
		FollowedEpisodesWebPushEnabled:    proto.Bool(true),
		FollowedEpisodesMobilePushEnabled: proto.Bool(false),
		FollowedCreatorsInboxEnabled:      proto.Bool(true),
		FollowedCreatorsWebPushEnabled:    proto.Bool(true),
		FollowedCreatorsMobilePushEnabled: proto.Bool(true),
		CommentsInboxEnabled:              proto.Bool(true),
		AnnouncementsInboxEnabled:         proto.Bool(true),
	})
	if err != nil {
		t.Fatalf("UpdateNotificationSettings: %v", err)
	}
	want := allNotificationPreferencesOn()
	want.FollowedEpisodesMobilePushEnabled = false
	assertNotificationPreferences(t, "saved", saved.GetPreferences(), want)

	read, err := client.GetNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, member)), getNotificationSettingsRequest(tenant))
	if err != nil {
		t.Fatalf("GetNotificationSettings from another session: %v", err)
	}
	assertNotificationPreferences(t, "read back", read.GetPreferences(), want)
	if !read.GetEmailNotificationsEnabled() {
		t.Fatal("email_notifications_enabled = false, want the true the update saved")
	}
}

// A client that shows only some of the cells, as one released before a cell
// existed does, writes those and leaves the rest as the reader set them.
func TestDBNotificationSettingsKeepTheCellsAnUpdateOmits(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTNPC", "notification-pref-c.example.com", "Notification Pref C")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPC", "member-notification-pref-c@example.com", "Member C", "tenant_member")
	client := env.authClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, member))

	if _, err := client.UpdateNotificationSettings(ctx, &publirav1.UpdateNotificationSettingsRequest{
		Tenant:                       tenantContext(tenant),
		EmailNotificationsEnabled:    true,
		FollowedCreatorsInboxEnabled: proto.Bool(false),
	}); err != nil {
		t.Fatalf("UpdateNotificationSettings turning one cell off: %v", err)
	}

	kept, err := client.UpdateNotificationSettings(ctx, &publirav1.UpdateNotificationSettingsRequest{
		Tenant:                    tenantContext(tenant),
		EmailNotificationsEnabled: false,
	})
	if err != nil {
		t.Fatalf("UpdateNotificationSettings naming no cell: %v", err)
	}
	want := allNotificationPreferencesOn()
	want.FollowedCreatorsInboxEnabled = false
	assertNotificationPreferences(t, "kept", kept.GetPreferences(), want)
	if kept.GetEmailNotificationsEnabled() {
		t.Fatal("email_notifications_enabled = true, want the false the update named")
	}
}

// The defaults are written in three places — the column defaults, the insert
// branch of UpsertUserNotificationSettings, and defaultNotificationPreferences
// — because a VALUES list cannot ask for a column default conditionally. This
// is what fails when they stop agreeing.
func TestDBNotificationPreferenceDefaultsAgreeAcrossPaths(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTNPD", "notification-pref-d.example.com", "Notification Pref D")
	unsaved := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPD", "member-notification-pref-d@example.com", "Member D", "tenant_member")
	inserted := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPE", "member-notification-pref-e@example.com", "Member E", "tenant_member")
	columns := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERNPF", "member-notification-pref-f@example.com", "Member F", "tenant_member")
	client := env.authClient()

	fromDefaults, err := client.GetNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, unsaved)), getNotificationSettingsRequest(tenant))
	if err != nil {
		t.Fatalf("GetNotificationSettings for a reader who saved nothing: %v", err)
	}

	// An update naming no cell at all, so the row is created from the insert
	// branch's defaults alone.
	fromInsert, err := client.UpdateNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, inserted)), &publirav1.UpdateNotificationSettingsRequest{
		Tenant:                    tenantContext(tenant),
		EmailNotificationsEnabled: true,
	})
	if err != nil {
		t.Fatalf("UpdateNotificationSettings naming no cell: %v", err)
	}
	assertNotificationPreferences(t, "inserted", fromInsert.GetPreferences(), fromDefaults.GetPreferences())

	// A row written with the columns' own defaults.
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"INSERT INTO user_notification_settings (tenant_id, user_id) VALUES ($1, $2)", tenant.ID, columns.ID,
	); err != nil {
		t.Fatalf("insert a row of column defaults: %v", err)
	}
	fromColumns, err := client.GetNotificationSettings(testutil.WithBearer(context.Background(), tokenFor(t, tenant, columns)), getNotificationSettingsRequest(tenant))
	if err != nil {
		t.Fatalf("GetNotificationSettings for a row of column defaults: %v", err)
	}
	assertNotificationPreferences(t, "column default", fromColumns.GetPreferences(), fromDefaults.GetPreferences())
}
