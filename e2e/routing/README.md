# Edge routing connectivity check

This check runs the routing contract of [`infra/proxy/`](../../infra/proxy/README.md) against each proxy that implements it — Traefik, nginx, and Caddy — without starting real applications. It also covers removal of inbound trace context, which the same configuration does.

Playwright E2E ([`../README.md`](../README.md)) connects directly to application ports. Bootstrap ([`../bootstrap/README.md`](../bootstrap/README.md)) verifies `task setup` / `task dev`, but starts no edge. Neither is in this check's scope.

## Why it is needed

The files under `infra/proxy/` are the source of truth for the edge. A one-line change can break precedence, host matching, the `/rpc` route, the 404 the edge answers for the rest of `/rpc`, or the `/images` route, and one proxy can drift from the other two while every stack still starts. `pnpm preflight`, Playwright, and bootstrap detect none of it.

The `strip-trace-context`, `strip-forwarded`, and `strip-country-region` middlewares and their nginx and Caddy counterparts are covered for the same reason: they remove incoming `traceparent`, `tracestate`, and `baggage`, the one of `Forwarded` and `X-Forwarded-For` the sample does not set, and an `X-Forwarded-CountryRegion` that did not come from a trusted hop, and requests still succeed when the removal is gone, so that regression is silent without this check. See [`../../server/README.md`](../../server/README.md#trace-context-arriving-from-outside).

The Traefik run starts **the same compose files** the Dev Container does (the root `compose.yaml` and the overlay on it) under a dedicated project name, replacing only the `app` process with an echo server, so it verifies the Dev Container's own wiring as well as the routing. nginx and Caddy have no environment of their own here and get a compose file that pairs the echo backends with the proxy.

## Prerequisites

- Docker with Compose v2 that supports `!reset` and `!override`
- `curl` and `task`

| Use | Port | Notes |
| --- | --- | --- |
| The proxy's HTTP entrypoint | `13080` | Change with `PUBLIRA_ROUTING_EDGE_PORT`; it intentionally differs from the Dev Container's `3080`. |
| Traefik API / dashboard | `18080` | Change with `PUBLIRA_ROUTING_TRAEFIK_API_PORT`; the Traefik readiness check reads routers here. |
| Caddy's HTTPS listener | `13443` | Change with `PUBLIRA_ROUTING_EDGE_TLS_PORT`; only the pass that terminates TLS listens behind it. |

The trusted-hop pass creates a Docker network on `198.18.0.0/24` with the hop at `198.18.0.10`, a benchmarking range Docker does not hand out on its own. Change them with `PUBLIRA_ROUTING_HOP_SUBNET` and `PUBLIRA_ROUTING_HOP_ADDRESS` when the range is taken, or for two runs at once.

`db`, `redis`, and `mailpit` do not start. This can run alongside `task dev` when the default ports do not collide. The three proxies run one at a time, because they publish the same port.

Logs default to `e2e/routing/.run/<proxy>/`. When `PUBLIRA_ROUTING_EDGE_PORT`, `PUBLIRA_ROUTING_TRAEFIK_API_PORT`, or `PUBLIRA_ROUTING_PROJECT_NAME` differs from its default, `lib.sh` keeps state in a subdirectory made from the project name and ports. `PUBLIRA_ROUTING_RUN_DIR` takes precedence when set. `flock` rejects concurrent starts of the same compose project; starts on the same ports fail through normal port collision.

## Run

```bash
task e2e:routing
```

It always tears down each compose project and its volumes, whether it succeeds, fails, or is interrupted.

`PUBLIRA_ROUTING_PROXY` narrows the run to one proxy, or to a space-separated subset, and selects which one the individual commands below act on (default `traefik`).

```bash
PUBLIRA_ROUTING_PROXY=caddy task e2e:routing
```

### Individual commands

| Command | Purpose |
| --- | --- |
| `task e2e:routing:up` | Start one proxy and the echo backends behind it. |
| `task e2e:routing:wait-ready` | Wait until that edge serves the contract. |
| `task e2e:routing:test` | Probe Host, `/rpc`, and `/images` routes (requires a running stack). |
| `task e2e:routing:down` | Tear down that proxy's stack. |

Readiness differs by proxy. Traefik is asked through its insecure API for the routers the host lists call for, five or four, and the three middlewares the file provider loaded, because a partially loaded configuration is otherwise a wall of failing probes. nginx and Caddy have the whole configuration before they accept a connection, so readiness for them is the first request a listed site host answers. In the pass that terminates TLS, that request is over HTTPS, and is sent once the root of Caddy's local CA can be copied out of the container.

## What it verifies

Every proxy is given the same hosts, the `PUBLIRA_ROUTING_*_HOSTS` lists in `scripts/lib.sh`, as the `PUBLIRA_EDGE_*_HOSTS` variables the samples read; the Traefik run puts them in place of the Dev Container's own. Each proxy then starts a second time with the platform and image lists empty, the install that runs no web-platform and gives no tenant an image host, and `scripts/test-empty-lists.sh` checks that the same files start and route the other two apps, and that the platform and image hosts reach nothing.

The echo server responds with `{"backend","port","path","host","method","bytes"}`, the received `traceparent`, `tracestate`, and `baggage` values, the received `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For`, and `X-Forwarded-CountryRegion`, and the received `Authorization`, `Content-Type`, and Svix signature headers, so every probe can assert **which backend received a request**, **the path it saw** after prefix removal, **the headers it was given**, and **how much of the body arrived**.

Caddy then starts a third time with every listed host in `PUBLIRA_EDGE_TLS_HOSTS`, as the Compose install starts it once its ACME contact is set, and `scripts/test-tls.sh` probes it over HTTPS. A certificate authority on the internet reaches no host of a test, so this pass lists `localhost`, names under it, and names under `.internal`, for which Caddy issues certificates from its own local CA rather than over ACME, and every probe trusts that CA's root alone and checks the certificate against the host name. Each listed host reaches its app, the public API and `/images` reach the server, an image host reaches the server on `/images` and the edge on every other path, the consoles' namespaces are answered by the edge, and every backend is handed `X-Forwarded-Proto: https`; plain HTTP to a listed host is answered with a `308` to the same path over HTTPS; a host in no list fails its TLS handshake, and over plain HTTP is answered with the edge's own `404`.

Each proxy then starts once more behind a trusted hop. For Traefik and nginx, `lib.sh` copies the sample into the run directory with the commented trusted-proxy setting uncommented as it is written and the hop's address in place of `192.0.2.0/24`, and fails when the sample no longer carries the setting in that shape; Caddy keeps its Caddyfile as it stands and is given the hop's address in `PUBLIRA_EDGE_TRUSTED_PROXIES`, which Traefik is given as well for the router that keeps the hop's region. Traefik starts from `traefik.yaml` for this pass, since the Dev Container passes its static settings as flags, and its readiness is then the first request a listed site host answers, as for the other two. A `hop` container on a network of its own sends requests, to an image host among others, naming a client address in `X-Forwarded-For` and `Forwarded`, and a region in `X-Forwarded-CountryRegion`, and `scripts/test-trusted-hop.sh` checks that the backend is handed that address first, in the header the sample hands the client address over in, the `X-Forwarded-Proto: https` the hop sent, and, on `web-storefront`, the region it named, while requests from the host, outside the trusted range, still have their forged client address replaced and their region removed. Traefik's pass also repeats the slow page upload, since only this pass reads its read timeout from `traefik.yaml`.

`scripts/test.sh` is the list of probes, one per row of the contract: host routing for listed hosts whose names follow no convention and a `Host` carrying a port, unlisted hosts that look like a console, the Platform Console, or a site, none of which may reach a backend, the `/rpc` route of the public API, the consoles' namespaces and every other path under `/rpc`, which the edge has to answer itself on every listed host, procedure paths under `/api` and the Next.js Route Handlers under `/api/v1`, both of which reach the host's own app, and the `/images` route, which reaches the same backend as the public API on every listed host; no route rewrites the path. An image host reaches that backend on `/images` alone, whatever it is named, and the edge answers every other path on it, the public API, the consoles' namespaces, the pages, and `/api/v1` among them. An inbound email webhook post from SendGrid and one from Resend must reach `web-storefront` with the headers their token and signature travel in, and a 32 MiB body — the most `web-storefront` reads of a mail — must arrive whole. A console page upload of 256 MiB, sent slowly enough to take 75 seconds, must reach `web-admin` whole, which an edge that gives a request only the 60 seconds Traefik gives it by default cuts off. Two probe sets then run against every one of the four backends: forged `traceparent`, `tracestate`, and `baggage` values that must be gone by the time the request arrives, and forged `Forwarded` / `X-Forwarded-For` / `X-Forwarded-Host` / `X-Forwarded-Proto` / `X-Forwarded-CountryRegion` values that the edge must have removed or replaced with its own. The client address arrives as the peer address alone in `X-Forwarded-For` on Traefik and in `Forwarded` on nginx and Caddy, and the other of the two must not arrive at all: the server finds the client IP it records in `Forwarded` ahead of `X-Forwarded-For`. The CSRF origin check reads `X-Forwarded-Host` and `X-Forwarded-Proto`, and `web-storefront` passes `X-Forwarded-CountryRegion` on to a tenant's Google tag gateway.

## Layout

```text
e2e/routing/
├── compose.traefik.yaml         # Overlay for compose.yaml + .devcontainer/compose.yaml (published ports + echo app)
├── compose.echo.yaml            # The echo backends, for the proxies with no environment of their own
├── compose.nginx.yaml           # nginx in front of them
├── compose.caddy.yaml           # Caddy in front of them, on plain HTTP or terminating TLS
├── compose.traefik-sample.yaml  # Traefik from traefik.yaml in front of them, for the trusted-hop pass
├── compose.hop.yaml             # The trusted hop and its network, over any of the three
├── echo.ts                      # Returns JSON on 3000 / 4000 / 4100 / 8000
├── Taskfile.yaml
└── scripts/
    ├── lib.sh
    ├── run.sh              # Every proxy in turn
    ├── run-one.sh          # up → wait-ready → test, then again with no platform or image hosts, terminating TLS (Caddy), and behind a trusted hop, always followed by teardown
    ├── up.sh / wait-ready.sh / test.sh / test-empty-lists.sh / test-tls.sh / test-trusted-hop.sh
    └── down.sh
```

The Traefik overlay replaces only the `app` image, command, volumes, `depends_on`, and health check; the Dev Container's own Traefik service, its flags, and its mount of `infra/proxy/traefik/dynamic` are what the run exercises.

## Failure triage

The failing `[routing:<proxy>] ERROR: …` message identifies the probe and the proxy.

1. **port is already in use** — free `13080` / `18080`, or change `PUBLIRA_ROUTING_EDGE_PORT` / `PUBLIRA_ROUTING_TRAEFIK_API_PORT`.
2. **readiness failed: traefik-routers** — the file provider did not read `infra/proxy/traefik/dynamic`. Check the bind mount on the `traefik` service and that both `routes.yaml` and `services.yaml` parse. If middleware entries alone are missing, inspect `routes.yaml`.
3. **readiness failed: the … edge did not serve web-storefront** — the proxy exited or refused its configuration. `compose.log` in the run directory carries its startup errors.
4. **backend / path mismatch** — one proxy no longer agrees with the contract. Compare that proxy's files against the table in [`infra/proxy/README.md`](../../infra/proxy/README.md); a mismatch on one proxy only is in that proxy's configuration, and a mismatch on all three is the contract itself.
5. **backend saw traceparent … (want it stripped)** — Traefik: `--entrypoints.web.http.middlewares=strip-trace-context@file` and the middleware in `routes.yaml`. nginx: `snippets/proxy-headers.conf` and the `include` in each server block. Caddy: the `publira_forwarded` snippet and its `import` in each `reverse_proxy`.
6. **X-Forwarded-For … kept the forged address**, or **is a list**, on Traefik, or the same of **Forwarded** on nginx or Caddy — the edge appended to the caller's header instead of replacing it. Traefik replaces untrusted forwarded headers on its own unless `forwardedHeaders` has been given trusted addresses; nginx wants `proxy_set_header Forwarded $publira_forwarded` and the `map` in `default.conf.template`; Caddy wants `header_up Forwarded {publira_forwarded}` and the `map` in the site block.
7. **backend saw Forwarded … (want it removed …)**, on Traefik — `strip-forwarded@file` beside `strip-trace-context@file` on the entry point, and the middleware in `routes.yaml`. **backend saw X-Forwarded-For … (want it removed …)**, on nginx or Caddy — `proxy_set_header X-Forwarded-For ""` in `snippets/proxy-headers.conf`, or `header_up -X-Forwarded-For` in the `publira_forwarded` snippet.
8. **… does not start with the address the trusted hop named**, or **X-Forwarded-Proto 'http' (want 'https' …)** — that sample's trusted-proxy setting no longer trusts the hop, or no longer reads its headers. nginx wants `real_ip_header X-Forwarded-For` beside `set_real_ip_from`, and the hop's address in the `geo` block that `$publira_forwarded_proto` reads; Caddy wants `trusted_proxies static {$PUBLIRA_EDGE_TRUSTED_PROXIES}` under `servers`, `{client_ip}` in the `map` that `Forwarded` is set from, and no `header_up X-Forwarded-Proto` of its own; Traefik wants `forwardedHeaders.trustedIPs` on the `web` entry point.
9. **backend saw X-Forwarded-CountryRegion … (want it removed from a caller)** — Traefik: `strip-country-region` in the `middlewares` of every router but `web-storefront-trusted-hop` in `routes.yaml`. nginx: the `map` that sets `$publira_country_region` in `default.conf.template`, and `proxy_set_header X-Forwarded-CountryRegion` in `snippets/proxy-headers.conf`. Caddy: the `@untrusted_hop` matcher and its `request_header` in the site block. **X-Forwarded-CountryRegion '' (want … the region the trusted hop named)** — Traefik wants the hop's address in `PUBLIRA_EDGE_TRUSTED_PROXIES` and the `web-storefront-trusted-hop` router; nginx the hop's address in the `geo` block; Caddy `trusted_proxies` under `servers`, which sets the `trusted_proxy` variable the matcher reads.
10. **… no longer carries the commented trusted-proxy setting** — the commented lines of the Traefik or nginx sample changed shape, so `enable_trusted_hop` in `lib.sh` uncommented nothing. Update the sample or that function, whichever is wrong.
11. **readiness failed: the caddy edge did not serve web-storefront** in the TLS pass, or **HTTP 000** on a listed host there — Caddy issued no certificate for that host, or the probe could not copy the local CA's root. The site's addresses want `{$PUBLIRA_EDGE_TLS_HOSTS}` beside `:80`; `compose.log` carries the certificate errors. **plain HTTP answered … (want 308 …)** — Caddy no longer redirects a host it serves over HTTPS, which it does only for the names among the site's addresses.
12. **page upload of 256 MiB over 75 seconds … HTTP 499**, or **HTTP 000** — the edge cut the upload off before it arrived whole; Traefik answers 499 once its read timeout passes. Traefik wants `respondingTimeouts.readTimeout` of 300 seconds on the `web` entry point: the `--entrypoints.web.transport.respondingTimeouts.readTimeout` flag in the Dev Container's compose files, or the key in `traefik.yaml` on the trusted-hop pass. nginx wants no `client_body_timeout` shorter than its default, and Caddy no `read_body` timeout.

Teardown leaves these files in `.run/<proxy>/logs/`: `compose-ps.log` / `compose.log` (on failure), and for Traefik `traefik-routers.json` / `traefik-middlewares.json` (on failure).

## CI

Job: **Test / Routing** (`.github/workflows/ci.yml`)

- Path filter: `compose.yaml`, `.devcontainer/**`, `infra/proxy/**`, `e2e/routing/**`; the contract, the environment that runs it, and this check.
- It always runs for `workflow_dispatch` and is not part of nightly; PRs that change compose or the proxy configuration already run it.
- Failure artifact: `routing-artifacts` (`.run/`).

Changing `e2e/routing/**` does not start the Playwright **Test / E2E** job. See [the workflow overview](../../.github/workflows/README.md) for all CI jobs.

## Out of scope

- Real application scenarios ([`../README.md`](../README.md))
- `task setup` / `task dev` ([`../bootstrap/README.md`](../bootstrap/README.md))
- TLS termination by Traefik and nginx, a certificate authority on the internet, monitoring, and load tests
