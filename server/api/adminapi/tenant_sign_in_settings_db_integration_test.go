package adminapi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testSignInServicesID  = "com.example.reader.web"
	testSignInWebClientID = "123-web.apps.googleusercontent.com"
	testSignInIOSClientID = "123-ios.apps.googleusercontent.com"
)

func updateDBSignInSettings(env *adminDBEnv, tenant adminDBTenant, req *publiraadminv1.UpdateTenantSignInSettingsRequest) (*publiraadminv1.TenantSignInSettings, error) {
	req.Tenant = tenant.tenantContext()
	resp, err := env.tenantSettingsClient().UpdateTenantSignInSettings(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		return nil, err
	}
	return resp.Settings, nil
}

// An administrator stores the Sign in with Apple key and the Google clients,
// and reads the key back as a hint only.
func TestDBSignInSettingsAreStoredAndReadBackMasked(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	keyPEM := signintest.PrivateKeyPEM(t)

	saved, err := updateDBSignInSettings(env, tenant, &publiraadminv1.UpdateTenantSignInSettingsRequest{
		Apple: &publiraadminv1.AppleSignInSettingsUpdate{
			Enabled:              true,
			ServicesId:           testSignInServicesID,
			TeamId:               "TEAM123456",
			KeyId:                "KEY1234567",
			PrivateKeyUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
			PrivateKey:           keyPEM,
		},
		Google: &publiraadminv1.GoogleSignInSettingsUpdate{
			Enabled:     true,
			WebClientId: testSignInWebClientID,
			IosClientId: testSignInIOSClientID,
		},
	})
	if err != nil {
		t.Fatalf("UpdateTenantSignInSettings: %v", err)
	}
	if !saved.Apple.Ready || !saved.Apple.PrivateKeyConfigured || saved.Apple.PrivateKeyHint == "" || !saved.Google.Ready {
		t.Fatalf("saved = %v, want both providers ready", saved)
	}

	got, err := env.tenantSettingsClient().GetTenantSignInSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantSignInSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantSignInSettings: %v", err)
	}
	body, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal the response: %v", err)
	}
	keyBody := strings.Join(strings.Split(strings.TrimSpace(keyPEM), "\n")[1:2], "")
	if strings.Contains(string(body), keyBody) {
		t.Fatal("GetTenantSignInSettings answered the private key")
	}
	if got.Settings.Apple.ServicesId != testSignInServicesID || got.Settings.Google.IosClientId != testSignInIOSClientID {
		t.Fatalf("settings = %v", got.Settings)
	}

	stored := env.countRows(t, "SELECT count(*) FROM tenant_apple_sign_in_config WHERE tenant_id = $1 AND private_key_encrypted LIKE 'enc:%'", tenant.Tenant.ID)
	if stored != 1 {
		t.Fatalf("sealed apple keys = %d, want 1", stored)
	}
	audited := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2", tenant.Tenant.ID, signin.ActionSettingsUpdated)
	if audited != 1 {
		t.Fatalf("audit entries = %d, want 1", audited)
	}
}

func TestDBSignInSettingsRefuseAnEnabledProviderMissingWhatItNeeds(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for _, tc := range []struct {
		name string
		req  *publiraadminv1.UpdateTenantSignInSettingsRequest
	}{
		{name: "apple without a key", req: &publiraadminv1.UpdateTenantSignInSettingsRequest{
			Apple: &publiraadminv1.AppleSignInSettingsUpdate{Enabled: true, ServicesId: testSignInServicesID, TeamId: "TEAM123456", KeyId: "KEY1234567"},
		}},
		{name: "google without a client", req: &publiraadminv1.UpdateTenantSignInSettingsRequest{
			Google: &publiraadminv1.GoogleSignInSettingsUpdate{Enabled: true},
		}},
		{name: "a key that is not one", req: &publiraadminv1.UpdateTenantSignInSettingsRequest{
			Apple: &publiraadminv1.AppleSignInSettingsUpdate{
				PrivateKeyUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
				PrivateKey:           "not a key",
			},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := updateDBSignInSettings(env, tenant, tc.req); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdateTenantSignInSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// A reader deleted from the console takes their links with them, so the Apple
// token a link held is queued for revocation first.
func TestDBAdminDeleteReaderQueuesTheRevocationOfItsAppleToken(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RDLTENANT001", "reader-delete.example.com", "Delete", "RDLADMIN0001", "admin@reader-delete.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RDLREADER001", "reader@reader-delete.example.com", "Reader")
	if _, err := env.PG.DB.Exec(`INSERT INTO user_identities (id, tenant_id, user_id, provider, subject, email_at_link, refresh_token_encrypted, refresh_token_client_id)
		VALUES ($1, $2, $3, 'apple', 'apple-subject', $4, 'enc:v1:k1:sealed', $5)`,
		uuid.Must(uuid.NewV7()), admin.Tenant.ID, reader.ID, reader.Email, testSignInServicesID); err != nil {
		t.Fatalf("seed the link: %v", err)
	}

	if _, err := env.userClient().DeleteReader(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.DeleteReaderRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: reader.ID.String(),
	}); err != nil {
		t.Fatalf("DeleteReader: %v", err)
	}

	queued := env.countRows(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 AND payload->>'refresh_token_encrypted' = 'enc:v1:k1:sealed' AND payload->>'client_id' = $3",
		admin.Tenant.ID, outbox.EventTypeAppleSignInTokenRevoke, testSignInServicesID)
	if queued != 1 {
		t.Fatalf("queued revocations = %d, want 1", queued)
	}
}
