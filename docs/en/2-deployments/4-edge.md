---
title: Edge
description: What the load balancer, proxy, or CDN in front of an install has to do, and the sample proxy configurations that do it.
published: 2026-10-06
updated: 2026-10-16
redirect_from:
  - /deployments/reverse-proxy
---

Every request a browser or the mobile app sends to an install reaches it through its edge: whatever terminates TLS and forwards the request to one of the processes. That can be a load balancer your platform manages, an Ingress or a Gateway, a CDN in front of either, a reverse proxy you run yourself, or several of them in a chain. Publira does not depend on which one it is, only on what the edge does with a request.

This page states that first, in terms of host names, paths, and headers, so that you can configure whatever edge your platform offers from it. It then shows the [sample configurations](#the-sample-configurations) for Traefik, nginx, and Caddy in the repository as one way of doing it.

## What the edge has to do

Each requirement below applies to the edge as a whole. When the edge is a chain, such as a CDN in front of a load balancer, each hop does its part: one terminates TLS, one routes, and every one of them lets the uploads and the webhooks through.

### Routing

The host name a request was sent to picks the web app that answers it:

| Host | Process |
| --- | --- |
| A tenant's domain, such as `comics.example.com` | `web-storefront` |
| A tenant's console host: `admin.<domain>`, or the one it was given with `--admin-domain` | `web-admin` |
| The Platform Console's host, such as `platform.example.com`, when you run it | `web-platform` |

Every tenant has a domain and a console host of its own, and a host name belongs to one tenant, so the edge routes each name it serves to one of the three. Nothing about a name's shape matters to Publira: a console host need not start with `admin.`, and a host that does is a console host only once the edge sends it to `web-admin`. What the edge does with a host that belongs to no tenant is yours to decide.

On every one of those hosts, the path then decides whether the web app answers, `publira server` does, or the edge answers itself, in this order:

| Path                                       | Process                      |
| ------------------------------------------ | ---------------------------- |
| Starting with `/images`                    | `publira server`             |
| Starting with `/rpc/publira.v1.`           | `publira server`             |
| `/rpc`, or starting with `/rpc/` otherwise | None: the edge answers `404` |
| `/api/v1`, or starting with `/api/v1/`     | The web app the host picked  |
| Starting with `/api/publira.v1.`           | `publira server`             |
| `/api`, or starting with `/api/` otherwise | None: the edge answers `404` |
| Anything else                              | The web app the host picked  |

`/images` is every image a page shows, and `/rpc/publira.v1.` the public API the browser and the mobile app call. Nothing else under `/rpc` is forwarded, as [Only the public API goes through the edge](#only-the-public-api-goes-through-the-edge) explains. `/api` is the prefix the API had before `/rpc`, and `publira server` still answers on it so that a client not yet on `/rpc`, an installed build of the mobile app among them, keeps working; 0.3.0 stops serving it, and the `/api` rows go then. Until that release, route `/api/publira.v1.` as well, and answer the rest of `/api` as the rest of `/rpc`. `/api/v1` is the exception: it belongs to the web apps, which answer their own endpoints there, the payment and inbound email webhooks among them. The exception ends at a `/`, so a path such as `/api/v10` or `/api/v1beta` is not part of it, and the edge answers it with the rest of `/api`.

The public API's prefix ends at the dot after `v1`, so that a procedure, `/rpc/publira.v1.<Service>/<Method>`, is all it matches. A match on `/rpc/publira.v1` without the dot would also take a namespace that only starts the same way, such as `publira.v1beta`. An edge that matches the longest prefix first gets the order of the table right without being told it.

`publira server` is on port `8000`, unless `PUBLIRA_PUBLIC_API_ADDR` gives it another address, as the [`publira server` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md) lists. The web apps listen on port `3000` (`web-storefront`), `4000` (`web-admin`), and `4100` (`web-platform`) in the images as the repository builds them, unless you set their `PORT`.

The edge forwards the path as it arrived, and the `Host` header as the browser sent it. Publira's routes carry the `/rpc`, `/api`, and `/images` prefixes, and Publira finds the tenant from the host name, so an edge that strips a prefix or rewrites `Host` reaches no tenant at all.

An edge that checks the health of what it forwards to, as a load balancer does, can probe `GET /readyz` on each process. [Health checks](../3-operations/11-monitoring.md#health-checks) says what each one checks, and what pointing a load balancer at it means when the database stops answering.

### Only the public API goes through the edge

`publira server` serves the tenant console's and the Platform Console's APIs, `publira.admin.v1` and `publira.platform.v1`, under `/rpc` beside the public API, and under `/api` until 0.3.0, on the one port the edge forwards to. Nothing reaches them through the edge: `web-admin` and `web-platform` call them from their own servers, over the private network on `PUBLIRA_GRPC_URL`, and the mobile app calls the public API alone. No host needs them forwarded, so the edge answers them with a `404` of its own, on the console hosts as on the tenants' domains. An edge that forwards them anyway exposes two APIs to the internet for nothing, along with every call of theirs that runs before there is a session: signing in, resetting a password, confirming an email address, and creating the Platform Console's first operator. Their own authentication, which [The console APIs](../3-operations/12-security.md#the-console-apis) describes, stays in place behind the edge rule.

`/api` follows the same rule as `/rpc`, because `/api/publira.admin.v1.…` reaches the same handlers until 0.3.0: an edge that holds back the rest of `/rpc` but forwards all of `/api` leaves the console APIs on the internet.

Running the process the tenants' domains reach with `publira server --role storefront` is a second, separate layer. The edge rule keeps the console APIs' paths off the internet; `--role storefront` keeps the consoles' database logins and the web service token out of the process readers reach at all. Keep sending the console hosts' `/rpc/publira.v1.`, `/api/publira.v1.`, and `/images` to the `publira server` the web apps call, which serves every role.

### TLS

The edge terminates TLS for every host name it serves, and needs a certificate for each of them:

- Each tenant's domain, such as `comics.example.com`.
- Each tenant's console host, such as `admin.comics.example.com`.
- The Platform Console's host, if you run it.

A wildcard certificate for `*.comics.example.com` covers the console host but not `comics.example.com` itself, and a tenant on a domain of its own needs names of its own: no one certificate covers every tenant. Where the certificates come from is the edge's choice: a load balancer or a CDN that issues and renews them itself, an ACME client such as one built into a proxy, or a certificate issued elsewhere that you install and renew.

Every certificate a public certificate authority issues is published in the Certificate Transparency logs, where anyone can search them by domain, so a console host under a tenant's domain can be found from the site's domain. A console host on a domain of its own, as [A console host on a domain of its own](../3-operations/2-tenants.md#a-console-host-on-a-domain-of-its-own) recommends, needs a certificate of its own to stay apart: one that also names the site's hosts links the two again.

Send plain HTTP to HTTPS with a redirect, so a reader who types the bare host name still arrives. Behind the hop that terminates TLS, the edge may reach the processes over plain HTTP: `PUBLIRA_TENANT_URL_SCHEME` stays `https`, since it describes the address readers open, not how the edge reaches the processes.

### Adding a tenant

A tenant made with `publiractl tenant create` or in the Platform Console is served as soon as it exists, but its two host names reach it only once the edge is ready for them. Before its staff open the console:

1. **DNS.** Point the tenant's domain and its console host at the edge.
2. **Certificates.** Have the edge serve a certificate for both names.
3. **Routing.** Route its domain to `web-storefront`, and its console host to `web-admin`, as [Routing](#routing) describes.

An edge that sends every host it does not name to `web-storefront` needs only the console host in step 3. The sample configurations name every host, so each of them needs both, given the way [The host lists](#the-host-lists) describes.

Moving a console host later, with `publiractl tenant update --admin-domain` or in the **Admin domain** field of the Platform Console, follows the same order: add the new name to DNS, the certificates, and the routing before the change, and remove the old one after it. `--admin-domain ""` moves the console back to `admin.<domain>`.

### The client address

Publira records the address of the reader behind every request: with every sign-in, in the audit log, and as the address its per-client limits count against. It reads that address from the `X-Forwarded-For` or the standard `Forwarded` header, stepping over the hops it trusts, as [The proxies Publira trusts](#the-proxies-publira-trusts) describes. For that address to be the reader's own:

- **The hop readers connect to writes the address that connected to it**, in `X-Forwarded-For` or in `Forwarded`, either setting the header to that address or appending the address to what the caller sent. Load balancers and CDNs do one of the two with `X-Forwarded-For` unless told otherwise.
- **The hops after it keep that address**, passing the header on, with or without the address they were reached from appended. A hop that replaces the header with the address that connected to it records every reader with the address of the hop in front of it.
- **`PUBLIRA_TRUSTED_PROXIES` covers every hop whose address reaches `publira server`**: the one that connects to it, and each one whose address a later hop appends after the reader's. A hop that finds the reader's address itself and replaces the header with it, rather than appending to it, leaves the hops in front of it out of the chain, and those need no entry. Unset, it is the private ranges, which cover a chain that runs on a private network; a hop whose public address reaches `publira server`, such as a CDN in front of a load balancer that appends to the header, has to be listed, as [When to set the trusted proxies](#when-to-set-the-trusted-proxies) describes.
- **A `Forwarded` header the caller sent is not read.** Publira reads `Forwarded` ahead of `X-Forwarded-For`, so a caller's `Forwarded` passed on as it arrived would name the client in place of the address the edge wrote in `X-Forwarded-For`. Either the edge removes `Forwarded` from requests from outside or sets it itself, or `PUBLIRA_FORWARDED_HEADER_ENABLED=false` is set on `publira server`, `web-storefront`, `web-admin`, and `web-platform`. A managed load balancer usually writes `X-Forwarded-For` and passes `Forwarded` on untouched, so it needs the variable.

#### The proxies Publira trusts

`publira server` does not take the first address in a forwarded header as the client's, since whoever sent the request first could have written it there. It reads the addresses in the header, followed by the address the request arrived from, and walks them from the right: each address that belongs to a trusted proxy is stepped over, and the first that does not is the client. A request that arrives from an address outside the trusted proxies is recorded with that address, whatever its headers say.

A web app is a hop of the same kind. On a call it makes for a reader, it passes on the `Forwarded` and `X-Forwarded-For` headers it received, each with the address the request reached it from appended, and an `X-Forwarded-For` naming that address alone when neither arrived. `publira server` therefore steps over the web app and the edge in front of it to the same address it records for a request that reaches it from the edge directly.

The addresses come from the `for=` parameters of the standard `Forwarded` header when the request carries any, and from `X-Forwarded-For` otherwise. `PUBLIRA_FORWARDED_HEADER_ENABLED=false` makes `publira server` read the client address from `X-Forwarded-For` alone, and the web apps take the host from `X-Forwarded-Host` rather than from the `host=` of `Forwarded`. Set it on all four processes or on none: one left reading `Forwarded` behind an edge that passes the caller's on still reads the caller's. Besides `true` and `false`, it takes `1`, `0`, `t`, and `f`, and each of them in upper or title case, such as `TRUE` or `False`. Any other value stops `publira server` at startup, and makes every request to a web app fail.

The trusted proxies are `PUBLIRA_TRUSTED_PROXIES` on `publira server`: addresses and CIDR ranges, separated by commas or spaces, such as `10.0.0.0/8, 203.0.113.7`. A range that covers every address, such as `0.0.0.0/0`, is refused, since trusting every hop makes the address the caller wrote first the client. Unset, they are the loopback, private, and link-local ranges: `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, and `fe80::/10`. Those cover an edge and web apps that reach `publira server` over a private network. A value that is set replaces those ranges rather than adding to them, so list the private ranges your edge and web apps use alongside anything else. A value that is not an address or a range stops `publira server` at startup. The same proxies are the only ones whose `host=` of `Forwarded` and `X-Forwarded-Host` `publira server` reads when it finds the tenant an image is requested for.

#### When to set the trusted proxies

- **A hop connects from a public address, and the hop after it appends that address** rather than replacing the header, such as a CDN in front of a load balancer, or a load balancer that reaches the next hop from addresses outside the private ranges. List the ranges the hop connects from, which its provider publishes. Only the addresses that reach `publira server` need trusting, and every range listed is one more that could name a reader's address.
- **The edge or a web app reaches `publira server` from a public address.** Otherwise every request it forwards is recorded with its address.
- **A private range also reaches readers**, such as an office network that reaches `publira server` without passing the edge. List the addresses of your edge and web apps instead: a trusted range that reaches readers lets any of them name an address of their choosing.

### The host the request was sent to

The web apps find the tenant, and check that a form was submitted from the tenant's own site, from the host the request was sent to: the rightmost `host=` of a `Forwarded` header, unless `PUBLIRA_FORWARDED_HEADER_ENABLED` is `false`, then the rightmost value of `X-Forwarded-Host`, then `Host`. They read those headers on any request that reaches them, so the edge makes sure that whichever of them a web app reads names the host the browser asked for:

- **`Host` is passed on unchanged**, as [Routing](#routing) requires.
- **`X-Forwarded-Host` is removed from requests from outside, or written by the edge** after anything the caller sent, naming the host the browser asked for.
- **`Forwarded` carries no `host=` the caller wrote**: the edge removes the header or sets it itself, or `PUBLIRA_FORWARDED_HEADER_ENABLED` is `false`, as [The client address](#the-client-address) describes.

An edge that passes a caller's `X-Forwarded-Host` on lets the caller have another tenant answer on a tenant's host name, and choose the host a form's origin is checked against.

### Trace context

The edge removes `traceparent`, `tracestate`, and `baggage` from every request from outside. Publira's processes continue the trace an incoming `traceparent` names, so a caller who could set it would choose the trace and whether the request is sampled: attaching spans to someone else's trace, or exporting traces past the sampling ratio you set. Without the headers, each request starts a trace of its own. Calls between Publira's own processes do not pass through the edge, so they keep theirs.

### Image uploads from a page

A reader's icon on the tenant's site, and the images uploaded in the tenant console — an author's icon, an eye-catch, and the branding logo and browser icon — are posted to the path of the page they are chosen on, with a body of up to 11 MiB. Every hop on the way has to admit a body that size on the paths of the site's and the console's pages. A smaller limit refuses the upload before it reaches Publira.

### Uploads in the tenant console

The episode edit screen in the tenant console adds an episode's pages in one upload of up to 256 MiB, posted to `/api/v1/episode-pages` on the console host. Every hop on the way has to admit a body that size there, a load balancer, a CDN, a web application firewall, and a proxy alike. A smaller limit makes a ZIP of a whole episode fail with a message telling the staff member to split it.

The upload also needs time to arrive: 300 seconds, which is enough for 256 MiB over an uplink of about 7.2 Mbit/s, and as long as `web-admin` gives a request to arrive whole. A hop that limits how long a request may take, rather than how long the connection may sit idle, has to allow at least that long on this path.

### Webhooks

Outside services post to a URL on the tenant's site, under `/api/v1/webhook/`:

- **Payment providers** report payments under `/api/v1/webhook/payment/`, such as `https://comics.example.com/api/v1/webhook/payment/stripe`. The tenant console shows the exact URL to register with each provider: **Webhook URL** under **Payment settings**, and **App Store Server Notifications URL** under **In-app purchase**.
- **Inbound email providers** post a reader's emailed reply to a contact message under `/api/v1/webhook/email/`: `/api/v1/webhook/email/sendgrid` for SendGrid Inbound Parse, `/api/v1/webhook/email/resend` for Resend, `/api/v1/webhook/email/mailgun/json` for a Mailgun Route, `/api/v1/webhook/email/ses` for the SNS topic an Amazon SES receipt rule publishes to, `/api/v1/webhook/email/mime` for a whole mail posted by a Cloudflare Email Worker or a mail server of the publisher's own.

[Routing](#routing) already sends every one of them to `web-storefront`, so no rule names a webhook path. What every hop has to allow:

- **The provider reaches the path from the internet.** An IP allowlist, a sign-in prompt, or a bot challenge in front of the tenant's site has to let these requests through, or payments are taken and never recorded, and replies never reach the console.
- **The body arrives as the provider sent it.** Each notification is signed over its exact bytes, so a hop that rewrites the body on this path makes Publira refuse it.
- **A body of up to 33 MiB** under `/api/v1/webhook/email/`. SendGrid posts a reply with its attachments, up to its own 30 MB limit for a mail. A smaller limit turns a reply with a large attachment into a failed delivery the provider retries for days and then drops.

## The sample configurations

The repository ships three sample configurations of a reverse proxy that route requests and handle their headers, bodies, and timeouts as above: one each for Traefik, nginx, and Caddy. One requirement stays with the install that runs one: a TLS listener, which each sample leaves for you to add. They are examples, not the definition of the edge. The [Docker Compose](./3-docker-compose.md) install runs the Traefik one, and an install that runs a proxy of its own can start from any of them. An edge built from a managed load balancer, an Ingress, or a Gateway follows the requirements above, and needs none of them; [Kubernetes](./5-kubernetes.md#6-put-the-edge-in-front) shows a Gateway and an Ingress that do, and [Amazon ECS on Fargate](./6-ecs-fargate.md#8-put-cloudfront-in-front) CloudFront in front of an Application Load Balancer.

| Proxy | Files | Where the backend addresses go | Obtains certificates itself |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | Yes, with an ACME resolver you add |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | No |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | The `PUBLIRA_UPSTREAM_*` environment variables | Yes, once the site is given host names |

Take the files of the one you run from the release you install. The [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md) states what the three share, rule by rule.

### What each sample does

- **Routing.** Each sample routes the host names in three lists, given as [The host lists](#the-host-lists) describes, and applies the path rules of [Routing](#routing) on every one of them, answering the rest of `/rpc` and `/api` with a 404 of its own. A host in none of the lists reaches nothing: the sample answers it with a 404 of its own, on every path. That is the samples' choice, not something Publira requires.
- **The client address.** Traefik sets `X-Forwarded-For` and removes `Forwarded` with the `strip-forwarded` middleware. nginx and Caddy set `Forwarded` to the client address alone and remove `X-Forwarded-For`. Leave `PUBLIRA_FORWARDED_HEADER_ENABLED` enabled behind any of them.
- **The host.** Every sample passes `Host` on unchanged, and sets `X-Forwarded-Host` and `X-Forwarded-Proto` itself rather than passing on the caller's, except where it trusts a [hop in front of it](#a-hop-in-front-of-the-proxy).
- **Trace context.** Every sample removes the three headers. Traefik does it with the `strip-trace-context` middleware, which every entry point needs beside `strip-forwarded`.
- **Uploads and webhooks.** Traefik and Caddy set no limit on a body unless you add one. nginx refuses anything over 1 MB by default, and its sample raises that to `256m` on `/api/v1/episode-pages` on a console host, to `33m` under the rest of `/api/v1/`, and to `11m` on the paths of the pages. Traefik cuts off any request that has not arrived whole within 60 seconds unless told otherwise, and sets that per entry point rather than per path, so the sample gives every request on its `web` entry point 300 seconds with `transport.respondingTimeouts.readTimeout`. nginx waits up to 60 seconds between two reads of a body rather than for the whole of it, and Caddy does not limit the time at all, so neither sample changes it.
- **TLS.** Every sample listens on plain HTTP until you give it a TLS listener, as [Terminate TLS in a sample](#terminate-tls-in-a-sample) describes.

When you adapt one, keep each of these, and give an entry point or a `server` block you add the same headers, limits, and timeouts.

### The backend addresses

Each sample keeps the backend addresses apart from the routing, and the committed addresses name the development container, so they are the first thing you replace:

| Backend | Address |
| --- | --- |
| `web-storefront` | `web-storefront`, on the port it listens on |
| `web-admin` | `web-admin`, on the port it listens on |
| `web-platform` | `web-platform`, on the port it listens on, when you run it |
| `api` | `publira server`, port `8000` unless `PUBLIRA_PUBLIC_API_ADDR` sets another |

### The host lists

The host names come from the proxy's environment, so the routing files need no edit for them. Each variable holds host names separated by spaces, without a port, and a host belongs to one of them:

| Variable | Holds | Process |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | Every tenant's domain | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | Every tenant's console host | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | The Platform Console's host | `web-platform` |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
```

Each sample reads them in its own way:

- **Traefik** renders `dynamic/routes.yaml` as a template, so the variables go in the environment of the Traefik process.
- **nginx** takes them through the official nginx image, which fills them into `default.conf.template` when the container starts. Mount the `nginx` directory at `/etc/nginx/templates` rather than `/etc/nginx/conf.d`: the image writes the result over its own `conf.d/default.conf`. Without that image, render the file with `envsubst` yourself, as its first comment says.
- **Caddy** substitutes them into the Caddyfile when it reads it.

An install that does not run the Platform Console leaves `PUBLIRA_EDGE_PLATFORM_HOSTS` empty, and can leave the `web-platform` address out of its backend addresses. No routing block is removed for it: every sample is valid with an empty list.

Each sample reads the lists once, when the proxy starts. When you [add a tenant](#adding-a-tenant), add its domain to `PUBLIRA_EDGE_SITE_HOSTS` and its console host to `PUBLIRA_EDGE_ADMIN_HOSTS`, and restart the proxy with the new environment; a reload keeps the old lists. A certificate added to nginx or Caddy alone still takes a reload: `nginx -s reload`, or `caddy reload --config /etc/caddy/Caddyfile`, neither of which drops a connection in progress. Traefik with an ACME resolver requests the certificates of the new names once the routing names them.

On the [Docker Compose](./3-docker-compose.md) install, the lists are in `.env`, and `docker compose up -d proxy` recreates the proxy with them.

### A hop in front of the proxy

When a load balancer, a CDN, or a TLS terminator connects to a sample, as the one in front of the [Docker Compose](./3-docker-compose.md) install does, the proxy's peer is that hop. With the samples as they ship, every request is then recorded with the hop's address: the audit log shows one address for everyone, and the limits Publira keeps per client address are shared by every reader.

To record the reader's own address:

- **The hop sets `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` itself**, to the address that connected to it, the host the browser asked for, and the scheme it used, rather than passing on or appending to the caller's. Traefik trusts all three from the hop, and the web apps find the tenant from `X-Forwarded-Host`, so behind Traefik a hop that set only `X-Forwarded-For` would let a caller pick the tenant. Caddy sets all three by default when it trusts no proxy in front of itself.
- **The proxy trusts that hop's addresses, and no others**, and takes the client address from the hop's header. Each sample carries the setting commented out, naming the documentation range `192.0.2.0/24`: uncomment it, and replace the range with the hop's addresses.
  - Traefik: `forwardedHeaders.trustedIPs` on the `web` entry point in `traefik.yaml`, or on the entry point the hop connects to.
  - nginx: `set_real_ip_from`, with `real_ip_header` and `real_ip_recursive` below it, near the top of `default.conf.template`, one `set_real_ip_from` line per address or range, and the same addresses in the `geo` block under them, one line each ending in ` 1;`.
  - Caddy: the `servers` block in the Caddyfile's global options, with `trusted_proxies static` followed by the addresses, separated by spaces.
  - The Docker Compose install: `PUBLIRA_EDGE_TRUSTED_PROXIES` in `.env`, as [Put TLS in front](./3-docker-compose.md#5-put-tls-in-front) describes.

Every sample then passes on the `X-Forwarded-Proto` the hop names, since the hop reaches the proxy over plain HTTP while the reader used HTTPS. nginx and Caddy take the rightmost address in the hop's `X-Forwarded-For` that is not one of the trusted ones, pass that address on alone in `Forwarded`, and keep setting `X-Forwarded-Host` themselves, so a hop in front of them needs no entry in `PUBLIRA_TRUSTED_PROXIES`. Traefik passes the hop's `X-Forwarded-For` on with the hop's own address appended, so `publira server` steps over that address to the one the hop named only when it trusts the hop as well: by default for a hop on a private network, and for a hop with a public address, such as a CDN, once `PUBLIRA_TRUSTED_PROXIES` lists its ranges. A request from any other address is treated as it is without the setting.

Trust the hop's own addresses only. A trusted range that also reaches readers lets any of them name an address of their choosing.

### Terminate TLS in a sample

The changes below add a TLS listener to each sample, and send plain HTTP to HTTPS with a redirect. Caddy and Traefik can obtain a certificate from Let's Encrypt, or another ACME certificate authority, for every name they are given, and renew it before it expires. The authority has to reach the proxy on port 80 or 443 at that name, so the DNS record comes first and both ports are open to the internet. A certificate issued elsewhere, by a separate ACME client such as certbot, your own certificate authority, or a certificate service, is written to files the proxy reads: renewal is then that tool's job, and the proxy has to load the renewed files.

On the [Docker Compose](./3-docker-compose.md) install, the Traefik sample runs on plain HTTP behind a TLS terminator on the host, and the certificates belong to that terminator instead.

#### Caddy

Give the site block the host names in place of `:80`, and remove `auto_https off` from the global options. Caddy then obtains a certificate for each name, renews it, and redirects plain HTTP to HTTPS on its own:

```text
{
	email ops@example.com
}

comics.example.com, admin.comics.example.com {
	# The matchers and the route block, as in the sample
}
```

The matchers and the `route` block stay as they are. For a certificate issued elsewhere, add `tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem` inside the site block, and Caddy uses those files instead of obtaining its own.

#### nginx

In each of the four `server` blocks of `default.conf.template`, change `listen 80` to `listen 443 ssl`, keeping `default_server` on the first block, the one that answers hosts in no list. Then add the certificate, and a server that redirects plain HTTP, at the end of the same file:

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

A certificate written there serves every `server` block, so it has to name every host the proxy serves. To keep one certificate per tenant instead, name each pair's directory after the host, and let nginx pick it from the name the browser asked for:

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

nginx then reads the pair on every new connection, so a new or renewed certificate takes effect without a reload. The files are read by the worker processes rather than the master, though, so the key has to be readable by the user the workers run as, `nginx` in the official image, and not only by root. A key only root can read fails every connection to its host.

nginx obtains no certificate itself. If your ACME client answers its HTTP challenge through nginx, serve `/.well-known/acme-challenge/` from the port 80 server ahead of the redirect.

#### Traefik

In `traefik.yaml`, send the `web` entry point to `websecure`, and turn on the `websecure` entry point the sample carries commented out:

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      middlewares:
        - strip-trace-context@file
        - strip-forwarded@file
      tls: {}
    transport:
      respondingTimeouts:
        readTimeout: 300s
```

`websecure` carries the same two middlewares and the same 300 seconds as `web`: without the timeout, an upload over HTTPS is cut off after a minute.

In `dynamic/routes.yaml`, change `entryPoints: [web]` to `entryPoints: [websecure]` on every router. A router answers only on the entry points it names, so one left on `web` is never reached over HTTPS.

To have Traefik obtain the certificates, add a resolver to `traefik.yaml`, and keep its `storage` file on a volume that outlives the container:

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

The routers name every listed host in their rules, so Traefik can tell from them which names to request. In the `websecure` entry point above, replace `tls: {}` with the resolver, and every router on it obtains a certificate for its hosts:

```yaml
tls:
  certResolver: letsencrypt
```

For certificates issued elsewhere, leave out the resolver, and list the files in a new file in the `dynamic` directory, such as `dynamic/tls.yaml`. Traefik serves each one for the names it carries:

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefik watches the `dynamic` directory, so a change to a file there, such as a new certificate entry, takes effect without a restart. A change to `traefik.yaml` needs one. Traefik does not notice a certificate file replaced in place, though, so after each renewal update a file in `dynamic/`, such as with `touch dynamic/tls.yaml`, or it keeps serving the old certificate until it expires.

## Next steps

With the edge serving HTTPS, [sign in to the tenant console](./2-installing.md#6-sign-in) at its console host. The rules the samples share, their order, and how the repository checks every sample against them are in the [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md).
