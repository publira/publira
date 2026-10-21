package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

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
