package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/googletag"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Every stored mode has an enum value and comes back unchanged through the
// round trip, so neither half can grow a mode the other does not know.
func TestGoogleTagConsentModeRoundTripsEveryStoredMode(t *testing.T) {
	for _, stored := range googletag.SupportedConsentModes {
		t.Run(stored, func(t *testing.T) {
			mode, err := GoogleTagConsentModeFromStored(stored)
			if err != nil {
				t.Fatalf("GoogleTagConsentModeFromStored(%q): %v", stored, err)
			}
			got, err := GoogleTagConsentModeToStored(mode)
			if err != nil {
				t.Fatalf("GoogleTagConsentModeToStored(%s): %v", mode, err)
			}
			if got != stored {
				t.Fatalf("round trip of %q = %q", stored, got)
			}
		})
	}
}

func TestGoogleTagConsentModeFromStoredRejectsAValueNamingNoMode(t *testing.T) {
	if _, err := GoogleTagConsentModeFromStored("banner"); !errors.Is(err, googletag.ErrUnresolvedConsentMode) {
		t.Fatalf("GoogleTagConsentModeFromStored error = %v, want ErrUnresolvedConsentMode", err)
	}
}

func TestGoogleTagConsentModeToStoredRejectsAValueNamingNoMode(t *testing.T) {
	for _, mode := range []publirattypesv1.GoogleTagConsentMode{
		publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED,
		publirattypesv1.GoogleTagConsentMode(99),
	} {
		if _, err := GoogleTagConsentModeToStored(mode); !errors.Is(err, ErrInvalidGoogleTagConsentMode) {
			t.Fatalf("GoogleTagConsentModeToStored(%s) error = %v, want ErrInvalidGoogleTagConsentMode", mode, err)
		}
	}
}
