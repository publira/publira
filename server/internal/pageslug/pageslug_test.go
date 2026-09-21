package pageslug_test

import (
	"testing"

	"github.com/publira/publira/server/internal/pageslug"
)

func TestReservedFirstSegment(t *testing.T) {
	tests := []struct {
		slug         string
		wantSegment  string
		wantReserved bool
	}{
		{slug: "/login", wantSegment: "login", wantReserved: true},
		{slug: "/settings/notifications", wantSegment: "settings", wantReserved: true},
		{slug: "/verify", wantSegment: "verify", wantReserved: true},
		{slug: "/series", wantSegment: "series"},
		{slug: "/help/login", wantSegment: "help"},
		{slug: "/login-help", wantSegment: "login-help"},
		{slug: "", wantSegment: ""},
	}
	for _, tt := range tests {
		segment, reserved := pageslug.ReservedFirstSegment(tt.slug)
		if segment != tt.wantSegment || reserved != tt.wantReserved {
			t.Errorf("ReservedFirstSegment(%q) = (%q, %v), want (%q, %v)", tt.slug, segment, reserved, tt.wantSegment, tt.wantReserved)
		}
	}
}
