package adminapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/inboundemail"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) inboundEmailClient() publiraadminv1connect.AdminInboundEmailSettingsServiceClient {
	return publiraadminv1connect.NewAdminInboundEmailSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

func updateDBInboundEmailSettings(env *adminDBEnv, tenant adminDBTenant, req *publiraadminv1.UpdateTenantInboundEmailSettingsRequest) (*publiraadminv1.TenantInboundEmailSettings, error) {
	req.Tenant = tenant.tenantContext()
	resp, err := env.inboundEmailClient().UpdateTenantInboundEmailSettings(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		return nil, err
	}
	return resp.Settings, nil
}

func getDBInboundEmailSettings(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantInboundEmailSettings {
	t.Helper()
	resp, err := env.inboundEmailClient().GetTenantInboundEmailSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantInboundEmailSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantInboundEmailSettings: %v", err)
	}
	return resp.Settings
}

func replaceInboundField(name, value string) *publiraadminv1.InboundEmailCredentialFieldUpdate {
	return &publiraadminv1.InboundEmailCredentialFieldUpdate{
		Name:  name,
		Mode:  publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		Value: value,
	}
}

func TestDBInboundEmailProvidersAreListedWithTheirFields(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	resp, err := env.inboundEmailClient().ListInboundEmailProviders(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListInboundEmailProvidersRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListInboundEmailProviders: %v", err)
	}
	providers := resp.Providers
	if len(providers) != 2 || providers[0].Id != resend.ID || providers[1].Id != sendgrid.ID {
		t.Fatalf("providers = %v, want resend and sendgrid in id order", providers)
	}
	if providers[1].WebhookPath != "/api/v1/webhook/email/sendgrid" {
		t.Errorf("webhook_path = %q", providers[1].WebhookPath)
	}
	if len(providers[1].Fields) != 1 || providers[1].Fields[0].Name != sendgrid.FieldWebhookToken || !providers[1].Fields[0].Secret || !providers[1].Fields[0].Required {
		t.Errorf("sendgrid fields = %v", providers[1].Fields)
	}
}

// An administrator stores Resend's credentials and a domain, reads them back
// as hints, and the change is audited without a value.
func TestDBInboundEmailSettingsAreStoredAndReadBackMasked(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	initial := getDBInboundEmailSettings(t, env, tenant)
	if initial.Provider != "" || initial.Enabled || initial.Ready || initial.Domain != "" {
		t.Fatalf("initial settings = %v, want nothing saved", initial)
	}

	saved, err := updateDBInboundEmailSettings(env, tenant, &publiraadminv1.UpdateTenantInboundEmailSettingsRequest{
		Provider: resend.ID,
		Enabled:  true,
		Domain:   "Reply.Tenant-A.example.com",
		Fields: []*publiraadminv1.InboundEmailCredentialFieldUpdate{
			replaceInboundField(resend.FieldAPIKey, "re_SecretApiKey9876"),
			replaceInboundField(resend.FieldWebhookSecret, "whsec_SigningSecret5432"),
		},
	})
	if err != nil {
		t.Fatalf("UpdateTenantInboundEmailSettings: %v", err)
	}
	if !saved.Ready || saved.Domain != "reply.tenant-a.example.com" {
		t.Fatalf("saved = %v, want ready on the lower-cased domain", saved)
	}
	for _, field := range saved.Fields {
		if !field.Configured || strings.Contains(field.Hint, "SecretApiKey") || strings.Contains(field.Hint, "SigningSecret") {
			t.Errorf("field %s = %v, want a masked hint", field.Name, field)
		}
	}
	read := getDBInboundEmailSettings(t, env, tenant)
	if !read.Ready || read.Provider != resend.ID || len(read.Fields) != 2 {
		t.Fatalf("read back = %v", read)
	}

	var reason string
	if err := env.PG.DB.QueryRowContext(context.Background(),
		`SELECT reason FROM audit_logs WHERE tenant_id = $1 AND action = $2`,
		tenant.Tenant.ID, inboundemail.ActionUpdated,
	).Scan(&reason); err != nil {
		t.Fatalf("read the audit record: %v", err)
	}
	if !strings.Contains(reason, "resend.api_key") || !strings.Contains(reason, "domain") || strings.Contains(reason, "SecretApiKey") {
		t.Errorf("audit reason = %q, want the fields touched and no value", reason)
	}

	// Leaving a field out keeps it, and switching the settings off keeps the
	// credentials for later.
	off, err := updateDBInboundEmailSettings(env, tenant, &publiraadminv1.UpdateTenantInboundEmailSettingsRequest{
		Provider: resend.ID,
		Domain:   "reply.tenant-a.example.com",
	})
	if err != nil {
		t.Fatalf("UpdateTenantInboundEmailSettings (off): %v", err)
	}
	if off.Ready || off.Enabled || !off.Fields[0].Configured {
		t.Fatalf("off = %v, want disabled with the credentials kept", off)
	}
}

func TestDBInboundEmailSettingsRefuseWhatCannotReceiveMail(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for name, req := range map[string]*publiraadminv1.UpdateTenantInboundEmailSettingsRequest{
		"no domain": {
			Provider: sendgrid.ID,
			Enabled:  true,
			Fields:   []*publiraadminv1.InboundEmailCredentialFieldUpdate{replaceInboundField(sendgrid.FieldWebhookToken, "token")},
		},
		"no token":            {Provider: sendgrid.ID, Enabled: true, Domain: "reply.example.com"},
		"an invalid domain":   {Provider: sendgrid.ID, Domain: "reply example com"},
		"an unknown provider": {Provider: "mailgun", Domain: "reply.example.com"},
		"an undeclared field": {
			Provider: sendgrid.ID,
			Fields:   []*publiraadminv1.InboundEmailCredentialFieldUpdate{replaceInboundField(resend.FieldAPIKey, "re_key")},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := updateDBInboundEmailSettings(env, tenant, req); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdateTenantInboundEmailSettings error = %v, want invalid_argument", err)
			}
		})
	}
	if settings := getDBInboundEmailSettings(t, env, tenant); settings.Provider != "" {
		t.Fatalf("a refused update stored %v", settings)
	}
}

// One tenant's settings are invisible to another tenant's administrator.
func TestDBInboundEmailSettingsStayOnTheirTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")

	if _, err := updateDBInboundEmailSettings(env, first, &publiraadminv1.UpdateTenantInboundEmailSettingsRequest{
		Provider: sendgrid.ID,
		Enabled:  true,
		Domain:   "reply.tenant-a.example.com",
		Fields:   []*publiraadminv1.InboundEmailCredentialFieldUpdate{replaceInboundField(sendgrid.FieldWebhookToken, "token")},
	}); err != nil {
		t.Fatalf("UpdateTenantInboundEmailSettings: %v", err)
	}
	if settings := getDBInboundEmailSettings(t, env, second); settings.Provider != "" || settings.Ready {
		t.Fatalf("the second tenant reads %v", settings)
	}
}
