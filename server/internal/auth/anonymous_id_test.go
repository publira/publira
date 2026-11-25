package auth

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestVerifyAnonymousIDAcceptsWhatSignAnonymousIDSigned(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	id := uuid.Must(uuid.NewV7())

	got, ok := manager.VerifyAnonymousID(manager.SignAnonymousID(id))
	if !ok || got != id {
		t.Fatalf("VerifyAnonymousID(SignAnonymousID(%s)) = %s, %v, want %s, true", id, got, ok, id)
	}
}

func TestVerifyAnonymousIDRefusesWhatTheServerDidNotSign(t *testing.T) {
	manager := NewTokenManager([]byte(testSecret))
	other := NewTokenManager([]byte(testSecret + "-other"))
	id := uuid.Must(uuid.NewV7())
	signed := manager.SignAnonymousID(id)
	_, mac, _ := strings.Cut(signed, ".")

	for name, value := range map[string]string{
		"empty":                       "",
		"a bare UUID":                 id.String(),
		"a UUID with an empty MAC":    id.String() + ".",
		"another UUID with this MAC":  uuid.Must(uuid.NewV7()).String() + "." + mac,
		"a MAC under another secret":  other.SignAnonymousID(id),
		"a MAC cut short":             signed[:len(signed)-1],
		"a MAC that is not base64url": id.String() + ".!!!!",
		"the nil UUID":                manager.SignAnonymousID(uuid.Nil),
		"an upper-case UUID":          strings.ToUpper(id.String()) + "." + mac,
	} {
		t.Run(name, func(t *testing.T) {
			if got, ok := manager.VerifyAnonymousID(value); ok {
				t.Fatalf("VerifyAnonymousID(%q) = %s, true, want false", value, got)
			}
		})
	}
}
