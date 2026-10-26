---
title: Operating on ECS
description: Add a tenant, keep the consoles' credentials off the tenants' domains, serve the images and the public API apart, and upgrade an install that runs on Amazon ECS on Fargate.
published: 2026-10-21
updated: 2026-10-26
---

These are the changes made to an install once [Amazon ECS on Fargate](./index.md) and [CloudFront in front of ECS](./1-cloudfront.md) have brought it into service. Their commands use the shell variables and functions those pages defined. In a shell other than the one the install was built in, define again the ones a command names: the variables of [Before you start](./index.md#before-you-start), the `run_publiractl` function of [Apply the migrations and create the database roles](./index.md#4-apply-the-migrations-and-create-the-database-roles), `SERVER_SG` and `NAMESPACE` and the `registry` function of [Open the network paths](./index.md#3-open-the-network-paths), the `target_group` function of [Create the load balancer](./index.md#5-create-the-load-balancer), the `service` function of [Start the services](./index.md#6-start-the-services), and `LISTENER`, which `aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text` prints.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs its two host names on the edge, as [Adding a tenant](../4-edge/index.md#adding-a-tenant) describes. On ECS that is, before its staff open the console:

1. **Certificates.** Request a certificate naming its domain and its console host in the load balancer's Region and in `us-east-1`, as in [Create the load balancer](./index.md#5-create-the-load-balancer), and validate both.
2. **The load balancer.** Add the first certificate to the listener with `aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`, and two rules: its domain and its console host each in the `2000` band, as in the table there. A load balancer takes 25 certificates besides its listener's default one, and 100 rules, unless you raise those quotas; a rule's host condition takes up to three names, so up to three tenants can share each rule.
3. **CloudFront.** Create a distribution of its own from the `distribution.json` of [The distribution](./1-cloudfront.md#the-distribution), with its two names in `Aliases`, its `us-east-1` certificate in `ViewerCertificate`, and a `CallerReference` of its own. The VPC origin, the function, and the cache policy are the ones the first distribution uses.
4. **DNS.** Point both names at the new distribution's domain name.

Nothing else changes: the services, the parameters, and the security groups serve every tenant alike.

## Keeping the consoles' credentials off the tenants' domains

The load balancer already keeps the consoles' APIs off the internet, but the `publira-server` it forwards the tenants' domains to still serves them, and holds their database logins and the web service token to do so. To take all three out of the process readers reach, a layer apart from the edge rule as [Only the public API goes through the edge](../4-edge/index.md#only-the-public-api-goes-through-the-edge) describes, run a second service with `--role storefront`, and route the tenants' domains and `web-storefront` to it. The split also lets reader traffic scale apart from the consoles, since each service runs tasks of its own, as [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes.

Its task definition is the `publira-server.json` of [Start the services](./index.md#6-start-the-services) with the family and the container named `publira-storefront`, `["server", "--role", "storefront"]` as its command, and only the secrets that role reads: the encryption keys, `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_REDIS_URL`, and `PUBLIRA_PUBLIC_DB_URL`. Register it, and give it a target group of its own and a Cloud Map name, since `web-storefront` calls it as well as the load balancer:

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

Then add rules ahead of the server's, which send the tenants' domains to it:

| Priority | Host | Path | Forwards to |
| --- | --- | --- | --- |
| `900` to `999` | A tenant's domain | `/images*`, `/rpc/publira.v1.*` | `publira-storefront` |

The two paths leave room for three host names among the five values a rule takes, so a rule in this band serves the domains of three tenants at most: add a new tenant's domain to a rule that names one, or give it a rule of its own at the next free priority in the band.

A rule is what attaches a target group to a load balancer, and ECS refuses to create a service whose target group has none, so the rules come before the service. Until the service's tasks are up, though, the new target group has nothing to answer with, so create each rule still forwarding to `publira-server`, with `publira-storefront` beside it at a weight of `0`. Then create the service with the `publira-server` security group, which already admits the web apps, and once its tasks are healthy, forward the rule to it alone:

```bash
RULE_900=$(aws elbv2 create-rule --listener-arn "$LISTENER" --priority 900 \
  --conditions "[$(host_is comics.example.com),$(path_is '["/images*","/rpc/publira.v1.*"]')]" \
  --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$SERVER_TG,Weight=1},{TargetGroupArn=$STOREFRONT_SERVER_TG,Weight=0}]}" \
  --query 'Rules[0].RuleArn' --output text)
service publira-storefront "$SERVER_SG" 8000 "$STOREFRONT_SERVER_TG"
aws ecs wait services-stable --cluster publira --services publira-storefront
aws elbv2 modify-rule --rule-arn "$RULE_900" \
  --actions "Type=forward,TargetGroupArn=$STOREFRONT_SERVER_TG" > /dev/null
```

`host_is` and `path_is` are the functions of [Create the load balancer](./index.md#5-create-the-load-balancer), and `SERVER_TG` is the target group created there; in another shell, `aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text` prints it. A rule added to the band once the service runs forwards to `publira-storefront` alone, with that page's `rule` function.

Point `web-storefront` at the new service too, since it calls the public API alone: set `PUBLIRA_GRPC_URL` in `web-storefront.json` to `http://publira-storefront.publira.internal:8000/rpc`, register it, and update the `web-storefront` service to the new revision. The console hosts, `web-admin`, and `web-platform` keep reaching `publira-server`, which serves every role, until [Leaving the public API off the consoles' server](#leaving-the-public-api-off-the-consoles-server) takes the public API off it.

The load balancer answers a console API with `404` on every host either way, so check that the tenants' domains reach the new service instead: `aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"` lists its tasks as `healthy`, and the public API call in [Check the edge](./1-cloudfront.md#check-the-edge) still answers `invalid_argument` on the tenant's domain, now from `publira-storefront`.

### Leaving the public API off the consoles' server

`publira-server` still serves the public API and holds `publira_public`, because `web-admin` calls the public API for the tenant's theme and tags, and the rule at `1000` forwards the console hosts' public API there. Send both to `publira-storefront`, and `publira-server` can run `--role admin,platform`, as step 4 of [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes. Make the changes in this order, so that nothing still sends `publira-server` a public API request when it stops serving them.

First point `web-admin`'s public API calls at the storefront service. Add the variable to the `environment` of `web-admin.json`, beside `PUBLIRA_GRPC_URL`, which keeps naming `publira-server`:

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

and deploy it:

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

Its `/readyz` now checks that service as well, as `public-api`.

Then route every host's public API to `publira-storefront`, which answers it on any host, and keep the console hosts' `/images` on `publira-server`, since the images a console page shows are the `admin` role's. Add a rule for the public API after the one at `1000`, and then take the public API out of that one, so that it reaches `publira-server` no more:

| Priority | Host | Path                | Forwards to          |
| -------- | ---- | ------------------- | -------------------- |
| `1000`   | Any  | `/images*`          | `publira-server`     |
| `1050`   | Any  | `/rpc/publira.v1.*` | `publira-storefront` |

```bash
rule 1050 "[$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
RULE_1000=$(aws elbv2 describe-rules --listener-arn "$LISTENER" \
  --query "Rules[?Priority=='1000'].RuleArn" --output text)
aws elbv2 modify-rule --rule-arn "$RULE_1000" \
  --conditions "[$(path_is '["/images*"]')]" > /dev/null
```

`rule` and `path_is` are the functions of [Create the load balancer](./index.md#5-create-the-load-balancer), and `STOREFRONT_SERVER_TG` is the target group created above; in another shell, `aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text` prints it. The rules in the `900` band keep forwarding the tenants' domains to `publira-storefront`, the public API included.

Last, give `publira-server.json` `["server", "--role", "admin,platform"]` as its container's `command`, remove `PUBLIRA_PUBLIC_DB_URL` from its `secrets`, since the process no longer reads it, and deploy it:

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

Sign in to the tenant console: it draws the tenant's theme and lists the tags as before, now read from `publira-storefront`. The public API call in [Check the edge](./1-cloudfront.md#check-the-edge), sent to the console host, `https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`, still answers `invalid_argument`; a `404` there means the console host's public API still reaches `publira-server`.

## Serving the images and the public API apart

The tenants' images and the public API can be reached on host names of their own, each through a load balancer of its own, as [Serving the images and the public API apart](../7-scaling-out.md#serving-the-images-and-the-public-api-apart) describes. On ECS the images get a second internal load balancer and a CloudFront distribution in front of a service of their own, and the public API a host name on the load balancer you have, in front of `publira-storefront`. This builds on [Keeping the consoles' credentials off the tenants' domains](#keeping-the-consoles-credentials-off-the-tenants-domains), which created `publira-storefront`. The names below are examples: `images.comics.example.com` for the tenant's image host, and `api.example.com` for the public API's.

### The images

Run the images on a service of their own, so that their traffic scales apart from the API's. Its task definition is `publira-storefront.json` with the family and the container named `publira-images`, in `publira-images.json`: the two serve the same role, and read the same secrets. Register it, and give it a target group and a Cloud Map name, which the `service` function registers it under:

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

Request a certificate naming the image hosts, in the load balancer's Region and in `us-east-1`, as in [Create the load balancer](./index.md#5-create-the-load-balancer), and validate it. Then create a second internal load balancer with the first load balancer's security group, which CloudFront's VPC origins and the `publira-server` security group already admit, and an HTTPS listener whose one rule forwards `/images` to the new service and answers everything else with a `404`:

```bash
IMAGES_ALB=$(aws elbv2 create-load-balancer --name publira-images --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
IMAGES_LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$IMAGES_ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the image hosts' certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 create-rule --listener-arn "$IMAGES_LISTENER" --priority 1000 \
  --conditions "[$(path_is '["/images*"]')]" \
  --actions "Type=forward,TargetGroupArn=$IMAGES_TG" > /dev/null
```

The rule is what attaches the target group to a load balancer, and ECS refuses a service whose target group has none, so create the service only now:

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

Put CloudFront in front of it the way [CloudFront in front of ECS](./1-cloudfront.md) put it in front of the first: a VPC origin for `$IMAGES_ALB`, created as in [The VPC origin](./1-cloudfront.md#the-vpc-origin), and a distribution from the `distribution.json` of [The distribution](./1-cloudfront.md#the-distribution) with the image hosts in `Aliases`, their `us-east-1` certificate in `ViewerCertificate`, the new load balancer's DNS name and the new VPC origin's ID in `Origins`, and a `CallerReference` of its own. The function and the `publira-images` cache policy are the ones the first distribution uses, and its `/images*` behaviour caches the images as it does there. `publira-images.json` carries the `PUBLIRA_TRUSTED_PROXIES` of [The client address](./1-cloudfront.md#the-client-address), which covers this distribution and this load balancer as well.

Once the distribution is deployed, point each image host at its domain name, and give the image host to the tenant, with **Image host** in the Platform Console or `publiractl tenant update --image-domain`, as [An image host](../../3-operations/2-tenants.md#an-image-host) describes. A tenant added later needs its image host in a certificate on the new listener, added with `aws elbv2 add-listener-certificates`, and in the `Aliases` of the new distribution, or of one of its own.

### The public API

Give the public API a host name of its own on the load balancer you have. Request a certificate for `api.example.com` in both Regions, add the one in the load balancer's Region to its listener, and add a rule in the `900` band that forwards the public API on that host to `publira-storefront`:

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

Take a priority in the band that no rule holds yet. Every other path on the host gets the listener's `404`, except `/images`, which the rule at `1000` sends to `publira-server` on every host, and which answers `404` there too, since the host belongs to no tenant. Then create a distribution for it from `distribution.json`, with `api.example.com` in `Aliases`, its `us-east-1` certificate in `ViewerCertificate`, and a `CallerReference` of its own, and point `api.example.com` at the distribution's domain name.

The web apps already call `publira-storefront` over the VPC, `web-storefront` on `PUBLIRA_GRPC_URL` and `web-admin` on `PUBLIRA_PUBLIC_GRPC_URL` once [Leaving the public API off the consoles' server](#leaving-the-public-api-off-the-consoles-server) is done, which skips both load balancers; a web app that runs outside the VPC names `https://api.example.com/rpc` instead. Build a tenant's mobile app with `PUBLIRA_BASE_URL=https://api.example.com`, once the tenant has an image host, as [The address the app connects to](../../5-mobile-app/2-building.md#the-address-the-app-connects-to) describes. The tenants' domains keep their rules as they are, so an app built against a tenant's domain keeps working.

### Check the split

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

The first answers `404`: an image host serves nothing but images. The second reaches `publira-storefront`, which refuses the empty request with `invalid_argument`. The third answers `404` too: the API's host serves no images. Then open the tenant's site: its images load from `https://images.comics.example.com/images/…`.

## Upgrading

[Upgrading](../8-upgrading.md) brings an install to a new release: a backup, the migrations and the roles with the new release's `publiractl`, and then the processes. Read it, and its release notes, first. On ECS its steps become:

Every step below acts on every service the install runs. List them once, adding `web-platform`, `email-renderer`, `publira-storefront`, and `publira-images` if you run them:

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

When the services keep running through the upgrade instead, step 4 replaces them in the order [Replace the processes](../8-upgrading.md#4-replace-the-processes) gives. Update `email-renderer` first if you run it, and then run the loop of step 4 with `SERVICES` naming the other services, which ECS replaces a few tasks at a time while the install keeps serving.
