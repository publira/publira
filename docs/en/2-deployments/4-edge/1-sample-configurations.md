---
title: Sample configurations
description: The sample Traefik, nginx, and Caddy configurations in the repository that do what the edge has to do, and how to adapt one to an install.
published: 2026-10-21
---

The repository ships three sample configurations of a reverse proxy that route requests and handle their headers, bodies, and timeouts as [What the edge has to do](./index.md#what-the-edge-has-to-do) requires: one each for Traefik, nginx, and Caddy. One requirement stays with the install that runs one: a TLS listener, which the Traefik and nginx samples leave for you to add, and the Caddy one adds once it is given the host names to serve over HTTPS. They are examples, not the definition of the edge. The [Docker Compose](../3-docker-compose.md) install runs the Caddy one, and an install that runs a proxy of its own can start from any of them. An edge built from a managed load balancer, an Ingress, or a Gateway follows those requirements, and needs none of them; [The edge on Kubernetes](../5-kubernetes/1-edge.md) shows a Gateway and an Ingress that do, and [CloudFront in front of ECS](../6-ecs-fargate/1-cloudfront.md) CloudFront in front of an Application Load Balancer.

| Proxy | Files | Where the backend addresses go | Obtains certificates itself |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | Yes, with an ACME resolver you add |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | No |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | The `PUBLIRA_UPSTREAM_*` environment variables | Yes, for the host names in `PUBLIRA_EDGE_TLS_HOSTS` |

Take the files of the one you run from the release you install. The [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md) states what the three share, rule by rule.

## What each sample does

- **Routing.** Each sample routes the host names in three lists, given as [The host lists](#the-host-lists) describes, and applies the path rules of [Routing](./index.md#routing) on every one of them, answering the rest of `/rpc` with a 404 of its own. A host in none of the lists reaches nothing: the sample answers it with a 404 of its own, on every path. That is the samples' choice, not something Publira requires.
- **The client address.** Traefik sets `X-Forwarded-For` and removes `Forwarded` with the `strip-forwarded` middleware. nginx and Caddy set `Forwarded` to the client address alone and remove `X-Forwarded-For`. Leave `PUBLIRA_FORWARDED_HEADER_ENABLED` enabled behind any of them.
- **The host.** Every sample passes `Host` on unchanged, and sets `X-Forwarded-Host` and `X-Forwarded-Proto` itself rather than passing on the caller's, except where it trusts a [hop in front of it](#a-hop-in-front-of-the-proxy).
- **Trace context.** Every sample removes the three headers. Traefik does it with the `strip-trace-context` middleware, which every entry point needs beside `strip-forwarded`.
- **Uploads and webhooks.** Traefik and Caddy set no limit on a body unless you add one. nginx refuses anything over 1 MB by default, and its sample raises that to `256m` on `/api/v1/episode-pages` on a console host, to `33m` under the rest of `/api/v1/`, and to `11m` on the paths of the pages. Traefik cuts off any request that has not arrived whole within 60 seconds unless told otherwise, and sets that per entry point rather than per path, so the sample gives every request on its `web` entry point 300 seconds with `transport.respondingTimeouts.readTimeout`. nginx waits up to 60 seconds between two reads of a body rather than for the whole of it, and Caddy does not limit the time at all, so neither sample changes it.
- **TLS.** Every sample listens on plain HTTP until you give it a TLS listener, or Caddy the host names to serve over HTTPS, as [Terminate TLS in a sample](#terminate-tls-in-a-sample) describes.

When you adapt one, keep each of these, and give an entry point or a `server` block you add the same headers, limits, and timeouts.

## The backend addresses

Each sample keeps the backend addresses apart from the routing, and the committed addresses name the development container, so they are the first thing you replace:

| Backend | Address |
| --- | --- |
| `web-storefront` | `web-storefront`, on the port it listens on |
| `web-admin` | `web-admin`, on the port it listens on |
| `web-platform` | `web-platform`, on the port it listens on, when you run it |
| `api` | `publira server`, port `8000` unless `PUBLIRA_PUBLIC_API_ADDR` sets another |

## The host lists

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

Each sample reads the lists once, when the proxy starts. When you [add a tenant](./index.md#adding-a-tenant), add its domain to `PUBLIRA_EDGE_SITE_HOSTS` and its console host to `PUBLIRA_EDGE_ADMIN_HOSTS`, and restart the proxy with the new environment; a reload keeps the old lists. A certificate added to nginx or Caddy as files alone still takes a reload: `nginx -s reload`, or `caddy reload --config /etc/caddy/Caddyfile`, neither of which drops a connection in progress. Caddy obtaining its own requests the certificates of the names added to `PUBLIRA_EDGE_TLS_HOSTS` when it restarts with them, and Traefik with an ACME resolver once the routing names them.

On the [Docker Compose](../3-docker-compose.md) install, the lists are in `.env`, and `docker compose up -d proxy` recreates the proxy with them, which then obtains the certificates of the new names.

## A hop in front of the proxy

When a load balancer, a CDN, or a TLS terminator connects to a sample, the proxy's peer is that hop. With the samples as they ship, every request is then recorded with the hop's address: the audit log shows one address for everyone, and the limits Publira keeps per client address are shared by every reader.

To record the reader's own address:

- **The hop sets `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` itself**, to the address that connected to it, the host the browser asked for, and the scheme it used, rather than passing on or appending to the caller's. Traefik trusts all three from the hop, and the web apps find the tenant from `X-Forwarded-Host`, so behind Traefik a hop that set only `X-Forwarded-For` would let a caller pick the tenant. Caddy sets all three by default when it trusts no proxy in front of itself.
- **The proxy trusts that hop's addresses, and no others**, and takes the client address from the hop's header. The Traefik and nginx samples carry the setting commented out, naming the documentation range `192.0.2.0/24`: uncomment it, and replace the range with the hop's addresses. The Caddy sample reads them from its environment.
  - Traefik: `forwardedHeaders.trustedIPs` on the `web` entry point in `traefik.yaml`, or on the entry point the hop connects to.
  - nginx: `set_real_ip_from`, with `real_ip_header` and `real_ip_recursive` below it, near the top of `default.conf.template`, one `set_real_ip_from` line per address or range, and the same addresses in the `geo` block under them, one line each ending in ` 1;`.
  - Caddy: `PUBLIRA_EDGE_TRUSTED_PROXIES` in the environment of the Caddy process, the addresses separated by spaces, which `trusted_proxies static` in the Caddyfile's global options reads.
  - The Docker Compose install: `PUBLIRA_EDGE_TRUSTED_PROXIES` in `.env`, as [A CDN or a load balancer in front](../3-docker-compose.md#a-cdn-or-a-load-balancer-in-front) describes.

Every sample then passes on the `X-Forwarded-Proto` the hop names, since the hop reaches the proxy over plain HTTP while the reader used HTTPS. nginx and Caddy take the rightmost address in the hop's `X-Forwarded-For` that is not one of the trusted ones, pass that address on alone in `Forwarded`, and keep setting `X-Forwarded-Host` themselves, so a hop in front of them needs no entry in `PUBLIRA_TRUSTED_PROXIES`. Traefik passes the hop's `X-Forwarded-For` on with the hop's own address appended, so `publira server` steps over that address to the one the hop named only when it trusts the hop as well: by default for a hop on a private network, and for a hop with a public address, such as a CDN, once `PUBLIRA_TRUSTED_PROXIES` lists its ranges. A request from any other address is treated as it is without the setting.

Trust the hop's own addresses only. A trusted range that also reaches readers lets any of them name an address of their choosing.

## Terminate TLS in a sample

The changes below add a TLS listener to each sample, and send plain HTTP to HTTPS with a redirect. Caddy and Traefik can obtain a certificate from Let's Encrypt, or another ACME certificate authority, for every name they are given, and renew it before it expires. The authority has to reach the proxy on port 80 or 443 at that name, so the DNS record comes first and both ports are open to the internet. A certificate issued elsewhere, by a separate ACME client such as certbot, your own certificate authority, or a certificate service, is written to files the proxy reads: renewal is then that tool's job, and the proxy has to load the renewed files.

The [Docker Compose](../3-docker-compose.md) install runs the Caddy sample terminating TLS for every listed host once its ACME contact is set, as below.

### Caddy

Set `PUBLIRA_EDGE_TLS_HOSTS` in the environment of the Caddy process to every host name the three lists hold, separated by spaces, and `PUBLIRA_EDGE_ACME_EMAIL` to the contact address its account at the certificate authority is registered with. Caddy then obtains a certificate for each name, renews it, serves it on port 443, and redirects plain HTTP for those names to HTTPS:

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddy keeps the certificates under `/data`, so give that directory a volume that outlives the container; one that starts empty makes Caddy request every certificate again. A host in no list gets no certificate, so its TLS handshake fails, and over plain HTTP the sample still answers it with its own 404.

For a certificate issued elsewhere, replace `:80 {$PUBLIRA_EDGE_TLS_HOSTS}`, the site block's addresses, with the host names, and add `tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem` inside the block: Caddy uses those files instead of obtaining its own, and refuses them in a block that also listens on plain HTTP. Caddy reads them inside its container, so mount the directory that holds them at `/etc/caddy/tls`, read-only: on the Docker Compose install, add `- <directory>:/etc/caddy/tls:ro` to the `volumes` of the `proxy` service, and run `docker compose up -d proxy` to recreate it with the mount. With no site left on port 80, Caddy redirects plain HTTP for every host, listed or not, to HTTPS, so a host in no list gets that redirect in place of the sample's 404, and then fails the TLS handshake.

### nginx

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

### Traefik

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

With the edge serving HTTPS, [sign in to the tenant console](../2-installing.md#6-sign-in) at its console host. The rules the samples share, their order, and how the repository checks every sample against them are in the [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md).
