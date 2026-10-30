#!/usr/bin/env bash
# Probe an edge started behind the trusted hop with every limit on: a burst
# over an allowance infra/proxy/README.md lists is answered 429 by the edge,
# for the client that sent it alone, and nothing else is limited.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ "${PUBLIRA_ROUTING_RATE_LIMITS}" != "1" ]]; then
  routing_fail "PUBLIRA_ROUTING_RATE_LIMITS is '${PUBLIRA_ROUTING_RATE_LIMITS}' (want 1)"
fi

routing_log "=== rate limit probes ==="

# What the edge serves without counting it, sent first while every allowance
# of this client is full, so that a limit placed on it shows as a 429. Pages,
# the webhooks an outside service posts, and the consoles' requests are
# counted by no allowance, the consoles' since the server limits them itself.
assert_not_rate_limited "pages on a site host are not limited" GET localhost / $((PUBLIRA_ROUTING_API_BURST * 2))
assert_not_rate_limited "the payment webhook is not limited" POST localhost /api/v1/webhook/payment/stripe $((PUBLIRA_ROUTING_API_BURST * 2))
assert_not_rate_limited "the inbound email webhook is not limited" POST localhost /api/v1/webhook/email/sendgrid $((PUBLIRA_ROUTING_API_BURST * 2))
assert_not_rate_limited "rpc on a console host is not limited" GET admin.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" $((PUBLIRA_ROUTING_API_BURST * 2))
assert_not_rate_limited "search on a console host is not limited" GET studio.example.com "/rpc/${PUBLIRA_ROUTING_SEARCH_PROCEDURE}" $((PUBLIRA_ROUTING_SEARCH_BURST * 2))
assert_not_rate_limited "rpc on the platform host is not limited" GET platform.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" $((PUBLIRA_ROUTING_API_BURST * 2))
assert_not_rate_limited "images on a console host are not limited" GET admin.localhost /images/cover $((PUBLIRA_ROUTING_IMAGES_BURST * 2))

# Each allowance on a tenant's site, and the images on its image host. A
# request past it is answered 429 by the edge until it refills, on every host
# it counts, so a burst right after on another of them is served only what
# refilled since. Every answer is the edge's own: a backend never answers 429.
assert_rate_limited "rpc on a site host" GET localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" "${PUBLIRA_ROUTING_API_BURST}" "${PUBLIRA_ROUTING_API_RATE}"
assert_allowance_shared "rpc on another site host once the allowance is spent" GET reader.example.org "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" "${PUBLIRA_ROUTING_API_BURST}" "${PUBLIRA_ROUTING_API_RATE}"

assert_rate_limited "the search RPC" GET localhost "/rpc/${PUBLIRA_ROUTING_SEARCH_PROCEDURE}" "${PUBLIRA_ROUTING_SEARCH_BURST}" "${PUBLIRA_ROUTING_SEARCH_RATE}"
assert_allowance_shared "another search RPC on another site host once the allowance is spent" GET reader.example.org /rpc/publira.v1.CatalogService/SearchPublishedCreators "${PUBLIRA_ROUTING_SEARCH_BURST}" "${PUBLIRA_ROUTING_SEARCH_RATE}"

assert_rate_limited "the search page" GET localhost /search "${PUBLIRA_ROUTING_SEARCH_BURST}" "${PUBLIRA_ROUTING_SEARCH_RATE}"
assert_allowance_shared "the search page with a locale prefix once the allowance is spent" GET reader.example.org /zh-Hans/search "${PUBLIRA_ROUTING_SEARCH_BURST}" "${PUBLIRA_ROUTING_SEARCH_RATE}"

assert_rate_limited "images on an image host" GET pictures.example.net /images/cover "${PUBLIRA_ROUTING_IMAGES_BURST}" "${PUBLIRA_ROUTING_IMAGES_RATE}"
assert_allowance_shared "images on a site host once the allowance is spent" GET localhost /images/cover "${PUBLIRA_ROUTING_IMAGES_BURST}" "${PUBLIRA_ROUTING_IMAGES_RATE}"

# Spending one allowance leaves the others and the unlimited paths alone.
assert_route "pages on a site host are served once the allowances are spent" GET localhost /series web-storefront /series
assert_route "rpc on a console host is served once the allowances are spent" GET admin.localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" api "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}"

# Behind the hop, the edge counts each client by the address the hop names,
# not by the hop's own: a client the hop names has an allowance apart from the
# host's, which is spent above, and from every other client it names.
assert_hop_rate_limited "rpc for one client through the trusted hop" localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" "${PUBLIRA_ROUTING_API_BURST}" "${PUBLIRA_ROUTING_API_RATE}" 198.51.100.21
assert_hop_served "rpc for another client through the trusted hop" localhost "/rpc/${PUBLIRA_ROUTING_PUBLIC_PROCEDURE}" 198.51.100.22

routing_log "=== rate limit probes passed ==="
