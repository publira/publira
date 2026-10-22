---
title: Operating on ECS
description: Add a tenant, keep the consoles' credentials off the tenants' domains, and upgrade an install that runs on Amazon ECS on Fargate.
published: 2026-10-21
updated: 2026-10-22
---

These are the changes made to an install once [Amazon ECS on Fargate](./index.md) and [CloudFront in front of ECS](./1-cloudfront.md) have brought it into service. Their commands use the shell variables and functions those pages defined. In a shell other than the one the install was built in, define again the ones a command names: the variables of [Before you start](./index.md#before-you-start), the `run_publiractl` function of [Apply the migrations and create the database roles](./index.md#4-apply-the-migrations-and-create-the-database-roles), and `LISTENER`, which `aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text` prints.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs its two host names on the edge, as [Adding a tenant](../4-edge/index.md#adding-a-tenant) describes. On ECS that is, before its staff open the console:

1. **Certificates.** Request a certificate naming its domain and its console host in the load balancer's Region and in `us-east-1`, as in [Create the load balancer](./index.md#5-create-the-load-balancer), and validate both.
2. **The load balancer.** Add the first certificate to the listener with `aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`, and two rules: its domain and its console host each in the `2000` band, as in the table there. A load balancer takes 25 certificates besides its listener's default one, and 100 rules, unless you raise those quotas; a rule's host condition takes up to three names, so up to three tenants can share each rule.
3. **CloudFront.** Create a distribution of its own from the `distribution.json` of [The distribution](./1-cloudfront.md#the-distribution), with its two names in `Aliases`, its `us-east-1` certificate in `ViewerCertificate`, and a `CallerReference` of its own. The VPC origin, the function, and the cache policy are the ones the first distribution uses.
4. **DNS.** Point both names at the new distribution's domain name.

Nothing else changes: the services, the parameters, and the security groups serve every tenant alike.

## Keeping the consoles' credentials off the tenants' domains

The load balancer already keeps the consoles' APIs off the internet, but the `publira-server` it forwards the tenants' domains to still serves them, and holds their database logins and the web service token to do so. To take all three out of the process readers reach, a layer apart from the edge rule as [Only the public API goes through the edge](../4-edge/index.md#only-the-public-api-goes-through-the-edge) describes, run a second service with `--role storefront`, and route the tenants' domains to it. The split also lets reader traffic scale apart from the consoles, since each service runs tasks of its own, as [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes.

Its task definition is the `publira-server.json` of [Start the services](./index.md#6-start-the-services) with the family and the container named `publira-storefront`, `["server", "--role", "storefront"]` as its command, and only the secrets that role reads: the encryption keys, `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_REDIS_URL`, and `PUBLIRA_PUBLIC_DB_URL`. Give it a target group of its own, `publira-storefront` on port `8000`, and create its service with the `publira-server` security group and no Cloud Map name, since nothing but the load balancer calls it.

Then add rules ahead of the server's, which send the tenants' domains to it:

| Priority | Host | Path | Forwards to |
| --- | --- | --- | --- |
| `900` to `999` | A tenant's domain | `/images*`, `/rpc/publira.v1.*` | `publira-storefront` |

The console hosts and the web apps keep reaching `publira-server`, which serves every role: `web-admin` calls the public API as well as the console's, through its one `PUBLIRA_GRPC_URL`. The two paths leave room for three host names among the five values a rule takes, so a rule in this band serves the domains of three tenants at most: add a new tenant's domain to a rule that names one, or give it a rule of its own at the next free priority in the band.

The load balancer answers a console API with `404` on every host either way, so check that the tenants' domains reach the new service instead: `aws elbv2 describe-target-health --target-group-arn <the publira-storefront target group ARN>` lists its tasks as `healthy`, and the public API call in [Check the edge](./1-cloudfront.md#check-the-edge) still answers `invalid_argument` on the tenant's domain, now from `publira-storefront`.

## Upgrading

[Upgrading](../8-upgrading.md) brings an install to a new release: a backup, the migrations and the roles with the new release's `publiractl`, and then the processes. Read it, and its release notes, first. On ECS its steps become:

Every step below acts on every service the install runs. List them once, adding `web-platform`, `email-renderer`, and `publira-storefront` if you run them:

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **Stop the services** when you decided to stop them first, which [Decide whether to stop the processes first](../8-upgrading.md#decide-whether-to-stop-the-processes-first) weighs, by setting every one of them to no tasks, after noting how many each one ran:

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **Back up the database** with a snapshot of the RDS instance or the Aurora cluster, or with `pg_dump` from a host that reaches it, as [Back up the database](../8-upgrading.md#1-back-up-the-database) describes.
3. **Apply the migrations and the roles**: change `<tag>` in `publiractl-db-migrate.json` and `publiractl-db-roles.json` to the new release, register both, and run them in that order with `run_publiractl`, going on only when each succeeds. The roles task gives each role the password its parameter holds, which is the one it already has, so it runs unchanged. A release that adds a role needs a parameter for that role's password, a `secrets` entry setting it as a variable, and the flag that names the variable.
4. **Start the new release**: change `<tag>` in every service's task definition, add the variables the release notes name, register them, and update each service to its new revision, and, if you stopped it in step 1, to the number of tasks it ran before, which that step noted in `COUNT`:

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **Check the install**, as [Check the install](../8-upgrading.md#5-check-the-install) describes.

When the services keep running through the upgrade instead, update every service at once after the roles task: ECS replaces the tasks of a service a few at a time, so the two releases serve side by side until the last old task stops, and the shorter that is the better, as the same page explains.
