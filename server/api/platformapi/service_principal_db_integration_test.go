package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/tenanttz"
)

const testWebServiceToken = "test-web-service-token"

func TestDBServiceTokenReadsTheTenantList(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	listed, err := client.ListTenants(t.Context(), newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(listed.Msg.Tenants) != 1 || listed.Msg.Tenants[0].PublicId != tenant.PublicID {
		t.Fatalf("tenants = %v, want the one seeded tenant", listed.Msg.Tenants)
	}

	// An operator's session keeps working beside the token.
	listed, err = client.ListTenants(t.Context(), newDBAuthedRequest(operator, publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants by the operator: %v", err)
	}
	if len(listed.Msg.Tenants) != 1 {
		t.Fatalf("tenants read by the operator = %d, want 1", len(listed.Msg.Tenants))
	}
}

// Every read on the allowlist has to answer without an operator behind the
// call, so a handler that starts reading the session fails here rather than in
// the console.
func TestDBServiceTokenAnswersEveryAllowlistedRead(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	endUser := pg.SeedEndUser(t, tenant.ID, "ENDUSER001", "reader@tenant-a.example.com", "Reader")
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	httpClient, url := ts.Client(), ts.URL
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(httpClient, url)
	policy := publirasplatformv1connect.NewPlatformPolicyServiceClient(httpClient, url)
	settings := publirasplatformv1connect.NewPlatformSettingsServiceClient(httpClient, url)
	email := publirasplatformv1connect.NewPlatformEmailSettingsServiceClient(httpClient, url)
	storage := publirasplatformv1connect.NewPlatformStorageSettingsServiceClient(httpClient, url)
	dashboard := publirasplatformv1connect.NewPlatformDashboardServiceClient(httpClient, url)
	operators := publirasplatformv1connect.NewPlatformOperatorServiceClient(httpClient, url)
	users := publirasplatformv1connect.NewPlatformUserServiceClient(httpClient, url)
	// A migrated database carries no settings row, which the read answers as
	// an error rather than as settings nobody saved.
	seedPlatformSettings(t, settings, operator, tenanttz.Default, "en")

	reads := map[string]func(context.Context) error{
		publirasplatformv1connect.PlatformTenantServiceListTenantsProcedure: func(ctx context.Context) error {
			_, err := tenants.ListTenants(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListTenantsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformTenantServiceGetTenantProcedure: func(ctx context.Context) error {
			_, err := tenants.GetTenant(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetTenantRequest{PublicId: tenant.PublicID}))
			return err
		},
		publirasplatformv1connect.PlatformTenantServiceListTenantMembersProcedure: func(ctx context.Context) error {
			_, err := tenants.ListTenantMembers(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListTenantMembersRequest{TenantId: tenant.ID.String()}))
			return err
		},
		publirasplatformv1connect.PlatformTenantServiceListTenantAdminInvitationsProcedure: func(ctx context.Context) error {
			_, err := tenants.ListTenantAdminInvitations(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListTenantAdminInvitationsRequest{TenantId: tenant.ID.String()}))
			return err
		},
		publirasplatformv1connect.PlatformPolicyServiceGetPlatformPolicyProcedure: func(ctx context.Context) error {
			_, err := policy.GetPlatformPolicy(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformPolicyRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformPolicyServiceGetPlatformRetentionDefaultsProcedure: func(ctx context.Context) error {
			_, err := policy.GetPlatformRetentionDefaults(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformRetentionDefaultsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformSettingsServiceGetPlatformSettingsProcedure: func(ctx context.Context) error {
			_, err := settings.GetPlatformSettings(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformSettingsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformEmailSettingsServiceGetPlatformEmailSettingsProcedure: func(ctx context.Context) error {
			_, err := email.GetPlatformEmailSettings(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformEmailSettingsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformStorageSettingsServiceGetPlatformStorageSettingsProcedure: func(ctx context.Context) error {
			_, err := storage.GetPlatformStorageSettings(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformStorageSettingsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformDashboardServiceGetDashboardSummaryProcedure: func(ctx context.Context) error {
			_, err := dashboard.GetDashboardSummary(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetDashboardSummaryRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformOperatorServiceListOperatorsProcedure: func(ctx context.Context) error {
			_, err := operators.ListOperators(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListOperatorsRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformOperatorServiceGetOperatorProcedure: func(ctx context.Context) error {
			_, err := operators.GetOperator(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetOperatorRequest{PublicId: operator.PublicID}))
			return err
		},
		publirasplatformv1connect.PlatformUserServiceListEndUsersProcedure: func(ctx context.Context) error {
			_, err := users.ListEndUsers(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListEndUsersRequest{}))
			return err
		},
		publirasplatformv1connect.PlatformUserServiceGetEndUserProcedure: func(ctx context.Context) error {
			_, err := users.GetEndUser(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetEndUserRequest{PublicId: endUser.PublicID}))
			return err
		},
	}
	for procedure := range serviceProcedures {
		if _, ok := reads[procedure]; !ok {
			t.Errorf("%s is on the allowlist but not exercised here", procedure)
		}
	}
	for procedure, read := range reads {
		t.Run(procedure, func(t *testing.T) {
			if err := read(t.Context()); err != nil {
				t.Fatalf("%s: %v", procedure, err)
			}
		})
	}
}

func TestDBServiceTokenIsRefusedOutsideTheAllowlist(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	httpClient, url := ts.Client(), ts.URL

	calls := map[string]func(context.Context) error{
		"creating a tenant": func(ctx context.Context) error {
			_, err := publirasplatformv1connect.NewPlatformTenantServiceClient(httpClient, url).CreateTenant(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.CreateTenantRequest{
				DefaultLocale: "en",
				Name:          "Tenant B",
				Domain:        "tenant-b.example.com",
			}))
			return err
		},
		"updating the platform policy": func(ctx context.Context) error {
			_, err := publirasplatformv1connect.NewPlatformPolicyServiceClient(httpClient, url).UpdatePlatformPolicy(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.UpdatePlatformPolicyRequest{}))
			return err
		},
		"a read that stores the key pair it generates": func(ctx context.Context) error {
			_, err := publirasplatformv1connect.NewPlatformWebPushSettingsServiceClient(httpClient, url).GetPlatformWebPushSettings(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.GetPlatformWebPushSettingsRequest{}))
			return err
		},
		"a read of the caller's own notifications": func(ctx context.Context) error {
			_, err := publirasplatformv1connect.NewPlatformNotificationServiceClient(httpClient, url).ListNotifications(ctx, newDBBearerRequest(testWebServiceToken, publirasplatformv1.ListNotificationsRequest{}))
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			if code := connect.CodeOf(call(t.Context())); code != connect.CodePermissionDenied {
				t.Fatalf("code = %v, want %v", code, connect.CodePermissionDenied)
			}
		})
	}
	var tenants int
	if err := pg.DB.QueryRowContext(t.Context(), "SELECT count(*) FROM tenants").Scan(&tenants); err != nil {
		t.Fatalf("count tenants: %v", err)
	}
	if tenants != 0 {
		t.Fatalf("tenants = %d, want the refused write to have stored none", tenants)
	}
}

func TestDBServiceTokenIsUnauthenticatedUnlessItIsTheConfiguredOne(t *testing.T) {
	tests := map[string]struct {
		configured *auth.ServiceToken
		bearer     string
	}{
		"a different token":          {configured: auth.NewServiceToken(testWebServiceToken), bearer: "not-" + testWebServiceToken},
		"a server with no token set": {configured: nil, bearer: testWebServiceToken},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			ts, _ := newDBIntegrationEnvWithServiceToken(t, tt.configured)
			client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

			_, err := client.ListTenants(t.Context(), newDBBearerRequest(tt.bearer, publirasplatformv1.ListTenantsRequest{}))
			if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
				t.Fatalf("ListTenants code = %v, want %v", code, connect.CodeUnauthenticated)
			}
			_, err = client.CreateTenant(t.Context(), newDBBearerRequest(tt.bearer, publirasplatformv1.CreateTenantRequest{
				DefaultLocale: "en",
				Name:          "Tenant B",
				Domain:        "tenant-b.example.com",
			}))
			if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
				t.Fatalf("CreateTenant code = %v, want %v", code, connect.CodeUnauthenticated)
			}
		})
	}
}
