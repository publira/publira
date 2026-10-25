package protomapper

import (
	"fmt"
	"net/url"
)

// ImageOrigin is what the image URLs a response carries are rooted at. The
// public API answers them on the origin of the tenant's image host when it has
// one, so a page loads them from there. Everywhere else they are
// [HostRelative].
type ImageOrigin struct {
	origin string
}

// HostRelative leaves an image URL a path, which the page that loads it
// resolves against its own host. The admin API answers every URL this way,
// because the console loads them on the console host.
var HostRelative = ImageOrigin{}

// ImagesOn roots the image URLs at origin, which names a scheme and a host
// and nothing else.
func ImagesOn(origin *url.URL) ImageOrigin {
	return ImageOrigin{origin: (&url.URL{Scheme: origin.Scheme, Host: origin.Host}).String()}
}

// imageURL is the URL of the image server route format names.
func (o ImageOrigin) imageURL(format string, args ...any) string {
	return o.origin + fmt.Sprintf(format, args...)
}
