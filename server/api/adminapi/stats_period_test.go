package adminapi

import (
	"errors"
	"testing"

	"connectrpc.com/connect/v2"
)

func TestParseStatsPeriod(t *testing.T) {
	tests := map[string]struct {
		start, end string
		wantErr    bool
	}{
		"one day":                          {start: "2026-03-01", end: "2026-03-01"},
		"a leap year":                      {start: "2028-01-01", end: "2028-12-31"},
		"367 days":                         {start: "2028-01-01", end: "2029-01-01", wantErr: true},
		"the end before the start":         {start: "2026-03-02", end: "2026-03-01", wantErr: true},
		"no start":                         {end: "2026-03-01", wantErr: true},
		"no end":                           {start: "2026-03-01", wantErr: true},
		"an instant rather than a date":    {start: "2026-03-01T00:00:00Z", end: "2026-03-02", wantErr: true},
		"a day the calendar does not have": {start: "2026-02-29", end: "2026-03-01", wantErr: true},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			period, err := parseStatsPeriod(tt.start, tt.end)
			if tt.wantErr {
				var connectErr *connect.Error
				if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
					t.Fatalf("parseStatsPeriod(%q, %q) error = %v, want invalid_argument", tt.start, tt.end, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseStatsPeriod(%q, %q): %v", tt.start, tt.end, err)
			}
			if got := period.start.Format("2006-01-02") + ".." + period.end.Format("2006-01-02"); got != tt.start+".."+tt.end {
				t.Fatalf("period = %s, want %s..%s", got, tt.start, tt.end)
			}
		})
	}
}
