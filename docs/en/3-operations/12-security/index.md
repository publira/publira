---
title: Securing an install
description: How an install keeps tenants and credentials apart, where each secret may go, and how to report a vulnerability.
published: 2026-10-07
updated: 2026-11-05
---

An install holds the credentials of every tenant's payment provider and mail server, the personal data of every reader, and the keys that seal them. This page is for the operator who keeps them safe: what the install relies on to keep them apart, and where each secret may go. How to replace each secret, what two-step verification and the audit logs give you, and what a web application firewall and rate limits in front of the install should do, are on the pages under [In this section](#in-this-section).

## What keeps data apart

### The database roles

No process connects to PostgreSQL as the [administrative login](../../2-deployments/2-installing.md#provision-the-services) the `publiractl db` commands use. Each part of the install connects as one of six roles that `publiractl db roles` creates, and each role reaches only what that part needs, as [The database roles](../../2-deployments/2-installing.md#the-database-roles) describes. The roles that answer readers and a tenant's staff are bound by row-level security to the tenant a request names, so a defect in those paths cannot read another tenant's rows, and the operators' password hashes and the platform's mail credentials are out of reach of every role but `publira_platform` and the worker role that sends the platform's mail. The tenant console's role reads the address the platform's mail is sent from, and nothing else of the platform's mail settings.

That only holds while each process has the connection URLs of its own roles and no others. Give the administrative login's password to the `publiractl db` commands alone, and never set a process's connection URL to that login or to a role it does not use.

### The console APIs

`publira server` serves the tenant console's and the Platform Console's APIs under `/rpc` beside the public API, on the one port the edge forwards to. They are reachable only where the edge forwards them, and an edge configured as [Routing](../../2-deployments/4-edge/index.md#routing) says forwards them nowhere: `web-admin` and `web-platform` call them over the private network, and the edge answers them with a `404` on every host. Behind that, each of their requests is refused before it runs unless it carries an operator's session or the web service token, the few that run before there is a session — signing in, resetting a password, and confirming an email address — are limited per client or guarded by the server itself, and creating the Platform Console's first operator takes the web service token, which only the Platform Console's server sends. The web service token is therefore what stands between whoever reaches `publira server` and every tenant's catalog and the platform's list of readers: keep it to the processes the table below names.

Running the process the tenants' domains reach as `publira server --role storefront`, as the [Overview](../../2-deployments/1-overview.md#what-an-install-runs) describes, stays worthwhile beside the edge rule. The two are separate layers: the edge keeps the consoles' APIs off the internet, and `--role storefront` keeps the consoles' database logins and the web service token out of the process readers reach, so neither a defect in that process nor an edge that forwards the consoles' paths after all reaches them.

### Where each secret may go

Give each secret only to the processes that read it. A process that does not need a value is one more place it can leak from.

| Secret | Set it on | Never on | What its holder can do |
| --- | --- | --- | --- |
| The secret encryption keys | `publira server`, `publira worker`, `publiractl` | The web apps | Open every credential the install stores, given a copy of the database |
| The access token signing key, `PUBLIRA_AUTH_JWT_SECRET` | `publira server` | Everything else | Sign a session for any reader, member of staff, or operator |
| Each web app's session key, `PUBLIRA_AUTH_SECRET` | That web app | `publira server`, `publira worker` | Read and forge that app's session cookies, which carry the user's access token |
| The cache revalidation token | `publira server`, `publira worker`, and every web app | `publiractl` | Drop any cached page, as often as they like |
| The web service token | `publira server`, `web-admin`, `web-platform` | `web-storefront`, `publira worker` | Read the catalog of any tenant, unpublished series included, and the platform's tenants, operators, and readers |
| The administrative login's password | The `publiractl db` commands | Every long-lived process | Everything in the database |
| Each role's password | The processes that connect as that role | The others | What that role reaches |

The web apps may share one session key, but give each its own, as the Compose file does: then replacing one signs out only that app's users.

### Handing a secret to publiractl

`publiractl` never takes a secret as an argument. Give it one as a file, with the secret's `--<name>-file` flag, wherever the platform can mount secrets as files, as Kubernetes and Docker do under `/run/secrets/`. A file can be made readable by the one user `publiractl` runs as, and kept on a tmpfs. A value in an environment variable is inherited by every process started from the one that holds it, and can be read from `/proc/<pid>/environ`, from `docker inspect` or the orchestrator's description of the task, and from a crash report or debug dump that records the environment.

Use the secret's `--<name>-env` flag only on a platform that sets secrets as environment variables alone, such as [Amazon ECS](../../2-deployments/6-ecs-fargate/index.md).

### One set of secrets per install

Generate a fresh set of every secret for each install: production, staging, and every developer's machine. Two installs that share the access token signing key accept each other's sessions for any account whose ID exists in both, which a staging database restored from a production backup has for every account.

A copy restored from production can read its stored credentials only with production's encryption keys, and with them it holds production's SMTP account, payment provider keys, and every other credential its tenants saved. Run such a copy only where production's own secrets are allowed, and give it its own access token signing key, session keys, tokens, and role passwords.

## Webhooks to your own network

A tenant chooses the URLs its [webhook endpoints](../../4-console/10-api-keys-and-webhooks.md#webhook-endpoints) deliver to, and `publira worker` sends those deliveries from inside your network. So a delivery to a host that resolves to a private, loopback, link-local, or shared address is given up, which keeps a tenant from reaching what you never exposed.

When a publisher's receiver runs on your own network, set `PUBLIRA_WEBHOOK_ALLOWED_ADDRESSES` on the worker to the addresses or CIDR ranges it is on, separated by commas or spaces, such as `10.20.0.15, 10.30.0.0/24`. Any tenant on the install can then deliver to those addresses, so list the receiver alone rather than a whole network, and never the addresses of Publira's own processes, your database, or your cloud provider's metadata service. A range that covers every address, such as `0.0.0.0/0`, is refused, and so is a value that is not an address or a range: either stops the worker at startup.

The setting changes only where a delivery may go. The endpoint's URL is still `https`, and the worker still verifies the receiver's certificate. A receiver whose certificate your own certificate authority issued needs that authority trusted: mount a file of PEM certificates in the worker's container and name it in `SSL_CERT_FILE`, which replaces the system's roots, so include the public roots if any tenant delivers to a public receiver.

## In this section

- [Rotating secrets](./1-rotating-secrets.md): replacing the secret encryption keys, a database role's password, and the signing keys and tokens.
- [Two-step verification](./2-two-step-verification.md): requiring it of tenant staff and of platform operators, and what to do when a second factor is lost.
- [Audit logs](./3-audit-logs.md): what the Platform Console's log and a tenant's log record, and what neither records.
- [A web application firewall](./4-waf.md): the managed rules to turn on in AWS WAF, Cloud Armor, or Cloudflare, the exceptions Publira's uploads and webhooks need, and keeping the consoles to your own networks.
- [Rate limits](./5-rate-limits.md): which requests to limit per client, which never to limit, and how to write the limits as WAF rules or in the proxy you run.

## Reporting a vulnerability

A vulnerability in Publira itself is reported privately, as the [security policy](https://github.com/publira/publira/security/policy) describes, never in a public Issue.
