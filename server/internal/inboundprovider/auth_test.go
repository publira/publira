package inboundprovider

import (
	"encoding/base64"
	"testing"
)

func TestBasicAuthorized(t *testing.T) {
	basic := func(credentials string) string {
		return "Basic " + base64.StdEncoding.EncodeToString([]byte(credentials))
	}
	cases := []struct {
		name   string
		header string
		token  string
		want   bool
	}{
		{"the token as the password", basic("inbound:secret-token"), "secret-token", true},
		{"any user name", basic("anyone:secret-token"), "secret-token", true},
		{"the scheme in another case", "basic " + base64.StdEncoding.EncodeToString([]byte("inbound:secret-token")), "secret-token", true},
		{"another password", basic("inbound:other-token"), "secret-token", false},
		{"the token as the user name", basic("secret-token:"), "secret-token", false},
		{"no colon", basic("secret-token"), "secret-token", false},
		{"no token stored", basic("inbound:"), "", false},
		{"a bearer token", "Bearer secret-token", "secret-token", false},
		{"not base64", "Basic not*base64", "secret-token", false},
		{"no header", "", "secret-token", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := BasicAuthorized(tc.header, tc.token); got != tc.want {
				t.Errorf("BasicAuthorized(%q, %q) = %v, want %v", tc.header, tc.token, got, tc.want)
			}
		})
	}
}
