---
title: Cloud Run
description: Run an install on Google Cloud Run behind a global external Application Load Balancer, against Cloud SQL, Memorystore, and Cloud Storage.
published: 2026-10-13
---

This page takes an install on Google Cloud from a project whose managed services are provisioned to the first sign-in to the tenant console. Every process runs on Cloud Run, and a global external Application Load Balancer is the edge in front of them. The services the install depends on are Cloud SQL for PostgreSQL, Memorystore, Cloud Storage, and an SMTP relay of your choice.

It covers what is particular to Cloud Run, in Google Cloud's own terms. Why each step exists, what every secret protects, and what each database role can reach are in [Installing](./2-installing.md), which this page follows step by step. The full list of variables each process reads is in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables). The `gcloud` commands here show one way of configuring each part, not a script to run as it stands: replace the names, the region, and the addresses with your own, and keep them in whatever you manage your infrastructure with.

## How the install maps onto Cloud Run

Each process runs as a Cloud Run resource of its own, and `publira server` runs twice:

| Resource | Kind | Image and arguments | Port | Ingress | CPU and instances |
| --- | --- | --- | --- | --- | --- |
| `publira-server-storefront` | Service | `ghcr.io/publira/publira:<tag>`, `server --role storefront` | `8000` | Internal and Cloud Load Balancing | Request-based billing |
| `publira-server` | Service | `ghcr.io/publira/publira:<tag>`, no arguments | `8000` | Internal and Cloud Load Balancing | Request-based billing |
| `web-storefront` | Service | `ghcr.io/publira/web-storefront:<tag>` | `3000` | Internal and Cloud Load Balancing | Instance-based billing, one instance kept running |
| `web-admin` | Service | `ghcr.io/publira/web-admin:<tag>` | `4000` | Internal and Cloud Load Balancing | Instance-based billing, one instance kept running |
| `publira-worker` | Worker pool | `ghcr.io/publira/publira:<tag>`, `worker` | None | None | Always running, one instance or more |
| `email-renderer`, optional | Service | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Internal | Request-based billing |
| `web-platform`, optional | Service | `ghcr.io/publira/web-platform:<tag>` | `4100` | Internal and Cloud Load Balancing | Instance-based billing, one instance kept running |
| `publiractl-migrate`, `publiractl-roles`, `publiractl-setup` | Jobs | `ghcr.io/publira/publiractl:<tag>`, the command | None | None | Run by hand |

A Cloud Run service exposes one port, and every process listens on one. `publira-server-storefront` answers the `/api` and `/images` of the tenants' domains: it serves the public API and the images of tenants' sites alone, and holds only the `publira_public` login. `publira-server` serves every role. The web apps call it, and the load balancer sends it the console hosts' `/api` and `/images`. The [Overview](./1-overview.md#what-an-install-runs) explains the split. An install that does without it runs `publira-server` alone and sends every host's `/api` and `/images` there.

Cloud Run deploys the public images from `ghcr.io` as they are published, so nothing has to be copied into Artifact Registry. Run every resource from the images of the same release.

### CPU outside a request

Under request-based billing, Cloud Run gives an instance CPU only while it is handling a request, and scales a service that receives none down to zero. Three of the processes work outside a request:

- **`publira worker`** serves nothing but its health checks. It drains the Outbox, which sends the mail, the push notifications, and the cache revalidations, and it runs every scheduled job. A worker pool keeps its instances running whether or not anything calls them, which is what the worker needs. More than one instance is fine: every scheduled job is unique while a run of it is in flight, so a second instance starts no second copy, and the Outbox drain shares its rows between them.
- **The web apps** regenerate a stale cached page after they have answered with the stale one. Give them instance-based billing (`--no-cpu-throttling`), so the regeneration has CPU once the response has gone: Cloud Run keeps an idle instance for a while before it shuts it down, which is long enough for a regeneration to finish. Keep one instance running as well (`--min-instances=1`), so the first reader after a quiet spell does not wait for an instance to start.
- **`publira server`** tries to drop the web apps' caches straight after a write, without making the response wait. Under request-based billing that attempt can be held until the next request, and the worker sends whatever it does not finish, so the server can stay on request-based billing. Give it instance-based billing as well if a change should reach the cached pages in seconds even when traffic is quiet.

