---
title: The edge on Kubernetes
description: Put a Gateway or an Ingress in front of an install on a Kubernetes cluster, with cert-manager issuing its certificates, and check it from outside the cluster.
published: 2026-10-21
updated: 2026-10-31
---

This page is step 6 of [Kubernetes](./index.md): it puts the edge in front of the Services that [Start the processes](./index.md#4-start-the-processes) created, once [Set the install up](./index.md#5-set-the-install-up) has run.

The edge routes each host and path to the right Service, terminates TLS, and removes the headers a caller must not choose, as [What the edge has to do](../4-edge/index.md#what-the-edge-has-to-do) requires. On a cluster it is either a Gateway with HTTPRoutes, on a controller that implements the Gateway API, or an Ingress. Both are below, with the same routing:

| Host | Path | Service |
| --- | --- | --- |
| The tenant's domain | `/images`, `/rpc/publira.v1.…` | `publira-server`, port `8000` |
| The tenant's domain | The rest of `/rpc` | None: the edge answers `404` |
| The tenant's domain | Everything else | `web-storefront`, port `3000` |
| The tenant's console host | `/images`, `/rpc/publira.v1.…` | `publira-server`, port `8000` |
| The tenant's console host | The rest of `/rpc` | None: the edge answers `404` |
| The tenant's console host | Everything else | `web-admin`, port `4000` |

Under `/rpc`, only the public API, `publira.v1`, is forwarded: the consoles call their own APIs over the cluster's network, so the edge answers the rest with a `404` of its own, as [Only the public API goes through the edge](../4-edge/index.md#only-the-public-api-goes-through-the-edge) explains. The path and the `Host` header reach the Service as the browser sent them; add no rewrite of either.

The public API's prefix ends inside a path segment, at the dot after `v1`, and a Gateway's `PathPrefix` and an Ingress's `Prefix` both match whole segments, so neither can name it by itself. Neither API has a way to answer a request itself, either. Both are left to the implementation, and each section below says how the one it uses does them.

## Certificates

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

## With a Gateway

The routes use two features the Gateway API marks Extended, which an implementation can conform to the API without supporting: `HTTPRouteSchemeRedirect`, for the redirect to HTTPS, and `HTTPRouteRequestTimeout`, for lifting the implementation's limit on how long a request to a web app may take. The Gateway API's [Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/) page compares the features each implementation supports and links its conformance report. Envoy Gateway supports both. On an implementation that lacks one, do that part with what it offers in its own resources, or use [an Ingress](#with-an-ingress) instead.

They also take two things from Envoy Gateway itself. The public API's prefix is a `RegularExpression` path match, whose dialect and precedence the Gateway API leaves to each implementation: Envoy Gateway matches an RE2 expression against the whole path, and tries regular expressions before prefixes. The `404` for the rest of `/rpc` is an `HTTPRouteFilter` of its own, which answers the request itself:

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

One HTTPRoute per web app attaches to that app's HTTPS listeners by name, and takes its host names from them. Every rule removes the trace context headers, `Forwarded`, `X-Forwarded-Host`, and `X-Forwarded-CountryRegion` from the request with a `RequestHeaderModifier` filter, which every implementation supports:

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
        - path: { type: PathPrefix, value: /rpc }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
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
        - path: { type: PathPrefix, value: /rpc }
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: not-found
    - matches:
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

- **The public API and the `404`.** A path that matches `/rpc/publira\.v1\..*` reaches `publira-server`, since Envoy Gateway tries the regular expression first; the rest of `/rpc` falls to the `PathPrefix` rule with the `not-found` filter, and `/api` reaches the web app with every other path. The rule with the filter has no `backendRefs`: the filter answers every request that matches it, and nothing is forwarded.
- **The removed headers.** `traceparent`, `tracestate`, and `baggage` are removed as [Trace context](../4-edge/index.md#trace-context) requires. A Gateway passes on a `Forwarded` and an `X-Forwarded-Host` the caller sent unless told otherwise, and Publira would read both, as [The client address](../4-edge/index.md#the-client-address) and [The host the request was sent to](../4-edge/index.md#the-host-the-request-was-sent-to) describe; removing them here leaves `PUBLIRA_FORWARDED_HEADER_ENABLED` at its default on every process. `X-Forwarded-CountryRegion` is removed as [The reader's region](../4-edge/index.md#the-readers-region) requires: Envoy Gateway looks up no region of its own, so a tenant's Google tag gateway sends Google none. A CDN in front of the Gateway that sets the header to the reader's region, as [CloudFront in front of ECS](../6-ecs-fargate/1-cloudfront.md#the-headers) shows, reaches `web-storefront` with it once `web-storefront`'s rules leave it out of `remove`, which is safe only while that CDN is the one thing that can connect to the Gateway.
- **The upload timeout.** `timeouts.request: 0s` turns off the limit on how long a request to a web app may take, as the Gateway API defines the zero duration. Without it a rule gets the implementation's default, which can be far shorter: Envoy Gateway's is 15 seconds for the answer once the request has arrived. The episode upload in the tenant console takes up to 300 seconds to arrive, as [Uploads in the tenant console](../4-edge/index.md#uploads-in-the-tenant-console) describes, and the Gateway API lets an implementation count that time too, before `web-admin` has stored the pages and answered. The web apps give a request 300 seconds to arrive themselves, so the edge needs no limit of its own. The Gateway API has no field for the size of a body, and Envoy Gateway sets no limit on it unless a policy of its own adds one; if your implementation does limit it, allow 256 MiB on a console host's `/api/v1/episode-pages` and 33 MiB under a tenant's domain's `/api/v1/webhook/email/`.
- **The redirect.** `https-redirect` attaches to the `http` listener alone and sends every request there to HTTPS. While a certificate is being issued, cert-manager adds a route of its own for the challenge to the same listener. It names the host the certificate is for, so it takes that host's plain HTTP requests from the redirect, which answers them again once the certificate is issued and the route removed.

The YAML anchor, `&strip-request-headers`, repeats the same filter on every rule of a route; `kubectl apply` expands it.

## With an Ingress

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

and two Middlewares: one that removes the headers, which the `websecure` entry point above applies to every request it receives, and one that answers a request with a `404` before it is forwarded, which the Ingress for the rest of `/rpc` below applies to its paths:

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
      X-Forwarded-CountryRegion: ""
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

Traefik replaces the caller's `X-Forwarded-For` and `X-Forwarded-Host` with its own unless it is told to trust a hop in front of it, as [The client address](#the-client-address) describes, so neither needs removing. It looks up no region of its own, so `X-Forwarded-CountryRegion` is removed from every request, as [The reader's region](../4-edge/index.md#the-readers-region) requires, and a tenant's Google tag gateway sends Google none. `readTimeout` gives a request 300 seconds to arrive, which the episode upload needs; Traefik sets no limit on the size of a body. The redirect on `web` sends the ACME challenge to HTTPS as well, and the certificate authority follows it there, where the challenge is answered before the certificate exists. On another controller, do each of these with what it offers, by its own annotation or resource.

One Ingress per web app then routes its hosts. Traefik matches a `Prefix` or an `ImplementationSpecific` path as a prefix of the path as a string rather than by whole segments, unless its `strictPrefixMatching` option is on, so leave that option off. That is how `/rpc/publira.v1.` names the public API's prefix inside a path segment, given as `ImplementationSpecific` because the Ingress API leaves that meaning to the controller; a controller that matches whole segments needs an annotation or a resource of its own for it.

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
    - host: admin.comics.example.com
      http:
        paths: *not-found-paths
```

The `cert-manager.io/cluster-issuer` annotation has cert-manager issue a certificate for the hosts of every `tls` entry into the Secret it names. `api-not-found` carries no such annotation, and reads the certificates the other two Ingresses had issued.

`api-not-found` takes the rest of `/rpc` on both hosts and answers it with the `not-found` Middleware. Traefik tries the longest rule first, so `/rpc/publira.v1.` keeps its paths, and the web apps keep `/`. The backend is never reached, and is there because an Ingress path needs one: it names a web app rather than `publira-server`, so that if the Middleware were ever missing, the paths would reach a web app that has no page there rather than the console APIs. Traefik matches `/rpc` as a string, so a path such as `/rpcabc` is answered with the `404` too; no web app has a page there either.

## The client address

Publira records the address of the reader behind every request, and reads it from the `X-Forwarded-For` header the edge writes, as [The client address](../4-edge/index.md#the-client-address) describes. On a cluster, two things decide whether that address is the reader's.

**The reader's address has to reach the controller.** A Service of type `LoadBalancer` that forwards connections as they are, as most cloud load balancers in their passthrough mode do, delivers them through whichever node the load balancer picked, and with the default `externalTrafficPolicy: Cluster` that node replaces the reader's address with its own before the connection reaches the controller's Pod. Set `externalTrafficPolicy: Local` on the controller's Service, so a connection is delivered only to a node that runs a controller Pod, with its source address kept. Where that is set is the controller's: Envoy Gateway sets it on the Service it creates for a Gateway unless told otherwise, and the Traefik values above set it on the Service the chart creates. A load balancer that terminates HTTP itself writes the reader's address in `X-Forwarded-For` instead, and then its own addresses are the ones to trust, below.

**`PUBLIRA_TRUSTED_PROXIES` names the hops inside the cluster.** The controller's Pods and the web apps' Pods connect to `publira server` from Pod addresses, so the Pod address range is the value, as in the `publira-server` and `web-storefront` Deployments of [Start the processes](./index.md#4-start-the-processes). Unset, it trusts every private range, the nodes' addresses among them, and then a request that reached the controller from a node's address, because `externalTrafficPolicy` was left at `Cluster`, is recorded with whatever address the caller wrote in its own `X-Forwarded-For`. With the Pod range alone, such a request is recorded with the node's address: every reader then shares one address, but none of them can choose it.

**A hop in front of the controller is trusted in two places.** A load balancer or a CDN that terminates HTTP in front of the controller sets `X-Forwarded-For` to the address that connected to it, rather than appending to the caller's, as [A hop in front of the proxy](../4-edge/1-sample-configurations.md#a-hop-in-front-of-the-proxy) describes. The controller has to pass that header on:

- Envoy Gateway keeps the `X-Forwarded-For` it receives and appends the hop's address, so it needs no setting.
- Traefik replaces it unless the entry point trusts the hop. Add the hop's addresses to the Helm values above, under `ports.websecure.forwardedHeaders.trustedIPs`. Traefik then keeps the hop's `X-Forwarded-Host` as well, which the web apps find the tenant from, so the hop sets that header too.

Then add the same addresses to `PUBLIRA_TRUSTED_PROXIES`, beside the Pod range, so `publira server` steps over the hop's address to the one it named, as [When to set the trusted proxies](../4-edge/index.md#when-to-set-the-trusted-proxies) describes. Without the controller's setting, every reader is recorded with the hop's address however `PUBLIRA_TRUSTED_PROXIES` is set. Trust the hop's own addresses only: a trusted range that also reaches readers lets any of them name an address of their choosing.

## Check the edge

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

Then go back to [Sign in](./index.md#7-sign-in) on the Kubernetes page.
