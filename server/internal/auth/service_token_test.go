package auth

import "testing"

func TestServiceTokenMatches(t *testing.T) {
	token := NewServiceToken("  web-service-token  ")

	tests := []struct {
		name   string
		bearer string
		want   bool
	}{
		{name: "the configured value", bearer: "web-service-token", want: true},
		{name: "a prefix of it", bearer: "web-service", want: false},
		{name: "a longer value", bearer: "web-service-token-2", want: false},
		{name: "an empty bearer", bearer: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := token.Matches(tt.bearer); got != tt.want {
				t.Fatalf("Matches(%q) = %v, want %v", tt.bearer, got, tt.want)
			}
		})
	}
}

func TestServiceTokenUnsetAcceptsNothing(t *testing.T) {
	for _, raw := range []string{"", "   "} {
		token := NewServiceToken(raw)
		if token != nil {
			t.Fatalf("NewServiceToken(%q) = %v, want nil", raw, token)
		}
		if token.Matches(raw) {
			t.Fatalf("an unset token matched %q", raw)
		}
	}
}
