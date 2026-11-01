package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/testutil"
)

// audienceFixture is one tenant to evaluate an audience against, with the
// helpers that put its readers in the state a condition asks about.
type audienceFixture struct {
	t      *testing.T
	pg     *testutil.PostgresEnv
	tenant testutil.Tenant
}

func newAudienceFixture(t *testing.T, pg *testutil.PostgresEnv) *audienceFixture {
	t.Helper()
	id := mustPublicID(t)
	return &audienceFixture{
		t:      t,
		pg:     pg,
		tenant: pg.SeedTenant(t, id, strings.ToLower(id)+".audience.example.com", "Audience "+id),
	}
}

func mustPublicID(t *testing.T) string {
	t.Helper()
	id, err := publicid.New()
	if err != nil {
		t.Fatalf("publicid.New: %v", err)
	}
	return id
}

func (f *audienceFixture) reader(name string) uuid.UUID {
	f.t.Helper()
	id := mustPublicID(f.t)
	return f.pg.SeedEndUser(f.t, f.tenant.ID, id, strings.ToLower(id)+"@audience.example.com", name).ID
}

func (f *audienceFixture) exec(query string, args ...any) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := f.pg.DB.ExecContext(ctx, query, args...); err != nil {
		f.t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *audienceFixture) series() testutil.Series {
	f.t.Helper()
	return f.pg.SeedSeries(f.t, f.tenant.ID, testutil.SeriesSeed{PublicID: mustPublicID(f.t), Title: "Series", Published: true})
}

func (f *audienceFixture) episode(series testutil.Series) uuid.UUID {
	f.t.Helper()
	return f.pg.SeedEpisode(f.t, f.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: mustPublicID(f.t),
		Title:    "Episode",
		Price:    100,
		Status:   testutil.EpisodeStatusPublished,
	}).ID
}

func (f *audienceFixture) follow(userID uuid.UUID, series testutil.Series) {
	f.t.Helper()
	f.exec("INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", f.tenant.ID, userID, series.ID)
}

func (f *audienceFixture) buy(userID, episodeID uuid.UUID) {
	f.t.Helper()
	f.pg.SeedPurchase(f.t, f.tenant.ID, userID, episodeID, 100)
}

func (f *audienceFixture) read(userID, episodeID uuid.UUID, at time.Time) {
	f.t.Helper()
	f.exec("INSERT INTO episode_reads (id, tenant_id, user_id, episode_id, read_at) VALUES (uuidv7(), $1, $2, $3, $4)",
		f.tenant.ID, userID, episodeID, at)
}

func (f *audienceFixture) position(userID, episodeID uuid.UUID, at time.Time) {
	f.t.Helper()
	f.exec("INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count, updated_at) VALUES ($1, $2, $3, 0, 1, $4)",
		f.tenant.ID, userID, episodeID, at)
}

func (f *audienceFixture) subscribe(userID, planID uuid.UUID, status string) {
	f.t.Helper()
	f.pg.SeedSubscription(f.t, f.tenant.ID, userID, planID, testutil.SubscriptionSeed{Status: status})
}

