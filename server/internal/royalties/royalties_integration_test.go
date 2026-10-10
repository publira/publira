package royalties

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// royaltyTenant is one tenant with a priced episode and a reader to buy it.
type royaltyTenant struct {
	pg      *testutil.PostgresEnv
	id      uuid.UUID
	reader  uuid.UUID
	episode uuid.UUID
}

// seedRoyaltyTenant names the tenant's rows after prefix, which is ten
// characters so that each public ID fills its twelve.
func seedRoyaltyTenant(t *testing.T, pg *testutil.PostgresEnv, prefix, timeZone string) royaltyTenant {
	t.Helper()
	tenant := pg.SeedTenant(t, prefix+"TN", prefix+".example.com", "Royalty "+prefix)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SE"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EP",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	reader := pg.SeedEndUser(t, tenant.ID, prefix+"RD", "reader@"+prefix+".example.com", "Reader")
	f := royaltyTenant{pg: pg, id: tenant.ID, reader: reader.ID, episode: episode.ID}
	f.setTimeZone(t, timeZone)
	return f
}

// setTimeZone stands in for a Tenant admin saving another zone, which is the
// zone every month not closed yet is resolved in from then on.
func (f royaltyTenant) setTimeZone(t *testing.T, timeZone string) {
	t.Helper()
	if _, err := f.pg.DB.ExecContext(context.Background(), "UPDATE tenants SET timezone = $2 WHERE id = $1", f.id, timeZone); err != nil {
		t.Fatalf("set tenant time zone to %s: %v", timeZone, err)
	}
}

