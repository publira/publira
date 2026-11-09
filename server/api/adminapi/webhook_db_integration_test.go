package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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

// An episode the console publishes at once owes episode.published to the
// endpoints that subscribed to it, once per publication: saving another past
// time over the published episode owes nothing more, and publishing it again
// after taking it back to a draft owes a second event. An endpoint that did
// not subscribe to it is owed none.
func TestDBEpisodePublishedIsOwedOncePerPublication(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT4", "hooks-episode.example.com", "Hook Episode Tenant", "HOOKADMIN04", "admin@hooks-episode.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for _, endpoint := range []struct {
		url    string
		events []publiraadminv1.WebhookEventType
	}{
		{url: "https://cms.example.com/publira", events: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_PUBLISHED}},
		{url: "https://crm.example.com/publira", events: purchaseEvents},
	} {
		created, err := env.webhookClient().CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
			Tenant:     admin.tenantContext(),
			Url:        endpoint.url,
			EventTypes: endpoint.events,
			Enabled:    true,
		})
		if err != nil {
			t.Fatalf("CreateWebhookEndpoint %s: %v", endpoint.url, err)
		}
		if got := created.Endpoint.EventTypes; len(got) != len(endpoint.events) {
			t.Fatalf("event types of %s = %v, want %v", endpoint.url, got, endpoint.events)
		}
	}

	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, admin, "Hooked Series")
	seriesID := env.seriesID(t, seriesPublicID)
	draft, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:   admin.tenantContext(),
		SeriesId: seriesID,
		Title:    "Hooked Episode",
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	schedule := func(scheduledAt string) *publirattypesv1.Episode {
		t.Helper()
		res, err := client.UpdateEpisodePublishSchedule(ctx, &publiraadminv1.UpdateEpisodePublishScheduleRequest{
			Tenant:      admin.tenantContext(),
			EpisodeId:   draft.Episode.Id,
			ScheduledAt: scheduledAt,
		})
		if err != nil {
			t.Fatalf("UpdateEpisodePublishSchedule %q: %v", scheduledAt, err)
		}
		return res.Episode
	}
	type delivered struct {
		url     string
		eventID string
		data    tenantwebhooks.Episode
	}
	deliveries := func() []delivered {
		t.Helper()
		rows, err := env.PG.DB.QueryContext(context.Background(), `
			SELECT e.url, d.event_id, d.payload->'data'
			FROM webhook_deliveries d
				JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
			WHERE d.tenant_id = $1 AND d.event_type = 'episode.published'
			ORDER BY d.created_at, d.id
		`, admin.Tenant.ID)
		if err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		defer func() { _ = rows.Close() }()
		var got []delivered
		for rows.Next() {
			var row delivered
			var data []byte
			if err := rows.Scan(&row.url, &row.eventID, &data); err != nil {
				t.Fatalf("scan a delivery: %v", err)
			}
			if err := json.Unmarshal(data, &row.data); err != nil {
				t.Fatalf("decode a delivery's data %s: %v", data, err)
			}
			got = append(got, row)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		return got
	}

	published := schedule("2000-01-01T00:00:00Z")
	got := deliveries()
	if len(got) != 1 {
		t.Fatalf("deliveries after the publication = %+v, want one", got)
	}
	want := tenantwebhooks.Episode{
		EpisodePublicID: draft.Episode.PublicId,
		SeriesPublicID:  seriesPublicID,
		Title:           "Hooked Episode",
		PublishedAt:     published.PublishedAt,
	}
	if got[0].url != "https://cms.example.com/publira" || got[0].data != want {
		t.Fatalf("delivery = %+v, want %+v to the subscribed endpoint", got[0], want)
	}

	// The episode is already published, so a time that has passed changes
	// nothing a receiver is told about.
	schedule("2001-01-01T00:00:00Z")
	if got := deliveries(); len(got) != 1 {
		t.Fatalf("deliveries after saving a past time again = %d, want 1", len(got))
	}

	schedule("")
	schedule("2002-01-01T00:00:00Z")
	got = deliveries()
	if len(got) != 2 || got[1].eventID == got[0].eventID || got[1].data.EpisodePublicID != draft.Episode.PublicId {
		t.Fatalf("deliveries after publishing again = %+v, want a second event for the episode", got)
	}

	// An episode created with a time that has passed is published as it is
	// created, and owes the event the same way.
	created, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:      admin.tenantContext(),
		SeriesId:    seriesID,
		Title:       "Published As Created",
		ScheduledAt: "2000-01-01T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateEpisode published at once: %v", err)
	}
	got = deliveries()
	if len(got) != 3 || got[2].data.EpisodePublicID != created.Episode.PublicId || got[2].data.PublishedAt != created.Episode.PublishedAt {
		t.Fatalf("deliveries after creating a published episode = %+v, want one for %s", got, created.Episode.PublicId)
	}
}

