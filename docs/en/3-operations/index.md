---
title: Operations
description: Running a Publira install day to day, from adding tenants and managing who signs in to configuring the services it depends on.
published: 2026-10-06
---

These pages are for the operator of an install that is already serving, as [Deployments](../2-deployments/index.md) left it. They cover the work that comes after the first tenant: adding more, managing who signs in to each console, keeping the platform's own accounts in order, and changing the services `publiractl setup` configured.

Most of this work can be done from either the `publiractl` command line or the Platform Console. The first page says how to choose, and each later page gives both ways where both exist.

## In this section

- [The Platform Console and publiractl](./1-platform-console.md): choosing between the two, creating the first operator, and the operators who sign in to the Platform Console.
- [Tenants](./2-tenants.md): creating a tenant, its domain and console host, changing them, and suspending a tenant.
- [A tenant's staff](./3-tenant-staff.md): the people who sign in to a tenant's console, their roles, invitations, and recovering a tenant that lost its last administrator.
- [Users](./4-users.md): the readers of every tenant, and what an operator can do about their accounts.
- [Object storage](./5-object-storage.md): the bucket every image is kept in, its credential, and how images are converted, cached, and delivered under `/images`.
- [Email](./6-email.md): the platform's SMTP account and a tenant's own, the mail the install sends, HTML mail, and where the links in a mail lead.
- [Search](./7-search.md): the storefront search engine, moving from the database to OpenSearch or Elasticsearch, text analysis, and rebuilding the index.
- [Web Push](./8-web-push.md): turning on browser notifications, and the key pair they are signed with.

Start from [Getting started](../1-getting-started.md) if you have not read what Publira is.
