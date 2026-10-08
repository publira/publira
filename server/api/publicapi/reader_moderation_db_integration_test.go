package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/ageverification"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// What a tenant admin does to a reader through AdminUserService is only worth
// something if the storefront answers to it, so these cases act through the
// admin API and observe through the public one.

type adminReaderConsole struct {
	client publiraadminv1connect.AdminUserServiceClient
	tenant *publirattypesv1.TenantContext
	token  string
}

func (e *publicDBEnv) openAdminReaderConsole(t *testing.T, tenant testutil.Tenant) adminReaderConsole {
	t.Helper()

	staff := e.PG.SeedTenantAdmin(t, tenant.ID, "READERADMIN1", "admin@"+tenant.Domain, "Admin")
	console := e.openAdminConsole(t, tenant, staff)
	return adminReaderConsole{
		client: publiraadminv1connect.NewAdminUserServiceClient(connect.NewClient(connecthttp.NewTransport(console.server.Client(), console.server.URL))),
		tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		token:  console.token,
	}
}

func (c adminReaderConsole) suspend(t *testing.T, readerID string) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := c.client.SuspendReader(testutil.WithBearer(context.Background(), c.token), &publiraadminv1.SuspendReaderRequest{Tenant: c.tenant, ReaderId: readerID})
	if err != nil {
		t.Fatalf("SuspendReader %s: %v", readerID, err)
	}
	return res.Reader
}

func (c adminReaderConsole) unsuspend(t *testing.T, readerID string) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := c.client.UnsuspendReader(testutil.WithBearer(context.Background(), c.token), &publiraadminv1.UnsuspendReaderRequest{Tenant: c.tenant, ReaderId: readerID})
	if err != nil {
		t.Fatalf("UnsuspendReader %s: %v", readerID, err)
	}
	return res.Reader
}

func loginReader(client publirav1connect.AuthServiceClient, tenant testutil.Tenant, email string) (*publirav1.LoginResponse, error) {
	return client.Login(context.Background(), &publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    email,
		Password: testutil.SeededPassword,
	})
}

func TestDBAdminSuspensionRefusesTheReaderUntilItIsLifted(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	login, err := loginReader(client, tenant, reader.Email)
	if err != nil {
		t.Fatalf("Login before the suspension: %v", err)
	}
	session := login.AccessToken.Token

	if got := console.suspend(t, reader.ID.String()); got.Status != "suspended" {
		t.Fatalf("suspended reader status = %q, want suspended", got.Status)
	}

	if _, err := client.GetMe(testutil.WithBearer(context.Background(), session), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a session from before the suspension = %v, want unauthenticated", err)
	}
	// The same refusal a platform suspension produces.
	if _, err := loginReader(client, tenant, reader.Email); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login while suspended = %v, want failed_precondition", err)
	}

	if got := console.unsuspend(t, reader.ID.String()); got.Status != "active" {
		t.Fatalf("unsuspended reader status = %q, want active", got.Status)
	}

	// Lifting the suspension does not bring back the sessions it ended.
	if _, err := client.GetMe(testutil.WithBearer(context.Background(), session), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a session from before the suspension after it was lifted = %v, want unauthenticated", err)
	}
	relogin, err := loginReader(client, tenant, reader.Email)
	if err != nil {
		t.Fatalf("Login after the suspension was lifted: %v", err)
	}
	if _, err := client.GetMe(testutil.WithBearer(context.Background(), relogin.AccessToken.Token), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)}); err != nil {
		t.Fatalf("GetMe with a session from after the suspension was lifted: %v", err)
	}
}

// Confirming an address activates an account that was waiting for it, and
// nothing else: a reader suspended before opening the link stays suspended.
func TestDBVerifyUserEmailDoesNotLiftAnAdminSuspension(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "pending-token", time.Now().Add(time.Hour))
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	console.suspend(t, pending.ID.String())

	if _, err := client.VerifyUserEmail(context.Background(), &publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  "pending-token",
	}); err != nil {
		t.Fatalf("VerifyUserEmail while suspended: %v", err)
	}
	if _, err := loginReader(client, tenant, pending.Email); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login after confirming the address while suspended = %v, want failed_precondition", err)
	}

	// The address was confirmed all the same, so lifting the suspension leaves
	// nothing more to wait for.
	if got := console.unsuspend(t, pending.ID.String()); got.Status != "active" {
		t.Fatalf("unsuspended reader status = %q, want active", got.Status)
	}
	if _, err := loginReader(client, tenant, pending.Email); err != nil {
		t.Fatalf("Login after the suspension was lifted: %v", err)
	}
}

