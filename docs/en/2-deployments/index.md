---
title: Deployments
description: How a Publira install is put together and brought into service.
published: 2026-10-04
updated: 2026-10-13
---

These pages are for the operator who deploys Publira. They describe what an install runs and what it depends on; how those parts are hosted — a Compose file, a Kubernetes cluster, a set of systemd units — is your choice.

## In this section

- [Overview](./1-overview.md): the processes an install runs, the services they depend on, and the processes you can add.
- [Installing](./2-installing.md): bringing an empty install into service, from the services it depends on to the first sign-in to the tenant console.
- [Docker Compose](./3-docker-compose.md): running a whole install on one host with the Compose file in the repository.
- [Edge](./4-edge.md): what the load balancer, proxy, or CDN in front of an install has to do, what to change on it when a tenant is added, and the sample proxy configurations that do it.
- [Kubernetes](./5-kubernetes.md): running an install on a Kubernetes cluster, from its Secrets, Jobs, and Deployments to a Gateway or an Ingress in front of them.
- [Upgrading](./6-upgrading.md): bringing a running install to a new release, and what to do when a migration fails.
- [Backup and restore](./7-backup-and-restore.md): what an install keeps, backing it up, and bringing it back on empty services.
- [Releases](./8-releases.md): what a `0.x` version number tells you, what a minor and a patch release may change, and which releases receive fixes.

Start from [Getting started](../1-getting-started.md) if you have not read what Publira is.
