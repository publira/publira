---
title: Deployments
description: How a Publira install is put together and brought into service.
published: 2026-10-04
updated: 2026-10-06
---

These pages are for the operator who deploys Publira. They describe what an install runs and what it depends on; how those parts are hosted — a Compose file, a Kubernetes cluster, a set of systemd units — is your choice.

## In this section

- [Overview](./1-overview.md): the processes an install runs, the services they depend on, and the processes you can add.
- [Installing](./2-installing.md): bringing an empty install into service, from the services it depends on to the first sign-in to the tenant console.
- [Docker Compose](./3-docker-compose.md): running a whole install on one host with the Compose file in the repository.
- [Reverse proxy](./4-reverse-proxy.md): putting a proxy with TLS in front of an install, and what to change on it when a tenant is added.
- [Upgrading](./5-upgrading.md): bringing a running install to a new release, and what to do when a migration fails.
- [Backup and restore](./6-backup-and-restore.md): what an install keeps, backing it up, and bringing it back on empty services.

Start from [Getting started](../1-getting-started.md) if you have not read what Publira is.
