# Host-based routing connectivity check

This check detects routing regressions in development Traefik—the Docker labels and static configuration in `.devcontainer/compose.yaml`—without starting real applications. It also covers removal of inbound trace context, which is configured on the same path.

Playwright E2E ([`../README.md`](../README.md)) connects directly to application ports. Bootstrap ([`../bootstrap/README.md`](../bootstrap/README.md)) verifies `task setup` / `task dev`, but does not start Traefik. Neither is in this check's scope.

## Why it is needed

The `app` labels in `.devcontainer/compose.yaml` are the source of truth for Traefik routing. A one-line label change can break priority, `HostRegexp`, `/api` strip-prefixing, the `/api/v1/revalidate` exception, or the admin `/images` route. `pnpm preflight`, Playwright, and bootstrap cannot detect these regressions.

The `strip-trace-context` middleware on the same entrypoint is covered too: it removes incoming `traceparent`, `tracestate`, and `baggage`, and requests still succeed if it is detached, so that regression is silent without this check. See [`../../server/README.md`](../../server/README.md#trace-context-arriving-from-outside).

The check starts **the same compose files** (the root `compose.yaml` the Dev Container overlay builds on, plus that overlay) under a dedicated project name, replacing only the `app` process with an echo server.

## Prerequisites

- Docker with Compose v2 that supports `!reset` and `!override`
- `curl` and `task`

| Use | Port | Notes |
| --- | --- | --- |
| Traefik web entrypoint | `13080` | Change with `ROUTING_TRAEFIK_PORT`; it intentionally differs from the Dev Container's `3080`. |
| Traefik API / dashboard | `18080` | Change with `ROUTING_TRAEFIK_API_PORT`; readiness reads routers here. |

`db`, `redis`, and `mailpit` do not start. This can run alongside `task dev` when the default ports do not collide.

Logs default to `e2e/routing/.run/`. When `ROUTING_TRAEFIK_PORT`, `ROUTING_TRAEFIK_API_PORT`, or `ROUTING_PROJECT_NAME` differs from its default, `lib.sh` keeps state in a subdirectory made from the project name and ports. `ROUTING_RUN_DIR` takes precedence when set. `flock` rejects concurrent starts of the same compose project; starts on the same ports fail through normal port collision.

## Run

```bash
task e2e:routing
```

It always tears down the compose project and volumes, whether it succeeds, fails, or is interrupted.

### Individual commands

| Command | Purpose |
| --- | --- |
| `task e2e:routing:up` | Start `traefik` and the echo `app` with `compose.yaml` + `.devcontainer/compose.yaml` plus the overlay. |
| `task e2e:routing:wait-ready` | Wait until the Traefik API reports six labeled routers and two middleware entries. |
| `task e2e:routing:test` | Probe Host, `/api`, and `/images` routes (requires a running stack). |
| `task e2e:routing:down` | Tear down the stack. |

## What it verifies

The echo server responds with `{"backend","port","path","host","method"}` and the received `traceparent`, `tracestate`, and `baggage` values, so every probe can assert both **which backend received a request** and **the path it saw** after strip-prefixing.

`scripts/test.sh` is the list of probes: host-based routing including the `HostRegexp` for admin and platform and a host carrying a port, `/api` strip-prefixing and its exact-match `/api/v1/revalidate` exception, the `/images` routes on the public and the admin host, and — against every one of the six backends — forged `traceparent`, `tracestate`, and `baggage` values that must be gone by the time the request arrives.

## Layout

```text
e2e/routing/
├── compose.override.yaml   # Overlay for compose.yaml + .devcontainer/compose.yaml (published ports + echo app)
├── echo.py                 # Returns JSON on 3000 / 4000 / 4100 / 8000 / 8200 / 8201
├── Taskfile.yaml
└── scripts/
    ├── lib.sh
    ├── run.sh              # up → wait-ready → test, always followed by teardown
    ├── up.sh / wait-ready.sh / test.sh
    └── down.sh
```

The overlay does not replace the `app` Traefik labels; it replaces only the image, command, volumes, `depends_on`, and health check.

## Failure triage

The failing `[routing] ERROR: …` message identifies the probe.

1. **port is already in use** — free `13080` / `18080`, or change `ROUTING_TRAEFIK_PORT` / `ROUTING_TRAEFIK_API_PORT`.
2. **readiness failed: traefik-routers** — Docker provider did not read labels. Check `traefik.enable=true` on `app` and Docker-socket visibility. If middleware entries alone are missing, inspect `traefik.http.middlewares.*` labels.
3. **backend / path mismatch** — inspect the matching router's rule, priority, and middleware in `.devcontainer/compose.yaml`.
4. **backend saw traceparent … (want it stripped)** — check `--entrypoints.web.http.middlewares` and the `strip-trace-context` label. The provider-qualified reference is `strip-trace-context@docker`.

Teardown leaves these files in `.run/logs/`: `compose-ps.log` / `compose.log` (on failure), `traefik-routers.json` (on failure), and `traefik-middlewares.json` (on failure).

## CI

Job: **Test / Routing** (`.github/workflows/ci.yml`)

- Path filter: `compose.yaml`, `.devcontainer/**`, `e2e/routing/**`; only the labels' source of truth, the base it overlays, and this check.
- It always runs for `workflow_dispatch` and is not part of nightly; PRs that change compose already run it.
- Failure artifact: `routing-artifacts` (`.run/`).

Changing `e2e/routing/**` does not start the Playwright **Test / E2E** job. See [the workflow overview](../../.github/workflows/README.md) for all CI jobs.

## Out of scope

- Real application scenarios ([`../README.md`](../README.md))
- `task setup` / `task dev` ([`../bootstrap/README.md`](../bootstrap/README.md))
- Production Traefik, monitoring, and load tests
