---
title: Overview
description: What a Publira install runs, and the services it depends on.
published: 2026-10-04
---

A Publira install is made of four long-lived processes, a handful of services they depend on, and one command-line tool you run by hand. This page describes the smallest install that serves a tenant: its public site and its console, managed from `publiractl` rather than from the Platform Console.

## What an install runs

| Process | Serves | Reached by |
| --- | --- | --- |
| `web-host` | The public site of every tenant | The reverse proxy, on every host that is not a console host |
| `web-admin` | The tenant console | The reverse proxy, on each tenant's console host, `admin.<domain>` unless the tenant was given another |
| `publira server` | The public API and image delivery on its edge listener, and the API the web apps call on its internal listener | The reverse proxy, on `/api` and `/images`; `web-host` and `web-admin`, on the internal listener |
| `publira worker` | Outgoing mail and push notifications, cache revalidation, and every scheduled job | Nothing; it only answers health checks |

Every process answers `GET /livez` and `GET /readyz`, so an orchestrator can probe it. The web apps are built from one image and `publira server` and `publira worker` from another; the [image build instructions](https://github.com/publira/publira/blob/main/infra/docker/README.md) list them.

## The services it depends on

| Service | Used by | What it holds |
| --- | --- | --- |
| A reverse proxy | Browsers and the mobile app | The routing that sends each host and path to the right process |
| PostgreSQL | Every process | Everything the install stores |
| Valkey, or any Redis-protocol server | `publira server`, `web-host`, `web-admin` | The image conversion cache, the rate limit counters, and the web apps' shared cache |
| An S3-compatible object store | `publira server`, `publira worker` | Every uploaded image |
| An SMTP server | `publira worker` | Nothing; it delivers the mail the install sends, such as reader sign-up and password reset |

You create the database and the bucket; Publira creates everything inside them. The routing is the same whichever reverse proxy you choose, and the repository ships [sample configurations for Traefik, nginx, and Caddy](https://github.com/publira/publira/blob/main/infra/proxy/README.md).

## The command you run by hand

`publiractl` applies the database migrations and roles on every release, sets a new install up, and changes platform settings afterwards. Nothing has to run it on a timer: `publira worker` schedules every recurring job itself.

## Processes you can add

| Process | What it adds |
| --- | --- |
| `email-renderer` | An HTML part in every mail. Without it, the same mail is sent as plain text |
| `web-platform` | The Platform Console, where an operator manages tenants and platform settings from a browser rather than from `publiractl` |

## Next steps

[Installing](./2-installing.md) brings an empty install into service, step by step. The environment variables each process reads are listed in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md).
