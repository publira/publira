---
title: Deployments
description: How a Publira install is put together and brought into service.
published: 2026-10-04
updated: 2026-10-22
---

These pages are for the operator who deploys Publira. They describe what an install runs and what it depends on; how those parts are hosted — a Compose file, a Kubernetes cluster, a set of systemd units — is your choice.

## In this section

- [Overview](./1-overview.md): the processes an install runs, the services they depend on, and the processes you can add.
- [Installing](./2-installing.md): bringing an empty install into service, from the services it depends on to the first sign-in to the tenant console.
- [Docker Compose](./3-docker-compose.md): running a whole install on one host with the Compose file in the repository.
- [Edge](./4-edge/index.md): what the load balancer, proxy, or CDN in front of an install has to do, and what to change on it when a tenant is added.
  - [Sample configurations](./4-edge/1-sample-configurations.md): the sample Traefik, nginx, and Caddy configurations in the repository that do it, and how to adapt one to an install.
- [Kubernetes](./5-kubernetes/index.md): running an install on a Kubernetes cluster, from its Secrets, Jobs, and Deployments to the first sign-in.
  - [The edge on Kubernetes](./5-kubernetes/1-edge.md): a Gateway or an Ingress in front of the Services, with cert-manager issuing the certificates.
  - [Operating on Kubernetes](./5-kubernetes/2-operating.md): adding a tenant, keeping the consoles' credentials off the tenants' domains, metrics, and upgrading.
- [Amazon ECS on Fargate](./6-ecs-fargate/index.md): running an install as ECS services on Fargate, from its parameters, one-off tasks, and services behind an Application Load Balancer to the first sign-in.
  - [CloudFront in front of ECS](./6-ecs-fargate/1-cloudfront.md): CloudFront in front of the load balancer, as a VPC origin.
  - [Operating on ECS](./6-ecs-fargate/2-operating.md): adding a tenant, keeping the consoles' credentials off the tenants' domains, and upgrading.
- [Scaling out](./7-scaling-out.md): running several copies of each process, splitting `publira server` by the traffic it answers, and what the copies share.
- [Upgrading](./8-upgrading.md): bringing a running install to a new release, and what to do when a migration fails.
- [Backup and restore](./9-backup-and-restore.md): what an install keeps, backing it up, and bringing it back on empty services.
- [Releases](./10-releases.md): what a `0.x` version number tells you, what a minor and a patch release may change, and which releases receive fixes.

Start from [Getting started](../1-getting-started.md) if you have not read what Publira is.
