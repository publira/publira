package emailaddress

import "testing"

func TestCanonical(t *testing.T) {
	cases := []struct {
		name    string
		address string
		want    string
	}{
		{name: "plain address", address: "john@example.com", want: "john@example.com"},
		{name: "tag dropped", address: "john+news@example.com", want: "john@example.com"},
		{name: "case folded", address: "John+News@Example.COM", want: "john@example.com"},
		{name: "everything after the first plus dropped", address: "john+a+b@example.com", want: "john@example.com"},
		{name: "local part that is only a tag", address: "+news@example.com", want: "@example.com"},
		{name: "plus in the domain kept", address: "john@ex+ample.com", want: "john@ex+ample.com"},
		{name: "dots kept", address: "j.o.h.n@example.com", want: "j.o.h.n@example.com"},
		{name: "non-ASCII case folded", address: "ÉMILE+x@MÜNCHEN.de", want: "émile@münchen.de"},
		{name: "no at sign", address: "John+news", want: "john+news"},
		{name: "the domain follows the last at sign", address: `"a@b"+x@Example.com`, want: `"a@b"@example.com`},
		{name: "a tag before an at sign of the local part", address: "a+b@c@Example.com", want: "a@example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Canonical(tc.address); got != tc.want {
				t.Errorf("Canonical(%q) = %q, want %q", tc.address, got, tc.want)
			}
		})
	}
}
