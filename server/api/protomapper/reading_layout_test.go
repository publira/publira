package protomapper

import (
	"database/sql"
	"errors"
	"testing"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestReadingDirectionRoundTripsEveryStoredValue(t *testing.T) {
	for _, stored := range []string{readingDirectionRightToLeft, readingDirectionLeftToRight} {
		t.Run(stored, func(t *testing.T) {
			direction, err := ReadingDirectionFromStored(stored)
			if err != nil {
				t.Fatalf("ReadingDirectionFromStored(%q): %v", stored, err)
			}
			got, err := ReadingDirectionOverrideToStored(direction)
			if err != nil {
				t.Fatalf("ReadingDirectionOverrideToStored(%s): %v", direction, err)
			}
			if !got.Valid || got.String != stored {
				t.Fatalf("round trip of %q = %v", stored, got)
			}
		})
	}
}

func TestReadingDirectionFromStoredRejectsAnUnknownValue(t *testing.T) {
	if _, err := ReadingDirectionFromStored("ttb"); !errors.Is(err, ErrUnknownReadingDirection) {
		t.Fatalf("error = %v, want ErrUnknownReadingDirection", err)
	}
}

func TestReadingDirectionToStoredRejectsAnUnknownEnumValue(t *testing.T) {
	if _, err := SeriesReadingDirectionToStored(publirattypesv1.ReadingDirection(99)); !errors.Is(err, ErrInvalidReadingDirection) {
		t.Fatalf("series error = %v, want ErrInvalidReadingDirection", err)
	}
	if _, err := ReadingDirectionOverrideToStored(publirattypesv1.ReadingDirection(99)); !errors.Is(err, ErrInvalidReadingDirection) {
		t.Fatalf("override error = %v, want ErrInvalidReadingDirection", err)
	}
}

// A series request that leaves the layout unstated stores the columns'
// defaults, where an episode request that does the same stores no override.
func TestUnspecifiedLayoutStoresTheDefaultOnASeriesAndNothingOnAnEpisode(t *testing.T) {
	direction, err := SeriesReadingDirectionToStored(publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED)
	if err != nil || direction != readingDirectionRightToLeft {
		t.Fatalf("series direction = %q, %v, want %q", direction, err, readingDirectionRightToLeft)
	}
	index, err := SeriesSpreadStartIndexToStored(nil)
	if err != nil || index != 1 {
		t.Fatalf("series spread_start_index = %d, %v, want 1", index, err)
	}
	override, err := ReadingDirectionOverrideToStored(publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED)
	if err != nil || override.Valid {
		t.Fatalf("episode direction override = %v, %v, want none", override, err)
	}
}

func TestSeriesSpreadStartIndexToStoredRejectsANegativeIndex(t *testing.T) {
	negative := int32(-1)
	if _, err := SeriesSpreadStartIndexToStored(&negative); !errors.Is(err, ErrNegativeSpreadStartIndex) {
		t.Fatalf("error = %v, want ErrNegativeSpreadStartIndex", err)
	}
}

func TestSetResolvedReadingLayoutPrefersTheEpisodeThenTheSeries(t *testing.T) {
	ltr := sql.NullString{String: readingDirectionLeftToRight, Valid: true}
	rtl := sql.NullString{String: readingDirectionRightToLeft, Valid: true}

	tests := []struct {
		name          string
		stored        StoredReadingLayout
		wantDirection publirattypesv1.ReadingDirection
		wantIndex     int32
	}{
		{
			name:          "no-listing-row",
			stored:        StoredReadingLayout{},
			wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT,
			wantIndex:     1,
		},
		{
			name:          "follows-the-series",
			stored:        StoredReadingLayout{SeriesReadingDirection: ltr, SeriesSpreadStartIndex: sql.NullInt32{Int32: 0, Valid: true}},
			wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
			wantIndex:     0,
		},
		{
			name: "overrides-each-value-separately",
			stored: StoredReadingLayout{
				ReadingDirection:       rtl,
				SeriesReadingDirection: ltr,
				SpreadStartIndex:       sql.NullInt32{},
				SeriesSpreadStartIndex: sql.NullInt32{Int32: 3, Valid: true},
			},
			wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT,
			wantIndex:     3,
		},
		{
			name: "overrides-an-index-with-zero",
			stored: StoredReadingLayout{
				SpreadStartIndex:       sql.NullInt32{Int32: 0, Valid: true},
				SeriesSpreadStartIndex: sql.NullInt32{Int32: 1, Valid: true},
			},
			wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT,
			wantIndex:     0,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			episode := &publirattypesv1.Episode{}
			if err := SetResolvedReadingLayout(episode, tc.stored); err != nil {
				t.Fatalf("SetResolvedReadingLayout: %v", err)
			}
			if episode.ReadingDirection != tc.wantDirection || episode.SpreadStartIndex != tc.wantIndex {
				t.Fatalf("layout = %s from %d, want %s from %d", episode.ReadingDirection, episode.SpreadStartIndex, tc.wantDirection, tc.wantIndex)
			}
		})
	}
}

func TestSetResolvedReadingLayoutFailsOnAStoredDirectionItDoesNotKnow(t *testing.T) {
	err := SetResolvedReadingLayout(&publirattypesv1.Episode{}, StoredReadingLayout{
		ReadingDirection: sql.NullString{String: "ttb", Valid: true},
	})
	if !errors.Is(err, ErrUnknownReadingDirection) {
		t.Fatalf("error = %v, want ErrUnknownReadingDirection", err)
	}
}