// A reader who never confirmed their address goes back to waiting for it,
// rather than to an active account nobody confirmed.
func TestDBAdminUnsuspendReturnsAnUnconfirmedReaderToInactive(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "pending-token", time.Now().Add(time.Hour))
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	console.suspend(t, pending.ID.String())
	if got := console.unsuspend(t, pending.ID.String()); got.Status != "inactive" {
		t.Fatalf("unsuspended unconfirmed reader status = %q, want inactive", got.Status)
	}

	if _, err := client.VerifyUserEmail(context.Background(), &publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  "pending-token",
	}); err != nil {
		t.Fatalf("VerifyUserEmail after the suspension was lifted: %v", err)
	}
	if _, err := loginReader(client, tenant, pending.Email); err != nil {
		t.Fatalf("Login after confirming the address: %v", err)
	}
}

// An account a tenant admin deletes is gone the way DeleteMe leaves one: the
// session and the sign-in both stop, and the purchases stay without the buyer.
func TestDBAdminDeleteReaderLeavesWhatDeleteMeLeaves(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	buyer := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "buyer@tenant-a.example.com", "Buyer")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODE00001",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedPurchase(t, tenant.ID, buyer.ID, episode.ID, 300)
	session := tokenFor(t, tenant, buyer)
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	res, err := console.client.DeleteReader(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.DeleteReaderRequest{
		Tenant:   console.tenant,
		ReaderId: buyer.ID.String(),
	})
	if err != nil {
		t.Fatalf("DeleteReader: %v", err)
	}
	if res.PublicId != buyer.PublicID {
		t.Fatalf("deleted public_id = %q, want %q", res.PublicId, buyer.PublicID)
	}

	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", buyer.ID); count != 0 {
		t.Fatalf("users rows for the deleted reader = %d, want 0", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM purchases WHERE tenant_id = $1 AND episode_id = $2 AND user_id IS NULL",
		tenant.ID, episode.ID,
	); count != 1 {
		t.Fatalf("purchases kept without the buyer = %d, want 1", count)
	}

	if _, err := client.GetMe(testutil.WithBearer(context.Background(), session), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the deleted reader's session = %v, want unauthenticated", err)
	}
	if _, err := loginReader(client, tenant, buyer.Email); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login as the deleted reader = %v, want unauthenticated", err)
	}
}

// A reader cannot rewrite their own birth date, so staff correct a wrong one.
// The session the reader already holds is decided on the corrected date.
func TestDBAdminBirthDateCorrectionDecidesTheNextAgeGatedRead(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	setTenantAgeVerification(t, env, tenant.ID, ageverification.R18)
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEAGE01",
		Title:    "Rated Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	setBirthDate(t, env, reader.ID, birthDateForAge(t, tenant, 16, false))
	session := tokenFor(t, tenant, reader)
	console := env.openAdminReaderConsole(t, tenant)

	access := func(t *testing.T) publirav1.EpisodeAccess {
		t.Helper()
		resp, err := env.catalogClient().GetEpisodeDetail(testutil.WithBearer(context.Background(), session), &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		return resp.Access
	}
	setByStaff := func(t *testing.T, birthDate string) {
		t.Helper()
		if _, err := console.client.SetReaderBirthDate(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.SetReaderBirthDateRequest{
			Tenant:    console.tenant,
			ReaderId:  reader.ID.String(),
			BirthDate: birthDate,
		}); err != nil {
			t.Fatalf("SetReaderBirthDate %q: %v", birthDate, err)
		}
	}

	if got := access(t); got != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access on the date the reader gave = %v, want age restricted", got)
	}
	setByStaff(t, ageverification.FormatBirthDate(birthDateForAge(t, tenant, 30, false)))
	if got := access(t); got != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access after staff corrected the date = %v, want free", got)
	}
	setByStaff(t, "")
	if got := access(t); got != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access after staff cleared the date = %v, want age restricted", got)
	}
}
