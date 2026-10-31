# Edge routing

Every Publira deployment puts one reverse proxy in front of four backends. This directory holds sample configurations of that proxy, one per subdirectory, and a deployment gives one of them its own hosts and addresses: they are not rules the application depends on. The routing below is what the three samples share; each subdirectory writes it for one proxy.

| Proxy | Files | Where it runs |
| --- | --- | --- |
| Traefik | [`traefik/`](./traefik/) | The Dev Container edge on `localhost:3080`, the same edge in front of a host-side `task dev` (`PUBLIRA_EDGE_BACKEND_HOST` pointing `services.yaml` at the host), the E2E edge, and the edge of each `dev-env` profile, all through the file provider; a sample for a deployment as well |
| nginx | [`nginx/`](./nginx/) | Sample for a deployment |
| Caddy | [`caddy/`](./caddy/) | The edge of the Compose install in [`infra/deploy/`](../deploy/README.md), which runs the Caddyfile as it stands; a sample for a deployment as well |

The Dev Container mounts `traefik/dynamic` into its `traefik` container and runs the file provider with `watch=true`, so an edit to `routes.yaml` or `services.yaml` takes effect without restarting the stack. Where the bind mount delivers no file events, `docker compose restart traefik` picks the edit up. A change to the hosts is a change to the container's environment, which `docker compose up -d traefik` applies by recreating it.

Image builds are a separate concern and live under [`infra/docker/`](../docker/README.md).

## The routing the samples share

### Backends

| Name | Serves | Port in the Dev Container |
| --- | --- | --- |
| `web-storefront` | The public tenant site | `3000` |
| `web-admin` | The tenant console | `4000` |
| `web-platform` | The platform console | `4100` |
| `api` | `publira server`: the public API under `/rpc`, and image delivery for the tenant site, a tenant's image host, and the tenant console alike | `8000` |

### Host rules

The hostname decides which Next.js app answers, and the hosts are listed rather than recognised: each sample reads one environment variable per app, and one for the hosts no app answers, and routes exactly the hosts they name.

| Variable | App | Holds |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | `web-storefront` | Every tenant's domain |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | `web-admin` | Every tenant's console host |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | `web-platform` | The Platform Console's host |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | None: `/images…` alone, to `api` | Every tenant's image host |

Each is a list of host names separated by spaces, without a port: the form a Caddyfile placeholder and nginx's `server_name` take as they are, and the Traefik template splits. A host belongs to one list. Matching ignores the port the `Host` header carries, so `admin.localhost:3080` is a console host when `admin.localhost` is listed.

A listed host reaches its app whatever its name: nothing about `admin.` or `platform.` means anything to the edge. A tenant's console host is the one it was given (`admin_domain`), or `admin.<domain>` without one, and the application answers on whichever it is, so adding a tenant means adding its domain to the first list and its console host to the second.

A tenant's image host is the host it was given for its storefront images (`image_domain`), which it has only when one was set. `publira server` then hands out the tenant's storefront image URLs on that host and answers it as the tenant's storefront, so the fourth list holds it, and on it the edge forwards `/images…` and answers every other path with a 404 of its own, `/rpc` included: no app serves the host. The edge forwards `Host` unrewritten here as everywhere, which is what the server resolves the tenant from, so the list only widens which hosts reach `api`.

A host in no list reaches no backend: the edge answers it with a 404 of its own, on every path, `/rpc` and `/images` included.

An install that runs no `web-platform` leaves `PUBLIRA_EDGE_PLATFORM_HOSTS` empty, and one that gives no tenant an image host, or serves the image hosts behind a load balancer of their own, leaves `PUBLIRA_EDGE_IMAGE_HOSTS` empty. Every sample stays valid with an empty list, so no block is removed for it; the `web-platform` upstream may be left out of the backend addresses as well.

### Path rules

| Path                              | Backend                       |
| --------------------------------- | ----------------------------- |
| `/images…`                        | `api`                         |
| Everything else, on an image host | none: the edge answers 404    |
| `/rpc/publira.v1.…`               | `api`                         |
| `/rpc`, `/rpc/…` otherwise        | none: the edge answers 404    |
| Everything else                   | the app the host rules picked |

