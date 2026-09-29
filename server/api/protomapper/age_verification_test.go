package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/ageverification"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestAgeVerificationRoundTripsEveryRule(t *testing.T) {
	for _, stored := range ageverification.Supported {
		rule, err := AgeVerificationFromStored(stored)
		if err != nil {
			t.Fatalf("AgeVerificationFromStored(%q): %v", stored, err)
		}
		back, err := AgeVerificationToStored(rule)
		if err != nil {
			t.Fatalf("AgeVerificationToStored(%s): %v", rule, err)
		}
		if back != stored {
			t.Fatalf("round trip of %q = %q", stored, back)
		}
	}
}

func TestAgeVerificationFromStoredFailsOnAValueItDoesNotKnow(t *testing.T) {
	if _, err := AgeVerificationFromStored("everything"); !errors.Is(err, ageverification.ErrUnresolved) {
		t.Fatalf("error = %v, want ErrUnresolved", err)
	}
}

// An unspecified rule is a caller that chose nothing. It is refused rather
// than stored as "no proof", which is a policy a tenant states deliberately.
func TestAgeVerificationToStoredRefusesUnspecified(t *testing.T) {
	if _, err := AgeVerificationToStored(publirattypesv1.AgeVerification_AGE_VERIFICATION_UNSPECIFIED); !errors.Is(err, ageverification.ErrInvalid) {
		t.Fatalf("error = %v, want ErrInvalid", err)
	}
}
