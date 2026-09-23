package platformapi

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// requireRateLimited fails unless err is the mail guard's refusal, which tells
// the caller when to come back.
func requireRateLimited(t *testing.T, what string, err error) {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeResourceExhausted {
		t.Fatalf("%s code = %v, want resource_exhausted (err=%v)", what, connect.CodeOf(err), err)
	}
	if connectErr.Meta().Get("Retry-After") == "" {
		t.Fatalf("%s carries no Retry-After", what)
	}
}

// An invitation mails an address nobody has confirmed, so creating and resending
// one from the platform console spend the mail guard's allowance.
func TestDBPlatformTenantAdminInvitationMailStopsAtTheLimit(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	ctx := context.Background()

	created, err := client.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: tenant.PublicID, Email: "invitee@tenant-a.example.com",
	}))
	if err != nil {
		t.Fatalf("the first CreateTenantAdminInvitation: %v", err)
	}
	tokenHash := func() string {
		var hash []byte
		if err := pg.DB.QueryRowContext(ctx, "SELECT token_hash FROM tenant_admin_invitations WHERE id = $1", created.Msg.Invitation.Id).Scan(&hash); err != nil {
			t.Fatalf("read the invitation's token hash: %v", err)
		}
		return string(hash)
	}
	issuedTokenHash := tokenHash()

	_, err = client.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: tenant.PublicID, Email: "invitee@tenant-a.example.com",
	}))
	requireRateLimited(t, "the second CreateTenantAdminInvitation", err)

	_, err = client.ResendTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.ResendTenantAdminInvitationRequest{
		TenantPublicId: tenant.PublicID, InvitationId: created.Msg.Invitation.Id,
	}))
	requireRateLimited(t, "ResendTenantAdminInvitation", err)

	if got := countOutboxEvents(t, pg, outbox.EventTypeTenantAdminInvitationEmail); got != 1 {
		t.Fatalf("queued invitation mails = %d, want the one the allowance paid for", got)
	}
	if got := tokenHash(); got != issuedTokenHash {
		t.Fatal("the invitation's link changed, want the refused requests to have rearmed nothing")
	}
}

// Granting the role to a user the tenant already has mails nothing, so it
// spends nothing.
func TestDBPlatformTenantAdminInvitationGrantSpendsNoMailAllowance(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1, PerDay: 100}))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "TAREADER", "reader@tenant-a.example.com", "Reader")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	for attempt := 1; attempt <= 2; attempt++ {
		created, err := client.CreateTenantAdminInvitation(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
			TenantPublicId: tenant.PublicID, Email: reader.Email,
		}))
		if err != nil {
			t.Fatalf("CreateTenantAdminInvitation attempt %d: %v", attempt, err)
		}
		if !created.Msg.RoleGrantedImmediately {
			t.Fatalf("attempt %d response = %+v, want the role granted", attempt, created.Msg)
		}
	}
}

// Every initial administrator of a new tenant is sent an invitation, so a
// request naming more addresses than the origin may mail creates no tenant.
func TestDBCreateTenantInitialAdminMailStopsAtTheLimit(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 100, PerDay: 100}, platformpolicy.HourDay{PerHour: 2, PerDay: 100}))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	_, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "en",
		Name:          "Tenant A",
		Domain:        "tenant-a.example.com",
		InitialAdminEmails: []string{
			"first@tenant-a.example.com",
			"second@tenant-a.example.com",
			"third@tenant-a.example.com",
		},
	}))
	requireRateLimited(t, "CreateTenant", err)

	if got := countRows(t, pg, "SELECT COUNT(*) FROM tenants"); got != 0 {
		t.Fatalf("tenant rows = %d, want the refused request to have written none", got)
	}
	if got := countOutboxEvents(t, pg, outbox.EventTypeTenantAdminInvitationEmail); got != 0 {
		t.Fatalf("queued invitation mails = %d, want none", got)
	}
}

// The same address named in a second tenant's creation is refused once the
// mailbox has had its invitations, and that tenant is not created.
func TestDBCreateTenantInitialAdminMailStopsAtTheAddressLimit(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	createTenant := func(domain string) error {
		_, err := client.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
			DefaultLocale:      "en",
			Name:               domain,
			Domain:             domain,
			InitialAdminEmails: []string{"admin@example.com"},
		}))
		return err
	}

	if err := createTenant("tenant-a.example.com"); err != nil {
		t.Fatalf("the first CreateTenant: %v", err)
	}
	requireRateLimited(t, "the second CreateTenant", createTenant("tenant-b.example.com"))

	if got := countRows(t, pg, "SELECT COUNT(*) FROM tenants"); got != 1 {
		t.Fatalf("tenant rows = %d, want only the one the allowance paid for", got)
	}
	if got := countOutboxEvents(t, pg, outbox.EventTypeTenantAdminInvitationEmail); got != 1 {
		t.Fatalf("queued invitation mails = %d, want the one the allowance paid for", got)
	}
}
