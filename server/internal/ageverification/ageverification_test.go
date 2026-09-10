package ageverification

import (
	"errors"
	"testing"
	"time"
)

func TestResolveAcceptsEveryStoredRule(t *testing.T) {
	for _, stored := range Supported {
		resolved, err := Resolve(stored)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", stored, err)
		}
		if resolved != stored {
			t.Fatalf("Resolve(%q) = %q, want %q", stored, resolved, stored)
		}
	}
}

func TestResolveRejectsAValueNamingNoRule(t *testing.T) {
	for _, stored := range []string{"", "  ", "r15", "R18", "everything"} {
		if _, err := Resolve(stored); !errors.Is(err, ErrUnresolved) {
			t.Fatalf("Resolve(%q) error = %v, want ErrUnresolved", stored, err)
		}
	}
}

func TestNormalizeRejectsBlankRatherThanReadingItAsOff(t *testing.T) {
	if _, err := Normalize(""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Normalize(\"\") error = %v, want ErrInvalid", err)
	}
	normalized, err := Normalize("  none  ")
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if normalized != None {
		t.Fatalf("Normalize = %q, want %q", normalized, None)
	}
}

func TestRequiredMinimumAgeCoversEveryRuleAndRating(t *testing.T) {
	tests := []struct {
		rule   string
		rating string
		want   int
	}{
		{rule: None, rating: RatingAll, want: 0},
		{rule: None, rating: RatingR15, want: 0},
		{rule: None, rating: RatingR18, want: 0},
		{rule: R18, rating: RatingAll, want: 0},
		{rule: R18, rating: RatingR15, want: 0},
		{rule: R18, rating: RatingR18, want: 18},
		{rule: R15AndR18, rating: RatingAll, want: 0},
		{rule: R15AndR18, rating: RatingR15, want: 15},
		{rule: R15AndR18, rating: RatingR18, want: 18},
	}
	for _, tt := range tests {
		got, err := RequiredMinimumAge(tt.rule, tt.rating)
		if err != nil {
			t.Fatalf("RequiredMinimumAge(%q, %q): %v", tt.rule, tt.rating, err)
		}
		if got != tt.want {
			t.Fatalf("RequiredMinimumAge(%q, %q) = %d, want %d", tt.rule, tt.rating, got, tt.want)
		}
	}
}

func TestRequiredMinimumAgeFailsOnAValueItDoesNotKnow(t *testing.T) {
	if _, err := RequiredMinimumAge("everything", RatingR18); !errors.Is(err, ErrUnresolved) {
		t.Fatalf("unknown rule error = %v, want ErrUnresolved", err)
	}
	if _, err := RequiredMinimumAge(R18, "r21"); !errors.Is(err, ErrUnresolved) {
		t.Fatalf("unknown rating error = %v, want ErrUnresolved", err)
	}
}

func TestAgeOnCountsCompletedYears(t *testing.T) {
	born := date(2008, time.April, 2)
	tests := []struct {
		name string
		day  time.Time
		want int
	}{
		{name: "the day before the birthday", day: date(2026, time.April, 1), want: 17},
		{name: "the birthday itself", day: date(2026, time.April, 2), want: 18},
		{name: "the day after the birthday", day: date(2026, time.April, 3), want: 18},
		{name: "an earlier month", day: date(2026, time.March, 31), want: 17},
		{name: "the day of birth", day: born, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AgeOn(born, tt.day); got != tt.want {
				t.Fatalf("AgeOn = %d, want %d", got, tt.want)
			}
		})
	}
}

// A reader born on 29 February has no birthday in a common year, and the
// anniversary the count reaches is 1 March.
func TestAgeOnHandlesALeapDayBirthDate(t *testing.T) {
	born := date(2008, time.February, 29)
	if got := AgeOn(born, date(2026, time.February, 28)); got != 17 {
		t.Fatalf("AgeOn on 28 February = %d, want 17", got)
	}
	if got := AgeOn(born, date(2026, time.March, 1)); got != 18 {
		t.Fatalf("AgeOn on 1 March = %d, want 18", got)
	}
}

// The clock and the zone a value carries are not part of the comparison: a
// birth date read out of a `date` column is midnight UTC, and the tenant's day
// is resolved in its own zone.
func TestAgeOnIgnoresTheClockAndTheZone(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	born := time.Date(2008, time.April, 2, 0, 0, 0, 0, time.UTC)
	day := time.Date(2026, time.April, 2, 8, 30, 0, 0, tokyo)
	if got := AgeOn(born, day); got != 18 {
		t.Fatalf("AgeOn = %d, want 18", got)
	}
}

// The day an age is counted against is the tenant's, so an instant that is
// still yesterday in one zone is already today in another.
func TestTodayFollowsTheTenantZone(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	losAngeles, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	at := time.Date(2026, time.April, 1, 20, 0, 0, 0, time.UTC)
	if got := Today(at, tokyo); !got.Equal(date(2026, time.April, 2)) {
		t.Fatalf("Today in Tokyo = %s, want 2026-04-02", got.Format(time.DateOnly))
	}
	if got := Today(at, losAngeles); !got.Equal(date(2026, time.April, 1)) {
		t.Fatalf("Today in Los Angeles = %s, want 2026-04-01", got.Format(time.DateOnly))
	}
}

func TestParseBirthDateAcceptsACalendarDate(t *testing.T) {
	today := date(2026, time.April, 1)
	parsed, err := ParseBirthDate(" 2008-04-02 ", today)
	if err != nil {
		t.Fatalf("ParseBirthDate: %v", err)
	}
	if !parsed.Equal(date(2008, time.April, 2)) {
		t.Fatalf("ParseBirthDate = %s, want 2008-04-02", parsed.Format(time.DateOnly))
	}
	if got := FormatBirthDate(parsed); got != "2008-04-02" {
		t.Fatalf("FormatBirthDate = %q, want 2008-04-02", got)
	}
}

func TestParseBirthDateRejectsWhatItWillNotStore(t *testing.T) {
	today := date(2026, time.April, 1)
	tests := []struct {
		name string
		raw  string
	}{
		{name: "empty", raw: ""},
		{name: "not a date", raw: "yesterday"},
		{name: "another format", raw: "02/04/2008"},
		{name: "a single-digit month and day", raw: "2008-4-2"},
		{name: "a day that does not exist", raw: "2007-02-29"},
		{name: "with a clock time", raw: "2008-04-02T00:00:00Z"},
		{name: "tomorrow", raw: "2026-04-02"},
		{name: "before anyone alive was born", raw: "1850-01-01"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ParseBirthDate(tt.raw, today); !errors.Is(err, ErrInvalidBirthDate) {
				t.Fatalf("ParseBirthDate(%q) error = %v, want ErrInvalidBirthDate", tt.raw, err)
			}
		})
	}
}

// Today is a birth date a reader may give: an account created for a newborn is
// nobody's typo, and the rule reads it as an age of 0.
func TestParseBirthDateAcceptsToday(t *testing.T) {
	today := date(2026, time.April, 1)
	if _, err := ParseBirthDate("2026-04-01", today); err != nil {
		t.Fatalf("ParseBirthDate: %v", err)
	}
}

func date(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
