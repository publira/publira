---
title: Edge
description: What the load balancer, proxy, or CDN in front of an install has to do.
published: 2026-10-06
updated: 2026-10-30
redirect_from:
  - /deployments/reverse-proxy
---

Every request a browser or the mobile app sends to an install reaches it through its edge: whatever terminates TLS and forwards the request to one of the processes. That can be a load balancer your platform manages, an Ingress or a Gateway, a CDN in front of either, a reverse proxy you run yourself, or several of them in a chain. Publira does not depend on which one it is, only on what the edge does with a request.

This page states that in terms of host names, paths, and headers, so that you can configure whatever edge your platform offers from it. [Sample configurations](./1-sample-configurations.md) shows the ones for Traefik, nginx, and Caddy in the repository as one way of doing it.

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
| Anything else                              | The web app the host picked  |

`/images` is every image a page shows, and `/rpc/publira.v1.` the public API the browser and the mobile app call. Nothing else under `/rpc` is forwarded, as [Only the public API goes through the edge](#only-the-public-api-goes-through-the-edge) explains. Everything else belongs to the web apps, `/api` included: they answer their own endpoints under `/api/v1`, the payment and inbound email webhooks among them.

The public API's prefix ends at the dot after `v1`, so that a procedure, `/rpc/publira.v1.<Service>/<Method>`, is all it matches. A match on `/rpc/publira.v1` without the dot would also take a namespace that only starts the same way, such as `publira.v1beta`. An edge that matches the longest prefix first gets the order of the table right without being told it.

`publira server` is on port `8000`, unless `PUBLIRA_PUBLIC_API_ADDR` gives it another address, as the [`publira server` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md) lists. The web apps listen on port `3000` (`web-storefront`), `4000` (`web-admin`), and `4100` (`web-platform`) in the images as the repository builds them, unless you set their `PORT`.

The edge forwards the path as it arrived, and the `Host` header as the browser sent it. Publira's routes carry the `/rpc` and `/images` prefixes, and Publira finds the tenant from the host name, so an edge that strips a prefix or rewrites `Host` reaches no tenant at all.

An edge that checks the health of what it forwards to, as a load balancer does, can probe `GET /readyz` on each process. [Health checks](../../3-operations/11-monitoring.md#health-checks) says what each one checks, and what pointing a load balancer at it means when the database stops answering.

### A tenant's image host

A tenant can be given an image host of its own, with `--image-domain` or **Image host**, as [An image host](../../3-operations/2-tenants.md#an-image-host) describes. Its site's images are then served there rather than on its domain, and `publira server` is the one process that answers the host:

| Host | Path | Process |
| --- | --- | --- |
| A tenant's image host, such as `images.comics.example.com` | Starting with `/images` | `publira server` |
| A tenant's image host | Anything else | None: nothing on it has an answer |

No web app serves an image host, and neither does the public API, so what the edge does with its other paths is yours to decide; the sample configurations answer them with a `404` of their own. `Host` is passed on unchanged here as on every other host, since it is what `publira server` finds the tenant from. The `publira server` an image host reaches serves the storefront: it runs `--role storefront`, or no `--role` at all. One run `--role admin,platform` answers every image there with `404`.

The image host can reach `publira server` through the same edge as the tenant's other host names, or through a load balancer of its own, as [Serving the images and the public API apart](../7-scaling-out.md#serving-the-images-and-the-public-api-apart) describes. Whichever forwards it terminates TLS for it and does with its requests what the rest of this page asks: [The client address](#the-client-address), [The host the request was sent to](#the-host-the-request-was-sent-to), and [Trace context](#trace-context) apply to an image host as they do to a tenant's domain.

### Only the public API goes through the edge

`publira server` serves the tenant console's and the Platform Console's APIs, `publira.admin.v1` and `publira.platform.v1`, under `/rpc` beside the public API, on the one port the edge forwards to. Nothing reaches them through the edge: `web-admin` and `web-platform` call them from their own servers, over the private network on `PUBLIRA_GRPC_URL`, and the mobile app calls the public API alone. No host needs them forwarded, so the edge answers them with a `404` of its own, on the console hosts as on the tenants' domains. An edge that forwards them anyway exposes two APIs to the internet for nothing, along with every call of theirs that runs before there is a session: signing in, resetting a password, confirming an email address, and creating the Platform Console's first operator. Their own authentication, which [The console APIs](../../3-operations/12-security/index.md#the-console-apis) describes, stays in place behind the edge rule.

Running the process the tenants' domains reach with `publira server --role storefront` is a second, separate layer. The edge rule keeps the console APIs' paths off the internet; `--role storefront` keeps the consoles' database logins and the web service token out of the process readers reach at all. Keep sending the console hosts' `/images` to the `publira server` `web-admin` calls on `PUBLIRA_GRPC_URL`, and their `/rpc/publira.v1.` to the one it calls the public API on: the same process, unless `web-admin`'s `PUBLIRA_PUBLIC_GRPC_URL` names a `--role storefront` one, as [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes.

### TLS

The edge terminates TLS for every host name it serves, and needs a certificate for each of them:

- Each tenant's domain, such as `comics.example.com`.
- Each tenant's console host, such as `admin.comics.example.com`.
- The Platform Console's host, if you run it.
- Each tenant's image host, if it has one and this edge serves it.

A wildcard certificate for `*.comics.example.com` covers the console host but not `comics.example.com` itself, and a tenant on a domain of its own needs names of its own: no one certificate covers every tenant. Where the certificates come from is the edge's choice: a load balancer or a CDN that issues and renews them itself, an ACME client such as one built into a proxy, or a certificate issued elsewhere that you install and renew.

Every certificate a public certificate authority issues is published in the Certificate Transparency logs, where anyone can search them by domain, so a console host under a tenant's domain can be found from the site's domain. A console host on a domain of its own, as [A console host on a domain of its own](../../3-operations/2-tenants.md#a-console-host-on-a-domain-of-its-own) recommends, needs a certificate of its own to stay apart: one that also names the site's hosts links the two again.

Send plain HTTP to HTTPS with a redirect, so a reader who types the bare host name still arrives. Behind the hop that terminates TLS, the edge may reach the processes over plain HTTP: `PUBLIRA_TENANT_URL_SCHEME` stays `https`, since it describes the address readers open, not how the edge reaches the processes.

### Adding a tenant

A tenant made with `publiractl tenant create` or in the Platform Console is served as soon as it exists, but its two host names reach it only once the edge is ready for them. Before its staff open the console:

1. **DNS.** Point the tenant's domain and its console host at the edge.
2. **Certificates.** Have the edge serve a certificate for both names.
3. **Routing.** Route its domain to `web-storefront`, and its console host to `web-admin`, as [Routing](#routing) describes.

An edge that sends every host it does not name to `web-storefront` needs only the console host in step 3. The sample configurations name every host, so each of them needs both, given the way [The host lists](./1-sample-configurations.md#the-host-lists) describes.

A tenant given an image host needs the same three steps for it, on whichever edge or load balancer serves it, with `/images` on it routed to `publira server` as [A tenant's image host](#a-tenants-image-host) describes. Take them before you give the tenant its image host: from then on, its site and its app load their images there.

Moving a console host later, with `publiractl tenant update --admin-domain` or in the **Admin domain** field of the Platform Console, follows the same order: add the new name to DNS, the certificates, and the routing before the change, and remove the old one after it. `--admin-domain ""` moves the console back to `admin.<domain>`. Setting, moving, or clearing an image host, with `--image-domain` or **Image host**, does too, and `--image-domain ""` serves the site's images on its domain again.

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

The trusted proxies are `PUBLIRA_TRUSTED_PROXIES` on `publira server` and on `web-storefront`, which finds the reader's address the same way to pass it to a tenant's Google tag gateway; set the same value on both. They are addresses and CIDR ranges, separated by commas or spaces, such as `10.0.0.0/8, 203.0.113.7`. A range that covers every address, such as `0.0.0.0/0`, is refused, since trusting every hop makes the address the caller wrote first the client. Unset, they are the loopback, private, and link-local ranges: `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, and `fe80::/10`. Those cover an edge and web apps that reach `publira server` over a private network. A value that is set replaces those ranges rather than adding to them, so list the private ranges your edge and web apps use alongside anything else. A value that is not an address or a range stops `publira server` at startup, and makes every request to a Google tag gateway on `web-storefront` fail. The same proxies are the only ones whose `host=` of `Forwarded` and `X-Forwarded-Host` `publira server` reads when it finds the tenant an image is requested for.

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

### The reader's region

A tenant that serves its Google tag through the [Google tag gateway](../../4-console/8-google-tag.md#google-tag-gateway) has `web-storefront` forward the tag's requests to Google, and Google places the reader in a region for its regional reports and its region-specific consent defaults by the `X-Forwarded-CountryRegion` header of that request. `web-storefront` sends the one the edge hands it, an ISO 3166-2 code such as `JP-13` or `US-CA`, and none when the edge hands it none, or a value of another shape:

- **The edge removes `X-Forwarded-CountryRegion` from requests from outside.** A caller's value passed on would let any reader be reported in a region of their choosing.
- **An edge that knows the reader's region sets it.** A CDN or a load balancer that looks up the country and region of the address that connected to it can write them into the header in that form, as [CloudFront in front of ECS](../6-ecs-fargate/1-cloudfront.md#the-headers) does. A hop after it passes the header on.

An edge that knows no region only removes the header, and Google then reports the tag's requests through the gateway with no region. Nothing else in Publira reads it.

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

## Rate limits and a WAF

`publira server` limits what it can tell apart: password attempts, the mail it sends, and each reader action, such as posting a comment or using a wait-for-free ticket, as [Rate limits](../../3-operations/9-platform-policies.md#rate-limits) describes. It does not limit anonymous reads. The catalog, the search, and the images answer as fast as a client asks, so one client can fetch every page of every free episode, or run the search until the database falls behind, and the first sign of it is `/readyz` failing. Those requests have to be limited per client at the edge.

### What to limit

Limit each reader's address, the one [The client address](#the-client-address) has the edge record, on a tenant's domain and its image host:

- **The public API**, `/rpc/publira.v1.`, which the mobile app calls.
- **The search**, which runs the most expensive query a reader can ask for: the search procedures of the public API, `/rpc/publira.v1.CatalogService/SearchPublished…`, and the site's search page, `/search` or `/<locale>/search`, which runs the same search on the server. Give it a lower limit than the rest of the API.
- **The images**, `/images`, which every page of an episode is. A reader opening an episode loads all of its pages at once, so allow a burst of several hundred.

Answer a request over the limit with `429 Too Many Requests`. Each limit counts per address, so readers behind one address, such as a carrier's NAT or an office network, share it: set them for the busiest address you expect a legitimate reader to come from, not for one reader.

The console hosts are left to the limits `publira server` keeps: their traffic is your staff's, and the episode uploads and editing screens there are the heaviest an install serves.

### What never to limit

- **The webhooks** under `/api/v1/webhook/`, which [Webhooks](#webhooks) lists. A provider refused there retries, and a payment is recorded late, or a reader's reply never reaches the console.
- **The health checks**, `GET /readyz` and `GET /livez`, which a load balancer or an orchestrator sends to each process. A health check refused for its rate takes a healthy process out of service.

A bot challenge or a sign-in prompt in front of a path is a limit of its own: neither the mobile app nor a webhook provider can answer one, so keep both off the public API, the images, and the webhooks.

### Where the limit goes

An install on a cloud platform almost always has a managed load balancer or a CDN in front of it, and that is where the limit belongs. A managed WAF, such as AWS WAF on CloudFront or an Application Load Balancer, Cloud Armor on a Google Cloud load balancer, or Cloudflare's rate limiting rules, counts each reader by the address that connected to it and refuses a request before it reaches anything you run. With the paths above limited there, the proxy behind it needs no limits of its own. Remove them, or [trust the hop](./1-sample-configurations.md#a-hop-in-front-of-the-proxy) first: a proxy that does not trust the hop counts every reader as the hop's address, and refuses all of them together.

A proxy you run limits requests when nothing in front of it does. The Traefik and nginx [sample configurations](./1-sample-configurations.md#what-each-sample-does) limit the paths above as they ship, and the Caddy one carries its limits commented out, since they need a module the `caddy` image does not include.

### Limits in a managed WAF or CDN

A managed WAF counts a reader's requests over a window, such as 10 seconds or a minute, and refuses the rest of that window once the count is reached. Write one rule per row below, matching its paths on a tenant's domain and image host, so that nothing else is counted, the webhooks and the health checks included. The counts are the most the sample configurations admit from one client in that time:

| Requests | In 10 seconds | In a minute |
| --- | --- | --- |
| The public API, `/rpc/publira.v1.`, except the search | 320 | 1,320 |
| The search procedures, `/rpc/publira.v1.CatalogService/SearchPublished…` | 40 | 140 |
| The search page, `/search` or `/<locale>/search` | 40 | 140 |
| The images, `/images` | 1,200 | 4,200 |

A window admits its whole count at once, so prefer the shortest one your WAF offers.

- **AWS WAF**: a [rate-based rule](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html) per row in the web ACL of the CloudFront distribution or the load balancer, with a scope-down statement matching the host and the path, the source IP address as the aggregation key, and an evaluation window of 60 seconds, its shortest, with the minute's count as the limit. Give its Block action a custom response with the status code `429`; it answers `403` otherwise.
- **Google Cloud Armor**: a [rate limiting rule](https://cloud.google.com/armor/docs/rate-limiting-overview) per row in the security policy of the load balancer's backend services, with the `throttle` action, a match expression on `request.headers['host']` and `request.path`, `IP` as the key, an interval of 10 or 60 seconds with the count for it as the threshold, and `deny(429)` as the action past it. Prefer `throttle` to `rate_based_ban`: a ban keeps refusing a reader for its whole duration, even once they have slowed down.
- **Cloudflare**: a [rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) per row, matching the hostname and the URI path and counting by IP, with a period of 10 seconds or a minute, and the Block action, which answers `429`. The plan sets how many rules a zone has, one on the Free plan, which counts over 10 seconds only, two on Pro, and five on Business; with fewer than four, limit the search first, since it costs the database the most.

Protecting an install from a distributed denial of service is the hosting provider's job, not the edge's: a limit per address does nothing against requests from many addresses.

## In this section

- [Sample configurations](./1-sample-configurations.md): the sample Traefik, nginx, and Caddy configurations in the repository, their backend addresses and host lists, a hop in front of the proxy, and terminating TLS in each.

## Next steps

With the edge serving HTTPS, [sign in to the tenant console](../2-installing.md#6-sign-in) at its console host. To run a proxy of your own rather than configure one your platform manages, start from one of the [sample configurations](./1-sample-configurations.md).
