package protomapper

import (
	"fmt"

	"github.com/publira/publira/server/internal/ageverification"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// AgeVerificationFromStored maps tenant_config.age_verification onto the enum
// both the storefront and the console branch on.
//
// A stored value naming no rule is reported rather than answered with a
// stand-in, for the reason ageverification.ErrUnresolved gives: either
// stand-in is a policy the tenant did not choose, applied to its whole
// catalogue.
func AgeVerificationFromStored(stored string) (publirattypesv1.AgeVerification, error) {
	resolved, err := ageverification.Resolve(stored)
	if err != nil {
		return publirattypesv1.AgeVerification_AGE_VERIFICATION_UNSPECIFIED, err
	}
	switch resolved {
	case ageverification.None:
		return publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE, nil
	case ageverification.R18:
		return publirattypesv1.AgeVerification_AGE_VERIFICATION_R18, nil
	case ageverification.R15AndR18:
		return publirattypesv1.AgeVerification_AGE_VERIFICATION_R15_AND_R18, nil
	default:
		return publirattypesv1.AgeVerification_AGE_VERIFICATION_UNSPECIFIED, fmt.Errorf("%w: %q", ageverification.ErrUnresolved, stored)
	}
}

// AgeVerificationToStored maps a requested rule onto the value to store.
//
// AGE_VERIFICATION_UNSPECIFIED names no rule, so it is rejected: a tenant that
// wants no age proven says so with AGE_VERIFICATION_NONE, and an empty field
// is a caller that chose nothing rather than one that chose off.
func AgeVerificationToStored(rule publirattypesv1.AgeVerification) (string, error) {
	switch rule {
	case publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE:
		return ageverification.None, nil
	case publirattypesv1.AgeVerification_AGE_VERIFICATION_R18:
		return ageverification.R18, nil
	case publirattypesv1.AgeVerification_AGE_VERIFICATION_R15_AND_R18:
		return ageverification.R15AndR18, nil
	default:
		return "", fmt.Errorf("%w: %s", ageverification.ErrInvalid, rule)
	}
}
