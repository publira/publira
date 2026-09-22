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

func TestUnreachableFirstSegment(t *testing.T) {
	tests := []struct {
		slug            string
		wantSegment     string
		wantUnreachable bool
	}{
		{slug: "/ja", wantSegment: "ja", wantUnreachable: true},
		{slug: "/en/about", wantSegment: "en", wantUnreachable: true},
		{slug: "/ko", wantSegment: "ko", wantUnreachable: true},
		{slug: "/api/x", wantSegment: "api", wantUnreachable: true},
		{slug: "/livez", wantSegment: "livez", wantUnreachable: true},
		{slug: "/readyz", wantSegment: "readyz", wantUnreachable: true},
		{slug: "/japan", wantSegment: "japan"},
		{slug: "/about/en", wantSegment: "about"},
		{slug: "/apis", wantSegment: "apis"},
		{slug: "", wantSegment: ""},
	}
	for _, tt := range tests {
		segment, unreachable := pageslug.UnreachableFirstSegment(tt.slug)
		if segment != tt.wantSegment || unreachable != tt.wantUnreachable {
			t.Errorf("UnreachableFirstSegment(%q) = (%q, %v), want (%q, %v)", tt.slug, segment, unreachable, tt.wantSegment, tt.wantUnreachable)
		}
	}
}
