package adminapi

import (
	"testing"

	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

func TestEffectiveCommunityLimitsUsesTheStricterValueAfterEitherSideChanges(t *testing.T) {
	defaults := communityDefaults(platformpolicy.Defaults().Community)
	overrides := &publiraadminv1.TenantCommunityLimitOverrides{
		CommentPost:                   &publiraplatformv1.MinuteDayLimit{PerMinute: 2, PerDay: 20},
		DuplicateCommentWindowMinutes: new(int32(30)),
	}
	if got := effectiveCommunityLimits(defaults, overrides); got.CommentPost.PerMinute != 2 || got.CommentPost.PerDay != 20 || got.DuplicateCommentWindowMinutes != 30 {
		t.Fatalf("effective tenant override = %+v, want 2/minute, 20/day, and 30 minutes", got)
	}
	// The operator may lower a ceiling after this tenant has saved its row.
	// Resolving again must not revive the old, looser tenant values.
	defaults.CommentPost.PerMinute = 1
	defaults.CommentPost.PerDay = 10
	defaults.DuplicateCommentWindowMinutes = 45
	if got := effectiveCommunityLimits(defaults, overrides); got.CommentPost.PerMinute != 1 || got.CommentPost.PerDay != 10 || got.DuplicateCommentWindowMinutes != 45 {
		t.Fatalf("effective after platform tightening = %+v, want 1/minute, 10/day, and 45 minutes", got)
	}
}

func TestValidateCommunityOverridesRejectsLooserValues(t *testing.T) {
	defaults := communityDefaults(platformpolicy.Defaults().Community)
	if err := validateCommunityOverrides(&publiraadminv1.TenantCommunityLimitOverrides{
		CommentPost: &publiraplatformv1.MinuteDayLimit{PerMinute: defaults.CommentPost.PerMinute + 1, PerDay: defaults.CommentPost.PerDay},
	}, defaults); err == nil {
		t.Fatal("validateCommunityOverrides accepted a looser per-minute comment limit")
	}
	if err := validateCommunityOverrides(&publiraadminv1.TenantCommunityLimitOverrides{
		DuplicateCommentWindowMinutes: new(defaults.DuplicateCommentWindowMinutes - 1),
	}, defaults); err == nil {
		t.Fatal("validateCommunityOverrides accepted a shorter duplicate-comment window")
	}
}
