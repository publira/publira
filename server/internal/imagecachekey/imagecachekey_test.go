package imagecachekey

import "testing"

// A rendition of a tenant's image is stored behind the tenant's public ID, so
// the erasure of a deleted tenant finds every one of them by that ID alone.
func TestEntryNamesTheTenantOfTheObject(t *testing.T) {
	for _, tc := range []struct {
		objectKey string
		want      string
	}{
		{"tenants/SeedTNNTAAA1/series/SR01/cover.jpg", "SeedTNNTAAA1:digest"},
		{"tenants/SeedTNNTAAA1/", "SeedTNNTAAA1:digest"},
		{"tenants/", "digest"},
		{"tenants//cover.jpg", "digest"},
		{"data-exports/SeedTNNTAAA1/a.zip", "digest"},
		{"obj", "digest"},
	} {
		if got := Entry(tc.objectKey, "digest"); got != tc.want {
			t.Errorf("Entry(%q) = %q, want %q", tc.objectKey, got, tc.want)
		}
	}
	if got, want := TenantMatch("SeedTNNTAAA1"), "publira:img:SeedTNNTAAA1:*"; got != want {
		t.Errorf("TenantMatch = %q, want %q", got, want)
	}
}
