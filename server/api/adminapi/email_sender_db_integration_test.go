package adminapi

import (
	"context"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
)

func (e *adminDBEnv) emailSettingsClient() publiraadminv1connect.AdminEmailSettingsServiceClient {
	return publiraadminv1connect.NewAdminEmailSettingsServiceClient(e.Server.Client(), e.Server.URL)
}

func getDBEmailSender(t *testing.T, env *adminDBEnv, tenant adminDBTenant) string {
	t.Helper()
	resp, err := env.emailSettingsClient().GetTenantEmailSender(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantEmailSenderRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantEmailSender: %v", err)
	}
	return resp.Msg.FromAddress
}

// savePlatformSMTP stores the platform relay as the platform console would,
// through the superuser connection, since the admin role may not write it.
func savePlatformSMTP(t *testing.T, env *adminDBEnv, fromAddress string) {
	t.Helper()
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO platform_smtp_config (host, port, username, password_encrypted, encryption, from_address)
		VALUES ('smtp.platform.example.com', 587, 'platform', 'sealed', 'starttls', $1)
	`, fromAddress); err != nil {
		t.Fatalf("save the platform smtp settings: %v", err)
	}
}

func saveTenantSMTP(t *testing.T, env *adminDBEnv, tenant adminDBTenant, overrideEnabled bool, fromAddress string) {
	t.Helper()
	if _, err := env.emailSettingsClient().UpdateTenantEmailSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantEmailSettingsRequest{
		Tenant:              tenant.tenantContext(),
		SmtpOverrideEnabled: overrideEnabled,
		Host:                "smtp.tenant.example.com",
		Port:                587,
		Username:            "tenant",
		PasswordUpdateMode:  publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		Password:            "tenant-password",
		Encryption:          "starttls",
		FromAddress:         fromAddress,
	})); err != nil {
		t.Fatalf("UpdateTenantEmailSettings: %v", err)
	}
}

// A tenant that overrides nothing is mailed from the platform relay, so that
// is the address it is told, read on the admin role's column grant.
func TestDBEmailSenderIsThePlatformsWithoutTheTenantsOwnSMTP(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	if got := getDBEmailSender(t, env, tenant); got != "" {
		t.Fatalf("from_address with nothing saved = %q, want empty", got)
	}

	savePlatformSMTP(t, env, "noreply@platform.example.com")
	if got, want := getDBEmailSender(t, env, tenant), "noreply@platform.example.com"; got != want {
		t.Fatalf("from_address = %q, want the platform's %q", got, want)
	}
}

// A tenant's own settings decide the sender only while its override is on:
// switched off, they are kept but the mail goes out over the platform relay.
func TestDBEmailSenderFollowsTheTenantsOverride(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	savePlatformSMTP(t, env, "noreply@platform.example.com")

	saveTenantSMTP(t, env, tenant, true, "news@tenant-a.example.com")
	if got, want := getDBEmailSender(t, env, tenant), "news@tenant-a.example.com"; got != want {
		t.Fatalf("from_address with the override on = %q, want the tenant's %q", got, want)
	}

	saveTenantSMTP(t, env, tenant, false, "news@tenant-a.example.com")
	if got, want := getDBEmailSender(t, env, tenant), "noreply@platform.example.com"; got != want {
		t.Fatalf("from_address with the override off = %q, want the platform's %q", got, want)
	}
}
