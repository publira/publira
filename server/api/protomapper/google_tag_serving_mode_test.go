package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/googletag"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Every stored mode has an enum value and comes back unchanged through the
// round trip, so neither half can grow a mode the other does not know.
func TestGoogleTagServingModeRoundTripsEveryStoredMode(t *testing.T) {
	for _, stored := range googletag.SupportedServingModes {
		t.Run(stored, func(t *testing.T) {
			mode, err := GoogleTagServingModeFromStored(stored)
			if err != nil {
				t.Fatalf("GoogleTagServingModeFromStored(%q): %v", stored, err)
			}
			got, err := GoogleTagServingModeToStored(mode)
			if err != nil {
				t.Fatalf("GoogleTagServingModeToStored(%s): %v", mode, err)
			}
			if got != stored {
				t.Fatalf("round trip of %q = %q", stored, got)
			}
		})
	}
}

func TestGoogleTagServingModeFromStoredRejectsAValueNamingNoMode(t *testing.T) {
	if _, err := GoogleTagServingModeFromStored("proxy"); !errors.Is(err, googletag.ErrUnresolvedServingMode) {
		t.Fatalf("GoogleTagServingModeFromStored error = %v, want ErrUnresolvedServingMode", err)
	}
}

func TestGoogleTagServingModeToStoredRejectsUnspecified(t *testing.T) {
	if _, err := GoogleTagServingModeToStored(publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_UNSPECIFIED); !errors.Is(err, ErrInvalidGoogleTagServingMode) {
		t.Fatalf("GoogleTagServingModeToStored error = %v, want ErrInvalidGoogleTagServingMode", err)
	}
}
