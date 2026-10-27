package protomapper

import (
	"errors"
	"fmt"

	"github.com/publira/publira/server/internal/googletag"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// ErrInvalidGoogleTagConsentMode is returned for a requested consent mode this
// build does not know, which the caller can correct.
var ErrInvalidGoogleTagConsentMode = errors.New("consent mode must be a supported Google tag consent mode")

// GoogleTagConsentModeFromStored maps tenant_analytics_settings.consent_mode
// onto the enum the storefront and the console branch on. A stored value
// naming no mode is reported rather than answered with a stand-in, for the
// reason googletag.ErrUnresolvedConsentMode gives.
func GoogleTagConsentModeFromStored(stored string) (publirattypesv1.GoogleTagConsentMode, error) {
	switch stored {
	case googletag.ConsentModeNotRequired:
		return publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_NOT_REQUIRED, nil
	case googletag.ConsentModeOptIn:
		return publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_OPT_IN, nil
	case googletag.ConsentModeExternal:
		return publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_EXTERNAL, nil
	default:
		return publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED,
			fmt.Errorf("%w: %q", googletag.ErrUnresolvedConsentMode, stored)
	}
}

// GoogleTagConsentModeToStored maps a requested consent mode onto the value to
// store. GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED names no mode, so it is rejected
// here; an update that leaves the mode unspecified keeps the stored one before
// it gets this far.
func GoogleTagConsentModeToStored(mode publirattypesv1.GoogleTagConsentMode) (string, error) {
	switch mode {
	case publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_NOT_REQUIRED:
		return googletag.ConsentModeNotRequired, nil
	case publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_OPT_IN:
		return googletag.ConsentModeOptIn, nil
	case publirattypesv1.GoogleTagConsentMode_GOOGLE_TAG_CONSENT_MODE_EXTERNAL:
		return googletag.ConsentModeExternal, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidGoogleTagConsentMode, mode)
	}
}