func (f royaltyTenant) sell(t *testing.T, purchasedAt time.Time) {
	t.Helper()
	if _, err := f.pg.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at)
		VALUES ($1, $2, $3, $4, 500, $5)
	`, uuid.Must(uuid.NewV7()), f.id, f.reader, f.episode, purchasedAt); err != nil {
		t.Fatalf("insert sale at %s: %v", purchasedAt.Format(time.RFC3339), err)
	}
}

func (f royaltyTenant) month(period string, timeZone string) Month {
	parsed, err := ParsePeriod(period)
	if err != nil {
		panic(err)
	}
	return Month{TenantID: f.id, Period: parsed, TimeZone: timeZone}
}

func (f royaltyTenant) close(t *testing.T, month Month, now time.Time) dbmodels.RoyaltyStatement {
	t.Helper()
	statement, err := CloseStatement(context.Background(), f.pg.DB, month, uuid.NullUUID{}, now, nil)
	if err != nil {
		t.Fatalf("close %s in %s: %v", FormatPeriod(month.Period), month.TimeZone, err)
	}
	return statement
}

func (f royaltyTenant) preview(t *testing.T, month Month, now time.Time) Computation {
	t.Helper()
	computation, err := PreviewStatement(context.Background(), f.pg.DB, month, now)
	if err != nil {
		t.Fatalf("preview %s in %s: %v", FormatPeriod(month.Period), month.TimeZone, err)
	}
	return computation
}

func utc(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}

func assertBounds(t *testing.T, label string, got Bounds, start, end time.Time) {
	t.Helper()
	if !got.Start.Equal(start) || !got.End.Equal(end) {
		t.Fatalf("%s runs from %s to %s, want %s to %s", label,
			got.Start.UTC().Format(time.RFC3339), got.End.UTC().Format(time.RFC3339),
			start.Format(time.RFC3339), end.Format(time.RFC3339))
	}
}

func TestDBMonthEndsAtTheNextMidnightInItsZone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	f := seedRoyaltyTenant(t, pg, "ROYALSEOUL", "Asia/Seoul")
	july := f.month("2026-07", "Asia/Seoul")
	endOfJulyInSeoul := utc(2026, time.July, 31, 15)

	if _, err := CloseStatement(context.Background(), pg.DB, july, uuid.NullUUID{}, endOfJulyInSeoul.Add(-time.Second), nil); !errors.Is(err, ErrNotOver) {
		t.Fatalf("close a second before the Seoul month ends error = %v, want ErrNotOver", err)
	}
	if _, err := PreviewStatement(context.Background(), pg.DB, july, utc(2026, time.June, 30, 15).Add(-time.Second)); !errors.Is(err, ErrNotStarted) {
		t.Fatalf("preview a second before the Seoul month starts error = %v, want ErrNotStarted", err)
	}
	statement := f.close(t, july, endOfJulyInSeoul)
	assertBounds(t, "July", Bounds{Start: statement.StartsAt, End: statement.EndsAt}, utc(2026, time.June, 30, 15), endOfJulyInSeoul)
}

// A sale late on 31 March in UTC is early on 1 April in Tokyo, so it is the
// one the two zones disagree about. Whichever way the zone changes after
// March is closed, the sale is counted in exactly one of the two months, and
// April ends at its own midnight in the zone the tenant has now.
func TestDBMonthAfterAClosedStatementStartsWhereItEnded(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	sale := utc(2026, time.March, 31, 20)

	cases := []struct {
		name        string
		prefix      string
		closedIn    string
		changedTo   string
		marchGross  int64
		aprilGross  int64
		aprilStarts time.Time
		aprilEnds   time.Time
	}{
		{
			name:        "Asia/Tokyo to UTC",
			prefix:      "ROYALJPUTC",
			closedIn:    "Asia/Tokyo",
			changedTo:   "UTC",
			marchGross:  0,
			aprilGross:  500,
			aprilStarts: utc(2026, time.March, 31, 15),
			aprilEnds:   utc(2026, time.May, 1, 0),
		},
		{
			name:        "UTC to Asia/Tokyo",
			prefix:      "ROYALUTCJP",
			closedIn:    "UTC",
			changedTo:   "Asia/Tokyo",
			marchGross:  500,
			aprilGross:  0,
			aprilStarts: utc(2026, time.April, 1, 0),
			aprilEnds:   utc(2026, time.April, 30, 15),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := seedRoyaltyTenant(t, pg, tc.prefix, tc.closedIn)
			f.sell(t, sale)

			march := f.close(t, f.month("2026-03", tc.closedIn), utc(2026, time.April, 2, 0))
			if march.TotalGross != tc.marchGross {
				t.Fatalf("March gross = %d, want %d", march.TotalGross, tc.marchGross)
			}

			f.setTimeZone(t, tc.changedTo)
			april := f.month("2026-04", tc.changedTo)

			preview := f.preview(t, april, utc(2026, time.April, 15, 0))
			assertBounds(t, "April's preview", preview.Bounds, tc.aprilStarts, tc.aprilEnds)
			if preview.Totals.Gross != tc.aprilGross {
				t.Fatalf("April's preview gross = %d, want %d", preview.Totals.Gross, tc.aprilGross)
			}

			statement := f.close(t, april, utc(2026, time.May, 2, 0))
			assertBounds(t, "April's statement", Bounds{Start: statement.StartsAt, End: statement.EndsAt}, tc.aprilStarts, tc.aprilEnds)
			if statement.TotalGross != tc.aprilGross {
				t.Fatalf("April's statement gross = %d, want %d", statement.TotalGross, tc.aprilGross)
			}
			if statement.TimeZone != tc.changedTo {
				t.Fatalf("April's statement zone = %q, want %q", statement.TimeZone, tc.changedTo)
			}
		})
	}
}

// Months may be closed out of order, so the month before a closed one ends
// where that statement started, not at its own midnight in the zone the
// tenant has moved to since.
func TestDBMonthBeforeAClosedStatementEndsWhereItStarted(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	f := seedRoyaltyTenant(t, pg, "ROYALGAP01", "Asia/Tokyo")
	f.sell(t, utc(2026, time.March, 31, 20))

	april := f.close(t, f.month("2026-04", "Asia/Tokyo"), utc(2026, time.May, 2, 0))
	if april.TotalGross != 500 {
		t.Fatalf("April gross = %d, want 500", april.TotalGross)
	}

	f.setTimeZone(t, "UTC")
	march := f.month("2026-03", "UTC")
	// March is over at April's start, nine hours before its UTC midnight.
	if _, err := CloseStatement(context.Background(), pg.DB, march, uuid.NullUUID{}, utc(2026, time.March, 31, 15).Add(-time.Second), nil); !errors.Is(err, ErrNotOver) {
		t.Fatalf("close March a second before April starts error = %v, want ErrNotOver", err)
	}
	statement := f.close(t, march, utc(2026, time.March, 31, 15))
	assertBounds(t, "March", Bounds{Start: statement.StartsAt, End: statement.EndsAt}, utc(2026, time.March, 1, 0), utc(2026, time.March, 31, 15))
	if statement.TotalGross != 0 {
		t.Fatalf("March gross = %d, want 0: the sale is April's", statement.TotalGross)
	}
}

// Two adjacent months closed at once each resolve their bounds before the
// other's statement is visible. Here April is closed in UTC while March, cut
// in Tokyo, is about to commit: March is rolled back, runs again, and ends
// where April starts, so the sale late on 31 March in UTC is counted once.
func TestDBAdjacentMonthsClosedAtOnceShareTheirBoundary(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	f := seedRoyaltyTenant(t, pg, "ROYALRACE1", "Asia/Tokyo")
	f.sell(t, utc(2026, time.March, 31, 20))
	now := utc(2026, time.May, 2, 0)

	var april dbmodels.RoyaltyStatement
	attempts := 0
	march, err := CloseStatement(context.Background(), pg.DB, f.month("2026-03", "Asia/Tokyo"), uuid.NullUUID{}, now,
		func(context.Context, *dbmodels.Queries, dbmodels.RoyaltyStatement) error {
			attempts++
			if attempts == 1 {
				april = f.close(t, f.month("2026-04", "UTC"), now)
			}
			return nil
		})
	if err != nil {
		t.Fatalf("close March beside April: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("March was written %d times, want twice: once beside an April it could not see, once after", attempts)
	}

	assertBounds(t, "April", Bounds{Start: april.StartsAt, End: april.EndsAt}, utc(2026, time.April, 1, 0), utc(2026, time.May, 1, 0))
	assertBounds(t, "March", Bounds{Start: march.StartsAt, End: march.EndsAt}, utc(2026, time.February, 28, 15), april.StartsAt)
	if march.TotalGross+april.TotalGross != 500 || march.TotalGross != 500 {
		t.Fatalf("March gross = %d and April gross = %d, want the sale in March alone", march.TotalGross, april.TotalGross)
	}
}
