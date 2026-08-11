package pagination_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	token := pagination.Encode(pagination.Forward, "2026-03-18T00:00:00Z", "SERIESPUB001")

	cursor, err := pagination.Decode(token)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if cursor.Direction != pagination.Forward {
		t.Fatalf("direction = %q, want %q", cursor.Direction, pagination.Forward)
	}
	if !slices.Equal(cursor.Keys, []string{"2026-03-18T00:00:00Z", "SERIESPUB001"}) {
		t.Fatalf("keys = %v, want the encoded sort keys", cursor.Keys)
	}
}

func TestEncodeKeepsSeparatorInsideKey(t *testing.T) {
	cursor, err := pagination.Decode(pagination.Encode(pagination.Backward, "a|b", "c"))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if !slices.Equal(cursor.Keys, []string{"a|b", "c"}) {
		t.Fatalf("keys = %v, want the separator preserved inside the first key", cursor.Keys)
	}
}

func TestDecodeEmptyTokenIsFirstPage(t *testing.T) {
	cursor, err := pagination.Decode("  ")
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if !cursor.IsZero() {
		t.Fatalf("cursor = %+v, want the zero value", cursor)
	}
}

func TestDecodeRejectsBrokenTokens(t *testing.T) {
	tests := map[string]string{
		"not base64":      "!!!!",
		"too few parts":   pagination.Encode(pagination.Forward),
		"unknown version": "djJ8Znxh", // v2|f|a
		"bad direction":   "djF8eHxh", // v1|x|a
	}

	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := pagination.Decode(token); !errors.Is(err, pagination.ErrInvalidToken) {
				t.Fatalf("Decode(%q) error = %v, want ErrInvalidToken", token, err)
			}
		})
	}
}

func TestEncodeTimeUUIDKeepsExistingTokenFormat(t *testing.T) {
	at := time.Date(2026, time.March, 18, 9, 10, 11, 123_456_789, time.FixedZone("test", 9*60*60))
	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")

	// These are tokens produced by the pre-extraction handler implementation.
	wantBoundary := "djF8ZnwyMDI2LTAzLTE4VDAwJTNBMTAlM0ExMS4xMjM0NTY3ODlafDAxOWQwMDhkLTE4NGQtN2QzMS1hNzhhLTg5NzI4YTc0NmUzOA"
	if got := pagination.EncodeTimeUUID(pagination.Forward, at, id); got != wantBoundary {
		t.Fatalf("EncodeTimeUUID() = %q, want %q", got, wantBoundary)
	}

	wantRecovery := "djF8ZnwyMDI2LTAzLTE4VDAwJTNBMTAlM0ExMS4xMjM0NTY3ODlafDAxOWQwMDhkLTE4NGQtN2QzMS1hNzhhLTg5NzI4YTc0NmUzOHxpbmNsdXNpdmU"
	if got := pagination.EncodeTimeUUIDRecovery(pagination.Forward, at, id); got != wantRecovery {
		t.Fatalf("EncodeTimeUUIDRecovery() = %q, want %q", got, wantRecovery)
	}
}

func TestDecodeTimeUUID(t *testing.T) {
	at := time.Date(2026, time.March, 18, 9, 10, 11, 123_456_789, time.FixedZone("test", 9*60*60))
	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")

	tests := []struct {
		name      string
		token     string
		inclusive bool
	}{
		{
			name:  "boundary",
			token: pagination.Encode(pagination.Backward, at.Format(time.RFC3339Nano), id.String()),
		},
		{
			name:      "inclusive recovery",
			token:     pagination.Encode(pagination.Backward, at.Format(time.RFC3339Nano), id.String(), "inclusive"),
			inclusive: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cursor, err := pagination.Decode(test.token)
			if err != nil {
				t.Fatalf("Decode: %v", err)
			}
			keys, err := pagination.DecodeTimeUUID(cursor)
			if err != nil {
				t.Fatalf("DecodeTimeUUID: %v", err)
			}
			if !keys.Valid || !keys.Time.Equal(at.UTC()) || keys.ID != id || keys.Inclusive != test.inclusive {
				t.Fatalf("keys = %+v, want time %v, ID %v, inclusive %t, valid", keys, at, id, test.inclusive)
			}
			if keys.Time.Location() != time.UTC {
				t.Fatalf("time location = %v, want UTC", keys.Time.Location())
			}
		})
	}
}