### Database connections

Each instance of `publira-server` opens up to 30 connections, 10 per login, and each instance of `publira-server-storefront` up to 10. Each instance of the worker opens up to 30 as well. Cloud Run adds instances as traffic grows, so cap each service with `--max-instances`, and size the Cloud SQL instance's `max_connections` for the sum of every cap. [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) has the arithmetic.

## Before you start

You need:

- **A Google Cloud project** with the Cloud Run, Compute Engine, Certificate Manager, Secret Manager, Cloud SQL Admin, and Memorystore APIs turned on, and `gcloud` signed in to it.
- **A VPC network with a subnet in the region** you run Cloud Run in, `publira-run` on this page, with **Private Google Access** turned on. Every Cloud Run resource sends all its traffic into that subnet with Direct VPC egress, which is how the services reach Cloud SQL, Memorystore, and each other's internal URLs. Give the subnet a **Cloud NAT** gateway as well: the processes also call out to the internet, to the SMTP relay, payment providers, and push services, and with all traffic routed through the VPC, Cloud NAT is their way out.
- **A Cloud SQL for PostgreSQL instance** with a private IP address on that network, and an empty database on it, such as `publira`. The `postgres` user is the superuser connection that only the `db migrate` and `db roles` jobs use.
- **A Memorystore instance**: Memorystore for Valkey with cluster mode disabled, or Memorystore for Redis. Publira's clients connect to one node, not to a cluster.
- **An empty Cloud Storage bucket**, a service account that can read and write it, and an HMAC key for that service account. Publira reaches the bucket through Cloud Storage's S3-compatible XML API, which signs requests with an HMAC key rather than with the service account's own credentials.
- **An SMTP relay**: its host, port, encryption, the address mail is sent from, and its user name and password. Google Cloud blocks outbound connections to port 25, so use the relay's submission port, `587` or `465`.
- **A global static IP address** for the load balancer, and **DNS** for the tenant's domain and `admin.<domain>` pointing at it:

```bash
gcloud compute addresses create publira-lb --global
gcloud compute addresses describe publira-lb --global --format='value(address)'
```

Give each Cloud Run resource a service account of its own, and grant each one `roles/secretmanager.secretAccessor` on the secrets it is given below and nothing else.

## Secrets

