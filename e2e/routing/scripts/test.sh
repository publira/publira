#!/usr/bin/env bash
# Probe the edge through the published port and assert backend + path.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "=== route probes ==="

# Host-based apps. Each listed host reaches the app whose list names it, and
# its name decides nothing: the lists are in lib.sh.
assert_route "web-host listed host" GET localhost / web-host /
assert_route "web-host listed host of no convention" GET reader.example.org /catalog web-host /catalog
assert_route "web-host listed host named like a console" GET admin.reader.example.org / web-host /
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "web-admin listed host of no convention" GET studio.example.com /series web-admin /series
assert_route "web-platform listed host" GET platform.localhost / web-platform /
assert_route "web-platform listed host of no convention" GET operators.example.net /tenants web-platform /tenants

# Host matching ignores the port. A browser hitting the forwarded entrypoint
# sends Host `admin.localhost:3080`.
assert_route "web-host host with port" GET reader.example.org:3080 / web-host /
assert_route "web-admin host with port" GET studio.example.com:3080 / web-admin /
assert_route "web-platform host with port" GET operators.example.net:3080 / web-platform /

# A host in no list reaches nothing, whatever it looks like: the patterns the
# samples used to route by name no app, and nothing falls through to web-host.
assert_unrouted "unlisted admin host" GET admin.example.com /
assert_unrouted "unlisted numbered admin host" GET admin2.localhost /series
assert_unrouted "unlisted platform host" GET platform.example.com /tenants
assert_unrouted "unlisted site host" GET unknown-tenant.localhost /
assert_unrouted "unlisted host with port" GET unknown-tenant.localhost:3080 /
assert_unrouted "unlisted host on /api" GET unknown-tenant.localhost /api/foo
assert_unrouted "unlisted host on /api/v1" POST unknown-tenant.localhost /api/v1/revalidate
assert_unrouted "unlisted host on /images" GET admin.example.com /images/cover

# /api reaches the server :8000 with the path intact, on every listed host:
# the server's own routes carry the prefix.
assert_route "api keeps /api" GET localhost /api api /api
assert_route "api keeps /api/" GET localhost /api/ api /api/
assert_route "api keeps a procedure path" GET localhost /api/publira.v1.CatalogService/ListPublishedSeries api /api/publira.v1.CatalogService/ListPublishedSeries
assert_route "api keeps a deeper path" GET localhost /api/foo/bar api /api/foo/bar
assert_route "api on admin host" GET admin.localhost /api/foo api /api/foo
assert_route "api on platform host" GET platform.localhost /api/foo api /api/foo
assert_route "api on a console host of no convention" GET studio.example.com /api/foo api /api/foo

# /api/v1 is the exception: it is where the Next.js apps mount their Route
# Handlers, so it stays on the app the host rules picked, prefix intact.
assert_route "revalidate stays on web-host" GET localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_route "revalidate trailing slash stays on web-host" GET localhost /api/v1/revalidate/ web-host /api/v1/revalidate/
assert_route "revalidate POST stays on web-host" POST localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_route "revalidate on admin host stays on web-admin" POST admin.localhost /api/v1/revalidate web-admin /api/v1/revalidate
assert_route "revalidate on platform host stays on web-platform" POST platform.localhost /api/v1/revalidate web-platform /api/v1/revalidate
assert_route "view beacon stays on web-host" POST localhost /api/v1/views web-host /api/v1/views
assert_route "read beacon stays on web-host" POST localhost /api/v1/series/SERIES_001/episodes/EPISODE_001/read web-host /api/v1/series/SERIES_001/episodes/EPISODE_001/read
assert_route "payment webhook stays on web-host" POST localhost /api/v1/webhook/payment/stripe web-host /api/v1/webhook/payment/stripe
assert_route "legacy stripe webhook stays on web-host" POST localhost /api/v1/webhook/stripe web-host /api/v1/webhook/stripe
assert_route "inbound email webhook stays on web-host" POST localhost /api/v1/webhook/email/sendgrid web-host /api/v1/webhook/email/sendgrid
assert_route "bare /api/v1 stays on web-host" GET localhost /api/v1 web-host /api/v1

