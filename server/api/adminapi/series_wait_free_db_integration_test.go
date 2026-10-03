package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
)

func (e *adminDBEnv) accessTicketClient() publiraadminv1connect.AdminAccessTicketServiceClient {
	return publiraadminv1connect.NewAdminAccessTicketServiceClient(e.Server.Client(), e.Server.URL)
}

// A series nobody configured answers the defaults, an editor saves the whole
// rule, and turning it off keeps the numbers for the next time it is on.
func TestDBSeriesWaitFreeSettingsRoundTrip(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor))
	client := env.seriesClient()
	seriesID := env.seriesID(t, createDBSeries(t, client, admin, "Wait-Free Series"))

	get := func(t *testing.T) *publiraadminv1.SeriesWaitFreeSettings {
		t.Helper()
		resp, err := client.GetSeriesWaitFreeSettings(context.Background(), newAdminDBRequest(editor, &publiraadminv1.GetSeriesWaitFreeSettingsRequest{
			Tenant:   editor.tenantContext(),
			SeriesId: seriesID,
		}))
		if err != nil {
			t.Fatalf("GetSeriesWaitFreeSettings: %v", err)
		}
		return resp.Msg.Settings
	}
	update := func(t *testing.T, settings *publiraadminv1.SeriesWaitFreeSettings) *publiraadminv1.SeriesWaitFreeSettings {
		t.Helper()
		resp, err := client.UpdateSeriesWaitFreeSettings(context.Background(), newAdminDBRequest(editor, &publiraadminv1.UpdateSeriesWaitFreeSettingsRequest{
			Tenant:   editor.tenantContext(),
			SeriesId: seriesID,
			Settings: settings,
		}))
		if err != nil {
			t.Fatalf("UpdateSeriesWaitFreeSettings: %v", err)
		}
		return resp.Msg.Settings
	}

	defaults := &publiraadminv1.SeriesWaitFreeSettings{RechargeHours: 23, AccessHours: 72}
	if got := get(t); !proto.Equal(got, defaults) {
		t.Fatalf("settings of an unconfigured series = %v, want %v", got, defaults)
	}

	on := &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, RechargeHours: 12, AccessHours: 48, ExcludedLatestCount: 3}
	if got := update(t, on); !proto.Equal(got, on) {
		t.Fatalf("saved settings = %v, want %v", got, on)
	}
	if got := get(t); !proto.Equal(got, on) {
		t.Fatalf("settings read back = %v, want %v", got, on)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'series_wait_free_settings_updated' AND target_type = 'series' AND outcome = 'success'",
		admin.Tenant.ID,
	); got != 1 {
		t.Fatalf("audit rows = %d, want 1", got)
	}

	off := &publiraadminv1.SeriesWaitFreeSettings{RechargeHours: 12, AccessHours: 48, ExcludedLatestCount: 3}
	update(t, off)
	if got := get(t); !proto.Equal(got, off) {
		t.Fatalf("settings after turning the rule off = %v, want %v", got, off)
	}
}

func TestDBUpdateSeriesWaitFreeSettingsRefusals(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesID := env.seriesID(t, createDBSeries(t, client, tenant, "Wait-Free Series"))
	otherSeriesID := env.seriesID(t, createDBSeries(t, client, other, "Elsewhere"))

	valid := func() *publiraadminv1.SeriesWaitFreeSettings {
		return &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, RechargeHours: 23, AccessHours: 72}
	}
	for _, tt := range []struct {
		name     string
		seriesID string
		settings *publiraadminv1.SeriesWaitFreeSettings
		code     connect.Code
	}{
		{name: "no settings", seriesID: seriesID, code: connect.CodeInvalidArgument},
		{name: "no recharge", seriesID: seriesID, settings: &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, AccessHours: 72}, code: connect.CodeInvalidArgument},
		{name: "a recharge past a year", seriesID: seriesID, settings: &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, RechargeHours: 8761, AccessHours: 72}, code: connect.CodeInvalidArgument},
		{name: "no access period", seriesID: seriesID, settings: &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, RechargeHours: 23}, code: connect.CodeInvalidArgument},
		{name: "a negative exclusion", seriesID: seriesID, settings: &publiraadminv1.SeriesWaitFreeSettings{Enabled: true, RechargeHours: 23, AccessHours: 72, ExcludedLatestCount: -1}, code: connect.CodeInvalidArgument},
		{name: "a malformed series id", seriesID: "not-an-id", settings: valid(), code: connect.CodeInvalidArgument},
		{name: "a series that does not exist", seriesID: uuid.Must(uuid.NewV7()).String(), settings: valid(), code: connect.CodeNotFound},
		{name: "another tenant's series", seriesID: otherSeriesID, settings: valid(), code: connect.CodeNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := client.UpdateSeriesWaitFreeSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesWaitFreeSettingsRequest{
				Tenant:   tenant.tenantContext(),
				SeriesId: tt.seriesID,
				Settings: tt.settings,
			}))
			if connect.CodeOf(err) != tt.code {
				t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), tt.code, err)
			}
		})
	}

	_, err := client.GetSeriesWaitFreeSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesWaitFreeSettingsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: otherSeriesID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeriesWaitFreeSettings of another tenant's series: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM series_wait_free_settings"); got != 0 {
		t.Fatalf("stored rules = %d, want none", got)
	}
}

// A reader's wait-for-free ticket on an episode is theirs, not one staff
// issued: IssueAccessTicket neither hands it back as the existing ticket nor
// collides with it, and the list tells the two apart.
func TestDBIssueAccessTicketBesideAWaitFreeTicket(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesClient := env.seriesClient()
	episodePublicID := createDBEpisode(t, seriesClient, tenant, createDBSeries(t, seriesClient, tenant, "Ticket Series"), "Chapter One")
	episodeID := env.episodeID(t, episodePublicID)
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at, source)
		VALUES ($1, $2, 'TICKETWAIT01', $3, $4, NOW() + INTERVAL '72 hours', 'wait_free')
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, episodeID, reader.ID); err != nil {
		t.Fatalf("seed wait-free ticket: %v", err)
	}

	client := env.accessTicketClient()
	issued, err := client.IssueAccessTicket(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.IssueAccessTicketRequest{
		Tenant:    tenant.tenantContext(),
		UserId:    reader.ID.String(),
		EpisodeId: episodeID,
	}))
	if err != nil {
		t.Fatalf("IssueAccessTicket: %v", err)
	}
	if issued.Msg.Ticket.PublicId == "TICKETWAIT01" || issued.Msg.Ticket.Source != "staff" {
		t.Fatalf("issued ticket = %s (%s), want a new staff ticket", issued.Msg.Ticket.PublicId, issued.Msg.Ticket.Source)
	}

	listed, err := client.ListAccessTickets(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListAccessTicketsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
	}))
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	sources := map[string]string{}
	for _, ticket := range listed.Msg.Tickets {
		sources[ticket.PublicId] = ticket.Source
	}
	if len(sources) != 2 || sources["TICKETWAIT01"] != "wait_free" || sources[issued.Msg.Ticket.PublicId] != "staff" {
		t.Fatalf("listed sources = %v, want the wait-free ticket and the staff one", sources)
	}
}