Generate every secret [Installing](./2-installing.md#generate-the-secrets) lists, and keep each one in Secret Manager. A connection URL carries its role's password, so keep each process's connection URLs there too, whole, beside the bare passwords the `db roles` job reads:

| Secret | Holds | Given to |
| --- | --- | --- |
| `publira-secret-encryption-keys` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `publira-server`, `publira-server-storefront`, `publira-worker`, `publiractl-setup` |
| `publira-auth-jwt-secret` | `PUBLIRA_AUTH_JWT_SECRET` | `publira-server`, `publira-server-storefront` |
| `publira-revalidate-token` | The cache revalidation token | `publira-server`, `publira-server-storefront`, `publira-worker` as `PUBLIRA_REVALIDATE_TOKEN`; the web apps as `PNCH_REVALIDATE_TOKEN` |
| `publira-web-service-token` | `PUBLIRA_WEB_SERVICE_TOKEN` | `publira-server`, `web-admin`, `web-platform` |
| `web-storefront-auth-secret`, `web-admin-auth-secret` | Each web app's `PUBLIRA_AUTH_SECRET` | The web app it belongs to |
| `publira-redis-url` | The Memorystore URL | `publira-server`, `publira-server-storefront` as `PUBLIRA_REDIS_URL`; the web apps as `PNCH_REDIS_URL` |
| `publira-<role>-db-password`, one per role | The role's password | `publiractl-roles` |
| `publira-<role>-db-url`, one per role | The role's connection URL | The resources that connect as the role, as the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process) lists |
| `publira-superuser-db-url` | `PUBLIRA_DB_URL`, the `postgres` connection | `publiractl-migrate`, `publiractl-roles` |
| `publira-storage-secret`, `publira-smtp-password`, `publira-admin-password` | The HMAC key's secret, the SMTP password, and the first administrator's password | `publiractl-setup` |

`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` is not a secret, and is set as a plain variable beside the keys. `publira-server-storefront` takes neither the web service token nor the `publira_admin` and `publira_platform` URLs: it never reads them, so it is never given them.

A secret given as an environment variable is read when an instance starts, so a new version reaches only the instances started after it: deploy a new revision to replace the running ones. A role's password is in two secrets, the bare password and the connection URL, so rotate both together, as [Rotating a database role's password](../3-operations/12-security.md#rotating-a-database-roles-password) describes for the rest of the procedure.

### Connection URLs

Each `*_DB_URL` names Cloud SQL's private IP address, such as `postgres://publira_public:<password>@10.20.0.3:5432/publira?sslmode=require`. `sslmode=require` encrypts the connection. To verify the server as well, keep the instance's server CA certificate in Secret Manager, mount it as a file, and connect with `sslmode=verify-ca&sslrootcert=<path>`: the instance's certificate is issued by a CA of its own, so verifying the CA verifies the instance.

The Memorystore URL names the instance's endpoint, such as `redis://10.20.0.10:6379` for an instance without authentication or in-transit encryption, which is then reached from your VPC alone. When the instance requires a password, the URL has to use `rediss://`, with TLS, since `publira server` and the web apps refuse a `redis://` URL that carries one. Memorystore signs its certificate with a CA of the instance rather than with one the images trust, so mount that CA as a file and point the processes at it: `SSL_CERT_DIR=<directory of the CA>:/etc/ssl/certs` on `publira-server` and `publira-server-storefront`, and `NODE_EXTRA_CA_CERTS=<path of the CA>` on the web apps. Memorystore's IAM authentication cannot be used, since it takes a token that expires within hours where Publira sends the fixed password in its URL.

Cloud Run mounts no two secrets at the same path, so give each mounted secret a directory of its own, such as `/run/secrets/redis-ca/ca.pem`.

## The calls between services

Three kinds of call go from one Cloud Run resource to another rather than through the load balancer:

| Caller | Calls | At | What it presents |
| --- | --- | --- | --- |
| The web apps | `publira-server` | `PUBLIRA_GRPC_URL`, such as `https://publira-server-<project-number>.<region>.run.app/api` | The reader's or the staff member's session, or the web service token |
| `publira-server`, `publira-server-storefront`, `publira-worker` | The web apps | `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, and `PUBLIRA_WEB_PLATFORM_INTERNAL_URL`, each web app's `run.app` URL | The cache revalidation token |
| `publira-worker` | `email-renderer` | `PUBLIRA_EMAIL_RENDERER_URL`, its `run.app` URL | Nothing |

Cloud Run's invoker check refuses a call to another service that carries no Google ID token, and Publira's clients send none. Turn the invoker check off on every service, with `--no-invoker-iam-check`, and keep the services off the internet with their ingress settings instead:

- **The services the load balancer forwards to** take `--ingress=internal-and-cloud-load-balancing`. Their `run.app` URLs refuse a request from the internet, and answer the load balancer and the resources in your VPC. Each call above still carries the credential the process checks itself, as the table says.
- **`email-renderer`** takes `--ingress=internal`, since nothing but the worker calls it, and it checks no credential of its own.
- **Every caller** sends all its traffic into the VPC with Direct VPC egress, `--vpc-egress=all-traffic`, on the subnet with Private Google Access. Only then does Cloud Run treat its call to a `run.app` URL as internal. With `private-ranges-only`, the call leaves through the internet, and the ingress setting refuses it.

The load balancer sends no ID token either, which is the other reason the invoker check stays off on the services behind it. An organization policy that enforces `constraints/run.managed.requireInvokerIam` refuses `--no-invoker-iam-check`, and the services cannot be deployed this way under it.

## Bring the install up

### 1. Apply the migrations and create the roles

Create the two jobs from the release's `publiractl` image, on the same subnet, and run them in order, waiting for each:

```bash
gcloud run jobs deploy publiractl-migrate \
  --region=us-central1 --image=ghcr.io/publira/publiractl:<tag> --args=db,migrate \
  --network=publira --subnet=publira-run --vpc-egress=all-traffic \
  --service-account=publiractl@<project>.iam.gserviceaccount.com \
  --set-secrets=PUBLIRA_DB_URL=publira-superuser-db-url:latest

gcloud run jobs deploy publiractl-roles \
  --region=us-central1 --image=ghcr.io/publira/publiractl:<tag> \
  --args=db,roles,--public-password-file,/run/secrets/public/password,--admin-password-file,/run/secrets/admin/password,--platform-password-file,/run/secrets/platform/password,--outbox-password-file,/run/secrets/outbox/password,--ticker-password-file,/run/secrets/ticker/password,--content-stats-password-file,/run/secrets/content-stats/password \
  --network=publira --subnet=publira-run --vpc-egress=all-traffic \
  --service-account=publiractl@<project>.iam.gserviceaccount.com \
  --set-secrets=PUBLIRA_DB_URL=publira-superuser-db-url:latest,/run/secrets/public/password=publira-public-db-password:latest,/run/secrets/admin/password=publira-admin-db-password:latest,/run/secrets/platform/password=publira-platform-db-password:latest,/run/secrets/outbox/password=publira-outbox-db-password:latest,/run/secrets/ticker/password=publira-ticker-db-password:latest,/run/secrets/content-stats/password=publira-content-stats-db-password:latest

gcloud run jobs execute publiractl-migrate --region=us-central1 --wait
gcloud run jobs execute publiractl-roles --region=us-central1 --wait
```

`--wait` returns once the execution has finished, and fails when it failed; its log is in Cloud Logging under the job's name. The [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db) has every flag of both commands.

### 2. Deploy the services

Every service takes the same network, ingress, and invoker settings. `publira-server`, for instance:

```bash
gcloud run deploy publira-server \
  --region=us-central1 --image=ghcr.io/publira/publira:<tag> --port=8000 \
  --ingress=internal-and-cloud-load-balancing --no-invoker-iam-check \
  --network=publira --subnet=publira-run --vpc-egress=all-traffic \
  --service-account=publira-server@<project>.iam.gserviceaccount.com \
  --max-instances=4 \
  --startup-probe=httpGet.path=/livez,httpGet.port=8000 \
  --liveness-probe=httpGet.path=/livez,httpGet.port=8000 \
  --env-vars-file=publira-server.env.yaml \
  --set-secrets=PUBLIRA_PUBLIC_DB_URL=publira-public-db-url:latest,PUBLIRA_ADMIN_DB_URL=publira-admin-db-url:latest,PUBLIRA_PLATFORM_DB_URL=publira-platform-db-url:latest,PUBLIRA_REDIS_URL=publira-redis-url:latest,PUBLIRA_SECRET_ENCRYPTION_KEYS=publira-secret-encryption-keys:latest,PUBLIRA_AUTH_JWT_SECRET=publira-auth-jwt-secret:latest,PUBLIRA_REVALIDATE_TOKEN=publira-revalidate-token:latest,PUBLIRA_WEB_SERVICE_TOKEN=publira-web-service-token:latest
```

with the plain variables in `publira-server.env.yaml`:

```yaml
PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID: k1
PUBLIRA_WEB_STOREFRONT_INTERNAL_URL: https://web-storefront-<project-number>.us-central1.run.app
PUBLIRA_WEB_ADMIN_INTERNAL_URL: https://web-admin-<project-number>.us-central1.run.app
PUBLIRA_FORWARDED_HEADER_ENABLED: "false"
PUBLIRA_TRUSTED_PROXIES: "127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, fc00::/7, fe80::/10, <load balancer address>"
AWS_REQUEST_CHECKSUM_CALCULATION: when_required
AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
```

A service's `run.app` URL is `https://<service>-<project-number>.<region>.run.app`, so the URLs of the web apps are known before they are deployed. [The client address](#the-client-address) explains the last two `PUBLIRA_` variables. The two `AWS_` variables are read by the AWS SDK the processes reach the bucket with: they keep it from adding the checksum headers it sends by default, which Cloud Storage does not document support for, so give them to the worker and the `publiractl` jobs too.

The other services differ in what the table at the top of this page and the deployment reference say:

- **`publira-server-storefront`**: the same command with `--args=server,--role,storefront`, without the web service token and the `publira_admin` and `publira_platform` URLs.
- **`web-storefront`** and **`web-admin`**: `--port=3000` and `--port=4000`, `--no-cpu-throttling --min-instances=1`, and the probes on that port. Each takes `PUBLIRA_GRPC_URL` with `publira-server`'s `run.app` URL followed by `/api`, its `PUBLIRA_AUTH_SECRET`, `PNCH_REDIS_URL`, `PNCH_REVALIDATE_TOKEN`, and `PUBLIRA_FORWARDED_HEADER_ENABLED=false`; `web-admin` also takes `PUBLIRA_WEB_SERVICE_TOKEN`. Keep each one's request timeout at 300 seconds or more, the default: the tenant console's page upload takes that long to arrive over a slow uplink.

Cloud Run admits a request body of 32 MiB at most to a process that speaks HTTP/1, as the web apps do. On Cloud Run, the tenant console's page upload therefore takes a ZIP of up to 32 MiB rather than the 256 MiB [Edge](./4-edge.md#uploads-in-the-tenant-console) states, and a larger one fails with a message telling the staff member to split it. An inbound email reply posted to the tenant's site is limited the same way. Admitting either above 32 MiB on Cloud Run is tracked in [#4239](https://github.com/publira/publira/issues/4239).

### 3. Deploy the worker

```bash
gcloud run worker-pools deploy publira-worker \
  --region=us-central1 --image=ghcr.io/publira/publira:<tag> --args=worker \
  --instances=1 \
  --network=publira --subnet=publira-run --vpc-egress=all-traffic \
  --service-account=publira-worker@<project>.iam.gserviceaccount.com \
  --env-vars-file=publira-worker.env.yaml \
  --set-secrets=PUBLIRA_WORKER_DB_URL=publira-outbox-db-url:latest,PUBLIRA_TICKER_DB_URL=publira-ticker-db-url:latest,PUBLIRA_CONTENT_STATS_DB_URL=publira-content-stats-db-url:latest,PUBLIRA_SECRET_ENCRYPTION_KEYS=publira-secret-encryption-keys:latest,PUBLIRA_REVALIDATE_TOKEN=publira-revalidate-token:latest
```

`publira-worker.env.yaml` holds the primary key ID, the web apps' internal URLs, and the two `AWS_` variables, as the server's file does. The worker creates the tables of its job queue when it starts, so it needs no job of its own.

### 4. Set the install up

Run `setup` unattended, as a job, with every value given as a flag, as the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup) lists them. The bucket is reached through Cloud Storage's XML API with the HMAC key:

```bash
gcloud run jobs deploy publiractl-setup \
  --region=us-central1 --image=ghcr.io/publira/publiractl:<tag> \
  --args=setup,--non-interactive,--default-locale,en,--bucket,<bucket>,--endpoint,https://storage.googleapis.com,--region,auto,--force-path-style,--access-key-id,<HMAC access ID>,--secret-access-key-file,/run/secrets/storage/secret,--host,<SMTP host>,--port,587,--encryption,starttls,--username,<SMTP user>,--from-address,no-reply@example.com,--smtp-password-file,/run/secrets/smtp/password,--tenant-name,Example Comics,--domain,comics.example.com,--admin-email,owner@comics.example.com,--admin-name,Owner,--admin-password-file,/run/secrets/admin/password \
  --network=publira --subnet=publira-run --vpc-egress=all-traffic \
  --service-account=publiractl@<project>.iam.gserviceaccount.com \
  --set-env-vars=PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1,AWS_REQUEST_CHECKSUM_CALCULATION=when_required,AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
  --set-secrets=PUBLIRA_PLATFORM_DB_URL=publira-platform-db-url:latest,PUBLIRA_SECRET_ENCRYPTION_KEYS=publira-secret-encryption-keys:latest,/run/secrets/storage/secret=publira-storage-secret:latest,/run/secrets/smtp/password=publira-smtp-password:latest,/run/secrets/admin/password=publira-admin-password:latest

gcloud run jobs execute publiractl-setup --region=us-central1 --wait
```

Give it the administrator's password from Secret Manager rather than `--generate-admin-password`: a generated password is printed in the summary, and the summary of a job goes to Cloud Logging. `--region auto` is the region the request is signed for, which Cloud Storage accepts whatever the bucket's location. A run that stopped halfway is finished by running the job again.

### 5. Put the load balancer in front

The load balancer is a global external Application Load Balancer (`EXTERNAL_MANAGED`) with one serverless network endpoint group and one backend service per Cloud Run service it forwards to: `web-storefront`, `web-admin`, `publira-server`, and `publira-server-storefront`, and `web-platform` when it runs. For each of them:

```bash
gcloud compute network-endpoint-groups create web-storefront \
  --region=us-central1 --network-endpoint-type=serverless --cloud-run-service=web-storefront
gcloud compute backend-services create web-storefront \
  --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend web-storefront \
  --global --network-endpoint-group=web-storefront --network-endpoint-group-region=us-central1
```

#### The URL map

The URL map routes by host and then by path, as [Routing](./4-edge.md#routing) states. A path rule ending in `/*` does not match the path without it, so each prefix is listed both ways, and the longest match wins, which puts `/api/v1` ahead of `/api`:

```yaml
name: publira
defaultService: projects/<project>/global/backendServices/web-storefront
headerAction:
  requestHeadersToRemove:
    - X-Forwarded-Host
    - traceparent
    - tracestate
    - baggage
hostRules:
  - hosts: [comics.example.com]
    pathMatcher: site
  - hosts: [admin.comics.example.com]
    pathMatcher: console
pathMatchers:
  - name: site
    defaultService: projects/<project>/global/backendServices/web-storefront
    pathRules:
      - paths: [/api/v1, /api/v1/*]
        service: projects/<project>/global/backendServices/web-storefront
      - paths: [/api, /api/*, /images, /images/*]
        service: projects/<project>/global/backendServices/publira-server-storefront
  - name: console
    defaultService: projects/<project>/global/backendServices/web-admin
    pathRules:
      - paths: [/api/v1, /api/v1/*]
        service: projects/<project>/global/backendServices/web-admin
      - paths: [/api, /api/*, /images, /images/*]
        service: projects/<project>/global/backendServices/publira-server
```

```bash
gcloud compute url-maps import publira --global --source=publira-url-map.yaml
```

Every tenant's domain goes in the `site` host rule and every console host in `console`; the Platform Console's host, when it runs, gets a path matcher of its own like `console`, with `web-platform` in place of `web-admin`. A host in no rule reaches `defaultService`.

`headerAction` removes, from every request, the headers [Edge](./4-edge.md#the-host-the-request-was-sent-to) says a caller may not set: `X-Forwarded-Host`, which the web apps would otherwise take the tenant from, and the [trace context](./4-edge.md#trace-context). The load balancer passes `Host` on as the browser sent it.

#### Certificates

Certificate Manager issues and renews a Google-managed certificate for every name. DNS authorization lets it do so before the name points at the load balancer, which is what lets a tenant be added without a gap:

```bash
gcloud certificate-manager dns-authorizations create comics-example-com --domain=comics.example.com
gcloud certificate-manager dns-authorizations create admin-comics-example-com --domain=admin.comics.example.com
gcloud certificate-manager dns-authorizations describe comics-example-com   # the CNAME record to add to DNS

gcloud certificate-manager certificates create comics-example-com \
  --domains=comics.example.com,admin.comics.example.com \
  --dns-authorizations=comics-example-com,admin-comics-example-com

gcloud certificate-manager maps create publira
gcloud certificate-manager maps entries create comics-example-com \
  --map=publira --hostname=comics.example.com --certificates=comics-example-com
gcloud certificate-manager maps entries create admin-comics-example-com \
  --map=publira --hostname=admin.comics.example.com --certificates=comics-example-com
```

Then the proxy and the forwarding rule, with a second URL map that sends plain HTTP to HTTPS:

```bash
gcloud compute target-https-proxies create publira --url-map=publira --certificate-map=publira
gcloud compute forwarding-rules create publira-https --global \
  --load-balancing-scheme=EXTERNAL_MANAGED --address=publira-lb --target-https-proxy=publira --ports=443

gcloud compute url-maps import publira-redirect --global <<'EOF'
name: publira-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: PERMANENT_REDIRECT
EOF
gcloud compute target-http-proxies create publira-redirect --url-map=publira-redirect
gcloud compute forwarding-rules create publira-http --global \
  --load-balancing-scheme=EXTERNAL_MANAGED --address=publira-lb --target-http-proxy=publira-redirect --ports=80
```

A certificate map holds up to 5,000 entries per project and each Google-managed certificate up to 100 names, so give each tenant a certificate of its own, as above, rather than one that grows with every tenant.

#### Cloud CDN for the images

Cloud CDN can cache the images of tenants' sites at Google's edge. `publira server` marks each image it may share `public, max-age=3600` and each one that belongs to a signed-in reader `private`, and varies them on `Accept` alone, so a CDN that follows those headers caches only what any reader may see. Give `/images` on the tenants' domains a backend service of its own, on a second network endpoint group for `publira-server-storefront`, with the CDN following the origin's headers:

```bash
gcloud compute network-endpoint-groups create publira-server-storefront-images \
  --region=us-central1 --network-endpoint-type=serverless --cloud-run-service=publira-server-storefront
gcloud compute backend-services create publira-site-images \
  --global --load-balancing-scheme=EXTERNAL_MANAGED --enable-cdn --cache-mode=USE_ORIGIN_HEADERS
gcloud compute backend-services add-backend publira-site-images \
  --global --network-endpoint-group=publira-server-storefront-images --network-endpoint-group-region=us-central1
```

and route `/images` and `/images/*` in the `site` path matcher to `publira-site-images`. Leave `/api` off the CDN, and the console hosts' images with it.

### 6. Check what the internet reaches

Every service is reachable from the internet only through the load balancer, and `email-renderer` not at all. From a machine outside Google Cloud, request each service's `run.app` URL directly:

```bash
curl -i https://publira-server-<project-number>.us-central1.run.app/livez
curl -i https://email-renderer-<project-number>.us-central1.run.app/livez
```

Each one is refused by Google's front end with an error page. A response of `ok` means the service's ingress is `all`. Through the load balancer, the tenant's domain serves no console API, since `publira-server-storefront` registers none:

```bash
curl -i -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/api/publira.platform.v1.PlatformTenantService/ListTenants
```

answers `404`. The same request to the console host answers `unauthenticated`, since `publira-server` serves the Platform Console's API there and refuses a caller without a session, as [The console APIs are under `/api` too](./4-edge.md#the-console-apis-are-under-api-too) describes.

### 7. Sign in

Open `https://admin.<domain>` and sign in with the administrator's email address and the password in `publira-admin-password`. The tenant's public site answers at `https://<domain>`.

## The client address

The load balancer writes the address that connected to it into `X-Forwarded-For` and appends its own, the address of its forwarding rule, after it: `<reader>,<load balancer>`. It neither removes nor writes `Forwarded`, and how Cloud Run treats that header is not documented. So:

- **`PUBLIRA_FORWARDED_HEADER_ENABLED=false`** on `publira-server`, `publira-server-storefront`, and every web app, so the client address and the host come from `X-Forwarded-For` and `X-Forwarded-Host` alone, as [The client address](./4-edge.md#the-client-address) requires for an edge that passes `Forwarded` on.
- **`PUBLIRA_TRUSTED_PROXIES`** on both `publira server` services lists the load balancer's address, the one `gcloud compute addresses describe publira-lb` printed, beside the ranges it trusts by default, which a value that is set replaces. Those cover the addresses Cloud Run and the VPC deliver requests from.

To check it, sign in to the tenant console from a machine whose public address you know, change a setting, and read the address its entry recorded, from Cloud SQL Studio as `postgres`:

```sql
SELECT action, client_ip FROM audit_logs ORDER BY created_at DESC LIMIT 1;
```

It is your address. The load balancer's address there means it is missing from `PUBLIRA_TRUSTED_PROXIES`, and another address of Google's means a hop between the load balancer and `publira server` is. Each needs adding to the list, as [When to set the trusted proxies](./4-edge.md#when-to-set-the-trusted-proxies) describes.

## Probes

Give every service a startup probe and a liveness probe on `/livez`, on the port it serves, as the deploy command above does. Cloud Run restarts an instance whose liveness probe fails, and `/livez` fails only when the process has hung.

Cloud Run also takes a readiness probe, which stops sending requests to an instance while it fails. Point it at `/readyz` only after reading [Probing from an orchestrator](../3-operations/11-monitoring.md#probing-from-an-orchestrator): one database login that stops answering makes every web app not ready together with `publira server`, so the load balancer has nowhere to send the site. Give a readiness probe on `publira server` a timeout of more than six seconds.

A worker pool has no port to probe. Cloud Run restarts a worker instance whose process exits, and a worker that hangs is noticed from the Outbox backing up, as [The outbox](../3-operations/11-monitoring.md#the-outbox) describes.

## Turning on the optional processes

- **`email-renderer`** runs as a service with `--ingress=internal --no-invoker-iam-check`, on the same subnet. Set `PUBLIRA_EMAIL_RENDERER_URL` on `publira-worker` to its `run.app` URL.
- **`web-platform`** runs like `web-admin`, on port `4100`, with what [Installing](./2-installing.md#the-platform-console-with-web-platform) lists. Add `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` with its `run.app` URL to both `publira server` services and the worker, give its host a certificate and a map entry, and route it in a path matcher of its own.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs, for its domain and its console host, the steps [Adding a tenant](./4-edge.md#adding-a-tenant) lists. On this load balancer:

1. **Certificates.** Create a DNS authorization for each name, add its CNAME record, create the tenant's certificate, and add a map entry for each name. Wait until `gcloud certificate-manager certificates describe` reports the certificate `ACTIVE`.
2. **DNS.** Point both names at the load balancer's address.
3. **Routing.** Add the domain to the `site` host rule and the console host to `console`, and import the URL map again.

## Upgrading

On every release, follow [Upgrading](./5-upgrading.md), with the release's images in place of the old ones:

1. Back up the Cloud SQL instance, such as with an on-demand backup.
2. Point `publiractl-migrate` and `publiractl-roles` at the new `publiractl` image with `gcloud run jobs update <job> --image=ghcr.io/publira/publiractl:<new tag>`, and execute each with `--wait`, in that order.
3. Deploy every service and the worker pool on the new tag, with any variable the release notes ask you to set. Each new revision of a service takes over once it has started.

## Next steps

The full list of variables each process reads is in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and what the load balancer has to do, whatever it is, in [Edge](./4-edge.md#what-the-edge-has-to-do). [Monitoring](../3-operations/11-monitoring.md) says what to watch once the install serves readers.
