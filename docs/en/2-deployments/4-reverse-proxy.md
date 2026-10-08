---
title: Reverse proxy
description: Put a reverse proxy with TLS in front of an install, and change it when a tenant is added.
published: 2026-10-06
updated: 2026-10-08
---

Every request a browser or the mobile app sends to an install reaches it through one reverse proxy. The proxy picks the process that answers from the host name and the path, terminates TLS, and is where the headers a caller could forge stop. This page takes one of the sample configurations in the repository to a proxy that serves a tenant's site and its console over HTTPS, and says what to change when a tenant is added.

The [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md) states the rules in full, and each sample implements them. This page says what the rules mean for you, and what they leave for you to decide.

## What the proxy routes

The host name picks a web app, and the proxy routes only the host names you list for it:

| Host | Listed in | Process |
| --- | --- | --- |
| A tenant's domain | `PUBLIRA_EDGE_SITE_HOSTS` | `web-host` |
| A tenant's console host: `admin.<domain>`, or the one it was given with `--admin-domain` | `PUBLIRA_EDGE_ADMIN_HOSTS` | `web-admin` |
| The Platform Console's host, such as `platform.example.com`, when you run it | `PUBLIRA_EDGE_PLATFORM_HOSTS` | `web-platform` |

A host in none of the lists reaches nothing: the proxy answers it with a 404 of its own. Its name does not matter either way, so a console host need not start with `admin.`, and a host that does reaches the console only once it is listed.

Two path prefixes then go to the edge listener of `publira server`, on every listed host:

- `/api`, the public API the browser and the mobile app call, except `/api/v1`. That one stays with the web app the host picked, which answers its own endpoints there, the payment and inbound email webhooks among them.
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

The host names come from the proxy's environment, so the routing files need no edit for them. Each of the three variables in the table above holds host names separated by spaces, without a port, and a host belongs to one of them:

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