# The exception ends at the path segment: /api/v1abc is not one of the Route
# Handlers, so it is the public API like any other /api path.
assert_route "api keeps /api/v1abc" GET localhost /api/v1abc api /api/v1abc

# /images outranks the host routers: the api backend answers it for every
# listed host with the path intact, and picks the rules it applies from the
# host name the edge forwarded unrewritten.
assert_route "images on default host" GET localhost /images/cover api /images/cover
assert_route "images on platform host" GET platform.localhost /images/cover api /images/cover
assert_route "images on admin host" GET admin.localhost /images/cover api /images/cover
assert_route "images on a site host of no convention" GET reader.example.org /images/x api /images/x

# An inbound email provider posts a reader's reply with the headers its token
# or signature travels in, and SendGrid posts the mail with its attachments,
# up to its own 30 MB limit; web-host reads up to 32 MiB of it. Each post has
# to reach web-host whole.
assert_webhook_delivered "SendGrid post reaches web-host intact" localhost /api/v1/webhook/email/sendgrid web-host 4096 "${PUBLIRA_ROUTING_SENDGRID_HEADERS[@]}"
assert_webhook_delivered "Resend post reaches web-host intact" localhost /api/v1/webhook/email/resend web-host 1024 "${PUBLIRA_ROUTING_RESEND_HEADERS[@]}"
assert_webhook_delivered "SendGrid post of 32 MiB reaches web-host whole" localhost /api/v1/webhook/email/sendgrid web-host 33554432 "${PUBLIRA_ROUTING_SENDGRID_HEADERS[@]}"

# The episode edit screen posts a whole episode's pages in one upload, which
# web-admin reads up to 256 MiB of, and the edge gives it 300 seconds to
# arrive. Spread over 75 seconds, it outlasts the 60 seconds Traefik gives a
# request by default.
assert_upload_delivered "page upload of 256 MiB over 75 seconds reaches web-admin whole" admin.localhost /api/v1/episode-pages web-admin 268435456 75

# Inbound W3C Trace Context is dropped at the edge, before any route runs. The
# Go servers adopt an inbound `traceparent` as the parent span, so a caller
# that could set it would pick the trace ID and the sampled flag; every backend
# reachable from outside has to see it gone. The probes also re-assert backend
# and path, because the header removal must not disturb either.
assert_trace_context_stripped "web-host drops trace context" GET localhost / web-host /
assert_trace_context_stripped "web-admin drops trace context" GET admin.localhost / web-admin /
assert_trace_context_stripped "web-platform drops trace context" GET platform.localhost / web-platform /
assert_trace_context_stripped "api drops trace context" GET localhost /api/foo api /api/foo
assert_trace_context_stripped "api on admin host drops trace context" GET admin.localhost /api/foo api /api/foo
assert_trace_context_stripped "revalidate drops trace context" POST localhost /api/v1/revalidate web-host /api/v1/revalidate
assert_trace_context_stripped "images drop trace context" GET localhost /images/cover api /images/cover
assert_trace_context_stripped "images on admin host drop trace context" GET admin.localhost /images/cover api /images/cover

# The headers the edge sets for the backend, on requests that forge all of
# them. Tenant resolution reads `Host` and `X-Forwarded-Host`, the CSRF origin
# check reads `X-Forwarded-Host` and `X-Forwarded-Proto`, and the server finds
# the client IP an access token and an audit log entry record in `Forwarded`
# or `X-Forwarded-For`, so a caller that could plant any of them would choose
# what a backend believes about its own request.
assert_forwarded_headers "web-host is given the edge's forwarded headers" GET localhost / web-host
assert_forwarded_headers "web-admin is given the edge's forwarded headers" GET admin.localhost / web-admin
assert_forwarded_headers "web-platform is given the edge's forwarded headers" GET platform.localhost / web-platform
assert_forwarded_headers "api is given the edge's forwarded headers" GET localhost /api/foo api
assert_forwarded_headers "images are given the edge's forwarded headers" GET localhost /images/cover api
assert_forwarded_headers "images on admin host are given the edge's forwarded headers" GET admin.localhost /images/cover api

routing_log "=== route probes passed ==="
