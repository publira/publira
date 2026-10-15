package protomapper

import (
	"errors"
	"fmt"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/usericon"
)

// ErrInvalidReaderIconPolicy is returned when a request names no policy, which
// the caller can correct.
var ErrInvalidReaderIconPolicy = errors.New("policy must be a supported reader icon policy")

// ReaderIconPolicyFromStored maps tenant_config.reader_icon_policy onto the
// enum the storefront and the console branch on. A stored value naming no
// policy is reported rather than answered with a stand-in, for the reason
// usericon.ErrUnresolvedPolicy gives.
func ReaderIconPolicyFromStored(stored string) (publirattypesv1.ReaderIconPolicy, error) {
	resolved, err := usericon.ResolvePolicy(stored)
	if err != nil {
		return publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UNSPECIFIED, err
	}
	switch resolved {
	case usericon.PolicyUpload:
		return publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD, nil
	case usericon.PolicyPreset:
		return publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET, nil
	default:
		return publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_DISABLED, nil
	}
}

// ReaderIconPolicyToStored maps a requested policy onto the value to store.
// READER_ICON_POLICY_UNSPECIFIED names no policy, so it is rejected: a tenant
// that wants no icons says so with READER_ICON_POLICY_DISABLED.
func ReaderIconPolicyToStored(policy publirattypesv1.ReaderIconPolicy) (string, error) {
	switch policy {
	case publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD:
		return usericon.PolicyUpload, nil
	case publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET:
		return usericon.PolicyPreset, nil
	case publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_DISABLED:
		return usericon.PolicyDisabled, nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidReaderIconPolicy, policy)
	}
}
