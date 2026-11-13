package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
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
		Published:       tenantwebhooks.PublishedEpisode,
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

// A series made public by a save owes episode.published to the endpoints that
// subscribed to it for each episode published in it, apart from the event each
// episode owed when it was published: neither the scheduled episode nor the
// draft, and nothing more when the series is saved public again. Hiding it and
// making it public again, even with the same instant, puts the episodes back
// on the site again, which owes them again. An endpoint that did not subscribe
// to it is owed none.
func TestDBEpisodePublishedIsOwedForEachEpisodeWhenItsSeriesIsMadePublic(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT7", "hooks-series.example.com", "Hook Series Tenant", "HOOKADMIN07", "admin@hooks-series.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for _, endpoint := range []struct {
		url    string
		events []publiraadminv1.WebhookEventType
	}{
		{url: "https://cms.example.com/publira", events: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_PUBLISHED}},
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
	seriesPublicID := createDBSeries(t, client, admin, "Returning Series")
	seriesID := env.seriesID(t, seriesPublicID)
	publishSeries := func(publishedAt string) {
		t.Helper()
		if _, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
			Tenant:      admin.tenantContext(),
			SeriesId:    seriesID,
			Title:       "Returning Series",
			PublishedAt: publishedAt,
		}); err != nil {
			t.Fatalf("UpdateSeries %q: %v", publishedAt, err)
		}
	}
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
	createEpisode("Scheduled", "2999-01-01T00:00:00Z")
	createEpisode("Draft", "")
	type delivered struct {
		url     string
		eventID string
		data    tenantwebhooks.Episode
	}
	deliveries := func(published string) []delivered {
		t.Helper()
		rows, err := env.PG.DB.QueryContext(context.Background(), `
			SELECT e.url, d.event_id, d.payload->'data'
			FROM webhook_deliveries d
				JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
			WHERE d.tenant_id = $1 AND d.event_type = 'episode.published'
				AND d.payload->'data'->>'published' = $2
			ORDER BY d.created_at, d.payload->'data'->>'episode_public_id'
		`, admin.Tenant.ID, published)
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
	// What a delivery carries is the episode as it stands once the series is
	// public, which dates the episodes published while it was hidden from its
	// instant.
	returned := func(episode *publirattypesv1.Episode) tenantwebhooks.Episode {
		t.Helper()
		res, err := client.GetEpisode(ctx, &publiraadminv1.GetEpisodeRequest{Tenant: admin.tenantContext(), SeriesPublicId: seriesPublicID, PublicId: episode.PublicId})
		if err != nil {
			t.Fatalf("GetEpisode %s: %v", episode.PublicId, err)
		}
		return tenantwebhooks.Episode{
			EpisodePublicID: episode.PublicId,
			SeriesPublicID:  seriesPublicID,
			Title:           episode.Title,
			PublishedAt:     res.Episode.PublishedAt,
			Published:       tenantwebhooks.PublishedSeries,
		}
	}

	// Each episode published while the series was hidden owed its own event,
	// and nothing yet says the series is public.
	if got := deliveries(tenantwebhooks.PublishedEpisode); len(got) != 2 {
		t.Fatalf("deliveries of the episodes' own publication = %+v, want one for each published episode", got)
	}
	if got := deliveries(tenantwebhooks.PublishedSeries); len(got) != 0 {
		t.Fatalf("deliveries before the series is public = %+v, want none", got)
	}

	publishSeries("2000-01-01T00:00:00Z")
	got := deliveries(tenantwebhooks.PublishedSeries)
	if len(got) != 2 {
		t.Fatalf("deliveries after making the series public = %+v, want one for each published episode", got)
	}
	back := map[tenantwebhooks.Episode]bool{got[0].data: true, got[1].data: true}
	if !back[returned(first)] || !back[returned(second)] {
		t.Fatalf("deliveries for the public series = %+v, want %+v and %+v", got, returned(first), returned(second))
	}
	for _, row := range got {
		if row.url != "https://cms.example.com/publira" {
			t.Fatalf("delivery to %s, want only the subscribed endpoint", row.url)
		}
	}

	// The series is public already, so another instant that has passed puts
	// nothing back on the site.
	publishSeries("2000-06-01T00:00:00Z")
	if got := deliveries(tenantwebhooks.PublishedSeries); len(got) != 2 {
		t.Fatalf("deliveries after saving the public series again = %d, want 2", len(got))
	}

	publishSeries("")
	publishSeries("2000-06-01T00:00:00Z")
	got = deliveries(tenantwebhooks.PublishedSeries)
	if len(got) != 4 || got[2].eventID == got[0].eventID || got[2].eventID == got[1].eventID {
		t.Fatalf("deliveries after making the series public again = %+v, want two more events of their own", got)
	}
	if got := deliveries(tenantwebhooks.PublishedEpisode); len(got) != 2 {
		t.Fatalf("deliveries of the episodes' own publication = %d, want them left at 2", len(got))
	}
}