No rule rewrites the path.

Only the public API is forwarded under `/rpc`. `publira server` answers the tenant console's and the Platform Console's namespaces, `publira.admin.v1` and `publira.platform.v1`, on the same paths, but `web-admin` and `web-platform` call them over the private network, and the mobile app calls `publira.v1` alone, so no host needs them, and the edge answers them itself rather than expose two authenticated APIs to the internet for nothing. The prefix ends at the dot after `v1`, so that `publira.v1.<Service>/<Method>` is all it matches: `publira.v1beta.…` and a bare `/rpc/publira.v1` are answered by the edge as well.

The path rules apply on every host an app answers: the public API and image delivery answer on the tenant site, the tenant console, and the platform console alike, from the same backend, and the rest of `/rpc` answers 404 on all of them. An image host takes the first two rows alone. Both reach it as they are, because the server's own routes carry the prefixes: the Connect endpoints are `/rpc/publira.v1.<Service>/<Method>`, so a client addresses the same paths whether it comes through the edge or dials the server directly. The host name the edge forwards unrewritten is what picks the rules an image is served under.

A webhook an outside service calls on the public site lives at `/api/v1/webhook/<kind>/<provider>`, such as `/api/v1/webhook/payment/stripe` or `/api/v1/webhook/email/sendgrid`; a new kind of webhook is added under that layout rather than beside it. It is one of the Route Handlers each app mounts under `/api/v1`, which the last row above routes to the app with every other path, so no proxy names a webhook path.

### Request bodies

A request under `/api/v1` is admitted with a body of up to 33 MiB: an inbound email webhook carries a whole mail with its attachments, which SendGrid accepts up to 30 MB, and `web-storefront` reads up to 32 MiB of it. On a console host, `/api/v1/episode-pages` is admitted with a body of up to 256 MiB: the episode edit screen posts a whole episode's pages there in one upload, and `web-admin` reads up to 256 MiB of it. Every request to the public API is admitted with a body of up to 15 MiB: a reader's icon upload carries an image of up to 10 MiB, which `publira server` reads in the base64 of the JSON encoding along with the fields beside it. Every other path, on the site host and on a console host alike, is admitted with a body of up to 11 MiB: a Server Action posts to the path of its page, and a reader's icon sent to `web-storefront` and an image uploaded from the tenant console to `web-admin` each reach theirs as an image of up to 10 MiB, which the app reads up to 11 MiB of with the multipart framing and the fields beside it. Traefik and Caddy set no limit unless one is configured; nginx's default is 1 MB, so its sample raises it on those locations.

That upload is given 300 seconds to arrive, which takes 256 MiB over an uplink of about 7.2 Mbit/s. It is as long as `web-admin`'s Node.js server gives a request to arrive whole, so an edge that streams the body on gains nothing by waiting longer. Traefik gives a request 60 seconds, body included, unless configured otherwise, and it sets that per entry point rather than per router, so every Traefik edge here gives every request on the `web` entry point 300 seconds. nginx limits only the wait between two reads of a body, 60 seconds by default, and passes the body on once all of it has arrived; Caddy sets no limit on reading a body. Neither sample changes its default.

### Request rates

The edge limits how many requests one client may send to the paths below, on a tenant's site and image hosts, so that one client cannot fetch every image of every free episode or run the search until the database falls behind. Each allowance lets a client send its burst at once, and over any span of time admits no more than the burst and what its rate refills in that span; a request past it is answered `429` by the edge itself, and no backend sees it. How the allowance comes back is up to the proxy: nginx and Traefik refill it at the rate, a request at a time, while Caddy's module counts the requests of the last window, so a client that sent the whole burst at once is refused until the window has passed and then has all of it again.

| Requests | Hosts | Burst | Refilled per second |
| --- | --- | --- | --- |
| `/rpc/publira.v1.…`, except the search below | Site hosts | 120 | 20 |
| `/rpc/publira.v1.CatalogService/SearchPublished…` | Site hosts | 20 | 2 |
| `/search`, with or without a locale prefix (`/zh-Hans/search`) | Site hosts | 20 | 2 |
| `/images…` | Site and image hosts | 600 | 60 |

