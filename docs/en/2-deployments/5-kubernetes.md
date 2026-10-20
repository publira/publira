---
title: Kubernetes
description: Run an install on a Kubernetes cluster, from its Secrets and Deployments and a Gateway or an Ingress in front of them to the first sign-in to the tenant console.
published: 2026-10-13
updated: 2026-10-20
---

This page takes an install from an empty namespace on a Kubernetes cluster to the first sign-in to the tenant console. It runs the same steps as [Installing](./2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach, and it puts the edge in front the way [Edge](./4-edge.md#what-the-edge-has-to-do) requires. This page covers what is particular to a cluster: which resources each part becomes, and how each requirement of those two pages is met with them.

The manifests below are illustrations to adapt, not a maintained set: the repository ships no Helm chart, Kustomize base, or Operator. They name the published images, `ghcr.io/publira/<name>:<tag>`; write the version of the release you install in place of `<tag>`, as [Before you start](./2-installing.md#before-you-start) describes.

## What runs in the cluster

Every long-lived process is a Deployment, and every one that something calls is reached through a Service of the same name:

| Deployment | Image and arguments | Port | Service | Replicas |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | Yes: the edge and the web apps call it | Any number |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`, with `worker` as its argument | `8003`, for its probes alone | No: nothing calls it | Any number |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | Yes: the edge, and the cache revalidation from the server and the worker | Any number |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | Yes, as `web-storefront` | Any number |
| `web-platform`, when you run it | `ghcr.io/publira/web-platform:<tag>` | `4100` | Yes, as `web-storefront` | Any number |
| `email-renderer`, when you run it | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Yes: the worker calls it | Any number |

The worker may run several replicas because every scheduled job is unique while a run of it is in flight, so two replicas never run the same job at once. It also schedules every recurring job itself, so the install needs no CronJob. Each replica of the server or the worker opens a pool per database login, so more replicas need a database that accepts more connections, as [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) works out.

Run `publira server` and `publira worker` as the two Deployments above rather than as one `publira server --with-worker`. That flag is for an install on one host: in a cluster it gives up scaling the two apart and puts the worker's database logins in the process the edge forwards to, as the [Overview](./1-overview.md#what-an-install-runs) describes, and buys nothing a cluster needs.

`publiractl` is not kept running. It runs as a Job, or as a Pod you attach to, from the image of the release you install.

## Before you start

You need:

- **A cluster** whose nodes are `linux/amd64` or `linux/arm64`, the two platforms the images are published for, and `kubectl` signed in to it. In the `publira` namespace, the steps create, change, and delete Secrets, Deployments, Services, Jobs, and Pods, read Pod logs, attach to a Pod, and manage the edge's resources: a Gateway, HTTPRoutes, and an Envoy Gateway HTTPRouteFilter, or Ingresses and two Traefik Middlewares. Creating the namespace and the `ClusterIssuer`, which belongs to no namespace, and installing cert-manager and the edge's controller, take a cluster administrator. The built-in `admin` role, bound in the namespace, covers the rest except the custom resources: one of those is covered only when its install adds it to that role, which Envoy Gateway's does not for Gateways, HTTPRoutes, and its own HTTPRouteFilters.
- **A Gateway API implementation or an Ingress controller** to be the edge, and **cert-manager** to issue the certificates, as [Put the edge in front](#6-put-the-edge-in-front) describes. The edge's Service has to be reachable from the internet, usually as a Service of type `LoadBalancer`.
- **The services the install depends on**, provisioned as [Provision the services](./2-installing.md#provision-the-services) lists, whether they are managed services outside the cluster or run in it: a PostgreSQL database with an administrative login that owns it and may create roles, a Valkey instance, an empty bucket and a credential for it, and an SMTP server. Every Pod of the install has to reach them.
- **DNS** for the tenant's domain and for its console host, `admin.<domain>` or the one you will give it with `--admin-domain`, both pointing at the address of the edge's Service once it has one.

Every command below runs in the `publira` namespace:

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. Create the Secrets

[Generate the secrets](./2-installing.md#generate-the-secrets) lists every secret an install needs and what each one protects. Generate them once, the same way:

```bash
ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"
AUTH_JWT_SECRET="$(openssl rand -base64 32)"
STOREFRONT_AUTH_SECRET="$(openssl rand -base64 32)"
ADMIN_AUTH_SECRET="$(openssl rand -base64 32)"
REVALIDATE_TOKEN="$(openssl rand -hex 32)"
WEB_SERVICE_TOKEN="$(openssl rand -base64 32)"
PUBLIC_DB_PASSWORD="$(openssl rand -hex 32)"
ADMIN_DB_PASSWORD="$(openssl rand -hex 32)"
PLATFORM_DB_PASSWORD="$(openssl rand -hex 32)"
OUTBOX_DB_PASSWORD="$(openssl rand -hex 32)"
TICKER_DB_PASSWORD="$(openssl rand -hex 32)"
CONTENT_STATS_DB_PASSWORD="$(openssl rand -hex 32)"
```

Then give each process only what it reads, in a Secret of its own. The connection URLs carry the role passwords, so they are secrets too, and so is the Redis URL once it carries a password. Write your database's host and your Valkey URL in place of the ones below:

```bash
DB="db.internal:5432/publira?sslmode=require"
REDIS_URL="rediss://:<valkey password>@valkey.internal:6379"

kubectl create secret generic publira-encryption \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_KEYS="$ENCRYPTION_KEYS" \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1

kubectl create secret generic publira-server \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_ADMIN_DB_URL="postgres://publira_admin:$ADMIN_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_PLATFORM_DB_URL="postgres://publira_platform:$PLATFORM_DB_PASSWORD@$DB"

kubectl create secret generic publira-worker \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_WORKER_DB_URL="postgres://publira_outbox:$OUTBOX_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_TICKER_DB_URL="postgres://publira_ticker:$TICKER_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_CONTENT_STATS_DB_URL="postgres://publira_content_stats:$CONTENT_STATS_DB_PASSWORD@$DB"

kubectl create secret generic web-storefront \
  --from-literal=PUBLIRA_AUTH_SECRET="$STOREFRONT_AUTH_SECRET" \
  --from-literal=PNCH_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL"

kubectl create secret generic web-admin \
  --from-literal=PUBLIRA_AUTH_SECRET="$ADMIN_AUTH_SECRET" \
  --from-literal=PNCH_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN"

kubectl create secret generic publiractl \
  --from-literal=PUBLIRA_DB_URL="postgres://postgres:<administrative login password>@$DB"

kubectl create secret generic publira-db-roles \
  --from-literal=public="$PUBLIC_DB_PASSWORD" \
  --from-literal=admin="$ADMIN_DB_PASSWORD" \
  --from-literal=platform="$PLATFORM_DB_PASSWORD" \
  --from-literal=outbox="$OUTBOX_DB_PASSWORD" \
  --from-literal=ticker="$TICKER_DB_PASSWORD" \
  --from-literal=content-stats="$CONTENT_STATS_DB_PASSWORD"
```

| Secret | Read by | How |
| --- | --- | --- |
| `publira-encryption` | `publira-server`, `publira-worker`, and every `publiractl` run | As environment variables |
| `publira-server` | `publira-server`, and `publiractl setup` | As environment variables. `setup` takes `PUBLIRA_PLATFORM_DB_URL` from it alone, with a `secretKeyRef` |
| `publira-worker` | `publira-worker` | As environment variables |
| `web-storefront`, `web-admin` | The web app of the same name | As environment variables |
| `publiractl` | The `db` Jobs | As environment variables. It holds `PUBLIRA_DB_URL`, the connection of the [administrative login](./2-installing.md#provision-the-services), alone: the `db` commands are the only ones that read it, so no other `publiractl` command, and nothing kept running, is given it |
| `publira-db-roles` | The `db roles` Job | As files, one per role, which `db roles` reads with its `--<role>-password-file` flags |

The Secrets in the cluster are not a backup. Keep the encryption keys in your own secret store as well: lose them and every credential the install stored has to be entered again, as [Generate the secrets](./2-installing.md#generate-the-secrets) says. If you keep the secrets in a store the cluster syncs from, such as with an operator that writes Secrets from it, have it write the same Secrets with the same keys.

## 2. Apply the migrations

`db migrate` runs as a Job from the `publiractl` image of the release, on the administrative login's connection:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-migrate
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args: ["db", "migrate"]
          envFrom:
            - secretRef:
                name: publiractl
```

```bash
kubectl apply -f publira-db-migrate.yaml
kubectl wait --for=condition=Complete --timeout=10m job/publira-db-migrate
kubectl logs job/publira-db-migrate
```

`backoffLimit: 0` keeps Kubernetes from running a failed migration again on its own: a failed run leaves the database marked dirty, which [When a migration fails](./7-upgrading.md#when-a-migration-fails) resolves by hand. `kubectl wait` gives up after ten minutes whether the Job failed or is still running, so read its log either way.

A Job cannot be changed once it exists, and one that has finished, whether it completed or failed, does not run again when its manifest is applied. This one is deleted a day after it finishes. Until then, running it again, as the last step of that recovery does, starts by deleting it:

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

The `db roles` and `setup` Jobs below are run again the same way.

## 3. Create the roles

`db roles` runs the same way, after the migrations. It reads the role passwords from the `publira-db-roles` Secret, mounted as files:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-roles
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - db
            - roles
            - --public-password-file=/run/secrets/publira/public
            - --admin-password-file=/run/secrets/publira/admin
            - --platform-password-file=/run/secrets/publira/platform
            - --outbox-password-file=/run/secrets/publira/outbox
            - --ticker-password-file=/run/secrets/publira/ticker
            - --content-stats-password-file=/run/secrets/publira/content-stats
          envFrom:
            - secretRef:
                name: publiractl
          volumeMounts:
            - name: db-roles
              mountPath: /run/secrets/publira
              readOnly: true
      volumes:
        - name: db-roles
          secret:
            secretName: publira-db-roles
```

```bash
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl logs job/publira-db-roles
```

The log has one line per role. The same Job is how a role's password is rotated later: change it in `publira-db-roles` and in the connection URL that carries it, run the Job again, and restart the Deployment that connects as that role. As with the migrations, delete the finished Job before applying it again. For `publira_admin`, whose URL `publira-server` carries:

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. Start the processes

Each process gets its Secrets as environment variables and the rest of the variables the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables) lists in its Deployment. Its liveness probe is `/livez` and its readiness probe `/readyz`, with the timeouts [Probing from an orchestrator](../3-operations/11-monitoring.md#probing-from-an-orchestrator) gives: longer than six seconds for the server and the worker, whose checks run one after another, and longer than two for the web apps.

`publira-server.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-server
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-server
    spec:
      containers:
        - name: publira-server
          image: ghcr.io/publira/publira:<tag>
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-server
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 8
---
apiVersion: v1
kind: Service
metadata:
  name: publira-server
spec:
  selector:
    app.kubernetes.io/name: publira-server
  ports:
    - name: http
      port: 8000
      targetPort: http
```

`PUBLIRA_TRUSTED_PROXIES` is the range your cluster gives Pods their addresses from, which your provider shows as the cluster's Pod address range; [The client address](#the-client-address) says why it is set.

`publira-worker.yaml`, which needs no Service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-worker
    spec:
      containers:
        - name: publira-worker
          image: ghcr.io/publira/publira:<tag>
          args: ["worker"]
          ports:
            - name: health
              containerPort: 8003
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-worker
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
          livenessProbe:
            httpGet:
              path: /livez
              port: health
          readinessProbe:
            httpGet:
              path: /readyz
              port: health
            timeoutSeconds: 8
```

The two web apps follow the same shape, and both call `publira server` through its Service. `web-storefront.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: web-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web-storefront
    spec:
      containers:
        - name: web-storefront
          image: ghcr.io/publira/web-storefront:<tag>
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: web-storefront
          env:
            - name: PUBLIRA_GRPC_URL
              value: http://publira-server:8000/rpc
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 3
---
apiVersion: v1
kind: Service
metadata:
  name: web-storefront
spec:
  selector:
    app.kubernetes.io/name: web-storefront
  ports:
    - name: http
      port: 3000
      targetPort: http
```

`web-admin.yaml` is the same with `web-admin` everywhere `web-storefront` appears, which names its Secret too, and port `4000` in place of `3000`.

Apply them all, and wait for every Deployment to be ready:

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker` creates the tables of its job queue when it starts, so it needs no Job of its own. A Deployment that does not become ready names the reason in the `/readyz` of its Pods, and in their log as a `readiness check failed` line: a role whose password does not match its connection URL is named there, as `db.public` or another login.

## 5. Set the install up

`publiractl setup` runs once, either attached to a terminal, where it asks for every value, or as a Job with every value given as a flag. Both connect as `publira_platform`, with the `PUBLIRA_PLATFORM_DB_URL` of the `publira-server` Secret, and seal what they save with the encryption keys, so both read the `publira-encryption` Secret the processes read. Neither is given the `publiractl` Secret: `setup` never connects as the administrative login.

Either way, what it prints goes to the container's log, which your cluster's log collection may keep, so give the administrator a password rather than having one generated: a generated password is printed in the summary. A password typed at the prompt is not echoed, and one given as a file is not printed.

On a terminal, run it in a Pod you attach to, which is deleted when it exits:

```bash
kubectl run publiractl-setup --rm -it --restart=Never \
  --image=ghcr.io/publira/publiractl:<tag> \
  --overrides='{
    "apiVersion": "v1",
    "spec": {
      "containers": [{
        "name": "publiractl-setup",
        "image": "ghcr.io/publira/publiractl:<tag>",
        "args": ["setup"],
        "stdin": true,
        "tty": true,
        "envFrom": [{"secretRef": {"name": "publira-encryption"}}],
        "env": [{
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": {"secretKeyRef": {"name": "publira-server", "key": "PUBLIRA_PLATFORM_DB_URL"}}
        }]
      }]
    }
  }'
```

Unattended, give it every value as a flag, and the secrets it saves, the administrator's password among them, as files from a Secret of their own:

```bash
kubectl create secret generic publiractl-setup \
  --from-literal=secret-access-key='<the object store secret key>' \
  --from-literal=smtp-password='<the SMTP password>' \
  --from-literal=admin-password="$(openssl rand -base64 18)"
```

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publiractl-setup
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - setup
            - --non-interactive
            - --default-locale=en
            - --bucket=publira-images
            - --region=us-east-1
            - --access-key-id=<the object store access key>
            - --secret-access-key-file=/run/secrets/setup/secret-access-key
            - --host=smtp.example.com
            - --port=587
            - --encryption=starttls
            - --username=mailer
            - --smtp-password-file=/run/secrets/setup/smtp-password
            - --from-address=no-reply@example.com
            - --tenant-name=Example Comics
            - --domain=comics.example.com
            - --admin-email=owner@comics.example.com
            - --admin-name=Owner
            - --admin-password-file=/run/secrets/setup/admin-password
          envFrom:
            - secretRef:
                name: publira-encryption
          env:
            - name: PUBLIRA_PLATFORM_DB_URL
              valueFrom:
                secretKeyRef:
                  name: publira-server
                  key: PUBLIRA_PLATFORM_DB_URL
          volumeMounts:
            - name: setup
              mountPath: /run/secrets/setup
              readOnly: true
      volumes:
        - name: setup
          secret:
            secretName: publiractl-setup
```

```bash
kubectl apply -f publiractl-setup.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publiractl-setup
kubectl logs job/publiractl-setup
```

For a store other than Amazon S3, add its URL with `--endpoint`, and `--force-path-style` if it addresses buckets by path. The [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup) lists every flag, and the steps that are optional.

A run that stops partway, on an object store that refuses the connection test for one, keeps what it saved and is finished by running it again once the cause is fixed. Delete the failed Job and apply it again, as with the migrations.

The administrator's password is the `admin-password` key of the `publiractl-setup` Secret. Once they have signed in and changed it, delete the Secret: nothing reads it afterwards.

## 6. Put the edge in front

The edge routes each host and path to the right Service, terminates TLS, and removes the headers a caller must not choose, as [What the edge has to do](./4-edge.md#what-the-edge-has-to-do) requires. On a cluster it is either a Gateway with HTTPRoutes, on a controller that implements the Gateway API, or an Ingress. Both are below, with the same routing:

| Host | Path | Service |
| --- | --- | --- |
| The tenant's domain | `/images`, `/rpc/publira.v1.…`, `/api/publira.v1.…` | `publira-server`, port `8000` |
| The tenant's domain | The rest of `/rpc` and `/api` | None: the edge answers `404` |
| The tenant's domain | `/api/v1`, and everything else | `web-storefront`, port `3000` |
| The tenant's console host | `/images`, `/rpc/publira.v1.…`, `/api/publira.v1.…` | `publira-server`, port `8000` |
| The tenant's console host | The rest of `/rpc` and `/api` | None: the edge answers `404` |
| The tenant's console host | `/api/v1`, and everything else | `web-admin`, port `4000` |

`/rpc` is the API's prefix, and `/api` the one it had before, which `publira server` answers until 0.3.0 for the clients not yet on `/rpc`; route both until then. Under either, only the public API, `publira.v1`, is forwarded: the consoles call their own APIs over the cluster's network, so the edge answers the rest with a `404` of its own, as [Only the public API goes through the edge](./4-edge.md#only-the-public-api-goes-through-the-edge) explains. `/api/v1` is longer than `/api`, so it wins on a path both match. The path and the `Host` header reach the Service as the browser sent them; add no rewrite of either.

The public API's prefix ends inside a path segment, at the dot after `v1`, and a Gateway's `PathPrefix` and an Ingress's `Prefix` both match whole segments, so neither can name it by itself. Neither API has a way to answer a request itself, either. Both are left to the implementation, and each section below says how the one it uses does them.

### Certificates

cert-manager issues and renews a certificate for every host name the Gateway or the Ingress names, from an ACME issuer such as Let's Encrypt. Install it with its Gateway API support turned on if you use a Gateway, which its Helm chart does with `config.enableGatewayAPI: true`, and create an issuer that answers the ACME challenge through the edge:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-account
    solvers:
      - http01:
          gatewayHTTPRoute:
            parentRefs:
              - name: publira
                namespace: publira
                kind: Gateway
                sectionName: http
```

For an Ingress, the solver is `http01: {ingress: {ingressClassName: <your class>}}` instead. The challenge reaches the edge on port 80 at each host name, so the DNS record comes first.

### With a Gateway

The routes use two features the Gateway API marks Extended, which an implementation can conform to the API without supporting: `HTTPRouteSchemeRedirect`, for the redirect to HTTPS, and `HTTPRouteRequestTimeout`, for lifting the implementation's limit on how long a request to a web app may take. The Gateway API's [Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/) page compares the features each implementation supports and links its conformance report. Envoy Gateway supports both. On an implementation that lacks one, do that part with what it offers in its own resources, or use [an Ingress](#with-an-ingress) instead.

They also take two things from Envoy Gateway itself. The public API's prefix is a `RegularExpression` path match, whose dialect and precedence the Gateway API leaves to each implementation: Envoy Gateway matches an RE2 expression against the whole path, and tries regular expressions before prefixes. The `404` for the rest of `/rpc` and `/api` is an `HTTPRouteFilter` of its own, which answers the request itself:

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

On another implementation, use its own way of matching a path by regular expression and of answering a request with a `404`.

The Gateway has one HTTPS listener per host name, each with the Secret its certificate goes in, and one plain HTTP listener, which redirects to HTTPS and answers the ACME challenge. The `cert-manager.io/cluster-issuer` annotation has cert-manager issue a certificate for every HTTPS listener into the Secret the listener names:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: publira
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: <your class>
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: comics-example-com
      protocol: HTTPS
      port: 443
      hostname: comics.example.com
      tls:
        certificateRefs:
          - name: comics-example-com-tls
    - name: admin-comics-example-com
      protocol: HTTPS
      port: 443
      hostname: admin.comics.example.com
      tls:
        certificateRefs:
          - name: admin-comics-example-com-tls
```

One HTTPRoute per web app attaches to that app's HTTPS listeners by name, and takes its host names from them. Every rule removes the trace context headers, `Forwarded`, and `X-Forwarded-Host` from the request with a `RequestHeaderModifier` filter, which every implementation supports:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-storefront
spec:
  parentRefs:
    - name: publira
      sectionName: comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
        - path: { type: RegularExpression, value: '/api/publira\.v1\..*' }
      filters: &strip-request-headers
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              [traceparent, tracestate, baggage, forwarded, x-forwarded-host]
      backendRefs:
        - name: publira-server
          port: 8000
    - matches:
        - path: { type: PathPrefix, value: /rpc }
        - path: { type: PathPrefix, value: /api }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
        - path: { type: PathPrefix, value: /api/v1 }
        - path: { type: PathPrefix, value: / }
      filters: *strip-request-headers
      timeouts:
        request: 0s
      backendRefs:
        - name: web-storefront
          port: 3000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-admin
spec:
  parentRefs:
    - name: publira
      sectionName: admin-comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
        - path: { type: RegularExpression, value: '/api/publira\.v1\..*' }
      filters: &strip-request-headers
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              [traceparent, tracestate, baggage, forwarded, x-forwarded-host]
      backendRefs:
        - name: publira-server
          port: 8000
    - matches:
        - path: { type: PathPrefix, value: /rpc }
        - path: { type: PathPrefix, value: /api }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
        - path: { type: PathPrefix, value: /api/v1 }
        - path: { type: PathPrefix, value: / }
      filters: *strip-request-headers
      timeouts:
        request: 0s
      backendRefs:
        - name: web-admin
          port: 4000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
spec:
  parentRefs:
    - name: publira
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

- **The public API and the `404`.** A path that matches `/rpc/publira\.v1\..*` reaches `publira-server`, since Envoy Gateway tries the regular expression first; the rest of `/rpc` and `/api` falls to the `PathPrefix` rule with the `not-found` filter, and `/api/v1`, the longer prefix, to the web app. The rule with the filter has no `backendRefs`: the filter answers every request that matches it, and nothing is forwarded.
- **The removed headers.** `traceparent`, `tracestate`, and `baggage` are removed as [Trace context](./4-edge.md#trace-context) requires. A Gateway passes on a `Forwarded` and an `X-Forwarded-Host` the caller sent unless told otherwise, and Publira would read both, as [The client address](./4-edge.md#the-client-address) and [The host the request was sent to](./4-edge.md#the-host-the-request-was-sent-to) describe; removing them here leaves `PUBLIRA_FORWARDED_HEADER_ENABLED` at its default on every process.
- **The upload timeout.** `timeouts.request: 0s` turns off the limit on how long a request to a web app may take, as the Gateway API defines the zero duration. Without it a rule gets the implementation's default, which can be far shorter: Envoy Gateway's is 15 seconds for the answer once the request has arrived. The episode upload in the tenant console takes up to 300 seconds to arrive, as [Uploads in the tenant console](./4-edge.md#uploads-in-the-tenant-console) describes, and the Gateway API lets an implementation count that time too, before `web-admin` has stored the pages and answered. The web apps give a request 300 seconds to arrive themselves, so the edge needs no limit of its own. The Gateway API has no field for the size of a body, and Envoy Gateway sets no limit on it unless a policy of its own adds one; if your implementation does limit it, allow 256 MiB on a console host's `/api/v1/episode-pages` and 33 MiB under a tenant's domain's `/api/v1/webhook/email/`.
- **The redirect.** `https-redirect` attaches to the `http` listener alone and sends every request there to HTTPS. While a certificate is being issued, cert-manager adds a route of its own for the challenge to the same listener. It names the host the certificate is for, so it takes that host's plain HTTP requests from the redirect, which answers them again once the certificate is issued and the route removed.

The YAML anchor, `&strip-request-headers`, repeats the same filter on every rule of a route; `kubectl apply` expands it.

### With an Ingress

An Ingress cannot remove a request header or set a timeout in its own fields, so an Ingress edge depends on its controller for both. The manifests below are for Traefik as the Ingress controller, installed from its Helm chart with these values:

```yaml
ports:
  web:
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    http:
      middlewares:
        - publira-strip-request-headers@kubernetescrd
    transport:
      respondingTimeouts:
        readTimeout: 300s
service:
  spec:
    externalTrafficPolicy: Local
```

and two Middlewares: one that removes the headers, which the `websecure` entry point above applies to every request it receives, and one that answers a request with a `404` before it is forwarded, which the Ingress for the rest of `/rpc` and `/api` below applies to its paths:

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: strip-request-headers
spec:
  headers:
    customRequestHeaders:
      traceparent: ""
      tracestate: ""
      baggage: ""
      Forwarded: ""
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: not-found
spec:
  ipAllowList:
    sourceRange: [255.255.255.255/32]
    rejectStatusCode: 404
```

Traefik has no Middleware that only answers a request, so `not-found` is an allow list that names the broadcast address, which no connection comes from, and refuses every other address with `404`. `rejectStatusCode` needs Traefik 3.4 or later.

Traefik replaces the caller's `X-Forwarded-For` and `X-Forwarded-Host` with its own unless it is told to trust a hop in front of it, as [The client address](#the-client-address) describes, so neither needs removing. `readTimeout` gives a request 300 seconds to arrive, which the episode upload needs; Traefik sets no limit on the size of a body. The redirect on `web` sends the ACME challenge to HTTPS as well, and the certificate authority follows it there, where the challenge is answered before the certificate exists. On another controller, do each of these with what it offers, by its own annotation or resource.

One Ingress per web app then routes its hosts. Traefik matches a `Prefix` or an `ImplementationSpecific` path as a prefix of the path as a string rather than by whole segments, unless its `strictPrefixMatching` option is on, so leave that option off. That is how `/rpc/publira.v1.` names the public API's prefix inside a path segment, given as `ImplementationSpecific` because the Ingress API leaves that meaning to the controller; a controller that matches whole segments needs an annotation or a resource of its own for it. It is also why `/api/v1` is given as `/api/v1/`, ending in a slash: `/api/v1` alone would send `/api/v10` to the web app. A controller that matches whole segments still sends the bare `/api/v1` to the web app with the slash; Traefik answers it with the `404` below, which is harmless, since no web app answers anything there.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-storefront
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [comics.example.com]
      secretName: comics-example-com-tls
  rules:
    - host: comics.example.com
      http:
        paths: &storefront-paths
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /rpc/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /api/v1/
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
          - path: /api/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-admin
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [admin.comics.example.com]
      secretName: admin-comics-example-com-tls
  rules:
    - host: admin.comics.example.com
      http:
        paths: &admin-paths
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /rpc/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /api/v1/
            pathType: Prefix
            backend: { service: { name: web-admin, port: { number: 4000 } } }
          - path: /api/publira.v1.
            pathType: ImplementationSpecific
            backend:
              { service: { name: publira-server, port: { number: 8000 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: web-admin, port: { number: 4000 } } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-not-found
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: publira-not-found@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts: [comics.example.com]
      secretName: comics-example-com-tls
    - hosts: [admin.comics.example.com]
      secretName: admin-comics-example-com-tls
  rules:
    - host: comics.example.com
      http:
        paths: &not-found-paths
          - path: /rpc
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
          - path: /api
            pathType: Prefix
            backend:
              { service: { name: web-storefront, port: { number: 3000 } } }
    - host: admin.comics.example.com
      http:
        paths: *not-found-paths
```

The `cert-manager.io/cluster-issuer` annotation has cert-manager issue a certificate for the hosts of every `tls` entry into the Secret it names. `api-not-found` carries no such annotation, and reads the certificates the other two Ingresses had issued.

`api-not-found` takes the rest of `/rpc` and `/api` on both hosts and answers it with the `not-found` Middleware. Traefik tries the longest rule first, so `/rpc/publira.v1.`, `/api/publira.v1.`, and `/api/v1/` keep their paths, and the web apps keep `/`. The backend is never reached, and is there because an Ingress path needs one: it names a web app rather than `publira-server`, so that if the Middleware were ever missing, the paths would reach a web app that has no page there rather than the console APIs. Traefik matches `/rpc` as a string, so a path such as `/rpcabc` is answered with the `404` too; no web app has a page there either.

### The client address

Publira records the address of the reader behind every request, and reads it from the `X-Forwarded-For` header the edge writes, as [The client address](./4-edge.md#the-client-address) describes. On a cluster, two things decide whether that address is the reader's.

**The reader's address has to reach the controller.** A Service of type `LoadBalancer` that forwards connections as they are, as most cloud load balancers in their passthrough mode do, delivers them through whichever node the load balancer picked, and with the default `externalTrafficPolicy: Cluster` that node replaces the reader's address with its own before the connection reaches the controller's Pod. Set `externalTrafficPolicy: Local` on the controller's Service, so a connection is delivered only to a node that runs a controller Pod, with its source address kept. Where that is set is the controller's: Envoy Gateway sets it on the Service it creates for a Gateway unless told otherwise, and the Traefik values above set it on the Service the chart creates. A load balancer that terminates HTTP itself writes the reader's address in `X-Forwarded-For` instead, and then its own addresses are the ones to trust, below.

**`PUBLIRA_TRUSTED_PROXIES` names the hops inside the cluster.** The controller's Pods and the web apps' Pods connect to `publira server` from Pod addresses, so the Pod address range is the value, as in the Deployment above. Unset, it trusts every private range, the nodes' addresses among them, and then a request that reached the controller from a node's address, because `externalTrafficPolicy` was left at `Cluster`, is recorded with whatever address the caller wrote in its own `X-Forwarded-For`. With the Pod range alone, such a request is recorded with the node's address: every reader then shares one address, but none of them can choose it.

**A hop in front of the controller is trusted in two places.** A load balancer or a CDN that terminates HTTP in front of the controller sets `X-Forwarded-For` to the address that connected to it, rather than appending to the caller's, as [A hop in front of the proxy](./4-edge.md#a-hop-in-front-of-the-proxy) describes. The controller has to pass that header on:

- Envoy Gateway keeps the `X-Forwarded-For` it receives and appends the hop's address, so it needs no setting.
- Traefik replaces it unless the entry point trusts the hop. Add the hop's addresses to the Helm values above, under `ports.websecure.forwardedHeaders.trustedIPs`. Traefik then keeps the hop's `X-Forwarded-Host` as well, which the web apps find the tenant from, so the hop sets that header too.

Then add the same addresses to `PUBLIRA_TRUSTED_PROXIES`, beside the Pod range, so `publira server` steps over the hop's address to the one it named, as [When to set the trusted proxies](./4-edge.md#when-to-set-the-trusted-proxies) describes. Without the controller's setting, every reader is recorded with the hop's address however `PUBLIRA_TRUSTED_PROXIES` is set. Trust the hop's own addresses only: a trusted range that also reaches readers lets any of them name an address of their choosing.

### Check the edge

Once the edge's Service has an address, point the DNS records at it, and wait for the certificates: `kubectl get certificate` shows each one `True` once it is issued. Then check the routing from outside the cluster:

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

The first answers `200` from `web-storefront`, and the second with its readiness, `"status":"ok"` once it reaches `publira server` and Valkey. The third reaches `publira server`, which refuses the empty request with `invalid_argument`. The fourth calls the tenant console's API, and the edge answers it with `404` without forwarding it. The last answers with the redirect to `https://comics.example.com/`. Run the same on the console host, where the console's API answers `404` as well: the console calls it over the cluster's network, not through the edge.

## 7. Sign in

Open the tenant console at `https://admin.comics.example.com`, or the console host you gave `--admin-domain`, and sign in with the administrator's email address and password. From here on the install is the one [Sign in](./2-installing.md#6-sign-in) describes.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs its two host names on the edge, as [Adding a tenant](./4-edge.md#adding-a-tenant) describes. On a cluster that is:

- **With a Gateway**: two HTTPS listeners on the Gateway, one for the tenant's domain and one for its console host, each with a Secret name of its own, and each listener's name in the `parentRefs` of the HTTPRoute of its web app. cert-manager issues both certificates from the Gateway's annotation. A Gateway holds at most 64 listeners, so one Gateway serves up to 31 tenants beside its `http` listener; put the next tenants on a Gateway of their own, with HTTPRoutes of their own.
- **With an Ingress**: the domain added to the `tls` entry and the rules of the `web-storefront` Ingress, the console host to those of `web-admin`, and both to those of `api-not-found`. The YAML anchors above (`&storefront-paths`, `&admin-paths`, `&not-found-paths`) let a new rule reuse the paths with `paths: *storefront-paths`. cert-manager issues the certificates for the new names when the `tls` entries change.

Point both names at the edge's address before you apply the change, so cert-manager's challenge reaches it.

## Keeping the consoles' credentials off the tenants' domains

The edge already keeps the consoles' APIs off the internet, but the `publira-server` it forwards the tenants' domains to still serves them, and holds their database logins and the web service token to do so. To take all three out of the process readers reach, a layer apart from the edge rule as [Only the public API goes through the edge](./4-edge.md#only-the-public-api-goes-through-the-edge) describes, run a second Deployment with `--role storefront`, and route the tenants' domains to it:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-storefront
    spec:
      containers:
        - name: publira-storefront
          image: ghcr.io/publira/publira:<tag>
          args: ["server", "--role", "storefront"]
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-storefront
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 8
---
apiVersion: v1
kind: Service
metadata:
  name: publira-storefront
spec:
  selector:
    app.kubernetes.io/name: publira-storefront
  ports:
    - name: http
      port: 8000
      targetPort: http
```

Its Secret holds the `publira server` values it reads, which leaves out the web service token and every connection but `publira_public`. Create it in the shell you created the other Secrets in, which still holds their values:

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

Then change the backend of `/images` and the public API under `/rpc` and `/api` on the tenants' domains alone, in the `web-storefront` HTTPRoute or Ingress, from `publira-server` to `publira-storefront`. The console hosts' routes and the web apps keep calling `publira-server`, which serves every role: `web-admin` calls the public API as well as the console's, through its one `PUBLIRA_GRPC_URL`.

The edge answers a console API with `404` on every host either way, so the check calls the two Services from inside the cluster instead:

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront` answers `404`, since it does not serve that API. `publira-server` answers `400`: the API is served there, and refuses the empty request.

## Metrics

`publira server` and `publira worker` serve Prometheus metrics on port `9464` once [Metrics](../3-operations/11-monitoring.md#metrics) turns them on with `PUBLIRA_METRICS_ENABLED=true`, `OTEL_METRICS_EXPORTER=prometheus`, and `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`. Each runs in a Pod of its own above, so each listens on that port without colliding. A Pod that runs the two as two containers shares one network namespace, and the second to start cannot listen on a port the first holds: give each its own `OTEL_EXPORTER_PROMETHEUS_PORT`, or keep them in Pods of their own.

## Upgrading

[Upgrading](./7-upgrading.md) brings an install to a new release: a backup, the migrations and the roles with the new release's `publiractl`, and then the processes. Read it, and its release notes, first. On a cluster its steps become:

1. **Stop the processes** when you decided to stop them first, which [Decide whether to stop the processes first](./7-upgrading.md#decide-whether-to-stop-the-processes-first) weighs, by scaling every Deployment of the install to zero:

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   The label selects the Pods of every Deployment above and leaves out those of the Jobs, which have finished and are kept for their logs.

2. **Back up the database**, with `pg_dump` from a host that reaches it, or a snapshot of the managed database, as [Back up the database](./7-upgrading.md#1-back-up-the-database) describes.
3. **Apply the migrations and the roles**: delete the previous release's Jobs if they are still there, since a Job cannot be changed, then change `<tag>` in the two Jobs of [Apply the migrations](#2-apply-the-migrations) and [Create the roles](#3-create-the-roles) to the new release, and run them in that order, waiting for each to complete:

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   The roles Job gives each role the password `publira-db-roles` holds for it, which is the one it already has, so it runs with its flags unchanged. A release that adds a role needs that role's password in `publira-db-roles` and its flag added.

4. **Start the new release**: change `<tag>` in every Deployment, add the variables the release notes name, and apply them. Applying the manifests restores the replicas you scaled to zero.
5. **Check the install**, as [Check the install](./7-upgrading.md#5-check-the-install) describes.

When the processes keep running through the upgrade instead, apply every Deployment at once after the roles Job: a Deployment rolls one replica at a time, so the two releases serve side by side until the last replica is replaced, and the shorter that is the better, as the same page explains.

## Next steps

[Edge](./4-edge.md) is the full statement of what the Gateway or the Ingress has to do, and [Monitoring](../3-operations/11-monitoring.md) of what to watch once the install is serving. The variables each process reads are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and the optional processes are turned on as [Turning on the optional processes](./2-installing.md#turning-on-the-optional-processes) describes, each as a Deployment and a Service like the ones above.
