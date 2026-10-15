package usericon

import (
	"errors"
	"fmt"
)

// The stored reader icon policies, matching the CHECK constraint on
// tenant_config.reader_icon_policy.
const (
	// PolicyUpload lets a reader upload an image of their own. It is the
	// column's own default, and the answer for a tenant with no config row.
	PolicyUpload = "upload"
	// PolicyPreset lets a reader pick one of the tenant's presets and upload
	// nothing.
	PolicyPreset = "preset"
	// PolicyDisabled lets no reader show an icon.
	PolicyDisabled = "disabled"
)

// ErrUnresolvedPolicy is returned when a stored value names no supported
// policy. There is no stand-in: reading it as PolicyUpload opens an upload
// path the tenant may have closed, and reading it as anything narrower hides
// icons the tenant allowed.
var ErrUnresolvedPolicy = errors.New("stored reader icon policy is not a supported policy")

// ResolvePolicy checks a stored policy, answering it unchanged when this build
// can act on it.
func ResolvePolicy(stored string) (string, error) {
	switch stored {
	case PolicyUpload, PolicyPreset, PolicyDisabled:
		return stored, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnresolvedPolicy, stored)
	}
}
