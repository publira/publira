package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) webhookClient() publiraadminv1connect.AdminWebhookServiceClient {
	return publiraadminv1connect.NewAdminWebhookServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

var purchaseEvents = []publiraadminv1.WebhookEventType{
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_PURCHASE_REFUNDED,
	publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_PURCHASE_COMPLETED,
}

// An endpoint is created with a secret answered once and hinted after, has
// its events and switch changed, its secret rotated, and is deleted, each
// change audited once and a save that changes nothing not at all. A tenant
// keeps five.
func TestDBWebhookEndpointIsCreatedChangedRotatedAndDeleted(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT1", "hooks.example.com", "Hook Tenant", "HOOKADMIN01", "admin@hooks.example.com")
	client := env.webhookClient()
	ctx := testutil.WithBearer(context.Background(), admin.token())
	audited := func(action string) int {
		return env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2`, admin.Tenant.ID, action)
	}

	created, err := client.CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
		Tenant:     admin.tenantContext(),
		Url:        "https://crm.example.com/publira",
		EventTypes: purchaseEvents,
		Enabled:    true,
	})
	if err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}
	endpoint := created.Endpoint
	if !strings.HasPrefix(created.Secret, "whsec_") || !strings.HasSuffix(created.Secret, endpoint.SecretHint[len(endpoint.SecretHint)-4:]) || strings.Contains(endpoint.SecretHint, created.Secret[6:]) {
		t.Fatalf("secret %q hinted as %q, want a whsec_ secret hinted by its last four characters", created.Secret, endpoint.SecretHint)
	}
	// The events are kept in the order the console lists them.
	if got := endpoint.EventTypes; len(got) != 2 || got[0] != publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_PURCHASE_COMPLETED {
		t.Fatalf("event types = %v, want purchase.completed first", got)
	}

	update := func(url string, enabled bool) *publiraadminv1.WebhookEndpoint {
		t.Helper()
		res, err := client.UpdateWebhookEndpoint(ctx, &publiraadminv1.UpdateWebhookEndpointRequest{
			Tenant:     admin.tenantContext(),
			EndpointId: endpoint.Id,
			Url:        url,
			EventTypes: purchaseEvents,
			Enabled:    enabled,
		})
		if err != nil {
			t.Fatalf("UpdateWebhookEndpoint: %v", err)
		}
		return res.Endpoint
	}
	update("https://crm.example.com/publira", true)
	if got := audited("webhook_endpoint_updated"); got != 0 {
		t.Fatalf("a save that changes nothing recorded %d entries", got)
	}
	if got := update("https://crm.example.com/publira", false); got.Enabled {
		t.Fatal("the endpoint is still enabled")
	}

	rotated, err := client.RotateWebhookSecret(ctx, &publiraadminv1.RotateWebhookSecretRequest{Tenant: admin.tenantContext(), EndpointId: endpoint.Id})
	if err != nil {
		t.Fatalf("RotateWebhookSecret: %v", err)
	}
	if rotated.Secret == created.Secret || rotated.Endpoint.SecretHint == endpoint.SecretHint && rotated.Secret[len(rotated.Secret)-4:] != created.Secret[len(created.Secret)-4:] {
		t.Fatalf("rotated secret %q (hint %q), want a new one", rotated.Secret, rotated.Endpoint.SecretHint)
	}
	if got := env.countRows(t, `SELECT count(*) FROM tenant_webhook_endpoints WHERE secret_encrypted LIKE '%' || $1 || '%'`, rotated.Secret); got != 0 {
		t.Fatal("the secret is stored as it was answered")
	}

	for i := range 4 {
		if _, err := client.CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
			Tenant:     admin.tenantContext(),
			Url:        fmt.Sprintf("https://crm.example.com/hook/%d", i),
			EventTypes: purchaseEvents,
		}); err != nil {
			t.Fatalf("CreateWebhookEndpoint %d: %v", i+2, err)
		}
	}
	_, err = client.CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
		Tenant:     admin.tenantContext(),
		Url:        "https://crm.example.com/hook/sixth",
		EventTypes: purchaseEvents,
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoReason(t, err) != rpcerrors.ReasonWebhookEndpointLimit {
		t.Fatalf("a sixth endpoint = %v, want failed_precondition with %s", err, rpcerrors.ReasonWebhookEndpointLimit)
	}

	if _, err := client.DeleteWebhookEndpoint(ctx, &publiraadminv1.DeleteWebhookEndpointRequest{Tenant: admin.tenantContext(), EndpointId: endpoint.Id}); err != nil {
		t.Fatalf("DeleteWebhookEndpoint: %v", err)
	}
	listed, err := client.ListWebhookEndpoints(ctx, &publiraadminv1.ListWebhookEndpointsRequest{Tenant: admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListWebhookEndpoints: %v", err)
	}
	if got := len(listed.Endpoints); got != 4 {
		t.Fatalf("ListWebhookEndpoints answered %d endpoints, want 4", got)
	}
	for action, want := range map[string]int{
		"webhook_endpoint_created": 5,
		"webhook_endpoint_updated": 1,
		"webhook_secret_rotated":   1,
		"webhook_endpoint_deleted": 1,
	} {
		if got := audited(action); got != want {
			t.Errorf("%s entries = %d, want %d", action, got, want)
		}
	}
}

// What an endpoint is saved with is checked field by field.
func TestDBCreateWebhookEndpointChecksItsFields(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT2", "hooks-b.example.com", "Hook Tenant", "HOOKADMIN02", "admin@hooks-b.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for name, tc := range map[string]struct {
		url    string
		events []publiraadminv1.WebhookEventType
		field  string
	}{
		"an http URL":         {url: "http://crm.example.com/publira", events: purchaseEvents, field: "url"},
		"no host":             {url: "https:///publira", events: purchaseEvents, field: "url"},
		"a user and password": {url: "https://user:pass@crm.example.com/", events: purchaseEvents, field: "url"},
		"no event":            {url: "https://crm.example.com/", field: "event_types"},
		"the test event":      {url: "https://crm.example.com/", events: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_TEST}, field: "event_types"},
	} {
		_, err := env.webhookClient().CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
			Tenant:     admin.tenantContext(),
			Url:        tc.url,
			EventTypes: tc.events,
		})
		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument || violatedField(t, connectErr) != tc.field {
			t.Errorf("%s: CreateWebhookEndpoint = %v, want invalid_argument on %s", name, err, tc.field)
		}
	}
}

// A test is owed to the endpoint and listed with its deliveries; the list
// narrows to a status, and only a dead delivery is resent.
func TestDBSendTestWebhookIsListedAndOnlyADeadDeliveryIsResent(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT3", "hooks-c.example.com", "Hook Tenant", "HOOKADMIN03", "admin@hooks-c.example.com")
	client := env.webhookClient()
	ctx := testutil.WithBearer(context.Background(), admin.token())

	created, err := client.CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
		Tenant:     admin.tenantContext(),
		Url:        "https://crm.example.com/publira",
		EventTypes: purchaseEvents,
	})
	if err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}
	var sent []*publiraadminv1.WebhookDelivery
	for range 3 {
		res, err := client.SendTestWebhook(ctx, &publiraadminv1.SendTestWebhookRequest{Tenant: admin.tenantContext(), EndpointId: created.Endpoint.Id})
		if err != nil {
			t.Fatalf("SendTestWebhook: %v", err)
		}
		if res.Delivery.EventType != publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_TEST || res.Delivery.Status != publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_PENDING {
			t.Fatalf("test delivery = %v %v, want a pending test", res.Delivery.EventType, res.Delivery.Status)
		}
		sent = append(sent, res.Delivery)
	}
	if got := env.countRows(t, `SELECT count(*) FROM outbox_events WHERE event_type = $1 AND tenant_id = $2`, tenantwebhooks.OutboxEventType, admin.Tenant.ID); got != 3 {
		t.Fatalf("outbox events = %d, want one per test", got)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE webhook_deliveries SET status = 'dead', attempts = 20 WHERE id = $1`, sent[0].Id); err != nil {
		t.Fatalf("give a delivery up: %v", err)
	}

	page, err := client.ListWebhookDeliveries(ctx, &publiraadminv1.ListWebhookDeliveriesRequest{Tenant: admin.tenantContext(), Limit: 2})
	if err != nil {
		t.Fatalf("ListWebhookDeliveries: %v", err)
	}
	if len(page.Deliveries) != 2 || page.Deliveries[0].Id != sent[2].Id || page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first page = %d deliveries starting %v (next %q), want the 2 newest and a next page", len(page.Deliveries), page.Deliveries, page.NextToken)
	}
	next, err := client.ListWebhookDeliveries(ctx, &publiraadminv1.ListWebhookDeliveriesRequest{Tenant: admin.tenantContext(), Limit: 2, Token: page.NextToken})
	if err != nil {
		t.Fatalf("ListWebhookDeliveries next page: %v", err)
	}
	if len(next.Deliveries) != 1 || next.Deliveries[0].Id != sent[0].Id || next.NextToken != "" {
		t.Fatalf("next page = %v, want the oldest alone", next.Deliveries)
	}
	dead, err := client.ListWebhookDeliveries(ctx, &publiraadminv1.ListWebhookDeliveriesRequest{Tenant: admin.tenantContext(), Status: publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_DEAD})
	if err != nil {
		t.Fatalf("ListWebhookDeliveries dead: %v", err)
	}
	if len(dead.Deliveries) != 1 || dead.Deliveries[0].Id != sent[0].Id {
		t.Fatalf("dead deliveries = %v, want the one given up", dead.Deliveries)
	}
	// A token of the unfiltered list is not one of the filtered list.
	if _, err := client.ListWebhookDeliveries(ctx, &publiraadminv1.ListWebhookDeliveriesRequest{Tenant: admin.tenantContext(), Token: page.NextToken, Status: publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_DEAD}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a token of another list = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}

	if _, err := client.ResendWebhookDelivery(ctx, &publiraadminv1.ResendWebhookDeliveryRequest{Tenant: admin.tenantContext(), DeliveryId: sent[1].Id}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("resending a pending delivery = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
	resent, err := client.ResendWebhookDelivery(ctx, &publiraadminv1.ResendWebhookDeliveryRequest{Tenant: admin.tenantContext(), DeliveryId: sent[0].Id})
	if err != nil {
		t.Fatalf("ResendWebhookDelivery: %v", err)
	}
	if resent.Delivery.Status != publiraadminv1.WebhookDeliveryStatus_WEBHOOK_DELIVERY_STATUS_PENDING || resent.Delivery.Attempts != 20 {
		t.Fatalf("resent delivery = %v after %d attempts, want pending keeping its 20", resent.Delivery.Status, resent.Delivery.Attempts)
	}
	if got := env.countRows(t, `SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'delivery_id' = $2`, tenantwebhooks.OutboxEventType, sent[0].Id); got != 2 {
		t.Fatalf("outbox events of the resent delivery = %d, want the first and the resend", got)
	}
	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'webhook_delivery_resent' AND target_id = $2`, admin.Tenant.ID, sent[0].Id); got != 1 {
		t.Fatalf("resend audit entries = %d, want 1", got)
	}
}
