---
title: Reverse proxy
description: Put a reverse proxy with TLS in front of an install, and change it when a tenant is added.
published: 2026-10-06
---

Every request a browser or the mobile app sends to an install reaches it through one reverse proxy. The proxy picks the process that answers from the host name and the path, terminates TLS, and is where the headers a caller could forge stop. This page takes one of the sample configurations in the repository to a proxy that serves a tenant's site and its console over HTTPS, and says what to change when a tenant is added.

The [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md) states the rules in full, and each sample implements them. This page says what the rules mean for you, and what they leave for you to decide.

## What the proxy routes

The host name picks a web app:

| Host | Process |
| --- | --- |
| A tenant's console host: `admin.<domain>`, or the one it was given with `--admin-domain` | `web-admin` |
| The Platform Console's host, such as `platform.example.com`, when you run it | `web-platform` |
| A tenant's domain | `web-host` |

Two path prefixes then go to the edge listener of `publira server`, on every host:

- `/api`, the public API the browser and the mobile app call, except `/api/v1`. That one stays with the web app the host picked, which answers its own endpoints there, the payment webhooks among them.
- `/images`, every image a page shows.

The proxy passes the path on as it arrived, and the `Host` header as the browser sent it. Publira picks the tenant from the host name, and its routes carry the `/api` and `/images` prefixes, so a proxy that rewrites either reaches no tenant at all.

## Choose a sample

The repository ships the same routing for three proxies. Take the files of the one you run from the release you install:

| Proxy | Files | Where the backend addresses go | Obtains certificates itself |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | Yes, with an ACME resolver you add |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | No |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | The `PUBLIRA_UPSTREAM_*` environment variables | Yes, once the site is given host names |

Each sample keeps the backend addresses apart from the routing, and the committed addresses name the development container, so they are the first thing you replace:

| Backend        | Address                                                    |
| -------------- | ---------------------------------------------------------- |
| `web-host`     | `web-host`, on the port it listens on                      |
| `web-admin`    | `web-admin`, on the port it listens on                     |
| `web-platform` | `web-platform`, on the port it listens on, when you run it |
| `api`          | The edge listener of `publira server`, port `8000`         |

The internal listener of `publira server`, port `8100`, is for the web apps alone. The proxy never forwards to it, so keep it off any network the proxy is reachable from.

The host rules in the samples are examples too. They pick an app by a pattern on the host name, `admin.` and `platform.`, and send every other host to `web-host`, none of which Publira itself relies on: a tenant's site and console are on whichever hosts it was given. Replace them with the host names your install actually serves: every tenant's domain for `web-host`, every tenant's console host for `web-admin`, and the Platform Console's host for `web-platform`.

An install that does not run the Platform Console leaves out its upstream and its host rule: the `web-platform` router and service in Traefik, the platform `server` block and its upstream in nginx, and the `@platform` matcher and its `handle` block in Caddy.

The [Docker Compose](./3-docker-compose.md) install already runs the Traefik sample, on plain HTTP behind a TLS terminator on the host. On that install, the certificates in the next section belong to the terminator, and the rest of this page applies to the Traefik files in your checkout.

## Terminate TLS

Every sample listens on plain HTTP until you give it a TLS listener. The changes below add one, and send plain HTTP to HTTPS with a redirect, so a reader who types the bare host name still arrives.

### The names that need a certificate

- Each tenant's domain, such as `comics.example.com`.
- Each tenant's console host, such as `admin.comics.example.com`.
- The Platform Console's host, if you run it.

A wildcard certificate for `*.comics.example.com` covers the console host but not `comics.example.com` itself, and a tenant on a domain of its own needs names of its own: no one certificate covers every tenant.

### Where certificates come from

- **ACME in the proxy.** Caddy and Traefik obtain a certificate from Let's Encrypt, or another ACME certificate authority, for every name they are given, and renew it before it expires. The authority has to reach the proxy on port 80 or 443 at that name, so the DNS record comes first and both ports are open to the internet.
- **A certificate issued elsewhere.** A separate ACME client such as certbot, your own certificate authority, or a certificate service writes the files, and the proxy reads them. Renewal is then that tool's job, and the proxy has to load the renewed files.

### Caddy

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

### nginx

In each of the three `server` blocks of `publira.conf`, change `listen 80` to `listen 443 ssl`, keeping `default_server` on the first block, the tenant site's. Then add the certificate, and a server that redirects plain HTTP, at the end of the same file:

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
      tls: {}
```

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

The routers match hosts by pattern, so Traefik cannot tell from them which names to request. List the names on one router in `dynamic/routes.yaml`, such as `web-host`:

```yaml
http:
  routers:
    web-host:
      rule: "PathPrefix(`/`)"
      priority: 1
      entryPoints: [websecure]
      service: web-host
      tls:
        certResolver: letsencrypt
        domains:
          - main: comics.example.com
            sans:
              - admin.comics.example.com
