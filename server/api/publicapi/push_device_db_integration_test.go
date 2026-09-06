package publicapi

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

func TestDBPushDeviceMovesToTheReaderWhoRegistersItLast(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	first := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "first@tenant-a.example.com", "First")
	second := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "second@tenant-a.example.com", "Second")

	client := env.notificationClient()
	for _, user := range []struct {
		id    uuid.UUID
		token string
	}{{id: first.ID, token: tokenFor(t, tenant, first)}, {id: second.ID, token: tokenFor(t, tenant, second)}} {
		if _, err := client.RegisterPushDevice(context.Background(), newBearerRequest(&publirav1.RegisterPushDeviceRequest{
			Tenant:   tenantContext(tenant),
			Token:    "shared-device-token",
			Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
		}, user.token)); err != nil {
			t.Fatalf("RegisterPushDevice: %v", err)
		}
	}

	devices := listPushDeviceRows(t, env)
	if len(devices) != 1 {
		t.Fatalf("user_push_devices = %d, want 1", len(devices))
	}
	if devices[0].UserID != second.ID {
		t.Fatalf("device owner = %s, want the reader who registered last (%s)", devices[0].UserID, second.ID)
	}
}

func TestDBPushDeviceIsListedForTheNotificationsItsOwnerHolds(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")

	notificationID := insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)
	insertTenantNotification(t, env, tenant.ID, other.ID, "episode_published", "episode:E002", `{"episode_id":"E002"}`)

	client := env.notificationClient()
	if _, err := client.RegisterPushDevice(context.Background(), newBearerRequest(&publirav1.RegisterPushDeviceRequest{
		Tenant:   tenantContext(tenant),
		Token:    "member-device",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_IOS,
	}, tokenFor(t, tenant, member))); err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}
	if _, err := client.RegisterPushDevice(context.Background(), newBearerRequest(&publirav1.RegisterPushDeviceRequest{
		Tenant:   tenantContext(tenant),
		Token:    "other-device",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	}, tokenFor(t, tenant, other))); err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := dbmodels.New(env.PG.DB).ListPushDevicesForNotification(ctx, dbmodels.ListPushDevicesForNotificationParams{
		TenantID:         tenant.ID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:E001",
	})
	if err != nil {
		t.Fatalf("ListPushDevicesForNotification: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("devices = %d, want only the member's", len(rows))
	}
	if rows[0].Token != "member-device" || rows[0].NotificationID != notificationID {
		t.Fatalf("device = %+v, want member-device mirroring %s", rows[0], notificationID)
	}
}

func TestDBUnregisterPushDeviceLeavesAnotherReadersToken(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")

	client := env.notificationClient()
	if _, err := client.RegisterPushDevice(context.Background(), newBearerRequest(&publirav1.RegisterPushDeviceRequest{
		Tenant:   tenantContext(tenant),
		Token:    "other-device",
		Platform: publirav1.PushPlatform_PUSH_PLATFORM_ANDROID,
	}, tokenFor(t, tenant, other))); err != nil {
		t.Fatalf("RegisterPushDevice: %v", err)
	}

	resp, err := client.UnregisterPushDevice(context.Background(), newBearerRequest(&publirav1.UnregisterPushDeviceRequest{
		Tenant: tenantContext(tenant),
		Token:  "other-device",
	}, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("UnregisterPushDevice: %v", err)
	}
	if resp.Msg.Unregistered {
		t.Fatal("unregistered = true, want false for a token the caller does not hold")
	}
	if devices := listPushDeviceRows(t, env); len(devices) != 1 {
		t.Fatalf("user_push_devices = %d, want the other reader's row to survive", len(devices))
	}
}

func listPushDeviceRows(t *testing.T, env *publicDBEnv) []dbmodels.UserPushDevice {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := env.PG.DB.QueryContext(ctx, `
		SELECT tenant_id, user_id, token, platform, created_at, updated_at
		FROM user_push_devices
		ORDER BY token
	`)
	if err != nil {
		t.Fatalf("list user_push_devices: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var devices []dbmodels.UserPushDevice
	for rows.Next() {
		var device dbmodels.UserPushDevice
		if err := rows.Scan(
			&device.TenantID,
			&device.UserID,
			&device.Token,
			&device.Platform,
			&device.CreatedAt,
			&device.UpdatedAt,
		); err != nil {
			t.Fatalf("scan user_push_device: %v", err)
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("user_push_devices: %v", err)
	}
	return devices
}
