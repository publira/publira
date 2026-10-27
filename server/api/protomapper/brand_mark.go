package protomapper

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// ErrInvalidTenantBrandMarkKind is a requested kind that names no mark.
var ErrInvalidTenantBrandMarkKind = errors.New("invalid tenant brand mark kind")

// ErrUnresolvedTenantBrandMarkKind is a stored kind this build has no enum
// value for.
var ErrUnresolvedTenantBrandMarkKind = errors.New("unresolved tenant brand mark kind")

// tenantBrandMarkKinds is the value tenant_brand_marks.kind stores for each
// kind, which is also the variant_type of the mark's image.
var tenantBrandMarkKinds = map[publirattypesv1.TenantBrandMarkKind]string{
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_X_SHARE:           "x_share",
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE:        "line_share",
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE:   "app_store_badge",
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_GOOGLE_PLAY_BADGE: "google_play_badge",
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APPLE_SIGN_IN:     "apple_sign_in",
	publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_GOOGLE_SIGN_IN:    "google_sign_in",
}

// TenantBrandMarkKindToStored maps a requested kind onto the value to store.
// TENANT_BRAND_MARK_KIND_UNSPECIFIED, and a value this build does not know,
// name no mark, so they are rejected.
func TenantBrandMarkKindToStored(kind publirattypesv1.TenantBrandMarkKind) (string, error) {
	stored, ok := tenantBrandMarkKinds[kind]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrInvalidTenantBrandMarkKind, kind)
	}
	return stored, nil
}

// TenantBrandMarkKindFromStored maps tenant_brand_marks.kind onto its enum
// value. A stored value naming no kind is reported rather than answered as
// unspecified, which a client could not draw anywhere.
func TenantBrandMarkKindFromStored(stored string) (publirattypesv1.TenantBrandMarkKind, error) {
	for kind, value := range tenantBrandMarkKinds {
		if value == stored {
			return kind, nil
		}
	}
	return publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnresolvedTenantBrandMarkKind, stored)
}

// TenantBrandMarkRow is what a brand mark is answered from, whichever query
// read it.
type TenantBrandMarkRow struct {
	Kind            string
	ImageID         uuid.UUID
	ImageUpdatedAt  time.Time
	TermsURL        string
	TermsAcceptedAt time.Time
}

// TenantBrandMark answers row with the variants of its image, out of the ones
// TenantImageVariantsByImageID grouped.
func TenantBrandMark(row TenantBrandMarkRow, variantsByImageID map[uuid.UUID][]*publirattypesv1.TenantImageVariant) (*publirattypesv1.TenantBrandMark, error) {
	kind, err := TenantBrandMarkKindFromStored(row.Kind)
	if err != nil {
		return nil, err
	}
	return &publirattypesv1.TenantBrandMark{
		Kind:            kind,
		ImageUpdatedAt:  row.ImageUpdatedAt.UTC().Format(time.RFC3339),
		ImageVariants:   variantsByImageID[row.ImageID],
		TermsUrl:        row.TermsURL,
		TermsAcceptedAt: row.TermsAcceptedAt.UTC().Format(time.RFC3339),
	}, nil
}
