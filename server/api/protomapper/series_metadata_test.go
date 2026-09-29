package protomapper

import (
	"errors"
	"slices"
	"testing"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Every value the CHECK constraint accepts has an enum value and comes back
// unchanged, so neither half can grow a status the other does not know.
func TestSeriesStatusRoundTripsEveryStoredStatus(t *testing.T) {
	for _, stored := range []string{"ongoing", "completed", "hiatus"} {
		t.Run(stored, func(t *testing.T) {
			status, err := SeriesStatusFromStored(stored)
			if err != nil {
				t.Fatalf("SeriesStatusFromStored(%q): %v", stored, err)
			}
			if status == publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED {
				t.Fatalf("SeriesStatusFromStored(%q) = UNSPECIFIED", stored)
			}
			got, err := SeriesStatusToStored(status)
			if err != nil {
				t.Fatalf("SeriesStatusToStored(%s): %v", status, err)
			}
			if got != stored {
				t.Fatalf("round trip of %q = %q", stored, got)
			}
		})
	}
}

func TestSeriesAgeRatingRoundTripsEveryStoredRating(t *testing.T) {
	for _, stored := range []string{"all", "r15", "r18"} {
		t.Run(stored, func(t *testing.T) {
			rating, err := SeriesAgeRatingFromStored(stored)
			if err != nil {
				t.Fatalf("SeriesAgeRatingFromStored(%q): %v", stored, err)
			}
			if rating == publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_UNSPECIFIED {
				t.Fatalf("SeriesAgeRatingFromStored(%q) = UNSPECIFIED", stored)
			}
			got, err := SeriesAgeRatingToStored(rating)
			if err != nil {
				t.Fatalf("SeriesAgeRatingToStored(%s): %v", rating, err)
			}
			if got != stored {
				t.Fatalf("round trip of %q = %q", stored, got)
			}
		})
	}
}

func TestSeriesStatusFromStoredRejectsAValueNamingNoStatus(t *testing.T) {
	if _, err := SeriesStatusFromStored("cancelled"); !errors.Is(err, ErrUnknownSeriesStatus) {
		t.Fatalf("SeriesStatusFromStored error = %v, want ErrUnknownSeriesStatus", err)
	}
}

func TestSeriesAgeRatingFromStoredRejectsAValueNamingNoRating(t *testing.T) {
	if _, err := SeriesAgeRatingFromStored("r12"); !errors.Is(err, ErrUnknownSeriesAgeRating) {
		t.Fatalf("SeriesAgeRatingFromStored error = %v, want ErrUnknownSeriesAgeRating", err)
	}
}

// A client that carries neither field stores the same values the column
// defaults to, which is what keeps an older console saving series.
func TestUnspecifiedStoresTheColumnDefault(t *testing.T) {
	status, err := SeriesStatusToStored(publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED)
	if err != nil {
		t.Fatalf("SeriesStatusToStored(UNSPECIFIED): %v", err)
	}
	if status != "ongoing" {
		t.Fatalf("SeriesStatusToStored(UNSPECIFIED) = %q, want ongoing", status)
	}

	rating, err := SeriesAgeRatingToStored(publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_UNSPECIFIED)
	if err != nil {
		t.Fatalf("SeriesAgeRatingToStored(UNSPECIFIED): %v", err)
	}
	if rating != "all" {
		t.Fatalf("SeriesAgeRatingToStored(UNSPECIFIED) = %q, want all", rating)
	}
}

func TestScheduleWeekdaysToStoredSortsAndDeduplicates(t *testing.T) {
	stored, err := ScheduleWeekdaysToStored([]int32{5, 2, 5, 0})
	if err != nil {
		t.Fatalf("ScheduleWeekdaysToStored: %v", err)
	}
	if want := []int32{0, 2, 5}; !slices.Equal(stored, want) {
		t.Fatalf("stored weekdays = %v, want %v", stored, want)
	}
}

func TestScheduleWeekdaysToStoredKeepsAnEmptyScheduleEmpty(t *testing.T) {
	stored, err := ScheduleWeekdaysToStored(nil)
	if err != nil {
		t.Fatalf("ScheduleWeekdaysToStored: %v", err)
	}
	if len(stored) != 0 {
		t.Fatalf("stored weekdays = %v, want empty", stored)
	}
}

func TestScheduleWeekdaysToStoredRejectsADayOutsideTheWeek(t *testing.T) {
	for _, weekday := range []int32{-1, 7} {
		if _, err := ScheduleWeekdaysToStored([]int32{weekday}); !errors.Is(err, ErrInvalidScheduleWeekday) {
			t.Fatalf("ScheduleWeekdaysToStored(%d) error = %v, want ErrInvalidScheduleWeekday", weekday, err)
		}
	}
}
