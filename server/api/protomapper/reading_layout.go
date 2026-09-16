package protomapper

import (
	"database/sql"
	"errors"
	"fmt"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// The stored values, matching the CHECK constraints on series_listings and
// episodes.
const (
	readingDirectionRightToLeft = "rtl"
	readingDirectionLeftToRight = "ltr"
)

// The layout of a series whose listing row does not exist, which is the
// default series_listings carries for one that does.
const (
	defaultReadingDirection = readingDirectionRightToLeft
	defaultSpreadStartIndex = int32(1)
)

// ErrUnknownReadingDirection reports a stored direction naming nothing this
// build knows. A guess would turn a work backwards from its first page.
var ErrUnknownReadingDirection = errors.New("stored reading direction names no supported direction")

// ErrInvalidReadingDirection reports a requested direction naming no value.
var ErrInvalidReadingDirection = errors.New("reading_direction must be a supported direction")

// ErrNegativeSpreadStartIndex reports a requested spread start before the
// first page.
var ErrNegativeSpreadStartIndex = errors.New("spread_start_index must be greater than or equal to 0")

// ReadingDirectionFromStored maps a stored direction onto the enum viewers
// branch on.
func ReadingDirectionFromStored(stored string) (publirattypesv1.ReadingDirection, error) {
	switch stored {
	case readingDirectionRightToLeft:
		return publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, nil
	case readingDirectionLeftToRight:
		return publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT, nil
	default:
		return publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnknownReadingDirection, stored)
	}
}

// SeriesReadingDirectionToStored maps the direction a series request carries.
// Unspecified stores the column's default, as an unspecified series status
// does.
func SeriesReadingDirectionToStored(direction publirattypesv1.ReadingDirection) (string, error) {
	if direction == publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED {
		return defaultReadingDirection, nil
	}
	return readingDirectionToStored(direction)
}

// SeriesSpreadStartIndexToStored maps the spread start a series request
// carries, storing the column's default when the field is absent.
func SeriesSpreadStartIndexToStored(index *int32) (int32, error) {
	if index == nil {
		return defaultSpreadStartIndex, nil
	}
	if *index < 0 {
		return 0, ErrNegativeSpreadStartIndex
	}
	return *index, nil
}

// ReadingDirectionOverrideFromStored maps episodes.reading_direction, where
// NULL is the episode following its series.
func ReadingDirectionOverrideFromStored(stored sql.NullString) (publirattypesv1.ReadingDirection, error) {
	if !stored.Valid {
		return publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED, nil
	}
	return ReadingDirectionFromStored(stored.String)
}

// ReadingDirectionOverrideToStored maps a requested episode override, where
// unspecified returns the episode to following its series.
func ReadingDirectionOverrideToStored(direction publirattypesv1.ReadingDirection) (sql.NullString, error) {
	if direction == publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED {
		return sql.NullString{}, nil
	}
	stored, err := readingDirectionToStored(direction)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: stored, Valid: true}, nil
}

// SpreadStartIndexOverrideFromStored maps episodes.spread_start_index onto the
// optional field, absent where the episode follows its series.
func SpreadStartIndexOverrideFromStored(stored sql.NullInt32) *int32 {
	if !stored.Valid {
		return nil
	}
	index := stored.Int32
	return &index
}

func readingDirectionToStored(direction publirattypesv1.ReadingDirection) (string, error) {
	switch direction {
	case publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT:
		return readingDirectionRightToLeft, nil
	case publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT:
		return readingDirectionLeftToRight, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidReadingDirection, direction)
	}
}

// StoredReadingLayout is the layout columns one episode read carries: the
// episode's overrides and the values of the series they override.
type StoredReadingLayout struct {
	ReadingDirection       sql.NullString
	SpreadStartIndex       sql.NullInt32
	SeriesReadingDirection sql.NullString
	SeriesSpreadStartIndex sql.NullInt32
}

// SetResolvedReadingLayout puts the layout the episode is read in onto it:
// each value from the episode where it states one, and from its series where
// it does not.
func SetResolvedReadingLayout(episode *publirattypesv1.Episode, stored StoredReadingLayout) error {
	direction, err := resolveReadingDirection(stored.ReadingDirection, stored.SeriesReadingDirection)
	if err != nil {
		return err
	}
	episode.ReadingDirection = direction
	episode.SpreadStartIndex = resolveSpreadStartIndex(stored.SpreadStartIndex, stored.SeriesSpreadStartIndex)
	return nil
}

// SeriesReadingLayoutFromStored maps the layout a series listing row holds.
func SeriesReadingLayoutFromStored(direction sql.NullString, spreadStartIndex sql.NullInt32) (publirattypesv1.ReadingDirection, int32, error) {
	resolvedDirection, err := resolveReadingDirection(sql.NullString{}, direction)
	if err != nil {
		return publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED, 0, err
	}
	return resolvedDirection, resolveSpreadStartIndex(sql.NullInt32{}, spreadStartIndex), nil
}

func resolveReadingDirection(episode, series sql.NullString) (publirattypesv1.ReadingDirection, error) {
	switch {
	case episode.Valid:
		return ReadingDirectionFromStored(episode.String)
	case series.Valid:
		return ReadingDirectionFromStored(series.String)
	default:
		return ReadingDirectionFromStored(defaultReadingDirection)
	}
}

func resolveSpreadStartIndex(episode, series sql.NullInt32) int32 {
	switch {
	case episode.Valid:
		return episode.Int32
	case series.Valid:
		return series.Int32
	default:
		return defaultSpreadStartIndex
	}
}
