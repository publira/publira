package protomapper

import (
	"errors"
	"fmt"

	"github.com/publira/publira/server/internal/googletag"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// ErrInvalidGoogleTagServingMode is returned when a request names no serving
// mode, which the caller can correct.
var ErrInvalidGoogleTagServingMode = errors.New("serving mode must be a supported Google tag serving mode")

// GoogleTagServingModeFromStored maps tenant_analytics_settings.serving_mode
// onto the enum the storefront and the console branch on. A stored value
// naming no mode is reported rather than answered with a stand-in, for the
// reason googletag.ErrUnresolvedServingMode gives.
func GoogleTagServingModeFromStored(stored string) (publirattypesv1.GoogleTagServingMode, error) {
	switch stored {
	case googletag.ServingModeGoogle:
		return publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GOOGLE, nil
	case googletag.ServingModeServerContainer:
		return publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER, nil
	case googletag.ServingModeGateway:
		return publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GATEWAY, nil
	default:
		return publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_UNSPECIFIED,
			fmt.Errorf("%w: %q", googletag.ErrUnresolvedServingMode, stored)
	}
}

// GoogleTagServingModeToStored maps a requested serving mode onto the value to
// store. GOOGLE_TAG_SERVING_MODE_UNSPECIFIED names no mode, so it is rejected:
// a tenant loading the tag from Google says so with
// GOOGLE_TAG_SERVING_MODE_GOOGLE.
func GoogleTagServingModeToStored(mode publirattypesv1.GoogleTagServingMode) (string, error) {
	switch mode {
	case publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GOOGLE:
		return googletag.ServingModeGoogle, nil
	case publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER:
		return googletag.ServingModeServerContainer, nil
	case publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GATEWAY:
		return googletag.ServingModeGateway, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidGoogleTagServingMode, mode)
	}
}
