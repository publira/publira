// Package imagecachekey names the keys the image routes keep their renditions
// under in the shared Redis. It is apart from internal/imageserver so that a
// process that only erases them, as the erasure of a deleted tenant does in
// publiractl, links none of the image conversion that writes them.
package imagecachekey

import "strings"

// RedisPrefix keeps the renditions apart from everything else sharing the
// deployment's Redis.
const RedisPrefix = "publira:img:"

// tenantObjectPrefix is the part of the bucket every tenant's images are
// stored under, each tenant's behind its public ID.
const tenantObjectPrefix = "tenants/"

// Entry is what the rendition keyed key, of the object objectKey, is stored
// under: key behind the public ID of the tenant whose object it was rendered
// from, so the renditions of a deleted tenant are found by [TenantMatch]
// alone. key stays what the response names the rendition by.
func Entry(objectKey, key string) string {
	rest, ok := strings.CutPrefix(objectKey, tenantObjectPrefix)
	if !ok {
		return key
	}
	tenant, _, ok := strings.Cut(rest, "/")
	if !ok || tenant == "" {
		return key
	}
	return tenant + ":" + key
}

// TenantMatch is the SCAN MATCH pattern of every rendition the shared cache
// holds of the images of the tenant with publicID. A public ID holds no
// character the pattern treats as special.
func TenantMatch(publicID string) string {
	return RedisPrefix + publicID + ":*"
}
