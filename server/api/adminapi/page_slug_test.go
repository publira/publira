package adminapi

import "testing"

func TestNormalizePageSlugForStorage(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{in: "", want: ""},
		{in: "/", want: ""},
		{in: "privacy", want: "/privacy"},
		{in: "/privacy", want: "/privacy"},
		{in: "//privacy//", want: "/privacy"},
		{in: "  /legal/terms  ", want: "/legal/terms"},
		{in: "legal//terms", want: "/legal/terms"},
		{in: "Under_score", wantErr: true},
		{in: "/series/", want: "/series"}, // segment validity only; reserved paths checked elsewhere
	}
	for _, tt := range tests {
		got, err := normalizePageSlugForStorage(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Fatalf("normalizePageSlugForStorage(%q) err = nil, want error", tt.in)
			}
			continue
		}
		if err != nil {
			t.Fatalf("normalizePageSlugForStorage(%q) err = %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("normalizePageSlugForStorage(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
