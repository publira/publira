package publicapi

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBGetAnnouncementReturnsTheTenantsRowByID(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	broadcastID := insertAnnouncement(t, env, tenant.ID, "/series/S001", "Broadcast")

	client := env.authClient()
	token := tokenFor(t, tenant, member)

	broadcast, err := client.GetAnnouncement(testutil.WithBearer(context.Background(), token), &publirav1.GetAnnouncementRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: broadcastID.String(),
	})
	if err != nil {
		t.Fatalf("GetAnnouncement broadcast: %v", err)
	}
	if broadcast.Announcement.Id != broadcastID.String() {
		t.Fatalf("broadcast id = %q, want %q", broadcast.Announcement.Id, broadcastID)
	}
	if broadcast.Announcement.LinkUrl != "/series/S001" {
		t.Fatalf("broadcast link_url = %q, want /series/S001", broadcast.Announcement.LinkUrl)
	}
	if broadcast.Announcement.Title != "Broadcast" {
		t.Fatalf("broadcast title = %q, want Broadcast", broadcast.Announcement.Title)
	}
}

func TestDBGetAnnouncementHidesRowsOutsideTheTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	foreign := insertAnnouncement(t, env, second.ID, "/series/FOREIGN", "Another tenant")
	missing := uuid.Must(uuid.NewV7())

	client := env.authClient()
	token := tokenFor(t, first, member)

	for _, announcementID := range []uuid.UUID{foreign, missing} {
		_, err := client.GetAnnouncement(testutil.WithBearer(context.Background(), token), &publirav1.GetAnnouncementRequest{
			Tenant:         tenantContext(first),
			AnnouncementId: announcementID.String(),
		})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetAnnouncement %s code = %v, want not_found (err=%v)", announcementID, connect.CodeOf(err), err)
		}
		if err.Error() != "not_found: announcement not found" {
			t.Fatalf("GetAnnouncement %s error = %q, want existence hidden", announcementID, err)
		}
	}
}

func insertAnnouncement(
	t *testing.T,
	env *publicDBEnv,
	tenantID uuid.UUID,
	linkURL, title string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO announcements (
			id, tenant_id, announcement_type, link_url
		) VALUES ($1, $2, 'announcement', $3)
	`, id, tenantID, sql.NullString{String: linkURL, Valid: linkURL != ""}); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	insertAnnouncementTranslation(t, env, tenantID, id, "", title, "Body")
	return id
}

// insertAnnouncementTranslation writes one locale's copy of an announcement. An
// empty locale writes the tenant default locale's.
func insertAnnouncementTranslation(
	t *testing.T,
	env *publicDBEnv,
	tenantID, announcementID uuid.UUID,
	locale, title, body string,
) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		SELECT uuidv7(), $1, t.id, COALESCE(NULLIF($3, ''), t.default_locale), $4, $5
		FROM tenants t
		WHERE t.id = $2
	`, announcementID, tenantID, locale, title, body); err != nil {
		t.Fatalf("insert announcement translation: %v", err)
	}
}