The [Docker Compose](./3-docker-compose.md) install already runs the Traefik sample, on plain HTTP behind a TLS terminator on the host. On that install, the certificates in the next section belong to the terminator, the hop in front of the proxy is that terminator, set in `.env` as [below](#a-hop-in-front-of-the-proxy), and the rest of this page applies to the Traefik routing in your checkout.

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

## Adding a tenant

A tenant made with `publiractl tenant create` or in the Platform Console is served as soon as it exists, but its two host names reach it only once the proxy is ready for them. Before its staff open the console:

1. **DNS.** Point the tenant's domain and its console host at the proxy.
2. **Certificates.** Add both names: to the site addresses in Caddy, or to the certificate or the per-host directories in nginx. Traefik with a resolver requests them once the routing below names them; with certificate files, add those.
3. **Routing.** Add its domain to `PUBLIRA_EDGE_SITE_HOSTS`, and its console host to `PUBLIRA_EDGE_ADMIN_HOSTS`.

Each sample reads the host lists once, when the proxy starts, so restart it with the new environment after the routing change; a reload keeps the old lists. A certificate added to nginx or Caddy alone still takes a reload: `nginx -s reload`, or `caddy reload --config /etc/caddy/Caddyfile`, neither of which drops a connection in progress.

On the [Docker Compose](./3-docker-compose.md) install, the lists are in `.env`, and `docker compose up -d proxy` recreates the proxy with them.

Moving a console host later, with `publiractl tenant update --admin-domain` or in the **Admin domain** field of the Platform Console, follows the same order: add the new name to DNS, the certificates, and the routing before the change, and remove the old one after it. `--admin-domain ""` moves the console back to `admin.<domain>`.

## The headers the proxy owns

The proxy is where a request from outside becomes one Publira acts on, so it decides some headers rather than passing on the caller's. Every sample already does what follows; keep it when you adapt one, and do the same if you write the configuration of another proxy.

- **Trace context is removed.** `traceparent`, `tracestate`, and `baggage` are dropped from every request. Publira's processes continue the trace an incoming `traceparent` names, so a caller who could set it would choose the trace and whether the request is sampled: attaching spans to someone else's trace, or exporting traces past the sampling ratio you set. Without the headers, each request starts a trace of its own. Calls between Publira's own processes do not pass through the proxy, so they keep theirs.
- **`X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` are set, never appended to.** `X-Forwarded-For` is where Publira finds the client address it records with every sign-in and in the audit log, and the address its per-client limits count against, as [The proxies Publira trusts](#the-proxies-publira-trusts) describes; setting it keeps an address the caller wrote out of it altogether. `X-Forwarded-Host` is how Publira finds the tenant, and what it compares a form submission's origin with.
- **`Forwarded` is removed.** Publira reads the client address from a standard `Forwarded` header ahead of `X-Forwarded-For`, and none of the samples writes one, so a `Forwarded` header that reaches the proxy is the caller's own. A proxy you configure yourself either removes it in the same way or writes it itself; if it does neither, turn the header off on `publira server`, as [below](#the-proxies-publira-trusts).
- **`Host` is passed on unchanged**, for the same reason as `X-Forwarded-Host`.

### A hop in front of the proxy

When a load balancer, a CDN, or a TLS terminator connects to the proxy, as the one in front of the [Docker Compose](./3-docker-compose.md) install does, the proxy's peer is that hop. With the samples as they ship, every request is then recorded with the hop's address: the audit log shows one address for everyone, and the limits Publira keeps per client address are shared by every reader.

To record the reader's own address:

- **The hop sets `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` itself**, to the address that connected to it, the host the browser asked for, and the scheme it used, rather than passing on or appending to the caller's. Traefik trusts all three from the hop, and Publira finds the tenant from `X-Forwarded-Host`, so behind Traefik a hop that set only `X-Forwarded-For` would let a caller pick the tenant. Caddy sets all three by default when it trusts no proxy in front of itself.
- **The proxy trusts that hop's addresses, and no others**, and takes the client address from the hop's header. Each sample carries the setting commented out, naming the documentation range `192.0.2.0/24`: uncomment it, and replace the range with the hop's addresses.
  - Traefik: `forwardedHeaders.trustedIPs` on the `web` entry point in `traefik.yaml`, or on the entry point the hop connects to.
  - nginx: `set_real_ip_from`, with `real_ip_header` and `real_ip_recursive` below it, near the top of `default.conf.template`, one `set_real_ip_from` line per address or range, and the same addresses in the `geo` block under them, one line each ending in ` 1;`.
  - Caddy: the `servers` block in the Caddyfile's global options, with `trusted_proxies static` followed by the addresses, separated by spaces.
  - The Docker Compose install: `PUBLIRA_EDGE_TRUSTED_PROXIES` in `.env`, as [Put TLS in front](./3-docker-compose.md#5-put-tls-in-front) describes.

Every sample then passes on the `X-Forwarded-Proto` the hop names, since the hop reaches the proxy over plain HTTP while the reader used HTTPS. nginx and Caddy take the rightmost address in the hop's `X-Forwarded-For` that is not one of the trusted ones, pass that address on alone, and keep setting `X-Forwarded-Host` themselves. Traefik passes the hop's `X-Forwarded-For` on with the hop's own address appended, so `publira server` steps over that address to the one the hop named only when it trusts the hop as well, which it does by default for a hop on a private network, as [below](#the-proxies-publira-trusts). A request from any other address is treated as it is without the setting.

Trust the hop's own addresses only. A trusted range that also reaches readers lets any of them name an address of their choosing.

## The proxies Publira trusts

`publira server` does not take the first address in a forwarded header as the client's, since whoever sent the request first could have written it there. It reads the addresses in the header, followed by the address the request arrived from, and walks them from the right: each address that belongs to a trusted proxy is stepped over, and the first that does not is the client. A request that arrives from an address outside the trusted proxies is recorded with that address, whatever its headers say.

A web app is a hop of the same kind. On a call it makes for a reader, it passes on the `Forwarded` and `X-Forwarded-For` headers it received, each with the address the request reached it from appended, and an `X-Forwarded-For` naming that address alone when neither arrived. `publira server` therefore steps over the web app and the proxy in front of it to the same address it records for a request that reaches it from the proxy directly.

The addresses come from the `for=` parameters of the standard `Forwarded` header when the request carries any, and from `X-Forwarded-For` otherwise. A proxy that writes only `X-Forwarded-For` and passes on a `Forwarded` header the caller sent would therefore let any caller name an address of their choosing, which is why the samples remove it. Behind such a proxy, set `PUBLIRA_FORWARDED_HEADER_ENABLED=false` on `publira server`, and it reads `X-Forwarded-For` alone. A value other than `true` or `false` stops `publira server` at startup.

The trusted proxies are `PUBLIRA_TRUSTED_PROXIES` on `publira server`: addresses and CIDR ranges, separated by commas or spaces, such as `10.0.0.0/8, 203.0.113.7`. A range that covers every address, such as `0.0.0.0/0`, is refused, since trusting every hop makes the address the caller wrote first the client. Unset, they are the loopback, private, and link-local ranges: `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, and `fe80::/10`. Those cover the proxy and the web apps of an install that keeps them on a private network, as the [Docker Compose](./3-docker-compose.md) install does, and a TLS terminator that reaches the proxy through that network's gateway. A value that is set replaces those ranges rather than adding to them, so list the private ranges your proxy and web apps use alongside anything else. A value that is not an address or a range stops `publira server` at startup.

Set it when:

- **The proxy or a web app reaches `publira server` from a public address.** Otherwise every request it forwards is recorded with its address.
- **A hop with a public address, such as a CDN, sits in front of Traefik.** Traefik appends that hop's address to `X-Forwarded-For`, so list the hop's published ranges as well. nginx and Caddy pass on the address they found alone, so a hop in front of them needs no entry here.
- **A private range also reaches readers**, such as an office network that reaches `publira server` without passing the proxy. List the proxy's and the web apps' own addresses instead, for the same reason as above: a trusted range that reaches readers lets any of them name an address of their choosing.

## Uploads in the tenant console

The episode edit screen in the tenant console adds an episode's pages in one upload of up to 256 MiB, posted to `/api/v1/episode-pages` on the console host. Traefik and Caddy set no limit on a body unless you add one; nginx refuses anything over 1 MB by default, and its sample raises that to `256m` on that path. A smaller limit makes a ZIP of a whole episode fail with a message telling the staff member to split it.

## Webhooks

Outside services post to a URL on the tenant's site, under `/api/v1/webhook/`:

- **Payment providers** report payments under `/api/v1/webhook/payment/`, such as `https://comics.example.com/api/v1/webhook/payment/stripe`. The tenant console shows the exact URL to register with each provider: **Webhook URL** under **Payment settings**, and **App Store Server Notifications URL** under **In-app purchase**. Endpoints registered with Stripe before that layout, at `/api/v1/webhook/stripe`, still reach the install, though that path is deprecated.
- **Inbound email providers** post a reader's emailed reply to a contact message under `/api/v1/webhook/email/`: `/api/v1/webhook/email/sendgrid` for SendGrid Inbound Parse, `/api/v1/webhook/email/resend` for Resend.

The routing above already sends every one of them to `web-host`, so no rule names a webhook path. What the proxy has to allow:

- **The provider reaches the path from the internet.** An IP allowlist, a sign-in prompt, or a bot challenge in front of the tenant's site has to let these requests through, or payments are taken and never recorded, and replies never reach the console.
- **The body arrives as the provider sent it.** Each notification is signed over its exact bytes, so a rule on this path that rewrites request bodies makes Publira refuse it.
- **A body of up to 33 MiB.** SendGrid posts a reply with its attachments, up to its own 30 MB limit for a mail. Traefik and Caddy set no limit unless you add one; nginx refuses anything over 1 MB by default, and its sample raises that to `33m` under `/api/v1/`. A smaller limit turns a reply with a large attachment into a failed delivery the provider retries for days and then drops.

## Next steps

With the proxy serving HTTPS, [sign in to the tenant console](./2-installing.md#6-sign-in) at its console host. The routing rules in full, their order, and how the repository checks every sample against them are in the [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md).
