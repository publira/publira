# Edge routing connectivity check

This check runs the routing contract of [`infra/proxy/`](../../infra/proxy/README.md) against each proxy that implements it — Traefik, nginx, and Caddy — without starting real applications. It also covers removal of inbound trace context, which the same configuration does.

Playwright E2E ([`../README.md`](../README.md)) connects directly to application ports. Bootstrap ([`../bootstrap/README.md`](../bootstrap/README.md)) verifies `task setup` / `task dev`, but starts no edge. Neither is in this check's scope.

## Why it is needed

The files under `infra/proxy/` are the source of truth for the edge. A one-line change can break precedence, host matching, the `/api` route, the `/api/v1` exception, or the `/images` route, and one proxy can drift from the other two while every stack still starts. `pnpm preflight`, Playwright, and bootstrap detect none of it.

The `strip-trace-context` middleware and its nginx and Caddy counterparts are covered for the same reason: they remove incoming `traceparent`, `tracestate`, and `baggage`, and requests still succeed when the removal is gone, so that regression is silent without this check. See [`../../server/README.md`](../../server/README.md#trace-context-arriving-from-outside).

The Traefik run starts **the same compose files** the Dev Container does (the root `compose.yaml` and the overlay on it) under a dedicated project name, replacing only the `app` process with an echo server, so it verifies the Dev Container's own wiring as well as the routing. nginx and Caddy have no environment of their own here and get a compose file that pairs the echo backends with the proxy.

## Prerequisites

- Docker with Compose v2 that supports `!reset` and `!override`
- `curl` and `task`

| Use | Port | Notes |
| --- | --- | --- |
| The proxy's HTTP entrypoint | `13080` | Change with `PUBLIRA_ROUTING_EDGE_PORT`; it intentionally differs from the Dev Container's `3080`. |
| Traefik API / dashboard | `18080` | Change with `PUBLIRA_ROUTING_TRAEFIK_API_PORT`; the Traefik readiness check reads routers here. |

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
| `task e2e:routing:test` | Probe Host, `/api`, and `/images` routes (requires a running stack). |
| `task e2e:routing:down` | Tear down that proxy's stack. |

Readiness differs by proxy. Traefik is asked through its insecure API for the routers the host lists call for, five or four, and the one middleware the file provider loaded, because a partially loaded configuration is otherwise a wall of failing probes. nginx and Caddy have the whole configuration before they accept a connection, so readiness for them is the first request a listed site host answers.

## What it verifies

Every proxy is given the same hosts, the `PUBLIRA_ROUTING_*_HOSTS` lists in `scripts/lib.sh`, as the `PUBLIRA_EDGE_*_HOSTS` variables the samples read; the Traefik run puts them in place of the Dev Container's own. Each proxy then starts a second time with the platform list empty, the install that runs no web-platform, and `scripts/test-without-platform.sh` checks that the same files start and route the other two apps, and that the platform hosts reach nothing.

The echo server responds with `{"backend","port","path","host","method","bytes"}`, the received `traceparent`, `tracestate`, and `baggage` values, the received `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`, and the received `Authorization`, `Content-Type`, and Svix signature headers, so every probe can assert **which backend received a request**, **the path it saw** after prefix removal, **the headers it was given**, and **how much of the body arrived**.

`scripts/test.sh` is the list of probes, one per row of the contract: host routing for listed hosts whose names follow no convention and a `Host` carrying a port, unlisted hosts that look like a console, the Platform Console, or a site, none of which may reach a backend, the `/api` route, the `/api/v1` exception that keeps the Next.js Route Handlers on their own app, and the `/images` route, which reaches the same backend as `/api` on every listed host; no route rewrites the path. An inbound email webhook post from SendGrid and one from Resend must reach `web-host` with the headers their token and signature travel in, and a 32 MiB body — the most `web-host` reads of a mail — must arrive whole. Two probe sets then run against every one of the four backends: forged `traceparent`, `tracestate`, and `baggage` values that must be gone by the time the request arrives, and forged `X-Forwarded-For` / `X-Forwarded-Host` / `X-Forwarded-Proto` values that the edge must have replaced with its own — the client IP a backend records is the first address in `X-Forwarded-For`, and the CSRF origin check reads the other two.

## Layout

```text
e2e/routing/
├── compose.traefik.yaml    # Overlay for compose.yaml + .devcontainer/compose.yaml (published ports + echo app)
├── compose.echo.yaml       # The echo backends, for the proxies with no environment of their own
├── compose.nginx.yaml      # nginx in front of them
├── compose.caddy.yaml      # Caddy in front of them
├── echo.ts                 # Returns JSON on 3000 / 4000 / 4100 / 8000
├── Taskfile.yaml
└── scripts/
    ├── lib.sh
    ├── run.sh              # Every proxy in turn
    ├── run-one.sh          # up → wait-ready → test, then again with no platform hosts, always followed by teardown
    ├── up.sh / wait-ready.sh / test.sh / test-without-platform.sh
    └── down.sh
```

The Traefik overlay replaces only the `app` image, command, volumes, `depends_on`, and health check; the Dev Container's own Traefik service, its flags, and its mount of `infra/proxy/traefik/dynamic` are what the run exercises.

## Failure triage

The failing `[routing:<proxy>] ERROR: …` message identifies the probe and the proxy.

1. **port is already in use** — free `13080` / `18080`, or change `PUBLIRA_ROUTING_EDGE_PORT` / `PUBLIRA_ROUTING_TRAEFIK_API_PORT`.
2. **readiness failed: traefik-routers** — the file provider did not read `infra/proxy/traefik/dynamic`. Check the bind mount on the `traefik` service and that both `routes.yaml` and `services.yaml` parse. If middleware entries alone are missing, inspect `routes.yaml`.
3. **readiness failed: the … edge did not serve web-host** — the proxy exited or refused its configuration. `compose.log` in the run directory carries its startup errors.
4. **backend / path mismatch** — one proxy no longer agrees with the contract. Compare that proxy's files against the table in [`infra/proxy/README.md`](../../infra/proxy/README.md); a mismatch on one proxy only is in that proxy's configuration, and a mismatch on all three is the contract itself.
5. **backend saw traceparent … (want it stripped)** — Traefik: `--entrypoints.web.http.middlewares=strip-trace-context@file` and the middleware in `routes.yaml`. nginx: `snippets/proxy-headers.conf` and the `include` in each server block. Caddy: the `publira_forwarded` snippet and its `import` in each `reverse_proxy`.
6. **X-Forwarded-For … kept the forged address**, or **is a list** — the edge appended to the caller's header instead of replacing it. nginx wants `$remote_addr`, not `$proxy_add_x_forwarded_for`; Caddy wants the explicit `header_up X-Forwarded-For`; Traefik replaces untrusted forwarded headers on its own unless `forwardedHeaders` has been given trusted addresses.

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
- TLS termination, monitoring, and load tests
