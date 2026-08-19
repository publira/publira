package platformconfig

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db"
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
		err    error
		want   string
	}{
		{name: "configured value is used", stored: "en", want: "en"},
		{name: "surrounding spaces are trimmed", stored: "  en  ", want: "en"},
		{name: "blank row falls back to the built-in default", stored: "   ", want: defaultLocale},
		{name: "missing row falls back to the built-in default", err: sql.ErrNoRows, want: defaultLocale},
		{name: "unreadable row falls back to the built-in default", err: errors.New("connection reset"), want: defaultLocale},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &stubQuerier{config: dbmodels.PlatformConfig{DefaultLocale: tt.stored}, err: tt.err}
			if got := DefaultLocale(context.Background(), q); got != tt.want {
				t.Fatalf("DefaultLocale = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDefaultsReadsTheSettingsRowOnce(t *testing.T) {
	q := &stubQuerier{config: dbmodels.PlatformConfig{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "en",
	}}
	timezone, locale := Defaults(context.Background(), q)
	if timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q, want America/Los_Angeles", timezone)
	}
	if locale != "en" {
		t.Fatalf("locale = %q, want en", locale)
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
