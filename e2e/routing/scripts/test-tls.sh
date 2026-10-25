#!/usr/bin/env bash
# Probe a Caddy edge started with every listed host as its site addresses, the
# way an install that terminates TLS in the Caddyfile runs it: each listed host
# is served over HTTPS with a certificate Caddy issued for it, routed as on
# plain HTTP, and handed the backends with X-Forwarded-Proto https; plain HTTP
# for it is redirected there; and a host in no list reaches nothing on either
# port.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ "${PUBLIRA_ROUTING_TLS}" != "1" ]]; then
  routing_fail "PUBLIRA_ROUTING_TLS is '${PUBLIRA_ROUTING_TLS}' (want 1)"
fi

routing_log "=== route probes over HTTPS ==="

# http_probe checks every certificate against the name it is for, so each of
# these is also a certificate Caddy obtained for that host.
assert_route "web-storefront listed host" GET localhost / web-storefront /
assert_route "web-storefront listed host of no convention" GET reader.internal /catalog web-storefront /catalog
assert_route "web-admin listed host" GET admin.localhost / web-admin /
assert_route "web-admin listed host of no convention" GET studio.internal /series web-admin /series
assert_route "web-platform listed host" GET platform.localhost / web-platform /
assert_route "web-platform listed host of no convention" GET operators.internal /tenants web-platform /tenants

assert_route "rpc on a listed host" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "api procedure on a listed host" GET studio.internal "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" web-admin "/api/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_route "images on a listed host" GET admin.localhost /images/cover api /images/cover
assert_route "images on an image host" GET pictures.internal /images/cover api /images/cover
assert_unrouted "rpc on an image host" GET pictures.internal "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unrouted "page on an image host" GET pictures.internal /
assert_route "api/v1 on a listed host" POST reader.internal /api/v1/revalidate web-storefront /api/v1/revalidate
assert_unrouted "console API on a listed host" POST admin.localhost /rpc/publira.admin.v1.AdminSeriesService/ListSeries
assert_unrouted "platform API on a listed host" POST operators.internal /rpc/publira.platform.v1.PlatformTenantService/ListTenants

assert_trace_context_stripped "trace context on web-storefront" GET localhost / web-storefront /
assert_forwarded_headers "forwarded headers on web-storefront" GET reader.internal / web-storefront
assert_forwarded_headers "forwarded headers on web-admin" GET studio.internal / web-admin
assert_forwarded_headers "forwarded headers on rpc" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api
assert_forwarded_headers "forwarded headers on an image host" GET pictures.internal /images/cover api

# Plain HTTP to a listed host: the edge answers it with a redirect to the same
# path over HTTPS, and no backend sees the request.
assert_redirected_to_https() {
  local name="$1" host="$2" path="$3"
  local out code location
  out="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 5 \
    -H "Host: ${host}" "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}" 2> /dev/null || true)"
  code="${out%% *}"
  location="${out#* }"
  if [[ "${code}" != "308" || "${location}" != "https://${host}${path}" ]]; then
    routing_fail "${name}: plain HTTP answered '${out}' (want 308 to https://${host}${path}) host=${host} GET ${path}"
  fi
  routing_log "ok: ${name} → redirected to https://${host}${path}"
}

assert_redirected_to_https "web-storefront over plain HTTP" reader.internal "/catalog?page=2"
assert_redirected_to_https "web-admin over plain HTTP" admin.localhost /series
assert_redirected_to_https "rpc over plain HTTP" localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_redirected_to_https "image host over plain HTTP" pictures.internal "/images/cover?w=640"

# A host in no list has no certificate, so the TLS handshake fails before any
# request is read, and over plain HTTP the edge answers it with its own 404,
# as it does with TLS off.
assert_unlisted_refused() {
  local name="$1" host="$2" path="$3"
  local out code body
  out="$(http_probe GET "${host}" "${path}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"
  if [[ "${code}" != "000" ]]; then
    routing_fail "${name}: HTTPS answered HTTP ${code} (want the TLS handshake refused) host=${host} GET ${path} body=${body}"
  fi
  out="$(curl -sS -w '\n%{http_code}' --max-time 5 \
    -H "Host: ${host}" "http://127.0.0.1:${PUBLIRA_ROUTING_EDGE_PORT}${path}" 2> /dev/null || true)"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [[ -n "$(json_string_field "${body}" backend)" || "${code}" != "404" ]]; then
    routing_fail "${name}: plain HTTP answered HTTP ${code} (want 404 from the edge) host=${host} GET ${path} body=${body}"
  fi
  routing_log "ok: ${name} → refused at the TLS handshake, answered by the edge over plain HTTP"
}

assert_unlisted_refused "unlisted site host" unknown-tenant.localhost /
assert_unlisted_refused "unlisted admin host" admin.example.internal "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"
assert_unlisted_refused "unlisted host on /images" admin2.localhost /images/cover

routing_log "=== route probes over HTTPS passed ==="
