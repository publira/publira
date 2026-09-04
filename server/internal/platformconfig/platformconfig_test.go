package platformconfig

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenanttz"
)

type stubQuerier struct {
	config dbmodels.PlatformConfig
	err    error
	calls  int
}

func (s *stubQuerier) GetPlatformConfig(_ context.Context) (dbmodels.PlatformConfig, error) {
	s.calls++
	if s.err != nil {
		return dbmodels.PlatformConfig{}, s.err
	}
	return s.config, nil
}

func TestDefaultTimeZone(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		err    error
		want   string
	}{
		{name: "configured value is used", stored: "America/Los_Angeles", want: "America/Los_Angeles"},
		{name: "surrounding spaces are trimmed", stored: "  Europe/Berlin  ", want: "Europe/Berlin"},
		{name: "blank row falls back to the built-in default", stored: "   ", want: tenanttz.Default},
		{name: "missing row falls back to the built-in default", err: sql.ErrNoRows, want: tenanttz.Default},
		{name: "unreadable row falls back to the built-in default", err: errors.New("connection reset"), want: tenanttz.Default},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultTimezone: tt.stored}, err: tt.err}
			if got := DefaultTimeZone(context.Background(), q); got != tt.want {
				t.Fatalf("DefaultTimeZone = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDefaultLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		want   string
	}{
		{name: "configured value is used", stored: "en", want: "en"},
		{name: "surrounding spaces are trimmed", stored: "  en  ", want: "en"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultLocale: tt.stored}}
			got, err := DefaultLocale(context.Background(), q)
			if err != nil {
				t.Fatalf("DefaultLocale: %v", err)
			}
			if got != tt.want {
				t.Fatalf("DefaultLocale = %q, want %q", got, tt.want)
			}
		})
	}
}

// Unlike the time zone, the locale has no constant to fall back on: a platform
// that has saved no usable language is reported as such.
func TestDefaultLocaleReportsAnUnusableRow(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		err    error
	}{
		{name: "blank row", stored: "   "},
		{name: "unsupported code", stored: "fr"},
		{name: "missing row", err: sql.ErrNoRows},
		{name: "unreadable row", err: errors.New("connection reset")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultLocale: tt.stored}, err: tt.err}
			got, err := DefaultLocale(context.Background(), q)
			if err == nil {
				t.Fatalf("DefaultLocale = %q, want an error", got)
			}
			if got != "" {
				t.Fatalf("DefaultLocale = %q, want no locale alongside the error", got)
			}
		})
	}
}

// A row the reader could not make sense of still leaves the time zone half
// usable: a timestamp in the wrong zone stays legible, a page in the wrong
// language does not.
func TestDefaultTimeZoneSurvivesAnUnusableLocale(t *testing.T) {
	q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultTimezone: "Europe/Berlin", DefaultLocale: "fr"}}
	timezone, defaultLocale, err := Defaults(context.Background(), q)
	if err == nil {
		t.Fatal("Defaults returned no error for an unsupported stored locale")
	}
	if timezone != "Europe/Berlin" {
		t.Fatalf("timezone = %q, want Europe/Berlin", timezone)
	}
	if defaultLocale != "" {
		t.Fatalf("locale = %q, want no locale alongside the error", defaultLocale)
	}
}

func TestDefaultsReadsTheSettingsRowOnce(t *testing.T) {
	q := &stubQuerier{config: dbmodels.PlatformConfig{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "en",
	}}
	timezone, defaultLocale, err := Defaults(context.Background(), q)
	if err != nil {
		t.Fatalf("Defaults: %v", err)
	}
	if timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q, want America/Los_Angeles", timezone)
	}
	if defaultLocale != "en" {
		t.Fatalf("locale = %q, want en", defaultLocale)
	}
	if q.calls != 1 {
		t.Fatalf("settings row was read %d times, want 1", q.calls)
	}
}

func TestDefaultTimeZoneFuncReadsLazilyAndOnce(t *testing.T) {
	q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultTimezone: "Europe/Berlin"}}
	defaultTimeZone := DefaultTimeZoneFunc(context.Background(), q)
	if q.calls != 0 {
		t.Fatalf("settings row was read %d times before the accessor was called, want 0", q.calls)
	}

	for range 3 {
		if got := defaultTimeZone(); got != "Europe/Berlin" {
			t.Fatalf("DefaultTimeZoneFunc() = %q, want Europe/Berlin", got)
		}
	}
	if q.calls != 1 {
		t.Fatalf("settings row was read %d times, want 1", q.calls)
	}
}
