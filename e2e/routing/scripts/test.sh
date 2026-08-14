#!/usr/bin/env bash
# Probe Traefik through the published entrypoint and assert backend + path.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "=== route probes ==="

# Host-based apps. PathPrefix(`/`) is the fallback (priority 1); admin / platform
# HostRegexp routers sit at priority 100. `\d*` is zero-or-more, so
# `admin.localhost` and `admin2.example.com` both match.
assert_route "web-host default host" GET localhost / web-host /
assert_route "web-host other tenant host" GET other.localhost /catalog web-host /catalog
assert_route "web-host unknown tenant host" GET unknown-tenant.localhost / web-host /
assert_route "web-admin host" GET admin.localhost / web-admin /
assert_route "web-admin numbered host" GET admin2.example.com /series web-admin /series
assert_route "web-admin does not match administrator.*" GET administrator.localhost / web-host /
assert_route "web-platform host" GET platform.localhost / web-platform /
assert_route "web-platform other domain" GET platform.example.com /tenants web-platform /tenants

# Traefik HostRegexp matches the hostname without the port. A browser hitting
# the forwarded entrypoint sends Host `admin.localhost:3080`.
assert_route "web-admin host with port" GET admin.localhost:3080 / web-admin /
assert_route "web-platform host with port" GET platform.localhost:3080 / web-platform /

# /api is stripped before the request reaches api-server :8000. The exclusion
# is the exact Next.js revalidate path so it stays on the matching web app.
assert_route "api strip /api" GET localhost /api api /
assert_route "api strip /api/" GET localhost /api/ api /
assert_route "api strip nested path" GET localhost /api/readyz api /readyz
assert_route "api strip deeper path" GET localhost /api/foo/bar api /foo/bar
assert_route "api strip on admin host" GET admin.localhost /api/readyz api /readyz
assert_route "api strip on platform host" GET platform.localhost /api/readyz api /readyz

assert_route "revalidate stays on web-host" GET localhost /api/revalidate web-host /api/revalidate
assert_route "revalidate trailing slash stays on web-host" GET localhost /api/revalidate/ web-host /api/revalidate/
assert_route "revalidate POST stays on web-host" POST localhost /api/revalidate web-host /api/revalidate
assert_route "revalidate on admin host stays on web-admin" POST admin.localhost /api/revalidate web-admin /api/revalidate
assert_route "revalidate prefix is not excluded" GET localhost /api/revalidate/extra api /revalidate/extra

# /images is higher priority than the host routers. admin.* + /images is
# higher still and lands on admin-image-server :8201.
assert_route "images on default host" GET localhost /images/cover image-server /images/cover
assert_route "images on platform host" GET platform.localhost /images/cover image-server /images/cover
assert_route "images on admin host" GET admin.localhost /images/cover admin-image-server /images/cover
assert_route "images on numbered admin host" GET admin1.localhost /images/x admin-image-server /images/x

routing_log "=== route probes passed ==="
