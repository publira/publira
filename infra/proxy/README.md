# Edge routing

Every Publira deployment puts one reverse proxy in front of four backends. This directory holds sample configurations of that proxy, one per subdirectory, and a deployment gives one of them its own hosts and addresses: they are not rules the application depends on. The routing below is what the three samples share; each subdirectory writes it for one proxy.

| Proxy | Files | Where it runs |
| --- | --- | --- |
| Traefik | [`traefik/`](./traefik/) | The Dev Container edge on `localhost:3080`, the same edge in front of a host-side `task dev` (`PUBLIRA_EDGE_BACKEND_HOST` pointing `services.yaml` at the host), the E2E edge, and the edge of each `dev-env` profile, all through the file provider; a sample for a deployment as well |
| nginx | [`nginx/`](./nginx/) | Sample for a deployment |
| Caddy | [`caddy/`](./caddy/) | Sample for a deployment |

The Dev Container mounts `traefik/dynamic` into its `traefik` container and runs the file provider with `watch=true`, so an edit to `routes.yaml` or `services.yaml` takes effect without restarting the stack. Where the bind mount delivers no file events, `docker compose restart traefik` picks the edit up. A change to the hosts is a change to the container's environment, which `docker compose up -d traefik` applies by recreating it.

Image builds are a separate concern and live under [`infra/docker/`](../docker/README.md).

## The routing the samples share

### Backends

| Name | Serves | Port in the Dev Container |
| --- | --- | --- |
| `web-host` | The public tenant site | `3000` |
| `web-admin` | The tenant console | `4000` |
| `web-platform` | The platform console | `4100` |
| `api` | The edge listener of `publira server`: the public API (Connect RPC plus `/readyz`) and image delivery for the tenant site and the tenant console alike | `8000` |

### Host rules

The hostname decides which Next.js app answers, and the hosts are listed rather than recognised: each sample reads one environment variable per app and routes exactly the hosts it names.

| Variable                      | App            | Holds                       |
| ----------------------------- | -------------- | --------------------------- |
| `PUBLIRA_EDGE_SITE_HOSTS`     | `web-host`     | Every tenant's domain       |
| `PUBLIRA_EDGE_ADMIN_HOSTS`    | `web-admin`    | Every tenant's console host |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | `web-platform` | The Platform Console's host |

Each is a list of host names separated by spaces, without a port: the form a Caddyfile placeholder and nginx's `server_name` take as they are, and the Traefik template splits. A host belongs to one list. Matching ignores the port the `Host` header carries, so `admin.localhost:3080` is a console host when `admin.localhost` is listed.

A listed host reaches its app whatever its name: nothing about `admin.` or `platform.` means anything to the edge. A tenant's console host is the one it was given (`admin_domain`), or `admin.<domain>` without one, and the application answers on whichever it is, so adding a tenant means adding its domain to the first list and its console host to the second.

A host in no list reaches no backend: the edge answers it with a 404 of its own, on every path, `/api` and `/images` included.

An install that runs no `web-platform` leaves `PUBLIRA_EDGE_PLATFORM_HOSTS` empty. Every sample stays valid with an empty list, so no block is removed for it; the `web-platform` upstream may be left out of the backend addresses as well.

### Path rules

| Path                       | Backend                       |
| -------------------------- | ----------------------------- |
| `/images…`                 | `api`                         |
| `/api/v1…`                 | the app the host rules picked |
| `/api`, `/api/…` otherwise | `api`                         |
| Everything else            | the app the host rules picked |

No rule rewrites the path.

The path rules apply on every listed host: the public API and image delivery answer on the tenant site, the tenant console, and the platform console alike, from the same backend. Both reach it as they are, because the server's own routes carry the prefixes: the Connect endpoints are `/api/publira.v1.<Service>/<Method>`, so a client addresses the same paths whether it comes through the edge or dials the server directly. The host name the edge forwards unrewritten is what picks the rules an image is served under.

`/api/v1…` is the exception because it belongs to the Next.js apps rather than to the server. Each app mounts its Route Handlers there — `/api/v1/revalidate` on all three, on the public site the view beacon, the read beacon, and the payment and inbound email webhooks, and on the tenant console the royalty statement CSV — and a browser reaches them on the origin it is already on. Nothing under `/api/v1` collides with the public API, whose Connect endpoints are `/api/publira.v1.<Service>/<Method>`.

A webhook an outside service calls on the public site lives at `/api/v1/webhook/<kind>/<provider>`, such as `/api/v1/webhook/payment/stripe` or `/api/v1/webhook/email/sendgrid`; a new kind of webhook is added under that layout rather than beside it. `/api/v1/webhook/stripe` is a deprecated alias of `/api/v1/webhook/payment/stripe`, kept for the endpoints tenants have already registered with Stripe. The prefix rule above already routes every one of them, so no proxy names a webhook path.

### Request bodies

A request under `/api/v1` is admitted with a body of up to 33 MiB: an inbound email webhook carries a whole mail with its attachments, which SendGrid accepts up to 30 MB, and `web-host` reads up to 32 MiB of it. On a console host, `/api/v1/episode-pages` is admitted with a body of up to 256 MiB: the episode edit screen posts a whole episode's pages there in one upload, and `web-admin` reads up to 256 MiB of it. Traefik and Caddy set no limit unless one is configured; nginx's default is 1 MB, so its sample raises it on those locations.

