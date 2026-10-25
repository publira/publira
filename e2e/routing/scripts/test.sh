#!/usr/bin/env bash
# Probe the edge through the published port and assert backend + path.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "=== route probes ==="

# Host-based apps. Each listed host reaches the app whose list names it, and
# its name decides nothing: the lists are in lib.sh.
assert_route "web-storefront listed host" GET localhost / web-storefront /
assert_route "web-storefront listed host of no convention" GET reader.example.org /catalog web-storefront /catalog
assert_route "web-storefront listed host named like a console" GET admin.reader.example.org / web-storefront /
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "web-admin listed host of no convention" GET studio.example.com /series web-admin /series
assert_route "web-platform listed host" GET platform.localhost / web-platform /
assert_route "web-platform listed host of no convention" GET operators.example.net /tenants web-platform /tenants

# Host matching ignores the port. A browser hitting the forwarded entrypoint
# sends Host `admin.localhost:3080`.
assert_route "web-storefront host with port" GET reader.example.org:3080 / web-storefront /
assert_route "web-admin host with port" GET studio.example.com:3080 / web-admin /
assert_route "web-platform host with port" GET operators.example.net:3080 / web-platform /

# A host in no list reaches nothing, whatever it looks like: the patterns the
# samples used to route by name no app, and nothing falls through to
# web-storefront.
assert_unrouted "unlisted admin host" GET admin.example.com /
assert_unrouted "unlisted numbered admin host" GET admin2.localhost /series
assert_unrouted "unlisted platform host" GET platform.example.com /tenants
assert_unrouted "unlisted site host" GET unknown-tenant.localhost /
assert_unrouted "unlisted host with port" GET unknown-tenant.localhost:3080 /
assert_unrouted "unlisted host on /rpc" GET unknown-tenant.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "unlisted host on bare /rpc" GET unknown-tenant.localhost /rpc
assert_unrouted "unlisted host on /api/v1" POST unknown-tenant.localhost /api/v1/revalidate
assert_unrouted "unlisted host on /images" GET admin.example.com /images/cover

# The public API reaches the server :8000 with the path intact, on every listed
# host: the server's own routes carry the prefix.
assert_route "rpc keeps a procedure path" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "rpc on admin host" GET admin.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "rpc on platform host" GET platform.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "rpc on a site host of no convention" GET reader.example.org "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "rpc on a console host of no convention" GET studio.example.com "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "rpc on a platform host of no convention" GET operators.example.net "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"

# Nothing else under /rpc reaches a backend, on any listed host: the consoles'
# namespaces are called over the private network, so the edge answers them
# itself, and every other path there with them. The public API's prefix ends at
# the dot after v1, so a namespace that only starts like it is answered by the
# edge too.
for host in localhost reader.example.org admin.localhost studio.example.com platform.localhost operators.example.net; do
  assert_unrouted "admin namespace on ${host}" POST "${host}" /rpc/publira.admin.v1.AdminSeriesService/ListSeries
  assert_unrouted "platform namespace on ${host}" POST "${host}" /rpc/publira.platform.v1.PlatformTenantService/ListTenants
done
assert_unrouted "bare /rpc" GET localhost /rpc
assert_unrouted "/rpc/" GET localhost /rpc/
assert_unrouted "rpc deeper path" GET localhost /rpc/foo/bar
assert_unrouted "rpc namespace without the dot" GET localhost /rpc/publira.v1
assert_unrouted "rpc namespace sharing the prefix" POST localhost /rpc/publira.v1beta.CatalogService/ListPublishedSeries
assert_unrouted "rpc types namespace" POST localhost /rpc/publira.types.v1.Foo/Bar

# The prefix ends at the path segment: /rpcabc is a path of the app the host
# rules picked.
assert_route "rpcabc stays on web-storefront" GET localhost /rpcabc web-storefront /rpcabc

