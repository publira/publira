# Caddy with the rate_limit handler the Caddyfile carries commented out, which
# the caddy image ships without: the rate-limit pass of the routing check runs
# the Caddyfile with those lines uncommented, and the caddy image refuses it.
# The same Caddy version as the image compose.caddy.yaml runs, with that one
# module added.

FROM caddy:2.11.9-builder-alpine@sha256:7d56ec51429d46ff6495db1542cc20e0a4e1559e766b2f4fc48ae25eeca16167 AS builder

# renovate: datasource=go depName=github.com/mholt/caddy-ratelimit
ARG CADDY_RATELIMIT_VERSION=v0.1.1-0.20260612195517-5625512f24f6
RUN xcaddy build --with "github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}"

FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
