package publicapi

import (
	"context"
	"testing"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// The reader's own address comes back from the two RPCs that answer with their
// own account, which is what lets a form fill it in.
func TestDBOwnAccountCarriesTheReadersEmail(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()
	token := tokenFor(t, tenant, reader)

	me, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, token,
	))
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if me.Msg.User.Email != "member@tenant-a.example.com" {
		t.Fatalf("email from GetMe = %q, want member@tenant-a.example.com", me.Msg.User.Email)
	}

	updated, err := client.UpdateMe(context.Background(), newBearerRequest(
		&publirav1.UpdateMeRequest{Tenant: tenantContext(tenant), Name: "Renamed"}, token,
	))
	if err != nil {
		t.Fatalf("UpdateMe: %v", err)
	}
	if updated.Msg.User.Email != "member@tenant-a.example.com" {
		t.Fatalf("email from UpdateMe = %q, want member@tenant-a.example.com", updated.Msg.User.Email)
	}
}
