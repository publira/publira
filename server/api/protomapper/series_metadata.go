package protomapper

import (
	"errors"
	"fmt"
	"slices"

	"github.com/publira/publira/server/internal/ageverification"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// The stored values, matching the CHECK constraints on series_listings. The
// ratings come from ageverification, which decides what each of them demands
// of a reader: a second spelling of them here would be a second vocabulary the
// gate and the catalogue could drift apart on.
const (
	seriesStatusOngoing   = "ongoing"
	seriesStatusCompleted = "completed"
	seriesStatusHiatus    = "hiatus"

	seriesAgeRatingAll = ageverification.RatingAll
	seriesAgeRatingR15 = ageverification.RatingR15
	seriesAgeRatingR18 = ageverification.RatingR18
)

// weekdayCount is how many values series_listings.schedule_weekdays accepts:
// EXTRACT(DOW) numbers 0 (Sunday) through 6 (Saturday).
const weekdayCount = 7

// ErrUnknownSeriesStatus and ErrUnknownSeriesAgeRating report a stored value
// naming nothing this build knows. Neither is answered with a stand-in: a
// series shown as running when it has ended misleads the reader, and a rating
// guessed as "all" puts rated work in front of someone the tenant meant to
// stop.
var (
	ErrUnknownSeriesStatus    = errors.New("stored series status names no supported status")
	ErrUnknownSeriesAgeRating = errors.New("stored series age rating names no supported rating")
)

// ErrInvalidScheduleWeekday reports a requested weekday outside 0 to 6.
var ErrInvalidScheduleWeekday = errors.New("schedule_weekdays must hold EXTRACT(DOW) numbers 0 to 6")

// SeriesStatusFromStored maps series_listings.status onto the enum clients
// branch on.
func SeriesStatusFromStored(stored string) (publirattypesv1.SeriesStatus, error) {
	switch stored {
	case seriesStatusOngoing:
		return publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING, nil
	case seriesStatusCompleted:
		return publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED, nil
	case seriesStatusHiatus:
		return publirattypesv1.SeriesStatus_SERIES_STATUS_HIATUS, nil
	default:
		return publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnknownSeriesStatus, stored)
	}
}

// SeriesStatusToStored maps a requested status onto the value to store.
//
// Unlike a comment mode, an unspecified status stores the column's own default
// rather than being refused. The admin save writes the whole listing row, and a
// series nobody has said anything about is a running one — the same answer the
// column gives a row that predates the field.
func SeriesStatusToStored(status publirattypesv1.SeriesStatus) (string, error) {
	switch status {
	case publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED,
		publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING:
		return seriesStatusOngoing, nil
	case publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED:
		return seriesStatusCompleted, nil
	case publirattypesv1.SeriesStatus_SERIES_STATUS_HIATUS:
		return seriesStatusHiatus, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrUnknownSeriesStatus, status)
	}
}

// SeriesAgeRatingFromStored maps series_listings.age_rating onto the enum a
// client interposes its confirmation on.
func SeriesAgeRatingFromStored(stored string) (publirattypesv1.SeriesAgeRating, error) {
	switch stored {
	case seriesAgeRatingAll:
		return publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_ALL, nil
	case seriesAgeRatingR15:
		return publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15, nil
	case seriesAgeRatingR18:
		return publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18, nil
	default:
		return publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnknownSeriesAgeRating, stored)
	}
}

// SeriesAgeRatingToStored maps a requested rating onto the value to store. An
// unspecified rating stores the column's default for the reason
// SeriesStatusToStored gives.
func SeriesAgeRatingToStored(rating publirattypesv1.SeriesAgeRating) (string, error) {
	switch rating {
	case publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_UNSPECIFIED,
		publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_ALL:
		return seriesAgeRatingAll, nil
	case publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15:
		return seriesAgeRatingR15, nil
	case publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18:
		return seriesAgeRatingR18, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrUnknownSeriesAgeRating, rating)
	}
}

// ScheduleWeekdaysToStored puts a requested schedule into the one shape stored:
// ascending, without duplicates. The CHECK on the column only bounds the range,
// so a client that sends Friday twice, or Friday before Tuesday, still reads
// the same array back as one that sent it in order.
func ScheduleWeekdaysToStored(weekdays []int32) ([]int32, error) {
	seen := [weekdayCount]bool{}
	stored := make([]int32, 0, len(weekdays))
	for _, weekday := range weekdays {
		if weekday < 0 || weekday >= weekdayCount {
			return nil, fmt.Errorf("%w: %d", ErrInvalidScheduleWeekday, weekday)
		}
		if seen[weekday] {
			continue
		}
		seen[weekday] = true
		stored = append(stored, weekday)
	}
	slices.Sort(stored)
	return stored, nil
}

// ScheduleWeekdaysFromStored copies the stored days into the slice the proto
// carries. A series with no weekly schedule has an empty array, which is a
// schedule the tenant stated rather than a missing value, so it stays empty
// rather than becoming nil.
func ScheduleWeekdaysFromStored(stored []int32) []int32 {
	return append(make([]int32, 0, len(stored)), stored...)
}
