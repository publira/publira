package pagination_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
)

func TestListKeyString(t *testing.T) {
	at := time.Date(2026, time.March, 18, 9, 0, 0, 0, time.FixedZone("test", 9*60*60))
	tests := map[string]struct {
		key  pagination.ListKey
		want string
	}{
		"no filter": {
			key:  pagination.NewListKey("created_at_desc"),
			want: "created_at_desc",
		},
		"filters in the order they were added": {
			key: pagination.NewListKey("created_at_desc").
				Value("status", "hidden").
				Flag("active_only", true).
				Value("series", ""),
			want: "created_at_desc+status:hidden+active_only",
		},
		"a value that spells another filter is escaped": {
			key:  pagination.NewListKey("created_at_desc").Value("query", "a+status:hidden"),
			want: "created_at_desc+query:a%2Bstatus%3Ahidden",
		},
		"an instant is written in UTC": {
			key:  pagination.NewListKey("created_at_desc").Time("created_from", at, true),
			want: "created_at_desc+created_from:2026-03-18T00%3A00%3A00Z",
		},
		"a set is sorted and deduplicated": {
			key:  pagination.NewListKey("created_at_desc").Values("public_ids", []string{"B", "A,B", "B"}),
			want: "created_at_desc+public_ids:A%2CB,B",
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := tt.key.String(); got != tt.want {
				t.Fatalf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestListKeyWithoutFilterKeepsThePlainToken(t *testing.T) {
	at := time.Date(2026, time.March, 18, 0, 0, 0, 0, time.UTC)
	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")
	key := pagination.NewListKey("created_at_desc").Flag("active_only", false)

	if got, want := key.EncodeTimeUUID(pagination.Forward, at, id), pagination.EncodeTimeUUID(pagination.Forward, at, id); got != want {
		t.Fatalf("EncodeTimeUUID() = %q, want the plain token %q", got, want)
	}
	if got, want := key.EncodeTimeUUIDRecovery(pagination.Backward, at, id), pagination.EncodeTimeUUIDRecovery(pagination.Backward, at, id); got != want {
		t.Fatalf("EncodeTimeUUIDRecovery() = %q, want the plain token %q", got, want)
	}
}

func TestListKeyDecodeTimeUUIDRoundTrip(t *testing.T) {
	at := time.Date(2026, time.March, 18, 0, 0, 0, 0, time.UTC)
	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")

	for name, key := range map[string]pagination.ListKey{
		"no filter": pagination.NewListKey("created_at_desc"),
		"filtered":  pagination.NewListKey("created_at_desc").Value("status", "hidden"),
	} {
		t.Run(name, func(t *testing.T) {
			for _, tc := range []struct {
				token     string
				inclusive bool
			}{
				{token: key.EncodeTimeUUID(pagination.Forward, at, id)},
				{token: key.EncodeTimeUUIDRecovery(pagination.Forward, at, id), inclusive: true},
			} {
				cursor, err := pagination.Decode(tc.token)
				if err != nil {
					t.Fatalf("Decode: %v", err)
				}
				keys, err := key.DecodeTimeUUID(cursor)
				if err != nil {
					t.Fatalf("DecodeTimeUUID: %v", err)
				}
				want := pagination.TimeUUIDKeys{Time: at, ID: id, Inclusive: tc.inclusive, Valid: true}
				if keys != want {
					t.Fatalf("keys = %+v, want %+v", keys, want)
				}
			}
		})
	}
}

func TestListKeyDecodeRefusesAnotherList(t *testing.T) {
	at := time.Date(2026, time.March, 18, 0, 0, 0, 0, time.UTC)
	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")
	plain := pagination.NewListKey("created_at_desc")
	hidden := plain.Value("status", "hidden")
	visible := plain.Value("status", "visible")

	tests := map[string]struct {
		token string
		key   pagination.ListKey
	}{
		"another value":             {token: hidden.EncodeTimeUUID(pagination.Forward, at, id), key: visible},
		"filtered token, no filter": {token: hidden.EncodeTimeUUID(pagination.Forward, at, id), key: plain},
		"plain token, filtered":     {token: plain.EncodeTimeUUID(pagination.Forward, at, id), key: hidden},
		"recovery token":            {token: hidden.EncodeTimeUUIDRecovery(pagination.Backward, at, id), key: visible},
		"plain recovery, filtered":  {token: plain.EncodeTimeUUIDRecovery(pagination.Backward, at, id), key: hidden},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			cursor, err := pagination.Decode(tt.token)
			if err != nil {
				t.Fatalf("Decode: %v", err)
			}
			if _, err := tt.key.DecodeTimeUUID(cursor); !errors.Is(err, pagination.ErrListMismatch) {
				t.Fatalf("DecodeTimeUUID() error = %v, want ErrListMismatch", err)
			}
		})
	}
}

func TestListKeyDecodeRejectsBrokenKeys(t *testing.T) {
	key := pagination.NewListKey("created_at_desc").Value("status", "hidden")
	cursor, err := pagination.Decode(pagination.Encode(pagination.Forward, key.String(), "not-a-time", uuid.NewString()))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if _, err := key.DecodeTimeUUID(cursor); !errors.Is(err, pagination.ErrInvalidToken) {
		t.Fatalf("DecodeTimeUUID() error = %v, want ErrInvalidToken", err)
	}
}
