---
title: Overview
description: What a Publira install runs, and the services it depends on.
published: 2026-10-04
updated: 2026-10-12
---

A Publira install is made of four long-lived processes, a handful of services they depend on, and one command-line tool you run by hand. This page describes the smallest install that serves a tenant: its public site and its console, managed from `publiractl` rather than from the Platform Console.

## What an install runs

| Process | Serves | Reached by |
| --- | --- | --- |
| `web-storefront` | The public site of every tenant | The edge, on each tenant's domain |
| `web-admin` | The tenant console | The edge, on each tenant's console host, `admin.<domain>` unless the tenant was given another |
| `publira server` | The public API and image delivery on its edge listener, and the API the web apps call on its internal listener | The edge, on `/api` and `/images`; `web-storefront` and `web-admin`, on the internal listener |
| `publira worker` | Outgoing mail and push notifications, cache revalidation, and every scheduled job | Nothing; it only answers health checks |

Every process answers `GET /livez` and `GET /readyz`, so an orchestrator can probe it. The web apps are built from one image and `publira server` and `publira worker` from another; the [image build instructions](https://github.com/publira/publira/blob/main/infra/docker/README.md) list them.

An install on one host that will never run more than one copy of the server or the worker can run both as one process: `publira server --with-worker` does everything both processes do, on the same three ports, and reads the variables of both. You give up two things. You can no longer scale the server and the worker separately. And the process that faces the internet also holds the worker's three database logins, among them the one that owns the tables of the job queue and may create tables of its own. Keep the two processes apart unless having one fewer to run matters more to you than that.

You can also go the other way and split `publira server` in two, one process per listener: `publira server --listener edge` serves the public API and image delivery to the reverse proxy, and `publira server --listener internal` serves the API the web apps call. The process that faces the internet then signs in to the database only as the storefront's and the tenant console's logins, both confined to one tenant per request, and holds neither the Platform Console's login nor the credential the web apps call the consoles with. Each process can be scaled and probed on its own, and a platform that exposes one port per service, such as Cloud Run, can run both. The [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes) lists what each one serves and reads.

## The services it depends on

| Service | Used by | What it holds |
| --- | --- | --- |
| The edge: a load balancer, a reverse proxy, or a CDN in front of one | Browsers and the mobile app | The routing that sends each host and path to the right process, and TLS |
| PostgreSQL | Every process | Everything the install stores |
| Valkey, or any Redis-protocol server | `publira server`, `web-storefront`, `web-admin` | The image conversion cache, the rate limit counters, and the web apps' shared cache |
| An S3-compatible object store | `publira server`, `publira worker` | Every uploaded image |
| An SMTP server | `publira worker` | Nothing; it delivers the mail the install sends, such as reader sign-up and password reset |

You create the database and the bucket; Publira creates everything inside them. The edge is whatever your platform offers in front of the processes, such as a managed load balancer or a proxy you run yourself, and [Edge](./4-edge.md#what-the-edge-has-to-do) states what it has to do whichever it is. The repository's sample configurations for Traefik, nginx, and Caddy are one way of doing it.

## The command you run by hand

`publiractl` applies the database migrations and roles on every release, sets a new install up, and changes platform settings afterwards. Nothing has to run it on a timer: `publira worker` schedules every recurring job itself.

## Processes you can add

| Process | What it adds |
| --- | --- |
| `email-renderer` | An HTML part in every mail. Without it, the same mail is sent as plain text |
| `web-platform` | The Platform Console, where an operator manages tenants and platform settings from a browser rather than from `publiractl` |

## Next steps

[Installing](./2-installing.md) brings an empty install into service, step by step. The environment variables each process reads are listed in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md).