// members answers announcement_audience_members for the fixture's tenant, in id
// order.
func (f *audienceFixture) members(audience *string) []uuid.UUID {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := f.pg.DB.QueryContext(ctx, "SELECT announcement_audience_members($1, $2::jsonb) ORDER BY 1", f.tenant.ID, audience)
	if err != nil {
		f.t.Fatalf("announcement_audience_members: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			f.t.Fatalf("scan member: %v", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		f.t.Fatalf("iterate members: %v", err)
	}
	return ids
}

func sortedIDs(ids ...uuid.UUID) []uuid.UUID {
	sorted := slices.Clone(ids)
	slices.SortFunc(sorted, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	return sorted
}

// Each condition selects the reader who meets it and leaves out the one who
// does not, and two conditions together select only the reader who meets both.
func TestAnnouncementAudienceMembersSelectsTheReadersEachConditionNames(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	for _, tc := range []struct {
		name string
		// setup seeds the readers and answers the audience and the readers it
		// should select.
		setup func(f *audienceFixture) (audience string, want []uuid.UUID)
	}{
		{
			name: "follows_series",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				followed, other := f.series(), f.series()
				match, miss := f.reader("Follower"), f.reader("Follower of another series")
				f.follow(match, followed)
				f.follow(miss, other)
				return `{"version": 1, "conditions": [{"type": "follows_series", "series_id": "` + followed.ID.String() + `"}]}`, []uuid.UUID{match}
			},
		},
		{
			name: "bought_series_episode",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				bought, other := f.series(), f.series()
				match, elsewhere, revoked := f.reader("Buyer"), f.reader("Buyer of another series"), f.reader("Refunded buyer")
				f.buy(match, f.episode(bought))
				f.buy(elsewhere, f.episode(other))
				refunded := f.episode(bought)
				f.buy(revoked, refunded)
				f.exec("UPDATE purchases SET revoked_at = NOW(), revocation_reason = 'staff' WHERE user_id = $1", revoked)
				return `{"version": 1, "conditions": [{"type": "bought_series_episode", "series_id": "` + bought.ID.String() + `"}]}`, []uuid.UUID{match}
			},
		},
		{
			name: "subscription active to any plan",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				plan := f.pg.SeedSubscriptionPlan(f.t, f.tenant.ID, testutil.SubscriptionPlanSeed{})
				trialing, pastDue, canceled := f.reader("Trialing"), f.reader("Past due"), f.reader("Canceled")
				f.reader("Never subscribed")
				f.subscribe(trialing, plan.ID, "trialing")
				f.subscribe(pastDue, plan.ID, "past_due")
				f.subscribe(canceled, plan.ID, "canceled")
				return `{"version": 1, "conditions": [{"type": "subscription", "plan_id": null, "state": "active"}]}`, []uuid.UUID{trialing, pastDue}
			},
		},
		{
			name: "subscription active to one plan",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				plan := f.pg.SeedSubscriptionPlan(f.t, f.tenant.ID, testutil.SubscriptionPlanSeed{})
				other := f.pg.SeedSubscriptionPlan(f.t, f.tenant.ID, testutil.SubscriptionPlanSeed{})
				match, miss := f.reader("Subscriber"), f.reader("Subscriber to another plan")
				f.subscribe(match, plan.ID, "active")
				f.subscribe(miss, other.ID, "active")
				return `{"version": 1, "conditions": [{"type": "subscription", "plan_id": "` + plan.ID.String() + `", "state": "active"}]}`, []uuid.UUID{match}
			},
		},
		{
			name: "subscription ended",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				plan := f.pg.SeedSubscriptionPlan(f.t, f.tenant.ID, testutil.SubscriptionPlanSeed{})
				lapsed, resubscribed, active := f.reader("Lapsed"), f.reader("Resubscribed"), f.reader("Active")
				f.reader("Never subscribed")
				f.subscribe(lapsed, plan.ID, "canceled")
				f.subscribe(resubscribed, plan.ID, "canceled")
				f.subscribe(resubscribed, plan.ID, "active")
				f.subscribe(active, plan.ID, "active")
				return `{"version": 1, "conditions": [{"type": "subscription", "plan_id": null, "state": "ended"}]}`, []uuid.UUID{lapsed}
			},
		},
		{
			name: "never_purchased",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				series := f.series()
				match, tested, buyer := f.reader("Browser"), f.reader("Test purchaser"), f.reader("Buyer")
				f.buy(buyer, f.episode(series))
				f.exec(`INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, provider, provider_checkout_id, is_test, currency)
					VALUES (uuidv7(), $1, $2, $3, 100, 'stripe', $4, true, $5)`,
					f.tenant.ID, tested, f.episode(series), "cs_test_"+tested.String(), f.pg.TenantCurrency(f.t, f.tenant.ID))
				return `{"version": 1, "conditions": [{"type": "never_purchased"}]}`, []uuid.UUID{match, tested}
			},
		},
		{
			name: "last_read_days_ago",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				episode := f.episode(f.series())
				lapsed, never, recent := f.reader("Lapsed reader"), f.reader("Never read"), f.reader("Recent reader")
				rereader, browsing, stalled := f.reader("Rereads an episode"), f.reader("Midway through an episode"), f.reader("Stopped midway")
				f.read(lapsed, episode, time.Now().AddDate(0, 0, -40))
				f.read(recent, episode, time.Now().AddDate(0, 0, -5))
				// The first finish is old, and the page turned since is not.
				f.read(rereader, episode, time.Now().AddDate(0, 0, -40))
				f.position(rereader, episode, time.Now().AddDate(0, 0, -2))
				f.position(browsing, episode, time.Now().AddDate(0, 0, -2))
				f.position(stalled, episode, time.Now().AddDate(0, 0, -40))
				return `{"version": 1, "conditions": [{"type": "last_read_days_ago", "days": 30}]}`, []uuid.UUID{lapsed, never, stalled}
			},
		},
		{
			name: "signed_up_within_days",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				match, miss := f.reader("New reader"), f.reader("Old reader")
				f.exec("UPDATE users SET created_at = NOW() - interval '30 days' WHERE id = $1", miss)
				return `{"version": 1, "conditions": [{"type": "signed_up_within_days", "days": 7}]}`, []uuid.UUID{match}
			},
		},
		{
			name: "locale",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				if f.tenant.DefaultLocale == "en" {
					f.t.Fatal("the seeded tenant defaults to en, which would hide the fallback this case is about")
				}
				english, unnamed, korean := f.reader("English reader"), f.reader("Reader with no locale"), f.reader("Korean reader")
				f.exec("UPDATE users SET last_locale = 'en' WHERE id = $1", english)
				f.exec("UPDATE users SET last_locale = 'ko' WHERE id = $1", korean)
				// The default locale selects the reader who never named one,
				// since that is the translation they are sent.
				return `{"version": 1, "conditions": [{"type": "locale", "locale": "` + f.tenant.DefaultLocale + `"}]}`, []uuid.UUID{unnamed}
			},
		},
		{
			name: "has_mobile_push_device",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				android, ios, web := f.reader("Android reader"), f.reader("iOS reader"), f.reader("Web push reader")
				f.reader("Reader with no device")
				f.exec("INSERT INTO user_push_devices (tenant_id, user_id, token, platform) VALUES ($1, $2, $3, 'android')", f.tenant.ID, android, "fcm-"+android.String())
				f.exec("INSERT INTO user_push_devices (tenant_id, user_id, token, platform) VALUES ($1, $2, $3, 'ios')", f.tenant.ID, ios, "fcm-"+ios.String())
				endpoint := "https://push.example.com/" + web.String()
				f.exec("INSERT INTO user_push_devices (tenant_id, user_id, token, platform, endpoint, p256dh, auth) VALUES ($1, $2, $3, 'web', $3, 'key', 'secret')", f.tenant.ID, web, endpoint)
				return `{"version": 1, "conditions": [{"type": "has_mobile_push_device"}]}`, []uuid.UUID{android, ios}
			},
		},
		{
			name: "follows_series and never_purchased",
			setup: func(f *audienceFixture) (string, []uuid.UUID) {
				series := f.series()
				match, buyer := f.reader("Follower yet to buy"), f.reader("Follower who bought")
				f.reader("Reader who follows nothing")
				f.follow(match, series)
				f.follow(buyer, series)
				f.buy(buyer, f.episode(series))
				return `{"version": 1, "conditions": [{"type": "follows_series", "series_id": "` + series.ID.String() + `"}, {"type": "never_purchased"}]}`, []uuid.UUID{match}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newAudienceFixture(t, pg)
			audience, want := tc.setup(f)
			if got := f.members(&audience); !slices.Equal(got, sortedIDs(want...)) {
				t.Fatalf("members = %v, want %v", got, sortedIDs(want...))
			}
		})
	}
}

