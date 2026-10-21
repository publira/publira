package adminapi

import (
	"slices"
	"testing"
)

func TestTenantCrawlerSettingsRevalidateTags(t *testing.T) {
	tags := tenantCrawlerSettingsRevalidateTags(" tenant-id ")
	want := []string{"tenant:tenant-id:crawler-settings"}
	if !slices.Equal(tags, want) {
		t.Fatalf("tenantCrawlerSettingsRevalidateTags() = %v, want %v", tags, want)
	}
}
