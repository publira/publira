package adminapi

import (
	"context"
	"log/slog"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/ratelimit"
)

// The console's password reset form takes an address from anyone who can reach
// it, so the mail behind it is bounded like the storefront's.
func TestDBAdminRequestPasswordResetStopsAtTheLimit(t *testing.T) {
	env := newAdminDBEnvWithMailGuard(t, mailguard.New(
		ratelimit.New(ratelimit.NewMemoryStore()),
		mailguard.Rules(1, 100),
		mailguard.Rules(1000, 1000),
		slog.Default(),
	))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	requestReset := func() error {
		_, err := env.authClient().RequestPasswordReset(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
			Tenant: tenant.tenantContext(),
			Email:  tenant.User.Email,
		}))
		return err
	}

	if err := requestReset(); err != nil {
		t.Fatalf("the first RequestPasswordReset: %v", err)
	}
	if err := requestReset(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second RequestPasswordReset code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	events := env.pendingOutboxEvents(t, outbox.EventTypeAdminPasswordResetEmail)
	if len(events) != 1 {
		t.Fatalf("queued admin_password_reset_email events = %d, want the one the allowance paid for", len(events))
	}
}
