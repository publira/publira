package adminapi

import (
	"context"
	"encoding/json"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// pendingOutboxEvents reads the queued rows of one type on the superuser
// connection: the outbox worker, not the tenant, is who consumes them.
func (e *adminDBEnv) pendingOutboxEvents(t *testing.T, eventType string) []dbmodels.OutboxEvent {
	t.Helper()

	rows, err := e.PG.DB.QueryContext(context.Background(),
		`SELECT id, tenant_id, event_type, payload, idempotency_key FROM outbox_events WHERE event_type = $1 AND status = 'pending' ORDER BY idempotency_key`,
		eventType)
	if err != nil {
		t.Fatalf("query outbox_events: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var events []dbmodels.OutboxEvent
	for rows.Next() {
		var event dbmodels.OutboxEvent
		if err := rows.Scan(&event.ID, &event.TenantID, &event.EventType, &event.Payload, &event.IdempotencyKey); err != nil {
			t.Fatalf("scan outbox_events: %v", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate outbox_events: %v", err)
	}
	return events
}

// The RPC no longer sends anything itself: it leaves a token row and the event
// that will mail its link, in one transaction, and needs no SMTP settings to
// answer.
func TestDBAdminRequestPasswordResetEnqueuesTheEmail(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	resp, err := env.authClient().RequestPasswordReset(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: tenant.tenantContext(),
		Email:  tenant.User.Email,
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("RequestPasswordReset returned requested = false")
	}

	events := env.pendingOutboxEvents(t, outbox.EventTypeAdminPasswordResetEmail)
	if len(events) != 1 {
		t.Fatalf("pending admin_password_reset_email events = %d, want 1", len(events))
	}
	event := events[0]
	if !event.TenantID.Valid || event.TenantID.UUID != tenant.Tenant.ID {
		t.Fatalf("event tenant_id = %v, want %s", event.TenantID, tenant.Tenant.ID)
	}
	var payload outbox.AdminPasswordResetEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if event.IdempotencyKey != "admin_password_reset_email:"+payload.TokenID {
		t.Fatalf("idempotency_key = %q, want one derived from token %s", event.IdempotencyKey, payload.TokenID)
	}

	// The event is only worth anything if the token it carries is the one
	// stored for the row it names.
	resetToken, err := dbmodels.New(env.PG.DB).GetUserPasswordResetTokenByHashForTenant(context.Background(), dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
		TenantID:  tenant.Tenant.ID,
		TokenHash: auth.HashToken(payload.Token),
	})
	if err != nil {
		t.Fatalf("GetUserPasswordResetTokenByHashForTenant: %v", err)
	}
	if resetToken.ID.String() != payload.TokenID || resetToken.UserID != tenant.User.ID {
		t.Fatalf("stored token = %+v, want the row event %s names for user %s", resetToken, payload.TokenID, tenant.User.ID)
	}
}

// One event per address to confirm, each with its own key, so a failure to
// deliver to one side is retried on its own.
func TestDBAdminRequestEmailChangeEnqueuesOneEmailPerSide(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	resp, err := env.authClient().RequestEmailChange(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
		Tenant:          tenant.tenantContext(),
		CurrentEmail:    tenant.User.Email,
		NewEmail:        "moved@tenant-a.example.com",
		CurrentPassword: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("RequestEmailChange: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("RequestEmailChange returned requested = false")
	}

	events := env.pendingOutboxEvents(t, outbox.EventTypeAdminEmailChangeConfirmationEmail)
	if len(events) != 2 {
		t.Fatalf("pending admin_email_change_confirmation_email events = %d, want 2", len(events))
	}
	queries := dbmodels.New(env.PG.DB)
	sides := map[string]bool{}
	for _, event := range events {
		var payload outbox.AdminEmailChangeConfirmationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		changeToken, err := queries.GetUserEmailChangeTokenByHashForTenant(context.Background(), dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
			TenantID:              tenant.Tenant.ID,
			CurrentEmailTokenHash: auth.HashToken(payload.Token),
		})
		if err != nil {
			t.Fatalf("GetUserEmailChangeTokenByHashForTenant: %v", err)
		}
		if changeToken.ID.String() != payload.TokenID {
			t.Fatalf("token %s belongs to request %s, event names %s", payload.Token, changeToken.ID, payload.TokenID)
		}
		if event.IdempotencyKey != "admin_email_change_confirmation_email:"+payload.TokenID+":"+changeToken.MatchedTarget {
			t.Fatalf("idempotency_key = %q, want one naming side %s", event.IdempotencyKey, changeToken.MatchedTarget)
		}
		sides[changeToken.MatchedTarget] = true
	}
	if !sides["current_email"] || !sides["new_email"] {
		t.Fatalf("events cover sides %v, want both", sides)
	}
}

// Confirming the second side stores the new address and, in the same
// transaction, the notice to the address it moved from.
func TestDBAdminConfirmEmailChangeEnqueuesTheNoticeWithTheNewAddress(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	if _, err := client.RequestEmailChange(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
		Tenant:          tenant.tenantContext(),
		CurrentEmail:    tenant.User.Email,
		NewEmail:        "moved@tenant-a.example.com",
		CurrentPassword: testutil.SeededPassword,
	})); err != nil {
		t.Fatalf("RequestEmailChange: %v", err)
	}

	var tokenID uuid.UUID
	for _, event := range env.pendingOutboxEvents(t, outbox.EventTypeAdminEmailChangeConfirmationEmail) {
		var payload outbox.AdminEmailChangeConfirmationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		tokenID = uuid.MustParse(payload.TokenID)
		confirmed, err := client.ConfirmEmailChange(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceConfirmEmailChangeRequest{
			Tenant: tenant.tenantContext(),
			Token:  payload.Token,
		}))
		if err != nil {
			t.Fatalf("ConfirmEmailChange: %v", err)
		}
		if !confirmed.Msg.Confirmed {
			t.Fatal("ConfirmEmailChange returned confirmed = false")
		}
	}

	user, err := dbmodels.New(env.PG.DB).GetUserByID(context.Background(), tenant.User.ID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	if user.Email != "moved@tenant-a.example.com" {
		t.Fatalf("stored email = %q, want the confirmed address", user.Email)
	}

	notices := env.pendingOutboxEvents(t, outbox.EventTypeAdminEmailChangedNoticeEmail)
	if len(notices) != 1 {
		t.Fatalf("pending admin_email_changed_notice_email events = %d, want 1", len(notices))
	}
	var payload outbox.AdminEmailChangedNoticeEmailPayload
	if err := json.Unmarshal(notices[0].Payload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload.TokenID != tokenID.String() || payload.TenantID != tenant.Tenant.ID.String() {
		t.Fatalf("notice payload = %+v, want request %s of tenant %s", payload, tokenID, tenant.Tenant.ID)
	}
	if notices[0].IdempotencyKey != "admin_email_changed_notice_email:"+tokenID.String() {
		t.Fatalf("idempotency_key = %q", notices[0].IdempotencyKey)
	}
}
