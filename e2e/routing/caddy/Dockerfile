# Caddy with the rate_limit handler the Caddyfile carries commented out, which
# the caddy image ships without: the rate-limit pass of the routing check runs
# the Caddyfile with those lines uncommented, and the caddy image refuses it.
# The same Caddy version as the image compose.caddy.yaml runs, with that one
# module added.

FROM caddy:2.11.8-builder-alpine@sha256:661f29bb0de2c3ea5eb9cae5783e1c907ef7daa13a4b7db5207c710f51854e4a AS builder

# renovate: datasource=go depName=github.com/mholt/caddy-ratelimit
ARG CADDY_RATELIMIT_VERSION=v0.1.1-0.20260612195517-5625512f24f6
RUN xcaddy build --with "github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}"

FROM caddy:2.11.8-alpine@sha256:3db3a09e418f86a8fce8de4bc0026fccd2b4cd925aef00cc7d843d9fdc75e442

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
