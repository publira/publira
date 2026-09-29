package protomapper

import (
	"errors"
	"testing"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestSurfaceAvailabilityRoundTripsEveryStoredValue(t *testing.T) {
	for _, stored := range []string{availabilityAll, surfaceWeb, surfaceApp} {
		t.Run(stored, func(t *testing.T) {
			availability, err := SurfaceAvailabilityFromStored(stored)
			if err != nil {
				t.Fatalf("SurfaceAvailabilityFromStored(%q): %v", stored, err)
			}
			got, err := SurfaceAvailabilityOverrideToStored(availability)
			if err != nil {
				t.Fatalf("SurfaceAvailabilityOverrideToStored(%s): %v", availability, err)
			}
			if !got.Valid || got.String != stored {
				t.Fatalf("round trip of %q = %v", stored, got)
			}
		})
	}
}

func TestSurfaceAvailabilityFromStoredRejectsAnUnknownValue(t *testing.T) {
	if _, err := SurfaceAvailabilityFromStored("tv"); !errors.Is(err, ErrUnknownSurfaceAvailability) {
		t.Fatalf("error = %v, want ErrUnknownSurfaceAvailability", err)
	}
}

func TestSurfaceAvailabilityToStoredRejectsAnUnknownEnumValue(t *testing.T) {
	if _, err := SeriesSurfaceAvailabilityToStored(publirattypesv1.SurfaceAvailability(99)); !errors.Is(err, ErrInvalidSurfaceAvailability) {
		t.Fatalf("series error = %v, want ErrInvalidSurfaceAvailability", err)
	}
	if _, err := SurfaceAvailabilityOverrideToStored(publirattypesv1.SurfaceAvailability(99)); !errors.Is(err, ErrInvalidSurfaceAvailability) {
		t.Fatalf("override error = %v, want ErrInvalidSurfaceAvailability", err)
	}
}

// A series request that leaves availability unstated is shown on both
// surfaces, where an episode request that does the same follows its series.
func TestUnspecifiedAvailabilityStoresBothOnASeriesAndNothingOnAnEpisode(t *testing.T) {
	series, err := SeriesSurfaceAvailabilityToStored(publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED)
	if err != nil || series != availabilityAll {
		t.Fatalf("series availability = %q, %v, want %q", series, err, availabilityAll)
	}
	override, err := SurfaceAvailabilityOverrideToStored(publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED)
	if err != nil || override.Valid {
		t.Fatalf("episode override = %v, %v, want none", override, err)
	}
}

// A caller that names no surface is answered as the storefront, so a client
// written before surfaces existed keeps seeing what it saw.
func TestClientSurfaceDefaultsToTheWeb(t *testing.T) {
	cases := map[publirattypesv1.ClientSurface]string{
		publirattypesv1.ClientSurface_CLIENT_SURFACE_UNSPECIFIED: surfaceWeb,
		publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB:         surfaceWeb,
		publirattypesv1.ClientSurface_CLIENT_SURFACE_APP:         surfaceApp,
	}
	for surface, want := range cases {
		got, err := ClientSurfaceToStored(surface)
		if err != nil || got != want {
			t.Fatalf("ClientSurfaceToStored(%s) = %q, %v, want %q", surface, got, err, want)
		}
	}
	if _, err := ClientSurfaceToStored(publirattypesv1.ClientSurface(99)); !errors.Is(err, ErrInvalidClientSurface) {
		t.Fatalf("error = %v, want ErrInvalidClientSurface", err)
	}
}

func TestPurchasableOn(t *testing.T) {
	tests := []struct {
		stored, surface string
		want            bool
	}{
		{availabilityAll, surfaceWeb, true},
		{availabilityAll, surfaceApp, true},
		{surfaceWeb, surfaceWeb, true},
		{surfaceWeb, surfaceApp, false},
		{surfaceApp, surfaceApp, true},
		{surfaceApp, surfaceWeb, false},
	}
	for _, tc := range tests {
		got, err := PurchasableOn(tc.stored, tc.surface)
		if err != nil || got != tc.want {
			t.Fatalf("PurchasableOn(%q, %q) = %v, %v, want %v", tc.stored, tc.surface, got, err, tc.want)
		}
	}
	if _, err := PurchasableOn("tv", surfaceWeb); !errors.Is(err, ErrUnknownSurfaceAvailability) {
		t.Fatalf("PurchasableOn of an unknown value error = %v, want ErrUnknownSurfaceAvailability", err)
	}
}