func TestDecodeTimeUUIDRejectsInvalidKeys(t *testing.T) {
	at := "2026-03-18T00:10:11.123456789Z"
	id := "019d008d-184d-7d31-a78a-89728a746e38"
	tests := map[string]pagination.Cursor{
		"too few keys":   {Keys: []string{at}},
		"too many keys":  {Keys: []string{at, id, "inclusive", "extra"}},
		"unknown marker": {Keys: []string{at, id, "exclusive"}},
		"invalid time":   {Keys: []string{"not-a-time", id}},
		"invalid UUID":   {Keys: []string{at, "not-a-uuid"}},
	}

	for name, cursor := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := pagination.DecodeTimeUUID(cursor); !errors.Is(err, pagination.ErrInvalidToken) {
				t.Fatalf("DecodeTimeUUID(%+v) error = %v, want ErrInvalidToken", cursor, err)
			}
		})
	}
}

func TestNormalizeLimit(t *testing.T) {
	tests := []struct {
		name      string
		requested int32
		want      int32
	}{
		{name: "in range", requested: 50, want: 50},
		{name: "zero", requested: 0, want: 20},
		{name: "negative", requested: -1, want: 20},
		{name: "over maximum", requested: 101, want: 20},
		{name: "at maximum", requested: 100, want: 100},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := pagination.NormalizeLimit(test.requested, 20, 100); got != test.want {
				t.Fatalf("NormalizeLimit(%d) = %d, want %d", test.requested, got, test.want)
			}
		})
	}
}

func TestPageDropsTheOverFetchedRow(t *testing.T) {
	page, hasMore := pagination.Page([]string{"a", "b", "c"}, 2, pagination.Forward)

	if !hasMore {
		t.Fatal("hasMore = false, want true when the extra row came back")
	}
	if !slices.Equal(page, []string{"a", "b"}) {
		t.Fatalf("page = %v, want the first two rows", page)
	}
}

func TestPageWithoutExtraRow(t *testing.T) {
	page, hasMore := pagination.Page([]string{"a", "b"}, 2, pagination.Forward)

	if hasMore {
		t.Fatal("hasMore = true, want false on the last page")
	}
	if !slices.Equal(page, []string{"a", "b"}) {
		t.Fatalf("page = %v, want both rows", page)
	}
}

func TestPageFlipsBackwardRowsIntoDisplayOrder(t *testing.T) {
	// The backward query sorts ascending, so the newest row arrives last.
	page, hasMore := pagination.Page([]string{"c", "b", "a"}, 2, pagination.Backward)

	if !hasMore {
		t.Fatal("hasMore = false, want true when a page precedes this one")
	}
	if !slices.Equal(page, []string{"b", "c"}) {
		t.Fatalf("page = %v, want the trimmed rows reversed", page)
	}
}

func TestNeighbors(t *testing.T) {
	tests := []struct {
		name         string
		cursor       pagination.Cursor
		hasMore      bool
		wantPrevious bool
		wantNext     bool
	}{
		{
			name:     "first page with more rows",
			hasMore:  true,
			wantNext: true,
		},
		{
			name: "first page that fits",
		},
		{
			name:         "forward page in the middle",
			cursor:       pagination.Cursor{Direction: pagination.Forward},
			hasMore:      true,
			wantPrevious: true,
			wantNext:     true,
		},
		{
			name:         "forward page at the end",
			cursor:       pagination.Cursor{Direction: pagination.Forward},
			wantPrevious: true,
		},
		{
			name:         "backward page in the middle",
			cursor:       pagination.Cursor{Direction: pagination.Backward},
			hasMore:      true,
			wantPrevious: true,
			wantNext:     true,
		},
		{
			name:     "backward page at the start",
			cursor:   pagination.Cursor{Direction: pagination.Backward},
			wantNext: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hasPrevious, hasNext := pagination.Neighbors(test.cursor, test.hasMore)
			if hasPrevious != test.wantPrevious || hasNext != test.wantNext {
				t.Fatalf("Neighbors = (%t, %t), want (%t, %t)", hasPrevious, hasNext, test.wantPrevious, test.wantNext)
			}
		})
	}
}
