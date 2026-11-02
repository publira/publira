package scheduledannouncements

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pinnedannouncements"
)

// A delivered announcement changes the readers' inboxes, and the banner only
// when it is pinned: an unpinned one leaves the banner's entry alone, so the
// band above every page is not rebuilt for nothing.
func TestRevalidateTagsDropTheBannerOnlyForAPinnedAnnouncement(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	inbox := "tenant:" + tenantID.String() + ":announcements"

	if got := RevalidateTags(tenantID, false); !slices.Equal(got, []string{inbox}) {
		t.Fatalf("unpinned tags = %v, want only %s", got, inbox)
	}
	want := append([]string{inbox}, pinnedannouncements.RevalidateTags(tenantID)...)
	if got := RevalidateTags(tenantID, true); !slices.Equal(got, want) {
		t.Fatalf("pinned tags = %v, want %v", got, want)
	}
}
