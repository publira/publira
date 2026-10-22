---
title: Operating on Kubernetes
description: Add a tenant, keep the consoles' credentials off the tenants' domains, expose the metrics, and upgrade an install that runs on a Kubernetes cluster.
published: 2026-10-21
updated: 2026-10-22
---

These are the changes made to an install once [Kubernetes](./index.md) has brought it into service. Each one changes the resources that page and [The edge on Kubernetes](./1-edge.md) created.

## Adding a tenant

A tenant created with `publiractl tenant create` or in the Platform Console needs its two host names on the edge, as [Adding a tenant](../4-edge/index.md#adding-a-tenant) describes. On a cluster that is:

- **With a Gateway**: two HTTPS listeners on the Gateway, one for the tenant's domain and one for its console host, each with a Secret name of its own, and each listener's name in the `parentRefs` of the HTTPRoute of its web app. cert-manager issues both certificates from the Gateway's annotation. A Gateway holds at most 64 listeners, so one Gateway serves up to 31 tenants beside its `http` listener; put the next tenants on a Gateway of their own, with HTTPRoutes of their own.
- **With an Ingress**: the domain added to the `tls` entry and the rules of the `web-storefront` Ingress, the console host to those of `web-admin`, and both to those of `api-not-found`. The YAML anchors of [With an Ingress](./1-edge.md#with-an-ingress) (`&storefront-paths`, `&admin-paths`, `&not-found-paths`) let a new rule reuse the paths with `paths: *storefront-paths`. cert-manager issues the certificates for the new names when the `tls` entries change.

Point both names at the edge's address before you apply the change, so cert-manager's challenge reaches it.

## Keeping the consoles' credentials off the tenants' domains

The edge already keeps the consoles' APIs off the internet, but the `publira-server` it forwards the tenants' domains to still serves them, and holds their database logins and the web service token to do so. To take all three out of the process readers reach, a layer apart from the edge rule as [Only the public API goes through the edge](../4-edge/index.md#only-the-public-api-goes-through-the-edge) describes, run a second Deployment with `--role storefront`, and route the tenants' domains and `web-storefront` to it. The split also lets reader traffic scale apart from the consoles, since each Deployment has replicas of its own, as [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes:

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
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-storefront
          image: ghcr.io/publira/publira:<tag>
          args: ["server", "--role", "storefront"]
          lifecycle:
            preStop:
              sleep:
                seconds: 5
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

Its Secret holds the `publira server` values it reads, which leaves out the web service token and every connection but `publira_public`. Create it in the shell you [created the other Secrets](./index.md#1-create-the-secrets) in, which still holds their values:

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

Then change the backend of `/images` and the public API under `/rpc` on the tenants' domains alone, in the `web-storefront` HTTPRoute or Ingress, from `publira-server` to `publira-storefront`, and point `web-storefront` at it too, since it calls the public API alone: set `PUBLIRA_GRPC_URL` in its Deployment to `http://publira-storefront:8000/rpc`. The console hosts' routes, `web-admin`, and `web-platform` keep calling `publira-server`, which serves every role: `web-admin` calls the public API as well as the console's, through its one `PUBLIRA_GRPC_URL`.

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

`publira server` and `publira worker` serve Prometheus metrics on port `9464` once [Metrics](../../3-operations/11-monitoring.md#metrics) turns them on with `PUBLIRA_METRICS_ENABLED=true`, `OTEL_METRICS_EXPORTER=prometheus`, and `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`. Each runs in a Pod of its own in [Start the processes](./index.md#4-start-the-processes), so each listens on that port without colliding. A Pod that runs the two as two containers shares one network namespace, and the second to start cannot listen on a port the first holds: give each its own `OTEL_EXPORTER_PROMETHEUS_PORT`, or keep them in Pods of their own.

## Upgrading

[Upgrading](../8-upgrading.md) brings an install to a new release: a backup, the migrations and the roles with the new release's `publiractl`, and then the processes. Read it, and its release notes, first. On a cluster its steps become:

1. **Stop the processes** when you decided to stop them first, which [Decide whether to stop the processes first](../8-upgrading.md#decide-whether-to-stop-the-processes-first) weighs, by scaling every Deployment of the install to zero:

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   The label selects the Pods of every Deployment of the install and leaves out those of the Jobs, which have finished and are kept for their logs.

2. **Back up the database**, with `pg_dump` from a host that reaches it, or a snapshot of the managed database, as [Back up the database](../8-upgrading.md#1-back-up-the-database) describes.
3. **Apply the migrations and the roles**: delete the previous release's Jobs if they are still there, since a Job cannot be changed, then change `<tag>` in the two Jobs of [Apply the migrations](./index.md#2-apply-the-migrations) and [Create the roles](./index.md#3-create-the-roles) to the new release, and run them in that order, waiting for each to complete:

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   The roles Job gives each role the password `publira-db-roles` holds for it, which is the one it already has, so it runs with its flags unchanged. A release that adds a role needs that role's password in `publira-db-roles` and its flag added.

4. **Start the new release**: change `<tag>` in every Deployment, add the variables the release notes name, and apply them. Applying the manifests restores the replicas you scaled to zero.
5. **Check the install**, as [Check the install](../8-upgrading.md#5-check-the-install) describes.

When the processes keep running through the upgrade instead, apply every Deployment at once after the roles Job: a Deployment rolls one replica at a time, so the two releases serve side by side until the last replica is replaced, and the shorter that is the better, as the same page explains.
