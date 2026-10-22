package adminapi

import (
	"slices"
	"testing"
)

func TestTenantSignUpSettingsRevalidateTags(t *testing.T) {
	tags := tenantSignUpSettingsRevalidateTags(" tenant-id ")
	want := []string{"tenant:tenant-id:site"}
	if !slices.Equal(tags, want) {
		t.Fatalf("tenantSignUpSettingsRevalidateTags() = %v, want %v", tags, want)
	}
}
