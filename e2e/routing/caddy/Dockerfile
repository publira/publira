# Caddy with the rate_limit handler the Caddyfile carries commented out, which
# the caddy image ships without: the rate-limit pass of the routing check runs
# the Caddyfile with those lines uncommented, and the caddy image refuses it.
# The same Caddy version as the image compose.caddy.yaml runs, with that one
# module added.

FROM caddy:2.11.9-builder-alpine@sha256:86e132d1d6db8850352b2dbc15f82a4cb25363ac305ee41e11405873e5931f37 AS builder

# renovate: datasource=go depName=github.com/mholt/caddy-ratelimit
ARG CADDY_RATELIMIT_VERSION=v0.1.1-0.20260612195517-5625512f24f6
RUN xcaddy build --with "github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}"

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
