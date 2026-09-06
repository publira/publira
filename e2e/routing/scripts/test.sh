#!/usr/bin/env bash
# Probe the edge through the published port and assert backend + path.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "=== route probes ==="

# Host-based apps. Everything that is not an admin or a platform host is the
# public tenant site. `\d*` is zero-or-more, so `admin.localhost` and
# `admin2.example.com` are both consoles.
assert_route "web-host default host" GET localhost / web-host /
assert_route "web-host other tenant host" GET other.localhost /catalog web-host /catalog
assert_route "web-host unknown tenant host" GET unknown-tenant.localhost / web-host /
assert_route "web-admin host" GET admin.localhost / web-admin /
assert_route "web-admin numbered host" GET admin2.example.com /series web-admin /series
assert_route "web-admin does not match administrator.*" GET administrator.localhost / web-host /
assert_route "web-platform host" GET platform.localhost / web-platform /
assert_route "web-platform other domain" GET platform.example.com /tenants web-platform /tenants

# Host matching ignores the port. A browser hitting the forwarded entrypoint
# sends Host `admin.localhost:3080`.
assert_route "web-admin host with port" GET admin.localhost:3080 / web-admin /
assert_route "web-platform host with port" GET platform.localhost:3080 / web-platform /

# /api is stripped before the request reaches api-server :8000, on every host.
assert_route "api strip /api" GET localhost /api api /
assert_route "api strip /api/" GET localhost /api/ api /
assert_route "api strip nested path" GET localhost /api/readyz api /readyz
assert_route "api strip deeper path" GET localhost /api/foo/bar api /foo/bar
assert_route "api strip on admin host" GET admin.localhost /api/readyz api /readyz
assert_route "api strip on platform host" GET platform.localhost /api/readyz api /readyz

# /api/v1 is the exception: it is where the Next.js apps mount their Route
# Handlers, so it stays on the app the host rules picked, prefix intact.
assert_route "revalidate stays on web-host" GET localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_route "revalidate trailing slash stays on web-host" GET localhost /api/v1/revalidate/ web-host /api/v1/revalidate/
assert_route "revalidate POST stays on web-host" POST localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_route "revalidate on admin host stays on web-admin" POST admin.localhost /api/v1/revalidate web-admin /api/v1/revalidate
assert_route "revalidate on platform host stays on web-platform" POST platform.localhost /api/v1/revalidate web-platform /api/v1/revalidate
assert_route "view beacon stays on web-host" POST localhost /api/v1/views web-host /api/v1/views
assert_route "read beacon stays on web-host" POST localhost /api/v1/series/SERIES_001/episodes/EPISODE_001/read web-host /api/v1/series/SERIES_001/episodes/EPISODE_001/read
assert_route "stripe webhook stays on web-host" POST localhost /api/v1/webhook/stripe web-host /api/v1/webhook/stripe
assert_route "bare /api/v1 stays on web-host" GET localhost /api/v1 web-host /api/v1

# The exception ends at the path segment: /api/v1abc is not one of the Route
# Handlers, so it is the public API like any other /api path.
assert_route "api keeps /api/v1abc" GET localhost /api/v1abc api /v1abc

# /images outranks the host routers. An admin host takes it further, to the
# image server the console reads from.
assert_route "images on default host" GET localhost /images/cover image-server /images/cover
assert_route "images on platform host" GET platform.localhost /images/cover image-server /images/cover
assert_route "images on admin host" GET admin.localhost /images/cover admin-image-server /images/cover
assert_route "images on numbered admin host" GET admin1.localhost /images/x admin-image-server /images/x

# Inbound W3C Trace Context is dropped at the edge, before any route runs. The
# Go servers adopt an inbound `traceparent` as the parent span, so a caller
# that could set it would pick the trace ID and the sampled flag; every backend
# reachable from outside has to see it gone. The probes also re-assert backend
# and path, because the header removal must not disturb either.
assert_trace_context_stripped "web-host drops trace context" GET localhost / web-host /
assert_trace_context_stripped "web-admin drops trace context" GET admin.localhost / web-admin /
assert_trace_context_stripped "web-platform drops trace context" GET platform.localhost / web-platform /
assert_trace_context_stripped "api drops trace context" GET localhost /api/readyz api /readyz
assert_trace_context_stripped "api on admin host drops trace context" GET admin.localhost /api/readyz api /readyz
assert_trace_context_stripped "revalidate drops trace context" POST localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_trace_context_stripped "image-server drops trace context" GET localhost /images/cover image-server /images/cover
assert_trace_context_stripped "admin-image-server drops trace context" GET admin.localhost /images/cover admin-image-server /images/cover

routing_log "=== route probes passed ==="
