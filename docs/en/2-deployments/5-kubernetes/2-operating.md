---
title: Operating on Kubernetes
description: Add a tenant, keep the consoles' credentials off the tenants' domains, serve the images and the public API apart, expose the metrics, and upgrade an install that runs on a Kubernetes cluster.
published: 2026-10-21
updated: 2026-10-25
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

Then change the backend of `/images` and the public API under `/rpc` on the tenants' domains alone, in the `web-storefront` HTTPRoute or Ingress, from `publira-server` to `publira-storefront`, and point `web-storefront` at it too, since it calls the public API alone: set `PUBLIRA_GRPC_URL` in its Deployment to `http://publira-storefront:8000/rpc`. The console hosts' routes, `web-admin`, and `web-platform` keep calling `publira-server`, which serves every role, until [Leaving the public API off the consoles' server](#leaving-the-public-api-off-the-consoles-server) takes the public API off it.

The edge answers a console API with `404` on every host either way, so the check calls the two Services from inside the cluster instead:

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront` answers `404`, since it does not serve that API. `publira-server` answers `400`: the API is served there, and refuses the empty request.

### Leaving the public API off the consoles' server

`publira-server` still serves the public API and holds `publira_public`, because `web-admin` calls the public API for the tenant's theme and tags, and the console hosts' route forwards it there. Send both to `publira-storefront`, and `publira-server` can run `--role admin,platform`, as step 4 of [Splitting the server by role](../7-scaling-out.md#splitting-the-server-by-role) describes. Make the changes in this order, so that nothing still sends `publira-server` a public API request when it stops serving them.

First point `web-admin`'s public API calls at the storefront Service. Add the variable to the `env` of its Deployment, beside `PUBLIRA_GRPC_URL`, which keeps naming `publira-server`, and apply it:

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

Its `/readyz` now checks that Service as well, as `public-api`.

Then route the console host's public API to `publira-storefront`, which answers it on any host, and keep its `/images` on `publira-server`, since the images a console page shows are the `admin` role's. In the `web-admin` HTTPRoute, split the first rule in two:

```yaml
- matches:
    - path: { type: PathPrefix, value: /images }
  filters: &strip-request-headers
    - type: RequestHeaderModifier
      requestHeaderModifier:
        remove:
          - traceparent
          - tracestate
          - baggage
          - forwarded
          - x-forwarded-host
          - x-forwarded-countryregion
  backendRefs:
    - name: publira-server
      port: 8000
- matches:
    - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
  filters: *strip-request-headers
  backendRefs:
    - name: publira-storefront
      port: 8000
```

In the `web-admin` Ingress, change the backend of the `/rpc/publira.v1.` path to `publira-storefront` instead.

Last, give the `publira-server` container `args: ["server", "--role", "admin,platform"]` in `publira-server.yaml`, take `PUBLIRA_PUBLIC_DB_URL` out of its Secret, which nothing else reads it from, and apply the Deployment:

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

Check that `publira-server` no longer serves the public API. This call answers `404`, where it answered `400` before:

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

Sign in to the tenant console: it draws the tenant's theme and lists the tags as before, now read from `publira-storefront`.

## Serving the images and the public API apart

The tenants' images and the public API can be reached on host names of their own, each through a load balancer of its own, as [Serving the images and the public API apart](../7-scaling-out.md#serving-the-images-and-the-public-api-apart) describes. On a cluster with a Gateway, each Gateway is a load balancer of its own, so the images get a second Gateway in front of a Deployment of their own, and the public API a host name on the Gateway you have, in front of `publira-storefront`. This builds on [Keeping the consoles' credentials off the tenants' domains](#keeping-the-consoles-credentials-off-the-tenants-domains), which created `publira-storefront`. The names below are examples: `images.comics.example.com` for the tenant's image host, and `api.example.com` for the public API's.

### The images

Run the images on a Deployment of their own, so that their traffic scales apart from the API's. Copy the Deployment and the Service of `publira-storefront` into `publira-images.yaml`, change `publira-storefront` to `publira-images` in their names, their labels, the selector, and the container's name, and keep `secretRef: {name: publira-storefront}`: the two serve the same role, and read the same Secret. Then apply it:

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

Give the image hosts a Gateway of their own, with an HTTPS listener per image host, and an HTTPRoute that forwards `/images` on them to `publira-images` and nothing else. A path no rule matches is answered with a `404` by the Gateway itself:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: <your class>
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: images-comics-example-com
      protocol: HTTPS
      port: 443
      hostname: images.comics.example.com
      tls:
        certificateRefs:
          - name: images-comics-example-com-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images
spec:
  parentRefs:
    - name: publira-images
      sectionName: images-comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-images
          port: 8000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images-https-redirect
spec:
  parentRefs:
    - name: publira-images
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

The filter removes the same headers as on the other routes, as [With a Gateway](./1-edge.md#with-a-gateway) explains. cert-manager answers the ACME challenge for an image host on the new Gateway's `http` listener, so add it to the `parentRefs` of the `letsencrypt` issuer's solver, beside the one [Certificates](./1-edge.md#certificates) gave it:

```yaml
parentRefs:
  - name: publira
    namespace: publira
    kind: Gateway
    sectionName: http
  - name: publira-images
    namespace: publira
    kind: Gateway
    sectionName: http
```

Point each image host at the new Gateway's address, wait for its certificate, and give it to the tenant, with **Image host** in the Platform Console or `publiractl tenant update --image-domain`, as [An image host](../../3-operations/2-tenants.md#an-image-host) describes. A tenant added later gets a listener on `publira-images` for its image host, and the listener's name in the `parentRefs` of the `images` HTTPRoute.

### The public API

Give the public API a host name of its own on the `publira` Gateway, and an HTTPRoute that forwards the public API on it to `publira-storefront` and nothing else. Add the listener to the Gateway's `listeners`:

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

and apply the route:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: public-api
spec:
  parentRefs:
    - name: publira
      sectionName: api-example-com
  rules:
    - matches:
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-storefront
          port: 8000
```

The web apps already call `publira-storefront` over the cluster's network, `web-storefront` on `PUBLIRA_GRPC_URL` and `web-admin` on `PUBLIRA_PUBLIC_GRPC_URL` once [Leaving the public API off the consoles' server](#leaving-the-public-api-off-the-consoles-server) is done, which skips the load balancer; a web app that runs outside the cluster names `https://api.example.com/rpc` instead. Build a tenant's mobile app with `PUBLIRA_BASE_URL=https://api.example.com`, once the tenant has an image host, as [The address the app connects to](../../5-mobile-app/2-building.md#the-address-the-app-connects-to) describes. The tenants' domains keep their routes as they are, so an app built against a tenant's domain keeps working.

### With an Ingress

Every Ingress of one class is reached through its controller's Service, which is one load balancer. Give the image hosts a second controller with a class of its own, installed with the values of [With an Ingress](./1-edge.md#with-an-ingress), or keep them on the controller you have, which [A tenant's image host](../4-edge/index.md#a-tenants-image-host) allows as well. Either way, one Ingress routes them, and Traefik answers every other path on them with a `404` of its own, since no rule names one:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [images.comics.example.com]
      secretName: images-comics-example-com-tls
  rules:
    - host: images.comics.example.com
      http:
        paths:
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-images, port: { number: 8000 } } }
```

The public API's host is one more Ingress of the same shape on the controller you have, with `api.example.com` for its host and `/rpc/publira.v1.`, `ImplementationSpecific`, to `publira-storefront` for its one path.

### Check the split

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

The first answers `404`: an image host serves nothing but images. The second reaches `publira-storefront`, which refuses the empty request with `invalid_argument`. The third answers `404` too: the API's host serves no images. Then open the tenant's site: its images load from `https://images.comics.example.com/images/…`.

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

When the processes keep running through the upgrade instead, step 4 replaces them in the order [Replace the processes](../8-upgrading.md#4-replace-the-processes) gives. Apply `email-renderer` first if you run it, and then the other Deployments, which roll one replica at a time while the install keeps serving.