// No audience is everyone, and an audience in a shape this release cannot read
// is nobody, so a newer release's audience is never read as everyone.
func TestAnnouncementAudienceMembersReadsNoAudienceAsEveryoneAndAnUnknownOneAsNobody(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	f := newAudienceFixture(t, pg)
	first, second := f.reader("First reader"), f.reader("Second reader")
	newAudienceFixture(t, pg).reader("Reader of another tenant")

	if got, want := f.members(nil), sortedIDs(first, second); !slices.Equal(got, want) {
		t.Fatalf("members of no audience = %v, want %v", got, want)
	}
	for _, audience := range []string{
		`{"version": 2, "conditions": [{"type": "never_purchased"}]}`,
		`{"version": 1, "conditions": []}`,
		`{"version": 1, "conditions": [{"type": "bought_coins"}]}`,
		`{"version": 1}`,
	} {
		if got := f.members(&audience); len(got) != 0 {
			t.Fatalf("members of %s = %v, want nobody", audience, got)
		}
	}
}

// The storefront's role reads a targeted announcement only as the reader it
// was delivered to, whatever the query asks: the previous release's reads
// filter by tenant alone and are still serving while the migration runs. The
// console's role reads every row.
func TestTargetedAnnouncementIsHiddenFromThePublicRoleBeyondItsReaders(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	f := newAudienceFixture(t, pg)
	recipient, other := f.reader("Recipient"), f.reader("Other reader")

	broadcastID, targetedID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	f.exec("INSERT INTO announcements (id, tenant_id, announcement_type) VALUES ($1, $2, 'announcement')", broadcastID, f.tenant.ID)
	f.exec(`INSERT INTO announcements (id, tenant_id, announcement_type, audience)
		VALUES ($1, $2, 'announcement', '{"version": 1, "conditions": [{"type": "never_purchased"}]}')`, targetedID, f.tenant.ID)
	f.exec(`INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category)
		VALUES (uuidv7(), $1, $2, 'announcement_posted', 'announcement:' || $3::text, '{}', 'announcements')`, f.tenant.ID, recipient, targetedID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	listed := func(db *sql.DB, userID uuid.UUID) []uuid.UUID {
		t.Helper()
		conn := scopedConn(t, ctx, db, f.tenant.ID, userID)
		// The shape of the previous release's ListAnnouncementsForUserDesc: the
		// tenant's rows, and nothing about who they are for.
		rows, err := conn.QueryContext(ctx, "SELECT id FROM announcements WHERE tenant_id = $1 ORDER BY id", f.tenant.ID)
		if err != nil {
			t.Fatalf("list announcements: %v", err)
		}
		defer rows.Close() //nolint:errcheck
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				t.Fatalf("scan announcement: %v", err)
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("iterate announcements: %v", err)
		}
		return ids
	}

	public := pg.OpenPublicDB(t)
	for _, tc := range []struct {
		name   string
		db     *sql.DB
		userID uuid.UUID
		want   []uuid.UUID
	}{
		{"a visitor", public, uuid.Nil, []uuid.UUID{broadcastID}},
		{"a reader it was not delivered to", public, other, []uuid.UUID{broadcastID}},
		{"its reader", public, recipient, []uuid.UUID{broadcastID, targetedID}},
		{"the console", pg.OpenAdminDB(t), uuid.Nil, []uuid.UUID{broadcastID, targetedID}},
	} {
		if got := listed(tc.db, tc.userID); !slices.Equal(got, tc.want) {
			t.Fatalf("%s reads %v, want %v", tc.name, got, tc.want)
		}
	}
}
