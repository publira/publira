package platformapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
)

func TestDBListTenantsReturnsEmptyList(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 0 {
		t.Fatalf("tenant count = %d, want 0", len(resp.Msg.Tenants))
	}
}

func TestDBCreateTenantPersistsAndLists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	createResp, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:   "Integration Tenant",
		Domain: "integration.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	tenant := createResp.Msg.Tenant
	if tenant == nil {
		t.Fatal("CreateTenant returned nil tenant")
	}
	if tenant.Name != "Integration Tenant" {
		t.Fatalf("tenant.name = %q, want Integration Tenant", tenant.Name)
	}
	if tenant.Domain != "integration.example.com" {
		t.Fatalf("tenant.domain = %q, want integration.example.com", tenant.Domain)
	}
	if tenant.Status != tenantStatusActive {
		t.Fatalf("tenant.status = %q, want %s", tenant.Status, tenantStatusActive)
	}
	if tenant.PublicId == "" {
		t.Fatal("tenant.public_id is empty")
	}

	listResp, err := client.ListTenants(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(listResp.Msg.Tenants) != 1 {
		t.Fatalf("tenant count = %d, want 1", len(listResp.Msg.Tenants))
	}
	if listResp.Msg.Tenants[0].PublicId != tenant.PublicId {
		t.Fatalf("listed public_id = %q, want %q", listResp.Msg.Tenants[0].PublicId, tenant.PublicId)
	}

	getResp, err := client.GetTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetTenantRequest{
		PublicId: tenant.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if getResp.Msg.Tenant.Domain != "integration.example.com" {
		t.Fatalf("GetTenant domain = %q", getResp.Msg.Tenant.Domain)
	}
}

func TestDBCreateTenantDuplicateDomainReturnsAlreadyExists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	_, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:   "First Tenant",
		Domain: "dup-domain.example.com",
	}))
	if err != nil {
		t.Fatalf("first CreateTenant: %v", err)
	}

	_, err = client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:   "Second Tenant",
		Domain: "dup-domain.example.com",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "domain") {
		t.Fatalf("CreateTenant error = %v, want domain duplicate message", err)
	}
}

func TestDBCreateTenantDuplicateAdminDomainReturnsAlreadyExists(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	_, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:        "First Tenant",
		Domain:      "first.example.com",
		AdminDomain: "admin.shared.example.com",
	}))
	if err != nil {
		t.Fatalf("first CreateTenant: %v", err)
	}

	_, err = client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:        "Second Tenant",
		Domain:      "second.example.com",
		AdminDomain: "admin.shared.example.com",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "admin_domain") {
		t.Fatalf("CreateTenant error = %v, want admin_domain duplicate message", err)
	}
}

func TestDBSuspendAndResumeTenant(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	createResp, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:   "Lifecycle Tenant",
		Domain: "lifecycle.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	publicID := createResp.Msg.Tenant.PublicId

	suspendResp, err := client.SuspendTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.SuspendTenantRequest{
		PublicId: publicID,
	}))
	if err != nil {
		t.Fatalf("SuspendTenant: %v", err)
	}
	if suspendResp.Msg.Tenant.Status != tenantStatusSuspended {
		t.Fatalf("status after suspend = %q, want %s", suspendResp.Msg.Tenant.Status, tenantStatusSuspended)
	}

	resumeResp, err := client.ResumeTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ResumeTenantRequest{
		PublicId: publicID,
	}))
	if err != nil {
		t.Fatalf("ResumeTenant: %v", err)
	}
	if resumeResp.Msg.Tenant.Status != tenantStatusActive {
		t.Fatalf("status after resume = %q, want %s", resumeResp.Msg.Tenant.Status, tenantStatusActive)
	}
}

func TestDBCreateTenantRejectsEmptyDomain(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	_, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		Name:   "No Domain",
		Domain: "",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
}
