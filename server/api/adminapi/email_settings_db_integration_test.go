package adminapi

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

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

// The stored password is kept only for the server it was saved for, whether or
// not the override is on: a save that names another host, port, username, or
// encryption and states no password is refused on the password and leaves the
// settings as they were.
func TestDBTenantSMTPSaveOfAnotherServerKeepsTheStoredPassword(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	saved, err := updateDBTenantEmailSettings(env, tenant, relayOverride(tenant, "mailer", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, "mailer-password"))
	if err != nil {
		t.Fatalf("UpdateTenantEmailSettings(with credentials): %v", err)
	}

	for _, tc := range []struct {
		name   string
		change func(*publiraadminv1.UpdateTenantEmailSettingsRequest)
	}{
		{name: "another host", change: func(r *publiraadminv1.UpdateTenantEmailSettingsRequest) { r.Host = "relay.elsewhere.example" }},
		{name: "another port", change: func(r *publiraadminv1.UpdateTenantEmailSettingsRequest) { r.Port = 2525 }},
		{name: "another username", change: func(r *publiraadminv1.UpdateTenantEmailSettingsRequest) { r.Username = "someone-else" }},
		{name: "another encryption", change: func(r *publiraadminv1.UpdateTenantEmailSettingsRequest) { r.Encryption = "starttls" }},
	} {
		for _, overrideEnabled := range []bool{true, false} {
			for _, mode := range []publiraadminv1.SecretUpdateMode{
				publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNSPECIFIED,
				publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
			} {
				req := relayOverride(tenant, "mailer", mode, "")
				req.SmtpOverrideEnabled = overrideEnabled
				tc.change(req)
				_, err := updateDBTenantEmailSettings(env, tenant, req)
				connectErr, ok := errors.AsType[*connect.Error](err)
				if !ok || connectErr.Code() != connect.CodeInvalidArgument || violatedField(t, connectErr) != emailsettings.FieldPassword {
					t.Fatalf("%s, override %v, %v: UpdateTenantEmailSettings = %v, want invalid_argument on password", tc.name, overrideEnabled, mode, err)
				}
			}
		}
	}
	got, err := env.emailSettingsClient().GetTenantEmailSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantEmailSettingsRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantEmailSettings: %v", err)
	}
	if !proto.Equal(got.Settings, saved.Settings) {
		t.Fatalf("settings = %v, want them left as %v", got.Settings, saved.Settings)
	}

	// The password stated again goes with the server it is saved beside.
	moved := relayOverride(tenant, "mailer", publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, "mailer-password")
	moved.Host = "relay.elsewhere.example"
	resp, err := updateDBTenantEmailSettings(env, tenant, moved)
	if err != nil {
		t.Fatalf("UpdateTenantEmailSettings(another host with the password): %v", err)
	}
	if resp.Settings.Host != "relay.elsewhere.example" || !resp.Settings.HasPassword {
		t.Fatalf("saved settings = %v, want the other host with a password", resp.Settings)
	}
}
