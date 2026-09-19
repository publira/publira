package protomapper

import (
	"database/sql"
	"errors"
	"fmt"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// The stored availabilities, matching the CHECK constraints on series and
// episodes, and the surfaces the series_surfaces and episode_surfaces views
// answer for.
const (
	availabilityAll = "all"
	surfaceWeb      = "web"
	surfaceApp      = "app"
)

// ErrUnknownSurfaceAvailability reports a stored availability naming nothing
// this build knows.
var ErrUnknownSurfaceAvailability = errors.New("stored availability names no supported value")

// ErrInvalidSurfaceAvailability reports a requested availability naming no
// value.
var ErrInvalidSurfaceAvailability = errors.New("availability must be a supported value")

// ErrInvalidClientSurface reports a requested client surface naming no value.
var ErrInvalidClientSurface = errors.New("surface must be a supported client surface")

// ClientSurfaceToStored maps the surface a catalog read names onto the value
// the views filter by. Unspecified is the storefront, so a caller that names
// nothing loses nothing it could see before surfaces existed.
func ClientSurfaceToStored(surface publirattypesv1.ClientSurface) (string, error) {
	switch surface {
	case publirattypesv1.ClientSurface_CLIENT_SURFACE_UNSPECIFIED, publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB:
		return surfaceWeb, nil
	case publirattypesv1.ClientSurface_CLIENT_SURFACE_APP:
		return surfaceApp, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidClientSurface, surface)
	}
}

// SurfaceAvailabilityFromStored maps series.availability, or an episode's
// override where it states one.
func SurfaceAvailabilityFromStored(stored string) (publirattypesv1.SurfaceAvailability, error) {
	switch stored {
	case availabilityAll:
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL, nil
	case surfaceWeb:
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB, nil
	case surfaceApp:
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP, nil
	default:
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnknownSurfaceAvailability, stored)
	}
}

// SeriesSurfaceAvailabilityToStored maps the availability a series request
// carries. Unspecified stores the column's default, both surfaces.
func SeriesSurfaceAvailabilityToStored(availability publirattypesv1.SurfaceAvailability) (string, error) {
	if availability == publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED {
		return availabilityAll, nil
	}
	return surfaceAvailabilityToStored(availability)
}

// SurfaceAvailabilityOverrideFromStored maps episodes.availability, where NULL
// is the episode following its series.
func SurfaceAvailabilityOverrideFromStored(stored sql.NullString) (publirattypesv1.SurfaceAvailability, error) {
	if !stored.Valid {
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED, nil
	}
	return SurfaceAvailabilityFromStored(stored.String)
}

// SurfaceAvailabilityOverrideToStored maps a requested episode override, where
// unspecified returns the episode to following its series.
func SurfaceAvailabilityOverrideToStored(availability publirattypesv1.SurfaceAvailability) (sql.NullString, error) {
	if availability == publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED {
		return sql.NullString{}, nil
	}
	stored, err := surfaceAvailabilityToStored(availability)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: stored, Valid: true}, nil
}

func surfaceAvailabilityToStored(availability publirattypesv1.SurfaceAvailability) (string, error) {
	switch availability {
	case publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL:
		return availabilityAll, nil
	case publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB:
		return surfaceWeb, nil
	case publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP:
		return surfaceApp, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidSurfaceAvailability, availability)
	}
}
