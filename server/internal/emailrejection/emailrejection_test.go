package emailrejection

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestMatches(t *testing.T) {
	entries := []string{"blocked.example", "john@example.com", "jane+news@example.org", "例え.jp"}
	tests := []struct {
		address string
		want    bool
	}{
		{"john@example.com", true},
		{"John@Example.COM", true},
		{"john+2@example.com", true},
		{"john+@example.com", true},
		{"johnny@example.com", false},
		{"jim+john@example.com", false},
		{"john@sub.example.com", false},
		// An address entry is compared with its own tag dropped as well.
		{"jane@example.org", true},
		{"jane+other@example.org", true},
		{"reader@blocked.example", true},
		{"reader@mail.blocked.example", true},
		{"reader+tag@deep.mail.blocked.example", true},
		{"reader@notblocked.example", false},
		{"reader@blocked.example.net", false},
		// A domain listed in Unicode matches its Punycode form and back.
		{"reader@xn--r8jz45g.jp", true},
		{"reader@mail.例え.jp", true},
		{"+tag@example.com", false},
		// A quoted local part may hold an @, which mail.ParseAddress keeps in
		// the bare address it answers. The domain follows the last one.
		{"a@b@blocked.example", true},
		{"john@x@example.com", false},
		{"not-an-address", false},
	}
	for _, tt := range tests {
		t.Run(tt.address, func(t *testing.T) {
			if got := Matches(entries, tt.address); got != tt.want {
				t.Fatalf("Matches(%q) = %t, want %t", tt.address, got, tt.want)
			}
		})
	}
}

func TestMatchesNothingWithoutEntries(t *testing.T) {
	if Matches(nil, "john@example.com") {
		t.Fatal("an empty list matched")
	}
}

func TestNormalizeEntries(t *testing.T) {
	got, err := NormalizeEntries([]string{
		"  John@Example.COM ",
		"",
		"   ",
		"Blocked.Example.",
		"blocked.example",
		"XN--R8JZ45G.jp",
		"jane+news@example.org",
	})
	if err != nil {
		t.Fatalf("NormalizeEntries: %v", err)
	}
	want := []string{"blocked.example", "jane+news@example.org", "john@example.com", "例え.jp"}
	if !slices.Equal(got, want) {
		t.Fatalf("NormalizeEntries = %q, want %q", got, want)
	}
}

func TestNormalizeEntriesRefusesWhatIsNeitherAnAddressNorADomain(t *testing.T) {
	for _, entry := range []string{
		"localhost",
		"com",
		"@example.com",
		"john@",
		"john@localhost",
		"john@@example.com",
		"john@exa mple.com",
		"jo hn@example.com",
		"john..doe@example.com",
		".john@example.com",
		`"john"@example.com`,
		"+tag@example.com",
		"-example.com",
		"example..com",
		"https://example.com",
	} {
		t.Run(entry, func(t *testing.T) {
			_, err := NormalizeEntries([]string{entry})
			var invalid *InvalidEntryError
			if !errors.As(err, &invalid) || !errors.Is(err, ErrInvalidEntry) {
				t.Fatalf("NormalizeEntries(%q) error = %v, want an InvalidEntryError", entry, err)
			}
			if invalid.Entry != entry {
				t.Fatalf("InvalidEntryError.Entry = %q, want %q", invalid.Entry, entry)
			}
		})
	}
}

func TestNormalizeEntriesBoundsTheList(t *testing.T) {
	entries := make([]string, 0, MaxEntries+1)
	for range MaxEntries + 1 {
		entries = append(entries, uuid.NewString()+".example")
	}
	if _, err := NormalizeEntries(entries); !errors.Is(err, ErrTooManyEntries) {
		t.Fatalf("NormalizeEntries error = %v, want ErrTooManyEntries", err)
	}
	// Duplicates are dropped before the list is counted.
	duplicates := slices.Repeat([]string{"blocked.example"}, MaxEntries+1)
	if got, err := NormalizeEntries(duplicates); err != nil || len(got) != 1 {
		t.Fatalf("NormalizeEntries(duplicates) = %q, %v; want one entry", got, err)
	}
}

type fakeQuerier struct {
	settings *dbmodels.TenantEmailRejectionSetting
	entries  []string
	err      error
}

func (f fakeQuerier) GetTenantEmailRejectionSettings(context.Context, uuid.UUID) (dbmodels.TenantEmailRejectionSetting, error) {
	if f.err != nil {
		return dbmodels.TenantEmailRejectionSetting{}, f.err
	}
	if f.settings == nil {
		return dbmodels.TenantEmailRejectionSetting{}, sql.ErrNoRows
	}
	return *f.settings, nil
}

func (f fakeQuerier) ListTenantEmailRejectionEntries(context.Context, uuid.UUID) ([]string, error) {
	return f.entries, nil
}

type fakeList map[string]bool

func (f fakeList) IsDisposable(_ context.Context, domain string) (bool, error) {
	return f[domain], nil
}

func TestCheck(t *testing.T) {
	list := fakeList{"throwaway.example": true}
	on := &dbmodels.TenantEmailRejectionSetting{RejectDisposableDomains: true}
	off := &dbmodels.TenantEmailRejectionSetting{RejectDisposableDomains: false}
	tests := []struct {
		name    string
		q       fakeQuerier
		address string
		want    Verdict
	}{
		{"nothing saved", fakeQuerier{}, "reader@throwaway.example", Accepted},
		{"list switched off", fakeQuerier{settings: off}, "reader@throwaway.example", Accepted},
		{"list switched on", fakeQuerier{settings: on}, "reader@throwaway.example", Disposable},
		{"list switched on, domain not on it", fakeQuerier{settings: on}, "reader@example.com", Accepted},
		{"listed by the tenant", fakeQuerier{entries: []string{"example.com"}}, "reader@example.com", Listed},
		{"listed by the tenant and disposable", fakeQuerier{settings: on, entries: []string{"throwaway.example"}}, "reader@throwaway.example", Listed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Check(context.Background(), tt.q, list, uuid.New(), tt.address)
			if err != nil {
				t.Fatalf("Check: %v", err)
			}
			if got != tt.want {
				t.Fatalf("Check = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCheckReportsAFailedRead(t *testing.T) {
	failure := errors.New("connection reset")
	if _, err := Check(context.Background(), fakeQuerier{err: failure}, nil, uuid.New(), "reader@example.com"); !errors.Is(err, failure) {
		t.Fatalf("Check error = %v, want %v", err, failure)
	}
}
