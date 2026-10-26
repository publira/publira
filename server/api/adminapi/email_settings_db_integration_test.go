package adminapi

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/emailsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// relayOverride is a tenant override naming a relay, with the credentials
// left to each case.
func relayOverride(tenant adminDBTenant, username string, mode publiraadminv1.SecretUpdateMode, password string) *publiraadminv1.UpdateTenantEmailSettingsRequest {
	return &publiraadminv1.UpdateTenantEmailSettingsRequest{
		Tenant:              tenant.tenantContext(),
		SmtpOverrideEnabled: true,
		Host:                "relay.tenant.example.com",
		Port:                25,
		Username:            username,
		PasswordUpdateMode:  mode,
		Password:            password,
		Encryption:          "none",
		FromAddress:         "mail@tenant.example.com",
	}
}

func updateDBTenantEmailSettings(env *adminDBEnv, tenant adminDBTenant, req *publiraadminv1.UpdateTenantEmailSettingsRequest) (*publiraadminv1.UpdateTenantEmailSettingsResponse, error) {
	return env.emailSettingsClient().UpdateTenantEmailSettings(testutil.WithBearer(context.Background(), tenant.token()), req)
}

func assertRefusedOn(t *testing.T, err error, field string, want error) {
	t.Helper()
	connectErr, ok := errors.AsType[*connect.Error](err)
	if !ok || connectErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if got := violatedField(t, connectErr); got != field {
		t.Fatalf("violated field = %q, want %q", got, field)
	}
	if connectErr.Message() != want.Error() {
		t.Fatalf("message = %q, want %q", connectErr.Message(), want.Error())
	}
}

// A tenant's own SMTP server may be a relay that takes no credentials, saved
// with neither a username nor a password.
func TestDBTenantSMTPOverrideSavesWithoutCredentials(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for _, mode := range []publiraadminv1.SecretUpdateMode{
		publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
		publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_CLEAR,
	} {
		resp, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "", mode, ""))
		if err != nil {
			t.Fatalf("UpdateTenantEmailSettings(%v): %v", mode, err)
		}
		if got := resp.Settings; !got.SmtpOverrideEnabled || got.Username != "" || got.HasPassword {
			t.Fatalf("saved settings (%v) = %v, want the override on with no credentials", mode, got)
		}
	}
}

// A password has no username to be sent with, whether it is given with the
// save or kept from the one before.
func TestDBTenantSMTPOverrideRefusesAPasswordWithoutAUsername(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, "relay-password"))
	assertRefusedOn(t, err, emailsettings.FieldUsername, emailsettings.ErrPasswordWithoutUsername)

	if _, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "mailer", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, "mailer-password")); err != nil {
		t.Fatalf("UpdateTenantEmailSettings(with credentials): %v", err)
	}
	_, err = updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED, ""))
	assertRefusedOn(t, err, emailsettings.FieldUsername, emailsettings.ErrPasswordWithoutUsername)

	// Clearing the stored password is how saved credentials move to a relay
	// that takes none.
	resp, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_CLEAR, ""))
	if err != nil {
		t.Fatalf("UpdateTenantEmailSettings(clear): %v", err)
	}
	if resp.Settings.Username != "" || resp.Settings.HasPassword {
		t.Fatalf("saved settings = %v, want no credentials", resp.Settings)
	}
}

// A username still needs the password it signs in with.
func TestDBTenantSMTPOverrideRefusesAUsernameWithoutAPassword(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "mailer", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_CLEAR, ""))
	assertRefusedOn(t, err, emailsettings.FieldPassword, emailsettings.ErrPasswordRequired)
}