// A save that keeps public a series the apply-series-publications job had yet
// to mark applied continues the job's publication, so it owes nothing the job
// already owed for it: the job names the publication by its instant, and so
// does the save, whatever instant it stores.
func TestDBEpisodePublishedIsOwedOnceWhenASaveTakesOverTheJobsPublication(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT8", "hooks-takeover.example.com", "Hook Takeover Tenant", "HOOKADMIN08", "admin@hooks-takeover.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	if _, err := env.webhookClient().CreateWebhookEndpoint(ctx, &publiraadminv1.CreateWebhookEndpointRequest{
		Tenant:     admin.tenantContext(),
		Url:        "https://cms.example.com/publira",
		EventTypes: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_EPISODE_PUBLISHED},
		Enabled:    true,
	}); err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}

	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, admin, "Taken Over Series")
	seriesID := env.seriesID(t, seriesPublicID)
	if _, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:      admin.tenantContext(),
		SeriesId:    seriesID,
		Title:       "Published",
		ScheduledAt: "2000-01-01T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	// The series' scheduled instant has passed, and the job owed the
	// publication's webhooks under it, then stopped before marking it applied.
	instant := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	var seriesRowID uuid.UUID
	if err := env.PG.DB.QueryRowContext(context.Background(),
		"UPDATE series SET is_published = true, published_at = $2, publication_revalidated_at = NULL WHERE public_id = $1 RETURNING id",
		seriesPublicID, instant,
	).Scan(&seriesRowID); err != nil {
		t.Fatalf("publish the series: %v", err)
	}
	job, err := env.PG.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin the job's transaction: %v", err)
	}
	if err := tenantwebhooks.QueueSeriesPublished(context.Background(), dbmodels.New(job), admin.Tenant.ID, seriesRowID, instant); err != nil {
		_ = job.Rollback()
		t.Fatalf("QueueSeriesPublished: %v", err)
	}
	if err := job.Commit(); err != nil {
		t.Fatalf("commit the job's transaction: %v", err)
	}

	if _, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
		Tenant:      admin.tenantContext(),
		SeriesId:    seriesID,
		Title:       "Taken Over Series",
		PublishedAt: "2000-06-01T00:00:00Z",
	}); err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	var owed int
	if err := env.PG.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM webhook_deliveries
		WHERE tenant_id = $1 AND event_type = 'episode.published' AND payload->'data'->>'published' = 'series'
	`, admin.Tenant.ID).Scan(&owed); err != nil {
		t.Fatalf("count the deliveries: %v", err)
	}
	if owed != 1 {
		t.Fatalf("deliveries of the series' publication = %d, want the one the job owed", owed)
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

// Deleting a published episode owes episode.unpublished to the endpoints that
// subscribed to it, once, naming the episode as deleted, and it is read before
// the episode's rows are gone. Deleting a draft or a scheduled episode owes
// nothing, since neither was on the site. An endpoint that did not subscribe
// to it is owed none.
func TestDBEpisodeUnpublishedIsOwedWhenAPublishedEpisodeIsDeleted(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "HOOKTENANT6", "hooks-delete.example.com", "Hook Delete Tenant", "HOOKADMIN06", "admin@hooks-delete.example.com")
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
	seriesPublicID := createDBSeries(t, client, admin, "Deleted Episodes Series")
	seriesID := env.seriesID(t, seriesPublicID)
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
	deleteEpisode := func(episode *publirattypesv1.Episode) {
		t.Helper()
		if _, err := client.DeleteEpisode(ctx, &publiraadminv1.DeleteEpisodeRequest{
			Tenant:    admin.tenantContext(),
			EpisodeId: episode.Id,
		}); err != nil {
			t.Fatalf("DeleteEpisode %s: %v", episode.PublicId, err)
		}
	}
	type delivered struct {
		url  string
		data tenantwebhooks.EpisodeWithdrawal
	}
	deliveries := func() []delivered {
		t.Helper()
		rows, err := env.PG.DB.QueryContext(context.Background(), `
			SELECT e.url, d.payload->'data'
			FROM webhook_deliveries d
				JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
			WHERE d.tenant_id = $1 AND d.event_type = 'episode.unpublished'
			ORDER BY d.created_at
		`, admin.Tenant.ID)
		if err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		defer func() { _ = rows.Close() }()
		var got []delivered
		for rows.Next() {
			var row delivered
			var data []byte
			if err := rows.Scan(&row.url, &data); err != nil {
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

	deleteEpisode(createEpisode("Draft", ""))
	deleteEpisode(createEpisode("Scheduled", "2999-01-01T00:00:00Z"))
	if got := deliveries(); len(got) != 0 {
		t.Fatalf("deliveries after deleting a draft and a scheduled episode = %+v, want none", got)
	}

	// The series is not public, which a published episode's deletion does not
	// wait on, as clearing its schedule does not.
	published := createEpisode("Published", "2000-01-01T00:00:00Z")
	deleteEpisode(published)
	got := deliveries()
	want := tenantwebhooks.EpisodeWithdrawal{EpisodePublicID: published.PublicId, SeriesPublicID: seriesPublicID, Withdrawn: tenantwebhooks.WithdrawnDeleted}
	if len(got) != 1 || got[0].url != "https://cms.example.com/publira" || got[0].data != want {
		t.Fatalf("deliveries after deleting the published episode = %+v, want one %+v to the subscribed endpoint", got, want)
	}
}

// A comment approved owes comment.posted to the endpoints that subscribed to
// it, once: a refused second approval owes nothing, nor does restoring it after
// staff hid it, and a comment hidden or withdrawn while it waited for approval
// owes none at all. The event names the writer by their public id and display
// name and carries no address. An endpoint that did not subscribe is owed none.
func TestDBCommentPostedIsOwedOnceWhenACommentIsApproved(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "CWH", "comment-hooks.example.com")
	admin := fixture.admin
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for _, endpoint := range []struct {
		url    string
		events []publiraadminv1.WebhookEventType
	}{
		{url: "https://cms.example.com/publira", events: []publiraadminv1.WebhookEventType{publiraadminv1.WebhookEventType_WEBHOOK_EVENT_TYPE_COMMENT_POSTED}},
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

	client := env.commentClient()
	moderate := func(action string, commentID string) error {
		t.Helper()
		var err error
		switch action {
		case "approve":
			_, err = client.ApproveComment(ctx, &publiraadminv1.ApproveCommentRequest{Tenant: admin.tenantContext(), CommentId: commentID})
		case "hide":
			_, err = client.HideComment(ctx, &publiraadminv1.HideCommentRequest{Tenant: admin.tenantContext(), CommentId: commentID})
		case "restore":
			_, err = client.RestoreComment(ctx, &publiraadminv1.RestoreCommentRequest{Tenant: admin.tenantContext(), CommentId: commentID})
		}
		return err
	}
	type delivered struct {
		url  string
		raw  string
		data tenantwebhooks.Comment
	}
	deliveries := func() []delivered {
		t.Helper()
		rows, err := env.PG.DB.QueryContext(context.Background(), `
			SELECT e.url, d.payload->'data'
			FROM webhook_deliveries d
				JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
			WHERE d.tenant_id = $1 AND d.event_type = 'comment.posted'
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
			if err := rows.Scan(&row.url, &data); err != nil {
				t.Fatalf("scan a delivery: %v", err)
			}
			if err := json.Unmarshal(data, &row.data); err != nil {
				t.Fatalf("decode a delivery's data %s: %v", data, err)
			}
			row.raw = string(data)
			got = append(got, row)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list the deliveries: %v", err)
		}
		return got
	}

	approved := fixture.seedComment(t, "CWHAPPROVE1", "pending")
	if err := moderate("approve", approved.ID.String()); err != nil {
		t.Fatalf("ApproveComment: %v", err)
	}
	got := deliveries()
	if len(got) != 1 || got[0].url != "https://cms.example.com/publira" {
		t.Fatalf("deliveries after approving a comment = %+v, want one to the subscribed endpoint", got)
	}
	data := got[0].data
	want := tenantwebhooks.Comment{
		CommentPublicID: approved.PublicID,
		EpisodePublicID: fixture.episode.PublicID,
		SeriesPublicID:  fixture.series.PublicID,
		Body:            approved.Body,
		AuthorPublicID:  fixture.readerPublicID,
		AuthorName:      "Reader CWH",
		PublishedAt:     data.PublishedAt,
	}
	if data.PublishedAt == "" || data != want {
		t.Fatalf("data of the approved comment = %+v, want %+v with its publication time", data, want)
	}
	if strings.Contains(got[0].raw, "comment-hooks.example.com") {
		t.Fatalf("data of the approved comment = %s, want it without the writer's address", got[0].raw)
	}

	// A second approval is refused, and a comment hidden and restored becomes
	// visible again without being posted again.
	if err := moderate("approve", approved.ID.String()); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ApproveComment on a published comment error = %v, want failed_precondition", err)
	}
	for _, action := range []string{"hide", "restore"} {
		if err := moderate(action, approved.ID.String()); err != nil {
			t.Fatalf("%s the approved comment: %v", action, err)
		}
	}
	if got := deliveries(); len(got) != 1 {
		t.Fatalf("deliveries after hiding and restoring the approved comment = %d, want 1", len(got))
	}

	// A comment hidden while it waited goes back to waiting when restored, and
	// one its writer withdrew cannot be approved: neither became visible.
	hidden := fixture.seedComment(t, "CWHHIDDEN01", "pending")
	for _, action := range []string{"hide", "restore", "hide"} {
		if err := moderate(action, hidden.ID.String()); err != nil {
			t.Fatalf("%s the waiting comment: %v", action, err)
		}
	}
	withdrawn := fixture.seedComment(t, "CWHWITHDRW1", "pending")
	fixture.withdrawComment(t, withdrawn.ID)
	if err := moderate("approve", withdrawn.ID.String()); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ApproveComment on a withdrawn comment error = %v, want failed_precondition", err)
	}
	if got := deliveries(); len(got) != 1 {
		t.Fatalf("deliveries after hiding and withdrawing waiting comments = %+v, want the approved comment's alone", got)
	}
}
