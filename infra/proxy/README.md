# Edge routing

Every Publira deployment puts one reverse proxy in front of four backends, and this directory is that proxy's configuration. The contract below is what the edge has to do; each subdirectory writes it for one proxy.

| Proxy | Files | Where it runs |
| --- | --- | --- |
| Traefik | [`traefik/`](./traefik/) | The Dev Container edge on `localhost:3080`, the E2E edge, and the edge of each `dev-env` profile, all through the file provider |
| nginx | [`nginx/`](./nginx/) | Deployment example |
| Caddy | [`caddy/`](./caddy/) | Deployment example |

The Dev Container mounts `traefik/dynamic` into its `traefik` container and runs the file provider with `watch=true`, so an edit to `routes.yaml` or `services.yaml` takes effect without restarting the stack. Where the bind mount delivers no file events, `docker compose restart traefik` picks the edit up.

Image builds are a separate concern and live under [`infra/docker/`](../docker/README.md).

## The contract

### Backends

| Name | Serves | Port in the Dev Container |
| --- | --- | --- |
| `web-host` | The public tenant site | `3000` |
| `web-admin` | The tenant console | `4000` |
| `web-platform` | The platform console | `4100` |
| `api` | The edge listener of `publira server`: the public API (Connect RPC plus `/readyz`) and image delivery for the tenant site and the tenant console alike | `8000` |

### Host rules

The hostname decides which Next.js app answers. Matching ignores the port the `Host` header carries, so `admin.localhost:3080` is an admin host.

| Hostname                                 | App            |
| ---------------------------------------- | -------------- |
| `^admin\d*\..*$` — `admin.…`, `admin2.…` | `web-admin`    |
| `^platform\..*$` — `platform.…`          | `web-platform` |
| Anything else                            | `web-host`     |

`\d*` is zero or more digits, so a numbered console host (`admin2.example.com`) is an admin host while `administrator.example.com` is a tenant site.

### Path rules

| Path                       | Backend                       |
| -------------------------- | ----------------------------- |
| `/images…`                 | `api`                         |
| `/api/v1…`                 | the app the host rules picked |
| `/api`, `/api/…` otherwise | `api`                         |
| Everything else            | the app the host rules picked |

No rule rewrites the path.

`/api` and `/images` are host-agnostic: the public API and image delivery answer on the tenant site, the tenant console, and the platform console alike, from the same backend. Both reach it as they are, because the server's own routes carry the prefixes: the Connect endpoints are `/api/publira.v1.<Service>/<Method>`, so a client addresses the same paths whether it comes through the edge or dials the server directly. The host name the edge forwards unrewritten is what picks the rules an image is served under.

`/api/v1…` is the exception because it belongs to the Next.js apps rather than to the server. Each app mounts its Route Handlers there — `/api/v1/revalidate` on all three, and on the public site the view beacon, the read beacon, and the Stripe webhook — and a browser reaches them on the origin it is already on. Nothing under `/api/v1` collides with the public API, whose Connect endpoints are `/api/publira.v1.<Service>/<Method>`.

### Precedence

Highest first. A proxy with no numeric priorities reaches the same result by ordering its blocks this way.

1. `/images…`
2. `/api` minus the `/api/v1…` exception
3. Admin or platform host
4. Everything else

### Request headers

The edge is the trust boundary for W3C Trace Context. It **removes** `traceparent`, `tracestate`, and `baggage` from every inbound request, because the Go servers and the Next.js apps adopt an inbound `traceparent` as the parent span: a caller who could set it would pick the trace ID and the sampled flag, grafting spans onto someone else's trace or forcing export past the deployment's sampling ratio. With the headers gone, each backend opens a fresh root span.

First-party server-to-server traffic keeps its trace context, because none of it passes through the edge: the SSR clients dial the gRPC ports directly, and the Go APIs call the Next.js revalidate endpoints over their `PUBLIRA_WEB_*_INTERNAL_URL`.

The edge **adds** what a backend reads back:

| Header | Read by |
| --- | --- |
| `Host`, unrewritten | Tenant resolution in every app |
| `X-Forwarded-Host` | Tenant resolution, and the CSRF origin check when the public host differs from `Host` |
| `X-Forwarded-Proto` | The CSRF origin check |
| `X-Forwarded-For` | The client IP in access tokens and audit log entries |

Each of them is **set**, never appended to. The client is outside the trust boundary, so an inbound `X-Forwarded-For` would otherwise leave a forged address in front of the real one, and the client IP a backend records is the first address in that header.

## What an operator supplies

Two things are deployment decisions, and each proxy's files mark them.

- **Backend addresses.** They are the half of the configuration that changes per environment, so every proxy here keeps them apart from the routing: Traefik in `traefik/dynamic/services.yaml`, nginx in `nginx/upstreams.conf`, Caddy in the `PUBLIRA_UPSTREAM_*` environment variables. The addresses committed here name the Dev Container's `app` container.
- **TLS.** Which certificate source, which listen addresses, and which real-IP header apply depend on where the edge runs. Each configuration listens on plain HTTP and carries a commented placeholder where the TLS listener goes.

## Verification

`task e2e:routing` runs the contract against all three proxies. It starts each one in front of an echo server that answers on the four backend ports and reports which backend and which path a request reached, so every row above is a probe. See [`e2e/routing/README.md`](../../e2e/routing/README.md).
