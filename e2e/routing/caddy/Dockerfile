# Caddy with the rate_limit handler the Caddyfile carries commented out, which
# the caddy image ships without: the rate-limit pass of the routing check runs
# the Caddyfile with those lines uncommented, and the caddy image refuses it.
# The same Caddy version as the image compose.caddy.yaml runs, with that one
# module added.

FROM caddy:2.11.7-builder-alpine@sha256:95a5e7e2692b5eb9545aadc5b90a39f6f509bee59c9508a493f83ee902eaef63 AS builder

# renovate: datasource=go depName=github.com/mholt/caddy-ratelimit
ARG CADDY_RATELIMIT_VERSION=v0.1.1-0.20260612195517-5625512f24f6
RUN xcaddy build --with "github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}"

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