# /api is no prefix of the server's, so a procedure path under it, in any
# namespace, is a path of the app the host rules picked like any other.
assert_route "api procedure stays on web-storefront" GET localhost "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" web-storefront "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "api procedure on admin host stays on web-admin" GET admin.localhost "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" web-admin "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "api procedure on platform host stays on web-platform" GET platform.localhost "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" web-platform "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "api procedure on a console host of no convention stays on web-admin" GET studio.example.com "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" web-admin "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "api admin namespace on admin host stays on web-admin" POST admin.localhost /api/publira.admin.v1.AdminSeriesService/ListSeries web-admin /api/publira.admin.v1.AdminSeriesService/ListSeries
assert_route "api platform namespace on platform host stays on web-platform" POST platform.localhost /api/publira.platform.v1.PlatformTenantService/ListTenants web-platform /api/publira.platform.v1.PlatformTenantService/ListTenants
assert_route "bare /api stays on web-storefront" GET localhost /api web-storefront /api

# The Next.js apps mount their Route Handlers under /api/v1, which reaches the
# app the host rules picked, prefix intact.
assert_route "revalidate stays on web-storefront" GET localhost /api/v1/revalidate web-storefront /api/v1/revalidate
assert_route "revalidate trailing slash stays on web-storefront" GET localhost /api/v1/revalidate/ web-storefront /api/v1/revalidate/
assert_route "revalidate POST stays on web-storefront" POST localhost /api/v1/revalidate web-storefront /api/v1/revalidate
assert_route "revalidate on admin host stays on web-admin" POST admin.localhost /api/v1/revalidate web-admin /api/v1/revalidate
assert_route "revalidate on platform host stays on web-platform" POST platform.localhost /api/v1/revalidate web-platform /api/v1/revalidate
assert_route "view beacon stays on web-storefront" POST localhost /api/v1/views web-storefront /api/v1/views
assert_route "read beacon stays on web-storefront" POST localhost /api/v1/series/SERIES_001/episodes/EPISODE_001/read web-storefront /api/v1/series/SERIES_001/episodes/EPISODE_001/read
assert_route "payment webhook stays on web-storefront" POST localhost /api/v1/webhook/payment/stripe web-storefront /api/v1/webhook/payment/stripe
assert_route "inbound email webhook stays on web-storefront" POST localhost /api/v1/webhook/email/sendgrid web-storefront /api/v1/webhook/email/sendgrid
assert_route "bare /api/v1 stays on web-storefront" GET localhost /api/v1 web-storefront /api/v1

# /images outranks the host routers: the api backend answers it for every
# listed host with the path intact, and picks the rules it applies from the
# host name the edge forwarded unrewritten.
assert_route "images on default host" GET localhost /images/cover api /images/cover
assert_route "images on platform host" GET platform.localhost /images/cover api /images/cover
assert_route "images on admin host" GET admin.localhost /images/cover api /images/cover
assert_route "images on a site host of no convention" GET reader.example.org /images/x api /images/x

# A tenant's image host serves image delivery and nothing else: no app answers
# it, so the edge answers every other path itself, the public API and the
# consoles' namespaces included. Its name decides nothing either, so one named
# like a console host is an image host all the same.
assert_route "images on an image host" GET pictures.example.net /images/episodes/EPISODE_001/pages/1 api /images/episodes/EPISODE_001/pages/1
assert_route "images on an image host named like a console" GET admin.art.example.com /images/cover api /images/cover
assert_route "images on an image host with port" GET pictures.example.net:3080 /images/cover api /images/cover
assert_unrouted "rpc on an image host" GET pictures.example.net "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "admin namespace on an image host" POST pictures.example.net /rpc/publira.admin.v1.AdminSeriesService/ListSeries
assert_unrouted "bare /rpc on an image host" GET pictures.example.net /rpc
assert_unrouted "page on an image host" GET pictures.example.net /
assert_unrouted "page on an image host named like a console" GET admin.art.example.com /series
assert_unrouted "api/v1 on an image host" POST pictures.example.net /api/v1/revalidate
assert_unrouted "api procedure on an image host" GET pictures.example.net "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"