```

For certificates issued elsewhere, leave out the resolver, and list the files in a new file in the `dynamic` directory, such as `dynamic/tls.yaml`. Traefik serves each one for the names it carries:

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefik watches the `dynamic` directory, so a change there, a new name or a new certificate, takes effect without a restart. A change to `traefik.yaml` needs one.

## Adding a tenant

A tenant made with `publiractl tenant create` or in the Platform Console is served as soon as it exists, but its two host names reach it only once the proxy is ready for them. Before its staff open the console:

1. **DNS.** Point the tenant's domain and its console host at the proxy.
2. **Certificates.** Add both names: to the site addresses in Caddy, to the certificate or the per-host directories in nginx, or to the `domains` list or the certificate files in Traefik.
3. **Routing.** Add its domain to the hosts your configuration sends to `web-host`, and its console host to those it sends to `web-admin`.

Load each change as you make it. Traefik picks up `dynamic/` on its own; nginx reloads with `nginx -s reload`, and Caddy with `caddy reload --config /etc/caddy/Caddyfile`. Neither reload drops a connection in progress.

Moving a console host later, with `publiractl tenant update --admin-domain` or in the **Admin domain** field of the Platform Console, follows the same order: add the new name to DNS, the certificates, and the routing before the change, and remove the old one after it. `--admin-domain ""` moves the console back to `admin.<domain>`.

## The headers the proxy owns

The proxy is where a request from outside becomes one Publira acts on, so it decides some headers rather than passing on the caller's. Every sample already does what follows; keep it when you adapt one, and do the same if you write the configuration of another proxy.

- **Trace context is removed.** `traceparent`, `tracestate`, and `baggage` are dropped from every request. Publira's processes continue the trace an incoming `traceparent` names, so a caller who could set it would choose the trace and whether the request is sampled: attaching spans to someone else's trace, or exporting traces past the sampling ratio you set. Without the headers, each request starts a trace of its own. Calls between Publira's own processes do not pass through the proxy, so they keep theirs.
- **`X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` are set, never appended to.** `X-Forwarded-For` is the client address Publira records with every sign-in and in the audit log, and the address its per-client limits count against, and Publira reads the first address in it. A proxy that appended to a header the caller sent would put the caller's own value first. `X-Forwarded-Host` is how Publira finds the tenant, and what it compares a form submission's origin with.
- **`Host` is passed on unchanged**, for the same reason as `X-Forwarded-Host`.

### A hop in front of the proxy

When a load balancer, a CDN, or a TLS terminator connects to the proxy, as the one in front of the [Docker Compose](./3-docker-compose.md) install does, the proxy's peer is that hop. With the samples as they ship, every request is then recorded with the hop's address: the audit log shows one address for everyone, and the limits Publira keeps per client address are shared by every reader.

To record the reader's own address:

- **The hop sets `X-Forwarded-For` to the address that connected to it**, rather than appending to the caller's. Caddy does this by default when it trusts no proxy in front of itself.
- **The proxy trusts that hop's addresses, and no others**, and takes the client address from the hop's header:
  - Traefik: `forwardedHeaders.trustedIPs` on the entry point the hop connects to.
  - nginx: `set_real_ip_from` with the hop's addresses and `real_ip_header X-Forwarded-For`, in a file of its own in the same directory. The sample's `X-Forwarded-For $remote_addr` then carries the reader's address.
  - Caddy: `trusted_proxies static` with the hop's addresses, under the `servers` global option, and `{client_ip}` in place of `{http.request.remote.host}` on the sample's `X-Forwarded-For` line.

Trust the hop's own addresses only. A trusted range that also reaches readers lets any of them name an address of their choosing.

## Payment webhooks

Payment providers report payments to a URL on the tenant's site, under `/api/v1/webhook/payment/`, such as `https://comics.example.com/api/v1/webhook/payment/stripe`. The tenant console shows the exact URL to register with each provider: **Webhook URL** under **Payment settings**, and **App Store Server Notifications URL** under **In-app purchase**. Endpoints registered with Stripe before that layout, at `/api/v1/webhook/stripe`, still reach the install, though that path is deprecated.

The routing above already sends every one of them to `web-host`, so no rule names a webhook path. What the proxy has to allow:

- **The provider reaches the path from the internet.** An IP allowlist, a sign-in prompt, or a bot challenge in front of the tenant's site has to let these requests through, or payments are taken and never recorded.
- **The body arrives as the provider sent it.** Each notification is signed over its exact bytes, so a rule on this path that rewrites request bodies makes Publira refuse it.

## Next steps

With the proxy serving HTTPS, [sign in to the tenant console](./2-installing.md#6-sign-in) at its console host. The routing rules in full, their order, and how the repository checks every sample against them are in the [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md).
