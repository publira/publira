---
title: Kubernetes
description: Run an install on a Kubernetes cluster, from its Secrets and Deployments and a Gateway or an Ingress in front of them to the first sign-in to the tenant console.
published: 2026-10-13
updated: 2026-10-22
---

This page takes an install from an empty namespace on a Kubernetes cluster to the first sign-in to the tenant console. It runs the same steps as [Installing](../2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach, and it puts the edge in front the way [Edge](../4-edge/index.md#what-the-edge-has-to-do) requires. This page covers what is particular to a cluster: which resources each part becomes, and how each requirement of those two pages is met with them.

The manifests below are illustrations to adapt, not a maintained set: the repository ships no Helm chart, Kustomize base, or Operator. They name the published images, `ghcr.io/publira/<name>:<tag>`; write the version of the release you install in place of `<tag>`, as [Before you start](../2-installing.md#before-you-start) describes.

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

Run `publira server` and `publira worker` as the two Deployments above rather than as one `publira server --with-worker`. That flag is for an install on one host: in a cluster it gives up scaling the two apart and puts the worker's database logins in the process the edge forwards to, as the [Overview](../1-overview.md#what-an-install-runs) describes, and buys nothing a cluster needs.

`publiractl` is not kept running. It runs as a Job, or as a Pod you attach to, from the image of the release you install.

## Before you start

You need:

- **A cluster** whose nodes are `linux/amd64` or `linux/arm64`, the two platforms the images are published for, and `kubectl` signed in to it. In the `publira` namespace, the steps create, change, and delete Secrets, Deployments, Services, Jobs, and Pods, read Pod logs, attach to a Pod, and manage the edge's resources: a Gateway, HTTPRoutes, and an Envoy Gateway HTTPRouteFilter, or Ingresses and two Traefik Middlewares. Creating the namespace and the `ClusterIssuer`, which belongs to no namespace, and installing cert-manager and the edge's controller, take a cluster administrator. The built-in `admin` role, bound in the namespace, covers the rest except the custom resources: one of those is covered only when its install adds it to that role, which Envoy Gateway's does not for Gateways, HTTPRoutes, and its own HTTPRouteFilters.
- **A Gateway API implementation or an Ingress controller** to be the edge, and **cert-manager** to issue the certificates, as [The edge on Kubernetes](./1-edge.md) describes. The edge's Service has to be reachable from the internet, usually as a Service of type `LoadBalancer`.
- **The services the install depends on**, provisioned as [Provision the services](../2-installing.md#provision-the-services) lists, whether they are managed services outside the cluster or run in it: a PostgreSQL database with an administrative login that owns it and may create roles, a Valkey instance, an empty bucket and a credential for it, and an SMTP server. Every Pod of the install has to reach them.
- **DNS** for the tenant's domain and for its console host, `admin.<domain>` or the one you will give it with `--admin-domain`, both pointing at the address of the edge's Service once it has one.

Every command below runs in the `publira` namespace:

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. Create the Secrets

[Generate the secrets](../2-installing.md#generate-the-secrets) lists every secret an install needs and what each one protects. Generate them once, the same way:

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
| `publiractl` | The `db` Jobs | As environment variables. It holds `PUBLIRA_DB_URL`, the connection of the [administrative login](../2-installing.md#provision-the-services), alone: the `db` commands are the only ones that read it, so no other `publiractl` command, and nothing kept running, is given it |
| `publira-db-roles` | The `db roles` Job | As files, one per role, which `db roles` reads with its `--<role>-password-file` flags |

The Secrets in the cluster are not a backup. Keep the encryption keys in your own secret store as well: lose them and every credential the install stored has to be entered again, as [Generate the secrets](../2-installing.md#generate-the-secrets) says. If you keep the secrets in a store the cluster syncs from, such as with an operator that writes Secrets from it, have it write the same Secrets with the same keys.

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

`backoffLimit: 0` keeps Kubernetes from running a failed migration again on its own: a failed run leaves the database marked dirty, which [When a migration fails](../8-upgrading.md#when-a-migration-fails) resolves by hand. `kubectl wait` gives up after ten minutes whether the Job failed or is still running, so read its log either way.

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

Each process gets its Secrets as environment variables and the rest of the variables the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables) lists in its Deployment. Its liveness probe is `/livez` and its readiness probe `/readyz`, with the timeouts [Probing from an orchestrator](../../3-operations/11-monitoring.md#probing-from-an-orchestrator) gives: longer than six seconds for the server and the worker, whose checks run one after another, and longer than two for the web apps.

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

`PUBLIRA_TRUSTED_PROXIES` is the range your cluster gives Pods their addresses from, which your provider shows as the cluster's Pod address range; [The client address](./1-edge.md#the-client-address) says why it is set.

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

`web-storefront` takes the same `PUBLIRA_TRUSTED_PROXIES` as `publira server`, to find the reader's address it passes to a tenant's Google tag gateway. `web-admin.yaml` is the same with `web-admin` everywhere `web-storefront` appears, which names its Secret too, port `4000` in place of `3000`, and no `PUBLIRA_TRUSTED_PROXIES`, which `web-admin` does not read.

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

The edge routes each host and path to the right Service, terminates TLS, and removes the headers a caller must not choose. [The edge on Kubernetes](./1-edge.md) puts it in front, as a Gateway or an Ingress with cert-manager issuing its certificates, and checks it from outside the cluster. Come back here once those checks pass, to sign in.

## 7. Sign in

Open the tenant console at `https://admin.comics.example.com`, or the console host you gave `--admin-domain`, and sign in with the administrator's email address and password. From here on the install is the one [Sign in](../2-installing.md#6-sign-in) describes.

## In this section

- [The edge on Kubernetes](./1-edge.md): the certificates, a Gateway or an Ingress in front of the Services, the client address, and checking the edge from outside the cluster.
- [Operating on Kubernetes](./2-operating.md): adding a tenant, keeping the consoles' credentials off the tenants' domains, metrics, and upgrading.

## Next steps

[Edge](../4-edge/index.md) is the full statement of what the Gateway or the Ingress has to do, and [Monitoring](../../3-operations/11-monitoring.md) of what to watch once the install is serving. The variables each process reads are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and the optional processes are turned on as [Turning on the optional processes](../2-installing.md#turning-on-the-optional-processes) describes, each as a Deployment and a Service like the ones above.