// An announcement is read in the locale the request names where it was written
// in it, and in the tenant default locale's otherwise, and the answer names the
// locale it is in and every locale the announcement has.
func TestDBAnnouncementsAreReadInTheRequestedLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	defaultLocale := tenantDefaultLocale(t, env, tenant.ID)
	if defaultLocale == "en" {
		t.Fatal("the seeded tenant defaults to en, which would hide the fallback this test is about")
	}

	onlyDefault := insertAnnouncement(t, env, tenant.ID, "", "Maintenance tonight (default)")
	translated := insertAnnouncement(t, env, tenant.ID, "", "Sale this week (default)")
	insertAnnouncementTranslation(t, env, tenant.ID, translated, "en", "Sale this week", "Every volume is half price.")

	client := env.authClient()
	for _, tc := range []struct {
		name           string
		announcementID uuid.UUID
		title, locale  string
		locales        []string
	}{
		{name: "only the default locale", announcementID: onlyDefault, title: "Maintenance tonight (default)", locale: defaultLocale, locales: []string{defaultLocale}},
		{name: "written in en", announcementID: translated, title: "Sale this week", locale: "en", locales: sortedLocales("en", defaultLocale)},
	} {
		got, err := client.GetAnnouncement(context.Background(), &publirav1.GetAnnouncementRequest{
			Tenant:         tenantContext(tenant),
			AnnouncementId: tc.announcementID.String(),
			Locale:         "en",
		})
		if err != nil {
			t.Fatalf("%s: GetAnnouncement: %v", tc.name, err)
		}
		if got.Announcement.Title != tc.title || got.Announcement.Locale != tc.locale {
			t.Fatalf("%s: announcement = (%q, %q), want (%q, %q)", tc.name, got.Announcement.Title, got.Announcement.Locale, tc.title, tc.locale)
		}
		if !slices.Equal(got.Locales, tc.locales) {
			t.Fatalf("%s: locales = %v, want %v", tc.name, got.Locales, tc.locales)
		}
	}

	listed, err := client.ListAnnouncements(context.Background(), &publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
		Locale: "en",
	})
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	var titles []string
	for _, item := range listed.Announcements {
		titles = append(titles, item.Locale+":"+item.Title)
	}
	if want := []string{"en:Sale this week", defaultLocale + ":Maintenance tonight (default)"}; !slices.Equal(titles, want) {
		t.Fatalf("listed = %v, want %v", titles, want)
	}
}

// A signed-in reader's request that names a locale records it as their last
// locale, whichever RPC it is, and a request that names none leaves it as it
// was. A visitor with no session records nothing.
func TestDBSignedInRequestsRecordTheReadersLastLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, member)
	client := env.authClient()

	lastLocale := func() sql.NullString {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var stored sql.NullString
		if err := env.PG.DB.QueryRowContext(ctx, `SELECT last_locale FROM users WHERE id = $1`, member.ID).Scan(&stored); err != nil {
			t.Fatalf("read last_locale: %v", err)
		}
		return stored
	}

	if _, err := client.ListAnnouncements(context.Background(), &publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
		Locale: "en",
	}); err != nil {
		t.Fatalf("ListAnnouncements as a visitor: %v", err)
	}
	if got := lastLocale(); got.Valid {
		t.Fatalf("last_locale after a visitor's request = %q, want none", got.String)
	}

	if _, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), token), &publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
		Locale: "en",
	}); err != nil {
		t.Fatalf("ListAnnouncements in en: %v", err)
	}
	if got := lastLocale(); got.String != "en" {
		t.Fatalf("last_locale after a request in en = %v, want en", got)
	}

	if _, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), token), &publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
	}); err != nil {
		t.Fatalf("ListAnnouncements with no locale: %v", err)
	}
	if got := lastLocale(); got.String != "en" {
		t.Fatalf("last_locale after a request naming no locale = %v, want en kept", got)
	}

	if _, err := client.GetMyLegalPageAgreements(testutil.WithBearer(context.Background(), token), &publirav1.GetMyLegalPageAgreementsRequest{
		Tenant: tenantContext(tenant),
		Locale: "ko",
	}); err != nil {
		t.Fatalf("GetMyLegalPageAgreements in ko: %v", err)
	}
	if got := lastLocale(); got.String != "ko" {
		t.Fatalf("last_locale after another RPC in ko = %v, want ko", got)
	}
}

func tenantDefaultLocale(t *testing.T, env *publicDBEnv, tenantID uuid.UUID) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var locale string
	if err := env.PG.DB.QueryRowContext(ctx, `SELECT default_locale FROM tenants WHERE id = $1`, tenantID).Scan(&locale); err != nil {
		t.Fatalf("read default locale: %v", err)
	}
	return locale
}

func sortedLocales(locales ...string) []string {
	slices.Sort(locales)
	return locales
}
