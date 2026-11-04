package tenantapikeys

import (
	"strings"
	"testing"
)

func TestNewKeyParsesToItsPrefixAndMatchesItsHash(t *testing.T) {
	key, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if !Looks(key.Key) || !strings.HasPrefix(key.Key, DisplayPrefix(key.Prefix)+"_") {
		t.Fatalf("key %q does not start with its prefix %q", key.Key, key.Prefix)
	}
	prefix, ok := Parse(key.Key)
	if !ok || prefix != key.Prefix {
		t.Fatalf("Parse(%q) = %q, %v, want %q", key.Key, prefix, ok, key.Prefix)
	}
	if !Matches(key.Key, key.Hash) {
		t.Fatal("a key does not match its own hash")
	}
	other, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if other.Prefix == key.Prefix || Matches(other.Key, key.Hash) {
		t.Fatal("two keys share a prefix or a hash")
	}
}

func TestParseRefusesWhatNewDoesNotMake(t *testing.T) {
	key, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for name, token := range map[string]string{
		"a session token":     "eyJhbGciOiJIUzI1NiJ9.e30.sig",
		"no secret":           DisplayPrefix(key.Prefix),
		"a short secret":      key.Key[:len(key.Key)-1],
		"a long secret":       key.Key + "a",
		"upper case":          strings.ToUpper(key.Key),
		"a character outside": key.Key[:len(key.Key)-1] + "1",
	} {
		if _, ok := Parse(token); ok {
			t.Errorf("Parse accepted %s: %q", name, token)
		}
	}
}