### Precedence

Highest first. A proxy with no numeric priorities reaches the same result by ordering its blocks this way.

1. A host in no list, answered by the edge itself
2. `/images…`
3. `/api` minus the `/api/v1…` exception
4. The app whose list names the host

### Request headers

The edge is the trust boundary for W3C Trace Context. It **removes** `traceparent`, `tracestate`, and `baggage` from every inbound request, because the Go servers and the Next.js apps adopt an inbound `traceparent` as the parent span: a caller who could set it would pick the trace ID and the sampled flag, grafting spans onto someone else's trace or forcing export past the deployment's sampling ratio. With the headers gone, each backend opens a fresh root span.

First-party server-to-server traffic keeps its trace context, because none of it passes through the edge: the SSR clients dial the gRPC ports directly, and publira server and worker call the Next.js revalidate endpoints over their `PUBLIRA_WEB_*_INTERNAL_URL`.

The edge **adds** what a backend reads back:

| Header | Read by |
| --- | --- |
| `Host`, unrewritten | Tenant resolution in every app |
| `X-Forwarded-Host` | Tenant resolution, and the CSRF origin check when the public host differs from `Host` |
| `X-Forwarded-Proto` | The CSRF origin check |
| `X-Forwarded-For` | The client IP in access tokens and audit log entries |

Each of them is **set**, never appended to. The client is outside the trust boundary, so no value it sent reaches a backend: the apps read `X-Forwarded-Host` and `X-Forwarded-Proto` as they arrive, and `publira server`, which reads `X-Forwarded-For` from the right past the proxies its `PUBLIRA_TRUSTED_PROXIES` names, then finds the one address the edge wrote.

### A trusted hop in front

When a load balancer, a CDN, or a TLS terminator connects to the edge, that hop is the peer of every request, and every request reaches the backends with its address. Each sample carries a setting, commented out, that trusts the hop's own addresses and no others:

| Proxy | Setting | Where |
| --- | --- | --- |
| Traefik | `forwardedHeaders.trustedIPs` on the entry point | `traefik/traefik.yaml` |
| nginx | `set_real_ip_from`, `real_ip_header X-Forwarded-For`, `real_ip_recursive on`, and the same addresses in the `geo` block | `nginx/default.conf.template` |
| Caddy | `trusted_proxies static` and `trusted_proxies_strict` under `servers` | The Caddyfile's global options |

With it left alone, a sample behaves as above. With the hop's addresses in it, a request from the hop reaches the backends with the client address the hop named first in `X-Forwarded-For`, and with the `X-Forwarded-Proto` the hop named, since a TLS terminator in front reaches the edge over plain HTTP. A request from anywhere else is treated as it is without the setting. nginx and Caddy take the rightmost address in the hop's header that is not a trusted one and still set `X-Forwarded-For` to that address alone, through `$remote_addr` and `{client_ip}`, and keep setting `X-Forwarded-Host` themselves. Traefik has no way to replace the header: it keeps the hop's `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`, and appends the hop's address to the first. The hop therefore sets those headers rather than appending to the caller's, which is what each sample does as the first hop, and `publira server` reaches the address the hop named past the one Traefik appended only when its `PUBLIRA_TRUSTED_PROXIES` covers the hop.

## What an operator supplies

Four things are deployment decisions, and each proxy's files mark them.

- **Hosts.** The three `PUBLIRA_EDGE_*_HOSTS` variables above, read from the proxy's environment: by the Traefik file provider when it renders `routes.yaml`, by the official nginx image when it renders `default.conf.template` at startup, and by Caddy when it parses the Caddyfile. Each proxy reads them once, so a changed list takes effect when the proxy restarts. None of them has a default: the Dev Container, the edge in front of a host-side `task dev`, and each `dev-env` profile list the development seed's tenant and the Platform Console, and the E2E stack every tenant its seeds and scenarios create.
- **Backend addresses.** They are the half of the configuration that changes per environment, so every proxy here keeps them apart from the routing: Traefik in `traefik/dynamic/services.yaml`, nginx in `nginx/upstreams.conf`, Caddy in the `PUBLIRA_UPSTREAM_*` environment variables. The addresses committed here name the Dev Container's `app` container.
- **TLS.** Which certificate source and which listen addresses apply depend on where the edge runs. Each configuration listens on plain HTTP and carries a commented placeholder where the TLS listener goes.
- **Trusted hops.** The addresses of a load balancer, a CDN, or a TLS terminator in front of the edge, in the setting [above](#a-trusted-hop-in-front). Each sample carries it commented out, naming the documentation range `192.0.2.0/24` in place of the hop's addresses. The Compose install in [`infra/deploy/`](../deploy/README.md) passes Traefik's from `PUBLIRA_EDGE_TRUSTED_PROXIES`.

## Verification

`task e2e:routing` runs this routing against all three samples. It starts each one in front of an echo server that answers on the four backend ports and reports which backend and which path a request reached, gives it hosts whose names follow no convention, and probes every row above, along with unlisted hosts that look like a console or the Platform Console. It then enables each sample's trusted-hop setting as it is written and probes it through a hop and from outside its range. See [`e2e/routing/README.md`](../../e2e/routing/README.md).
