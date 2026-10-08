package platformapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/platformtenants"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBListTenantsReturnsEmptyList(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.ListTenants(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ListTenantsRequest{})
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Tenants) != 0 {
		t.Fatalf("tenant count = %d, want 0", len(resp.Tenants))
	}
}

func TestDBCreateTenantPersistsAndLists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	createResp, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Integration Tenant",
		Domain:        "integration.example.com",
	})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	tenant := createResp.Tenant
	if tenant == nil {
		t.Fatal("CreateTenant returned nil tenant")
	}
	if tenant.Name != "Integration Tenant" {
		t.Fatalf("tenant.name = %q, want Integration Tenant", tenant.Name)
	}
	if tenant.Domain != "integration.example.com" {
		t.Fatalf("tenant.domain = %q, want integration.example.com", tenant.Domain)
	}
	if tenant.Status != platformtenants.StatusActive {
		t.Fatalf("tenant.status = %q, want %s", tenant.Status, platformtenants.StatusActive)
	}
	if tenant.PublicId == "" {
		t.Fatal("tenant.public_id is empty")
	}
	// Creation applies the tenants.timezone default; there is no unset state.
	if tenant.Timezone != tenanttz.Default {
		t.Fatalf("tenant.timezone = %q, want %s", tenant.Timezone, tenanttz.Default)
	}

	listResp, err := client.ListTenants(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ListTenantsRequest{})
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(listResp.Tenants) != 1 {
		t.Fatalf("tenant count = %d, want 1", len(listResp.Tenants))
	}
	if listResp.Tenants[0].PublicId != tenant.PublicId {
		t.Fatalf("listed public_id = %q, want %q", listResp.Tenants[0].PublicId, tenant.PublicId)
	}

	getResp, err := client.GetTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.GetTenantRequest{
		PublicId: tenant.PublicId,
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if getResp.Tenant.Domain != "integration.example.com" {
		t.Fatalf("GetTenant domain = %q", getResp.Tenant.Domain)
	}
}

func TestDBListTenantsPaginatesWithTokens(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	createdPublicIDs := make([]string, 0, 3)
	for index, name := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
			DefaultLocale: "ja",
			Name:          name + " Paginated Tenant",
			Domain:        strings.ToLower(name) + "-paginated.example.com",
		})
		if err != nil {
			t.Fatalf("CreateTenant %d: %v", index, err)
		}
		createdPublicIDs = append(createdPublicIDs, resp.Tenant.PublicId)
	}

	first, err := client.ListTenants(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ListTenantsRequest{Limit: 2})
	if err != nil {
		t.Fatalf("ListTenants first page: %v", err)
	}
	if len(first.Tenants) != 2 || first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page = %d tenants, tokens (%q, %q); want 2, empty previous, non-empty next", len(first.Tenants), first.PreviousToken, first.NextToken)
	}

	second, err := client.ListTenants(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ListTenantsRequest{
		Limit: 2,
		Token: first.NextToken,
	})
	if err != nil {
		t.Fatalf("ListTenants second page: %v", err)
	}
	if len(second.Tenants) != 1 || second.PreviousToken == "" || second.NextToken != "" {
		t.Fatalf("second page = %d tenants, tokens (%q, %q); want 1, non-empty previous, empty next", len(second.Tenants), second.PreviousToken, second.NextToken)
	}

	listedPublicIDs := []string{
		first.Tenants[0].PublicId,
		first.Tenants[1].PublicId,
		second.Tenants[0].PublicId,
	}
	slices.Sort(createdPublicIDs)
	slices.Sort(listedPublicIDs)
	if !slices.Equal(listedPublicIDs, createdPublicIDs) {
		t.Fatalf("listed public IDs = %v, want %v", listedPublicIDs, createdPublicIDs)
	}

	back, err := client.ListTenants(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ListTenantsRequest{
		Limit: 2,
		Token: second.PreviousToken,
	})
	if err != nil {
		t.Fatalf("ListTenants previous page: %v", err)
	}
	if len(back.Tenants) != 2 {
		t.Fatalf("previous page tenant count = %d, want 2", len(back.Tenants))
	}
	if back.Tenants[0].PublicId != first.Tenants[0].PublicId || back.Tenants[1].PublicId != first.Tenants[1].PublicId {
		t.Fatalf("previous page public IDs = [%s %s], want [%s %s]", back.Tenants[0].PublicId, back.Tenants[1].PublicId, first.Tenants[0].PublicId, first.Tenants[1].PublicId)
	}
}

func TestDBCreateTenantDuplicateDomainReturnsAlreadyExists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	_, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "First Tenant",
		Domain:        "dup-domain.example.com",
	})
	if err != nil {
		t.Fatalf("first CreateTenant: %v", err)
	}

	_, err = client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Second Tenant",
		Domain:        "dup-domain.example.com",
	})
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "domain") {
		t.Fatalf("CreateTenant error = %v, want domain duplicate message", err)
	}
}

func TestDBCreateTenantDuplicateAdminDomainReturnsAlreadyExists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	_, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "First Tenant",
		Domain:        "first.example.com",
		AdminDomain:   "admin.shared.example.com",
	})
	if err != nil {
		t.Fatalf("first CreateTenant: %v", err)
	}

	_, err = client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Second Tenant",
		Domain:        "second.example.com",
		AdminDomain:   "admin.shared.example.com",
	})
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "admin_domain") {
		t.Fatalf("CreateTenant error = %v, want admin_domain duplicate message", err)
	}
}

func TestDBSuspendAndResumeTenant(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	createResp, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Lifecycle Tenant",
		Domain:        "lifecycle.example.com",
	})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	tenantID := createResp.Tenant.Id

	suspendResp, err := client.SuspendTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.SuspendTenantRequest{
		TenantId: tenantID,
	})
	if err != nil {
		t.Fatalf("SuspendTenant: %v", err)
	}
	if suspendResp.Tenant.Status != platformtenants.StatusSuspended {
		t.Fatalf("status after suspend = %q, want %s", suspendResp.Tenant.Status, platformtenants.StatusSuspended)
	}

	resumeResp, err := client.ResumeTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.ResumeTenantRequest{
		TenantId: tenantID,
	})
	if err != nil {
		t.Fatalf("ResumeTenant: %v", err)
	}
	if resumeResp.Tenant.Status != platformtenants.StatusActive {
		t.Fatalf("status after resume = %q, want %s", resumeResp.Tenant.Status, platformtenants.StatusActive)
	}
}

func TestDBCreateTenantRejectsEmptyDomain(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	_, err := client.CreateTenant(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "No Domain",
		Domain:        "",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
}