# An inbound email provider posts a reader's reply with the headers its token or
# signature travels in, and SendGrid posts the mail with its attachments, up to
# its own 30 MB limit; web-storefront reads up to 32 MiB of it. Each post has to
# reach web-storefront whole.
assert_webhook_delivered "SendGrid post reaches web-storefront intact" localhost /api/v1/webhook/email/sendgrid web-storefront 4096 "${PUBLIRA_ROUTING_SENDGRID_HEADERS[@]}"
assert_webhook_delivered "Resend post reaches web-storefront intact" localhost /api/v1/webhook/email/resend web-storefront 1024 "${PUBLIRA_ROUTING_RESEND_HEADERS[@]}"
assert_webhook_delivered "SendGrid post of 32 MiB reaches web-storefront whole" localhost /api/v1/webhook/email/sendgrid web-storefront 33554432 "${PUBLIRA_ROUTING_SENDGRID_HEADERS[@]}"

# A reader's icon upload is the largest request the public API reads: an image
# of up to 10 MiB in the base64 of the JSON encoding, and the fields beside it.
# It has to reach the api backend whole on the tenant site.
assert_upload_delivered "icon upload of 15029592 bytes reaches api whole" localhost /rpc/publira.v1.AuthService/UploadMyIcon api 15029592 0

# A Server Action posts to the path of its page, and an image travels in it
# with the multipart framing and the fields beside it: a reader's icon of up to
# 10 MiB to web-storefront, and an image uploaded from the tenant console to
# web-admin. A page path admits 11 MiB on either host, so a body that size has
# to reach its app whole.
assert_upload_delivered "icon Server Action of 11 MiB on a page path reaches web-storefront whole" localhost /en/settings web-storefront 11534336 0
assert_upload_delivered "image Server Action of 11 MiB on a page path reaches web-admin whole" admin.localhost /branding web-admin 11534336 0

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
assert_trace_context_stripped "web-storefront drops trace context" GET localhost / web-storefront /
assert_trace_context_stripped "web-admin drops trace context" GET admin.localhost / web-admin /
assert_trace_context_stripped "web-platform drops trace context" GET platform.localhost / web-platform /
assert_trace_context_stripped "rpc drops trace context" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_trace_context_stripped "rpc on admin host drops trace context" GET admin.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_trace_context_stripped "revalidate drops trace context" POST localhost /api/v1/revalidate web-storefront /api/v1/revalidate
assert_trace_context_stripped "images drop trace context" GET localhost /images/cover api /images/cover
assert_trace_context_stripped "images on admin host drop trace context" GET admin.localhost /images/cover api /images/cover
assert_trace_context_stripped "images on an image host drop trace context" GET pictures.example.net /images/cover api /images/cover

# The headers the edge sets for the backend, on requests that forge all of
# them. Tenant resolution reads `Host` and `X-Forwarded-Host`, the CSRF origin
# check reads `X-Forwarded-Host` and `X-Forwarded-Proto`, and the server finds
# the client IP an access token and an audit log entry record in `Forwarded`
# or `X-Forwarded-For`, so a caller that could plant any of them would choose
# what a backend believes about its own request.
assert_forwarded_headers "web-storefront is given the edge's forwarded headers" GET localhost / web-storefront
assert_forwarded_headers "web-admin is given the edge's forwarded headers" GET admin.localhost / web-admin
assert_forwarded_headers "web-platform is given the edge's forwarded headers" GET platform.localhost / web-platform
assert_forwarded_headers "rpc is given the edge's forwarded headers" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api
assert_forwarded_headers "images are given the edge's forwarded headers" GET localhost /images/cover api
assert_forwarded_headers "images on admin host are given the edge's forwarded headers" GET admin.localhost /images/cover api
assert_forwarded_headers "images on an image host are given the edge's forwarded headers" GET pictures.example.net /images/cover api

routing_log "=== route probes passed ==="
