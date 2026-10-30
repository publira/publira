---
title: Rate limits and a WAF
description: Which requests to limit per client in front of an install, which never to limit, and how to write the limits as AWS WAF, Cloud Armor, or Cloudflare rules, or in the proxy you run.
published: 2026-10-30
---

`publira server` limits what it can tell apart: password attempts, the mail it sends, and each reader action, such as posting a comment or using a wait-for-free ticket, as [Rate limits](../9-platform-policies.md#rate-limits) describes. It does not limit anonymous reads. The catalog, the search, and the images answer as fast as a client asks, so one client can fetch every page of every free episode, or run the search until the database falls behind, and the first sign of it is `/readyz` failing. Those requests have to be limited per client in front of it: by a managed WAF or CDN, or by the proxy at the edge.

## What to limit

Limit each reader's address, the one [The client address](../../2-deployments/4-edge/index.md#the-client-address) has the edge record, on a tenant's domain and its image host:

- **The public API**, `/rpc/publira.v1.`, which the mobile app calls.
- **The search**, which runs the most expensive query a reader can ask for: the search procedures of the public API, `/rpc/publira.v1.CatalogService/SearchPublished…`, and the site's search page, `/search` or `/<locale>/search`, which runs the same search on the server. Give it a lower limit than the rest of the API.
- **The images**, `/images`, which every page of an episode is. A reader opening an episode loads all of its pages at once, so allow a burst of several hundred.

Answer a request over the limit with `429 Too Many Requests`. Each limit counts per address, so readers behind one address, such as a carrier's NAT or an office network, share it: set them for the busiest address you expect a legitimate reader to come from, not for one reader.

The console hosts are left to the limits `publira server` keeps: their traffic is your staff's, and the episode uploads and editing screens there are the heaviest an install serves.

## What never to limit

- **The webhooks** under `/api/v1/webhook/`, which [Webhooks](../../2-deployments/4-edge/index.md#webhooks) lists. A provider refused there retries, and a payment is recorded late, or a reader's reply never reaches the console.
- **The health checks**, `GET /readyz` and `GET /livez`, which a load balancer or an orchestrator sends to each process. A health check refused for its rate takes a healthy process out of service.

A bot challenge or a sign-in prompt in front of a path is a limit of its own: neither the mobile app nor a webhook provider can answer one, so keep both off the public API, the images, and the webhooks.

## In a managed WAF or CDN

An install on a cloud platform almost always has a managed load balancer or a CDN in front of it, and that is where the limit belongs. A managed WAF, such as AWS WAF on CloudFront or an Application Load Balancer, Cloud Armor on a Google Cloud load balancer, or Cloudflare's rate limiting rules, counts each reader by the address that connected to it and refuses a request before it reaches anything you run. With the paths above limited there, the proxy behind it needs no limits of its own. Remove them, or [trust the hop](../../2-deployments/4-edge/1-sample-configurations.md#a-hop-in-front-of-the-proxy) first: a proxy that does not trust the hop counts every reader as the hop's address, and refuses all of them together.

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

## In the proxy you run

A proxy you run limits requests when nothing in front of it does. The Traefik and nginx [sample configurations](../../2-deployments/4-edge/1-sample-configurations.md#what-each-sample-does) limit the paths above as they ship, and the Caddy one carries its limits commented out, since they need a module the `caddy` image does not include.

## Distributed denial of service

Protecting an install from a distributed denial of service is the hosting provider's job, not the edge's: a limit per address does nothing against requests from many addresses.
