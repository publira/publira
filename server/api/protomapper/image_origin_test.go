package protomapper

import (
	"net/url"
	"testing"

	"github.com/google/uuid"
)

func TestImageURLsAreRootedAtTheImageOrigin(t *testing.T) {
	iconID := uuid.MustParse("018f0e76-0001-7000-8000-000000000001")
	for _, tc := range []struct {
		name   string
		origin ImageOrigin
		want   string
	}{
		{name: "host-relative", origin: HostRelative, want: "/images/creators/" + iconID.String()},
		{name: "on an image host", origin: ImagesOn(&url.URL{Scheme: "https", Host: "images.example.com"}), want: "https://images.example.com/images/creators/" + iconID.String()},
		{name: "on an image host given with a path", origin: ImagesOn(&url.URL{Scheme: "http", Host: "images.localhost:3180", Path: "/"}), want: "http://images.localhost:3180/images/creators/" + iconID.String()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := CreatorIconURL(tc.origin, iconID); got != tc.want {
				t.Fatalf("url = %q, want %q", got, tc.want)
			}
		})
	}
}
