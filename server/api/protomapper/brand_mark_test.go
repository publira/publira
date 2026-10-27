package protomapper

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestTenantBrandMarkKindRoundTripsEveryKind(t *testing.T) {
	for value := range publirattypesv1.TenantBrandMarkKind_name {
		kind := publirattypesv1.TenantBrandMarkKind(value)
		if kind == publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_UNSPECIFIED {
			continue
		}
		stored, err := TenantBrandMarkKindToStored(kind)
		if err != nil {
			t.Fatalf("TenantBrandMarkKindToStored(%s): %v", kind, err)
		}
		back, err := TenantBrandMarkKindFromStored(stored)
		if err != nil {
			t.Fatalf("TenantBrandMarkKindFromStored(%q): %v", stored, err)
		}
		if back != kind {
			t.Fatalf("round trip of %s = %s", kind, back)
		}
	}
}

func TestTenantBrandMarkKindToStoredRejectsWhatNamesNoMark(t *testing.T) {
	for _, kind := range []publirattypesv1.TenantBrandMarkKind{
		publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_UNSPECIFIED,
		publirattypesv1.TenantBrandMarkKind(99),
	} {
		if _, err := TenantBrandMarkKindToStored(kind); !errors.Is(err, ErrInvalidTenantBrandMarkKind) {
			t.Fatalf("TenantBrandMarkKindToStored(%d) err = %v, want ErrInvalidTenantBrandMarkKind", kind, err)
		}
	}
}

func TestTenantBrandMarkKindFromStoredFailsOnAValueItDoesNotKnow(t *testing.T) {
	if _, err := TenantBrandMarkKindFromStored("facebook_share"); !errors.Is(err, ErrUnresolvedTenantBrandMarkKind) {
		t.Fatalf("err = %v, want ErrUnresolvedTenantBrandMarkKind", err)
	}
}

func TestTenantBrandMarkCarriesItsOwnImageVariants(t *testing.T) {
	imageID := uuid.New()
	otherImageID := uuid.New()
	variants := map[uuid.UUID][]*publirattypesv1.TenantImageVariant{
		imageID:      {{VariantType: "line_share", Url: "/images/tenants/a/line_share"}},
		otherImageID: {{VariantType: "x_share", Url: "/images/tenants/b/x_share"}},
	}
	acceptedAt := time.Date(2026, 10, 27, 9, 30, 0, 0, time.FixedZone("JST", 9*60*60))

	mark, err := TenantBrandMark(TenantBrandMarkRow{
		Kind:            "line_share",
		ImageID:         imageID,
		ImageUpdatedAt:  acceptedAt,
		TermsURL:        "https://example.com/guidelines",
		TermsAcceptedAt: acceptedAt,
	}, variants)
	if err != nil {
		t.Fatalf("TenantBrandMark: %v", err)
	}
	if mark.Kind != publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE {
		t.Fatalf("kind = %s, want LINE_SHARE", mark.Kind)
	}
	if len(mark.ImageVariants) != 1 || mark.ImageVariants[0].VariantType != "line_share" {
		t.Fatalf("image variants = %v, want the line_share variant alone", mark.ImageVariants)
	}
	if mark.TermsAcceptedAt != "2026-10-27T00:30:00Z" || mark.ImageUpdatedAt != "2026-10-27T00:30:00Z" {
		t.Fatalf("times = %q, %q, want both in UTC", mark.TermsAcceptedAt, mark.ImageUpdatedAt)
	}
	if mark.TermsUrl != "https://example.com/guidelines" {
		t.Fatalf("terms_url = %q", mark.TermsUrl)
	}
}