Each row is an allowance of its own: a client that has spent the public API's still has the search's, and the search page and the search RPC are counted apart. Within a row the hosts share it, so a client that has spent the images allowance on an image host is refused on a site host too. The catalog search runs the most expensive query a reader can ask for, which is why it gets an allowance of its own both on the public API and on the page that runs it on the server.

A client is the address the edge records it by: the peer address, or, behind a [trusted hop](#a-trusted-hop-in-front), the address the hop named. Behind a hop the edge does not trust, every reader shares the hop's allowance, which is one more reason to configure the hop.

`publira server` limits the two public API rows and the images itself, behind the edge, by default at twice what each row admits in 10 seconds, so that a reader behind a working edge is refused here first. Those limits are part of the platform policy, which refuses a value below what a row admits in 10 seconds. `server/internal/platformpolicy` holds this table as `EdgeReadRates`, and its test fails when the two part, so a change to a row here is a change there too. `web-storefront` limits the search page itself in the same way, at twice what its row admits in 10 seconds; `apps/web-storefront/lib/search-page-rate-limit.ts` holds the row as `EDGE_SEARCH_PAGE_RATE`, and its test fails when the two part.

Nothing else is limited. A console host is left to the limits `publira server` keeps itself, on sign-in, mail, and each reader action, since the consoles' traffic is their staff's, and their uploads and editing screens are the heaviest an install serves. The pages of a tenant's site other than the search, and the webhooks under `/api/v1/webhook/`, are not limited either: a provider that is refused retries, and a payment or a reader's reply arrives late or not at all.

Each sample writes the allowances in its own terms:

- **nginx** has a `limit_req_zone` per row in `default.conf.template`, at the rate in the table, and a `limit_req` with the burst and `nodelay` in the location of its paths. A zone counts a client by `$publira_rate_limit_key`, which the site and image hosts' server blocks set to `$binary_remote_addr` and the console hosts' leave empty, which nginx counts nowhere.
- **Traefik** has a `rateLimit` middleware per row in `dynamic/routes.yaml`, with the rate as `average` over a period of `1s` and the burst as `burst`, on the routers of the site and image hosts. The console hosts have routers of their own, `rpc-console` and `images-console`, without one. Traefik keeps the count per router, so each row is one router's. A `rateLimit` counts the address that connected unless told to read `X-Forwarded-For`, and then counts every request that did not come through the hop as one client, since Traefik removed that header from theirs; so with `PUBLIRA_EDGE_TRUSTED_PROXIES` set, each limited router has a `-trusted-hop` copy that matches the hop's addresses, with a `-trusted-hop` copy of its middleware that reads the header past them.
- **Caddy** has a `rate_limit` zone per row in the Caddyfile, with the burst as `events` and the time the rate takes to refill it as `window`, so that no window admits more than the other samples would, keyed by `{client_ip}`. The handler is the [`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit) module, which the `caddy` image does not carry and refuses the Caddyfile with, so the block is commented out: a deployment that runs a Caddy built with the module, with `xcaddy build --with github.com/mholt/caddy-ratelimit`, uncomments it. The Compose install in [`infra/deploy/`](../deploy/README.md) runs the `caddy` image and limits nothing at the edge.

### Precedence

Highest first. A proxy with no numeric priorities reaches the same result by ordering its blocks this way.

1. A host in no list, answered by the edge itself
2. `/images…`
3. The rest of an image host, answered by the edge itself
4. `/rpc/publira.v1.…`
5. The rest of `/rpc`, answered by the edge itself
6. The app whose list names the host

### Request headers

The edge is the trust boundary for W3C Trace Context. It **removes** `traceparent`, `tracestate`, and `baggage` from every inbound request, because the Go servers and the Next.js apps adopt an inbound `traceparent` as the parent span: a caller who could set it would pick the trace ID and the sampled flag, grafting spans onto someone else's trace or forcing export past the deployment's sampling ratio. With the headers gone, each backend opens a fresh root span.

It also **removes** whichever of `Forwarded` and `X-Forwarded-For` it does not set. `publira server` reads the client IP from either, the standard `Forwarded` ahead of `X-Forwarded-For`, so a caller's value left in the one the edge does not write would reach it as sent. Traefik sets `X-Forwarded-For` itself and can only set a request header to a fixed value, so it hands the client address over in that header and removes `Forwarded`, with a second entry-point middleware, `strip-forwarded`. nginx and Caddy set `Forwarded` and remove `X-Forwarded-For`.

It also **removes** `X-Forwarded-CountryRegion` from every request but one from a [trusted hop](#a-trusted-hop-in-front). The header carries the reader's region as an ISO 3166-2 subdivision code, such as `JP-13`, and `web-storefront` passes it on to a tenant's Google tag gateway under the same name, which Google reads its regional reports and region-specific consent defaults from. None of the samples looks a region up itself, so an edge with no hop in front hands the backends none, and the gateway sends none; a caller's value passed on would let any reader name a region of their choosing.

First-party server-to-server traffic keeps its trace context, because none of it passes through the edge: the SSR clients dial the gRPC ports directly, and publira server and worker call the Next.js revalidate endpoints over their `PUBLIRA_WEB_*_INTERNAL_URL`.

The edge **adds** what a backend reads back:

| Header | Read by |
| --- | --- |
| `Host`, unrewritten | Tenant resolution in every app |
| `X-Forwarded-Host` | Tenant resolution, and the CSRF origin check when the public host differs from `Host` |
| `X-Forwarded-Proto` | The CSRF origin check |
| `X-Forwarded-For` (Traefik) or `Forwarded` (nginx, Caddy) | The client IP in access tokens and audit log entries, and, through the `host=` of `Forwarded` ahead of `X-Forwarded-Host`, tenant resolution and the CSRF origin check |

Each of them is **set**, never appended to. The client is outside the trust boundary, so no value it sent reaches a backend: the apps read `X-Forwarded-Host` and `X-Forwarded-Proto` as they arrive, and `publira server`, which reads the client address header from the right past the proxies its `PUBLIRA_TRUSTED_PROXIES` names and the host from those proxies alone, then finds the one address and the one host the edge wrote. `Forwarded` carries it as `for=` and the address, quoted and in brackets when it is an IPv6 address.

### A trusted hop in front

When a load balancer, a CDN, or a TLS terminator connects to the edge, that hop is the peer of every request, and every request reaches the backends with its address. Each sample carries a setting that trusts the hop's own addresses and no others: Traefik and nginx commented out, and Caddy reading the addresses from `PUBLIRA_EDGE_TRUSTED_PROXIES`, separated by spaces, which trusts no one while it is empty.

| Proxy | Setting | Where |
| --- | --- | --- |
| Traefik | `forwardedHeaders.trustedIPs` on the entry point, and the same addresses in `PUBLIRA_EDGE_TRUSTED_PROXIES` | `traefik/traefik.yaml`, and the environment `traefik/dynamic/routes.yaml` is rendered from |
| nginx | `set_real_ip_from`, `real_ip_header X-Forwarded-For`, `real_ip_recursive on`, and the same addresses in the `geo` block | `nginx/default.conf.template` |
| Caddy | `trusted_proxies static` and `trusted_proxies_strict` under `servers` | The Caddyfile's global options |

With it left alone, a sample behaves as above. With the hop's addresses in it, a request from the hop reaches the backends with the client address the hop named first in `X-Forwarded-For`, and with the `X-Forwarded-Proto` the hop named, since a TLS terminator in front reaches the edge over plain HTTP. The hop's `X-Forwarded-CountryRegion` reaches `web-storefront` as the hop sent it, so a hop that knows the reader's region, such as a CDN, sets that header to it, replacing any value the caller sent, and a hop that does not removes it. A request from anywhere else is treated as it is without the setting. nginx and Caddy take the rightmost address in the hop's `X-Forwarded-For` that is not a trusted one and still set `Forwarded` to that address alone, through `$remote_addr` and `{client_ip}`, and keep setting `X-Forwarded-Host` themselves. Traefik has no way to replace the header: it keeps the hop's `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`, and appends the hop's address to the first. The hop therefore sets those headers rather than appending to the caller's, which is what each sample does as the first hop, and `publira server` reaches the address the hop named past the one Traefik appended only when its `PUBLIRA_TRUSTED_PROXIES` covers the hop.

Traefik's trusted addresses govern only the `X-Forwarded-*` headers it writes itself, which `X-Forwarded-CountryRegion` is not, so `routes.yaml` keeps the hop's region with a router of its own, `web-storefront-trusted-hop`, which matches the addresses in `PUBLIRA_EDGE_TRUSTED_PROXIES`, and every other router removes the header.

## What an operator supplies

Five things are deployment decisions, and each proxy's files mark them.

- **Hosts.** The four `PUBLIRA_EDGE_*_HOSTS` variables above, read from the proxy's environment: by the Traefik file provider when it renders `routes.yaml`, by the official nginx image when it renders `default.conf.template` at startup, and by Caddy when it parses the Caddyfile. Each proxy reads them once, so a changed list takes effect when the proxy restarts. None of them has a default: the Dev Container, the edge in front of a host-side `task dev`, and each `dev-env` profile list the development seed's tenant and the Platform Console, and the E2E stack every tenant its seeds and scenarios create. None of them lists an image host, since no tenant they serve has one.
- **Backend addresses.** They are the half of the configuration that changes per environment, so every proxy here keeps them apart from the routing: Traefik in `traefik/dynamic/services.yaml`, nginx in `nginx/upstreams.conf`, Caddy in the `PUBLIRA_UPSTREAM_*` environment variables. The addresses committed here name the Dev Container's `app` container.
- **TLS.** Which certificate source and which listen addresses apply depend on where the edge runs. Traefik and nginx listen on plain HTTP and carry a commented placeholder where the TLS listener goes. Caddy listens on plain HTTP until `PUBLIRA_EDGE_TLS_HOSTS` names hosts, separated by spaces: it then obtains a certificate for each over ACME, registering the account with `PUBLIRA_EDGE_ACME_EMAIL`, serves them on `:443`, and redirects plain HTTP for them to HTTPS. A host in no list gets no certificate, so its TLS handshake fails. The Compose install in [`infra/deploy/`](../deploy/README.md) gives it every listed host once its ACME contact is set.
- **Request rates.** The [allowances](#request-rates) are a starting point for an install whose readers each come from an address of their own. Readers behind one address, such as a carrier's NAT or an office, share an allowance, and an install that serves many of them raises it. A managed WAF or a CDN rate limit in front of the edge replaces these, and the edge's can then be removed.
- **Trusted hops.** The addresses of a load balancer, a CDN, or a TLS terminator in front of the edge, in the setting [above](#a-trusted-hop-in-front). Traefik and nginx carry it commented out, naming the documentation range `192.0.2.0/24` in place of the hop's addresses, and Traefik reads the same addresses from `PUBLIRA_EDGE_TRUSTED_PROXIES` as well; Caddy reads it from `PUBLIRA_EDGE_TRUSTED_PROXIES` alone, which the Compose install passes on from its `.env`.

## Verification

`task e2e:routing` runs this routing against all three samples. It starts each one in front of an echo server that answers on the four backend ports and reports which backend and which path a request reached, gives it hosts whose names follow no convention, image hosts among them, and probes every row above, along with unlisted hosts that look like a console or the Platform Console. It then starts Caddy with every listed host in `PUBLIRA_EDGE_TLS_HOSTS` and probes it over HTTPS, and enables each sample's trusted-hop setting as it is written and probes it through a hop that names a client address, a scheme, and a region, and from outside its range. Last, it sends bursts over every allowance in [Request rates](#request-rates) behind the same hop, Caddy built with its module and its block uncommented. See [`e2e/routing/README.md`](../../e2e/routing/README.md).