// A published episode taken off the site owes episode.unpublished to the
// endpoints that subscribed to it, once per withdrawal: clearing its schedule
// or moving it to a time still ahead owes one for the episode, a save that
// leaves a draft a draft owes nothing, and hiding its series owes one for each
// episode published in it, and nothing more when the series is saved hidden
// again. An endpoint that did not subscribe to it is owed none.
func TestDBEpisodeUnpublishedIsOwedOncePerWithdrawal(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT5", "hooks-unpublish.example.com", "Hook Unpublish Tenant", "HOOKADMIN05", "admin@hooks-unpublish.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for _, endpoint := range []struct {
		url    string
		events []publiraadminv1.WebhookEventType
	}{
		{url: "https://cms.example.com/publira", events: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_UNPUBLISHED}},
		{url: "https://crm.example.com/publira", events: purchaseEvents},
	} {
		if _, err := env.webhookClient().CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
			Tenant:     admin.tenantContext(),
			Url:        endpoint.url,
			EventTypes: endpoint.events,
			Enabled:    true,
		}); err != nil {
			t.Fatalf("CreateWebhookEndpoint %s: %v", endpoint.url, err)
		}
	}

	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, admin, "Withdrawn Series")
	seriesID := env.seriesID(t, seriesPublicID)
	publishSeries := func(publishedAt string) {
		t.Helper()
		if _, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
			Tenant:      admin.tenantContext(),
			SeriesId:    seriesID,
			Title:       "Withdrawn Series",
			PublishedAt: publishedAt,
		}); err != nil {
			t.Fatalf("UpdateSeries %q: %v", publishedAt, err)
		}
	}
	publishSeries("2000-01-01T00:00:00Z")
	createEpisode := func(title, scheduledAt string) *publirattypesv1.Episode {
		t.Helper()
		res, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
			Tenant:      admin.tenantContext(),
			SeriesId:    seriesID,
			Title:       title,
			ScheduledAt: scheduledAt,
		})
		if err != nil {
			t.Fatalf("CreateEpisode %q: %v", title, err)
		}
		return res.Episode
	}
	first := createEpisode("First", "2000-01-01T00:00:00Z")
	second := createEpisode("Second", "2000-01-02T00:00:00Z")
	createEpisode("Draft", "")
	schedule := func(episode *publirattypesv1.Episode, scheduledAt string) {
		t.Helper()
		if _, err := client.UpdateEpisodePublishSchedule(ctx, &publiraadminv1.UpdateEpisodePublishScheduleRequest{
			Tenant:      admin.tenantContext(),
			EpisodeId:   episode.Id,
			ScheduledAt: scheduledAt,
		}); err != nil {
			t.Fatalf("UpdateEpisodePublishSchedule %q: %v", scheduledAt, err)
		}
	}
	type delivered struct {
		url     string
		eventID string
		data    tenantwebhooks.EpisodeWithdrawal
	}
	deliveries := func() []delivered {
		t.Helper()
		rows, err := env.PG.DB.QueryContext(context.Background(), `
			SELECT e.url, d.event_id, d.payload->'data'
			FROM webhook_deliveries d
				JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
			WHERE d.tenant_id = $1 AND d.event_type = 'episode.unpublished'
			ORDER BY d.created_at, d.payload->'data'->>'episode_public_id'
		`, admin.Tenant.ID)
		if err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		defer func() { _ = rows.Close() }()
		var got []delivered
		for rows.Next() {
			var row delivered
			var data []byte
			if err := rows.Scan(&row.url, &row.eventID, &data); err != nil {
				t.Fatalf("scan a delivery: %v", err)
			}
			if err := json.Unmarshal(data, &row.data); err != nil {
				t.Fatalf("decode a delivery's data %s: %v", data, err)
			}
			got = append(got, row)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		return got
	}
	withdrawal := func(episode *publirattypesv1.Episode, withdrawn string) tenantwebhooks.EpisodeWithdrawal {
		return tenantwebhooks.EpisodeWithdrawal{EpisodePublicID: episode.PublicId, SeriesPublicID: seriesPublicID, Withdrawn: withdrawn}
	}

	schedule(first, "")
	got := deliveries()
	if len(got) != 1 || got[0].url != "https://cms.example.com/publira" || got[0].data != withdrawal(first, tenantwebhooks.WithdrawnEpisode) {
		t.Fatalf("deliveries after clearing the schedule = %+v, want one for the episode to the subscribed endpoint", got)
	}

	// The episode is a draft already, so saving it as one takes nothing off
	// the site.
	schedule(first, "")
	if got := deliveries(); len(got) != 1 {
		t.Fatalf("deliveries after saving the draft again = %d, want 1", len(got))
	}

	// Published again and moved to a time still ahead, it leaves the site
	// again, which is a withdrawal of its own.
	schedule(first, "2001-01-01T00:00:00Z")
	schedule(first, "2999-01-01T00:00:00Z")
	got = deliveries()
	if len(got) != 2 || got[1].eventID == got[0].eventID || got[1].data != withdrawal(first, tenantwebhooks.WithdrawnEpisode) {
		t.Fatalf("deliveries after moving the published episode ahead = %+v, want a second event for it", got)
	}

	// Hiding the series takes off each episode published in it, and neither
	// the scheduled one nor the draft.
	schedule(first, "2002-01-01T00:00:00Z")
	publishSeries("")
	got = deliveries()
	if len(got) != 4 {
		t.Fatalf("deliveries after hiding the series = %+v, want one more for each published episode", got)
	}
	hidden := map[tenantwebhooks.EpisodeWithdrawal]bool{got[2].data: true, got[3].data: true}
	if !hidden[withdrawal(first, tenantwebhooks.WithdrawnSeries)] || !hidden[withdrawal(second, tenantwebhooks.WithdrawnSeries)] {
		t.Fatalf("deliveries for the hidden series = %+v, want one for each of its published episodes", got[2:])
	}

	// Saving the hidden series hidden again takes nothing more off the site,
	// while hiding it again once it is public is a withdrawal of its own.
	publishSeries("")
	if got := deliveries(); len(got) != 4 {
		t.Fatalf("deliveries after saving the hidden series again = %d, want 4", len(got))
	}
	publishSeries("2000-01-01T00:00:00Z")
	publishSeries("2999-01-01T00:00:00Z")
	got = deliveries()
	if len(got) != 6 || got[4].eventID == got[2].eventID || got[4].eventID == got[3].eventID {
		t.Fatalf("deliveries after hiding the series a second time = %+v, want two more events of their own", got)
	}
}
