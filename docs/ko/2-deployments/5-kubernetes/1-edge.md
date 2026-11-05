---
title: Kubernetes의 엣지
description: Kubernetes 클러스터의 설치 환경 앞에 cert-manager가 인증서를 발급하는 Gateway 또는 Ingress를 두고, 클러스터 밖에서 확인합니다.
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

이 페이지는 [Kubernetes](./index.md)의 6단계입니다. [설치 환경 설정](./index.md#5-설치-환경-설정)을 실행한 뒤, [프로세스 시작](./index.md#4-프로세스-시작)에서 만든 Service 앞에 엣지를 둡니다.

엣지는 [엣지가 해야 하는 일](../4-edge/index.md#엣지가-해야-하는-일)이 요구하는 대로 각 호스트와 경로를 알맞은 Service로 라우팅하고, TLS를 종단하며, 호출자가 정해서는 안 되는 헤더를 제거합니다. 클러스터에서 엣지는 Gateway API를 구현하는 컨트롤러 위의 Gateway와 HTTPRoute이거나, Ingress입니다. 아래에서 두 가지를 모두, 같은 라우팅으로 설명합니다.

| 호스트 | 경로 | Service |
| --- | --- | --- |
| 테넌트의 도메인 | `/images`, `/rpc/publira.v1.…` | `publira-server`, 포트 `8000` |
| 테넌트의 도메인 | 나머지 `/rpc` | 없음: 엣지가 `404`로 응답합니다 |
| 테넌트의 도메인 | 그 밖의 모든 경로 | `web-storefront`, 포트 `3000` |
| 테넌트의 콘솔 호스트 | `/images`, `/rpc/publira.v1.…` | `publira-server`, 포트 `8000` |
| 테넌트의 콘솔 호스트 | 나머지 `/rpc` | 없음: 엣지가 `404`로 응답합니다 |
| 테넌트의 콘솔 호스트 | 그 밖의 모든 경로 | `web-admin`, 포트 `4000` |

`/rpc` 아래에서는 공개 API인 `publira.v1`만 전달합니다. 콘솔은 자체 API를 클러스터 네트워크를 통해 호출하므로, [공개 API만 엣지를 거친다](../4-edge/index.md#공개-api만-엣지를-거친다)에서 설명하듯 나머지에는 엣지가 직접 `404`로 응답합니다. 자체 시스템이 클러스터 밖에서 API 키를 사용하는 테넌트에는 [키로 보낼 수 있는 읽기 요청](../4-edge/index.md#api-키로-보낼-수-있는-읽기-요청)의 전달도 필요합니다. 각 경로를 그 테넌트의 콘솔 호스트 라우트에 `publira-server`의 포트 `8000`으로 가는 정확한 경로로 추가하세요. HTTPRoute에서는 `type: Exact`, Ingress에서는 `pathType: Exact`로 지정하며, 두 리소스 모두 이를 나머지 `/rpc`보다 먼저 확인합니다. 경로와 `Host` 헤더는 브라우저가 보낸 그대로 Service에 도달합니다. 어느 쪽도 다시 쓰지 마세요.

공개 API의 접두사는 경로 세그먼트 안, `v1` 뒤의 점에서 끝납니다. 그런데 Gateway의 `PathPrefix`와 Ingress의 `Prefix`는 모두 세그먼트 단위로 일치시키므로, 어느 쪽도 그 자체로는 이 접두사를 지정할 수 없습니다. 또한 두 API 모두 요청에 직접 응답하는 방법이 없습니다. 둘 다 구현에 맡겨져 있으며, 아래의 각 섹션에서 그 섹션이 사용하는 구현이 이를 어떻게 처리하는지 설명합니다.

## 인증서

cert-manager는 Let's Encrypt 같은 ACME 발급자로부터, Gateway 또는 Ingress가 지정하는 모든 호스트 이름의 인증서를 발급하고 갱신합니다. Gateway를 사용한다면 Gateway API 지원을 켜서 설치하세요. Helm 차트에서는 `config.enableGatewayAPI: true`로 켭니다. 그리고 엣지를 통해 ACME 챌린지에 응답하는 발급자를 만듭니다.

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

Ingress의 경우 솔버는 대신 `http01: {ingress: {ingressClassName: <your class>}}`입니다. 챌린지는 각 호스트 이름의 포트 80으로 엣지에 도달하므로 DNS 레코드를 먼저 만들어야 합니다.

## Gateway 사용

라우트는 Gateway API가 Extended로 표시한 기능 두 가지를 사용합니다. 이 기능들은 지원하지 않아도 구현이 API에 적합할 수 있습니다. HTTPS로의 리디렉션에 쓰는 `HTTPRouteSchemeRedirect`와, 웹 앱으로의 요청이 걸릴 수 있는 시간에 대한 구현의 제한을 없애는 `HTTPRouteRequestTimeout`입니다. Gateway API의 [Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/) 페이지에서 각 구현이 지원하는 기능을 비교할 수 있으며, 각 구현의 적합성 보고서 링크도 있습니다. Envoy Gateway는 둘 다 지원합니다. 둘 중 하나가 없는 구현에서는 그 부분을 구현 자체의 리소스가 제공하는 기능으로 처리하거나, 대신 [Ingress](#ingress-사용)를 사용하세요.

라우트는 Envoy Gateway 자체에서 두 가지도 가져옵니다. 공개 API의 접두사는 `RegularExpression` 경로 일치인데, 그 문법과 우선순위는 Gateway API가 각 구현에 맡깁니다. Envoy Gateway는 RE2 표현식을 경로 전체에 대해 일치시키며, 정규 표현식을 접두사보다 먼저 시도합니다. 나머지 `/rpc`에 대한 `404`는 Envoy Gateway 고유의 `HTTPRouteFilter`로, 요청에 직접 응답합니다.

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

다른 구현에서는 그 구현 고유의 방법으로 정규 표현식 경로 일치와 `404` 응답을 처리하세요.

Gateway에는 호스트 이름마다 HTTPS 리스너가 하나씩 있으며, 각각 인증서가 들어갈 Secret을 지정합니다. 그리고 HTTPS로 리디렉션하고 ACME 챌린지에 응답하는 일반 HTTP 리스너가 하나 있습니다. `cert-manager.io/cluster-issuer` 애너테이션은 cert-manager가 모든 HTTPS 리스너의 인증서를 그 리스너가 지정한 Secret에 발급하게 합니다.

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

웹 앱마다 HTTPRoute가 하나씩 있어, 그 앱의 HTTPS 리스너에 이름으로 연결되고 리스너에서 호스트 이름을 가져옵니다. 모든 규칙은 모든 구현이 지원하는 `RequestHeaderModifier` 필터로 요청에서 트레이스 컨텍스트 헤더, `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-CountryRegion`을 제거합니다.

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

- **공개 API와 `404`.** `/rpc/publira\.v1\..*`와 일치하는 경로는 Envoy Gateway가 정규 표현식을 먼저 시도하므로 `publira-server`에 도달합니다. 나머지 `/rpc`는 `not-found` 필터가 있는 `PathPrefix` 규칙으로 넘어가고, `/api`는 다른 모든 경로와 함께 웹 앱에 도달합니다. 필터가 있는 규칙에는 `backendRefs`가 없습니다. 필터가 일치하는 모든 요청에 응답하므로 아무것도 전달되지 않습니다.
- **제거되는 헤더.** `traceparent`, `tracestate`, `baggage`는 [트레이스 컨텍스트](../4-edge/index.md#트레이스-컨텍스트)가 요구하는 대로 제거합니다. Gateway는 따로 지정하지 않으면 호출자가 보낸 `Forwarded`와 `X-Forwarded-Host`를 그대로 전달하며, Publira는 [클라이언트 주소](../4-edge/index.md#클라이언트-주소)와 [요청이 보내진 호스트](../4-edge/index.md#요청이-보내진-호스트)에서 설명하듯 둘 다 읽습니다. 여기서 이들을 제거하면 모든 프로세스에서 `PUBLIRA_FORWARDED_HEADER_ENABLED`를 기본값으로 둘 수 있습니다. `X-Forwarded-CountryRegion`은 [독자의 지역](../4-edge/index.md#독자의-지역)이 요구하는 대로 제거합니다. Envoy Gateway는 자체적으로 지역을 조회하지 않으므로, 테넌트의 Google tag gateway는 Google에 지역을 보내지 않습니다. [ECS 앞의 CloudFront](../6-ecs-fargate/1-cloudfront.md#헤더)처럼 Gateway 앞에 이 헤더를 독자의 지역으로 설정하는 CDN이 있다면, `web-storefront`의 규칙에서 이 헤더를 `remove`에서 빼면 헤더가 `web-storefront`에 도달합니다. 이는 그 CDN만이 Gateway에 연결할 수 있는 동안에만 안전합니다.
- **업로드 타임아웃.** `timeouts.request: 0s`는 Gateway API가 0 기간을 정의하는 방식에 따라, 웹 앱으로의 요청이 걸릴 수 있는 시간의 제한을 끕니다. 이 설정이 없으면 규칙은 구현의 기본값을 받으며, 이 값은 훨씬 짧을 수 있습니다. Envoy Gateway의 기본값은 요청이 도착한 뒤 응답까지 15초입니다. 테넌트 콘솔의 에피소드 업로드는 [테넌트 콘솔에서의 업로드](../4-edge/index.md#테넌트-콘솔에서의-업로드)에서 설명하듯 도착하는 데 최대 300초가 걸리며, Gateway API는 구현이 `web-admin`이 페이지를 저장하고 응답하기 전의 이 시간까지 셀 수 있도록 허용합니다. 웹 앱 자체가 요청에 도착까지 300초를 주므로, 엣지에는 별도의 제한이 필요하지 않습니다. Gateway API에는 본문 크기를 지정하는 필드가 없으며, Envoy Gateway는 자체 정책으로 추가하지 않는 한 본문 크기를 제한하지 않습니다. 사용하는 구현이 본문 크기를 제한한다면 콘솔 호스트의 `/api/v1/episode-pages`에는 256 MiB, 테넌트 도메인의 `/api/v1/webhook/email/` 아래에는 33 MiB를 허용하세요.
- **리디렉션.** `https-redirect`는 `http` 리스너에만 연결되어 그곳의 모든 요청을 HTTPS로 보냅니다. 인증서가 발급되는 동안 cert-manager는 챌린지를 위한 자체 라우트를 같은 리스너에 추가합니다. 이 라우트는 인증서 대상 호스트를 지정하므로, 그 호스트의 일반 HTTP 요청을 리디렉션에서 가져갑니다. 인증서가 발급되고 라우트가 제거되면 다시 리디렉션이 그 요청에 응답합니다.

YAML 앵커 `&strip-request-headers`는 라우트의 모든 규칙에 같은 필터를 반복합니다. `kubectl apply`가 이를 전개합니다.

## Ingress 사용

Ingress는 자체 필드로 요청 헤더를 제거하거나 타임아웃을 설정할 수 없으므로, Ingress 엣지는 두 가지 모두 컨트롤러에 의존합니다. 아래의 매니페스트는 Ingress 컨트롤러로 Traefik을 사용하며, 다음 값으로 Helm 차트에서 설치한 경우입니다.

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

그리고 Middleware 두 개가 필요합니다. 하나는 헤더를 제거하는 것으로, 위의 `websecure` 엔트리 포인트가 받는 모든 요청에 적용합니다. 다른 하나는 요청을 전달하기 전에 `404`로 응답하는 것으로, 아래에 나오는 나머지 `/rpc`용 Ingress가 자신의 경로에 적용합니다.

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

Traefik에는 요청에 응답만 하는 Middleware가 없으므로, `not-found`는 어떤 연결도 오지 않는 브로드캐스트 주소를 지정한 허용 목록이며, 그 밖의 모든 주소를 `404`로 거부합니다. `rejectStatusCode`에는 Traefik 3.4 이상이 필요합니다.

Traefik은 [클라이언트 주소](#클라이언트-주소)에서 설명하듯 앞단의 홉을 신뢰하도록 지정하지 않는 한, 호출자의 `X-Forwarded-For`와 `X-Forwarded-Host`를 자체 값으로 바꾸므로 둘 다 제거할 필요가 없습니다. Traefik은 자체적으로 지역을 조회하지 않으므로, [독자의 지역](../4-edge/index.md#독자의-지역)이 요구하는 대로 모든 요청에서 `X-Forwarded-CountryRegion`을 제거하며, 테넌트의 Google tag gateway는 Google에 지역을 보내지 않습니다. `readTimeout`은 에피소드 업로드에 필요한 대로 요청에 도착까지 300초를 줍니다. Traefik은 본문 크기를 제한하지 않습니다. `web`의 리디렉션은 ACME 챌린지도 HTTPS로 보내며, 인증 기관은 그 리디렉션을 따라가고, 거기서 인증서가 생기기 전에 챌린지에 응답합니다. 다른 컨트롤러에서는 이 각각을 그 컨트롤러가 제공하는 고유의 애너테이션이나 리소스로 처리하세요.

그런 다음 웹 앱마다 Ingress가 하나씩 있어 자신의 호스트를 라우팅합니다. Traefik은 `strictPrefixMatching` 옵션이 켜져 있지 않으면 `Prefix` 또는 `ImplementationSpecific` 경로를 세그먼트 단위가 아니라 문자열로서 경로의 접두사로 일치시키므로, 이 옵션은 꺼 두세요. 그 덕분에 `/rpc/publira.v1.`가 경로 세그먼트 안에서 공개 API의 접두사를 지정할 수 있습니다. Ingress API는 그 의미를 컨트롤러에 맡기므로 `ImplementationSpecific`으로 지정합니다. 세그먼트 단위로 일치시키는 컨트롤러에는 이를 위한 고유의 애너테이션이나 리소스가 필요합니다.

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

`cert-manager.io/cluster-issuer` 애너테이션은 cert-manager가 모든 `tls` 항목의 호스트에 대한 인증서를 그 항목이 지정한 Secret에 발급하게 합니다. `api-not-found`에는 이 애너테이션이 없으며, 다른 두 Ingress가 발급받은 인증서를 읽습니다.

`api-not-found`는 두 호스트의 나머지 `/rpc`를 받아 `not-found` Middleware로 응답합니다. Traefik은 가장 긴 규칙을 먼저 시도하므로 `/rpc/publira.v1.`는 자신의 경로를 유지하고, 웹 앱은 `/`를 유지합니다. 백엔드에는 절대 도달하지 않으며, Ingress 경로에는 백엔드가 필요하기 때문에 지정한 것입니다. `publira-server`가 아니라 웹 앱을 지정하는 것은, 혹시 Middleware가 빠지더라도 경로가 콘솔 API가 아니라 그곳에 페이지가 없는 웹 앱에 도달하도록 하기 위해서입니다. Traefik은 `/rpc`를 문자열로 일치시키므로 `/rpcabc` 같은 경로도 `404`로 응답합니다. 그곳에도 페이지가 있는 웹 앱은 없습니다.

## 클라이언트 주소

Publira는 [클라이언트 주소](../4-edge/index.md#클라이언트-주소)에서 설명하듯 모든 요청 뒤에 있는 독자의 주소를 기록하며, 엣지가 쓰는 `X-Forwarded-For` 헤더에서 이를 읽습니다. 클러스터에서는 두 가지가 그 주소가 독자의 것인지를 결정합니다.

**독자의 주소가 컨트롤러에 도달해야 합니다.** 대부분의 클라우드 로드 밸런서의 패스스루 모드처럼 연결을 그대로 전달하는 `LoadBalancer` 타입의 Service는, 로드 밸런서가 고른 노드를 거쳐 연결을 전달합니다. 기본값인 `externalTrafficPolicy: Cluster`에서는 연결이 컨트롤러의 Pod에 도달하기 전에 그 노드가 독자의 주소를 자신의 주소로 바꿉니다. 컨트롤러의 Service에 `externalTrafficPolicy: Local`을 설정해, 연결이 출발지 주소를 유지한 채 컨트롤러 Pod가 실행 중인 노드로만 전달되게 하세요. 이를 설정하는 곳은 컨트롤러마다 다릅니다. Envoy Gateway는 따로 지정하지 않으면 Gateway를 위해 만드는 Service에 이를 설정하며, 위의 Traefik 값은 차트가 만드는 Service에 이를 설정합니다. HTTP를 직접 종단하는 로드 밸런서는 대신 독자의 주소를 `X-Forwarded-For`에 쓰며, 이 경우 신뢰할 대상은 그 로드 밸런서 자신의 주소입니다(아래 참조).

**`PUBLIRA_TRUSTED_PROXIES`는 클러스터 안의 홉을 지정합니다.** 컨트롤러의 Pod와 웹 앱의 Pod는 Pod 주소에서 `publira server`에 연결하므로, [프로세스 시작](./index.md#4-프로세스-시작)의 `publira-server`와 `web-storefront` Deployment처럼 Pod 주소 범위가 그 값입니다. 설정하지 않으면 노드의 주소를 포함한 모든 사설 범위를 신뢰합니다. 그러면 `externalTrafficPolicy`를 `Cluster`로 둔 탓에 노드의 주소에서 컨트롤러에 도달한 요청은, 호출자가 자신의 `X-Forwarded-For`에 쓴 아무 주소로나 기록됩니다. Pod 범위만 지정하면 이런 요청은 노드의 주소로 기록됩니다. 그러면 모든 독자가 하나의 주소를 공유하게 되지만, 어떤 독자도 그 주소를 고를 수는 없습니다.

**컨트롤러 앞의 홉은 두 곳에서 신뢰합니다.** 컨트롤러 앞에서 HTTP를 종단하는 로드 밸런서나 CDN은 [프록시 앞의 홉](../4-edge/1-sample-configurations.md#프록시-앞의-홉)에서 설명하듯, 호출자의 `X-Forwarded-For`에 덧붙이지 않고 자신에게 연결한 주소로 이 헤더를 설정합니다. 컨트롤러는 이 헤더를 그대로 전달해야 합니다.

- Envoy Gateway는 받은 `X-Forwarded-For`를 유지하고 홉의 주소를 덧붙이므로 설정이 필요 없습니다.
- Traefik은 엔트리 포인트가 홉을 신뢰하지 않으면 이 헤더를 바꿉니다. 위의 Helm 값에서 `ports.websecure.forwardedHeaders.trustedIPs` 아래에 홉의 주소를 추가하세요. 그러면 Traefik은 웹 앱이 테넌트를 찾는 데 쓰는 홉의 `X-Forwarded-Host`도 유지하므로, 홉이 이 헤더도 설정해야 합니다.

그런 다음 같은 주소를 Pod 범위와 함께 `PUBLIRA_TRUSTED_PROXIES`에 추가해, [신뢰하는 프록시를 설정해야 하는 경우](../4-edge/index.md#신뢰하는-프록시를-설정해야-하는-경우)에서 설명하듯 `publira server`가 홉의 주소를 건너뛰고 홉이 지정한 주소를 사용하게 하세요. 컨트롤러 쪽 설정이 없으면 `PUBLIRA_TRUSTED_PROXIES`를 어떻게 설정하든 모든 독자가 홉의 주소로 기록됩니다. 신뢰하는 것은 홉 자신의 주소만으로 하세요. 독자에게도 닿는 범위를 신뢰하면 어떤 독자든 원하는 주소를 지정할 수 있게 됩니다.

## 엣지 확인

엣지의 Service에 주소가 생기면 DNS 레코드가 그 주소를 가리키게 하고, 인증서를 기다립니다. `kubectl get certificate`는 발급된 인증서를 각각 `True`로 표시합니다. 그런 다음 클러스터 밖에서 라우팅을 확인합니다.

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

첫 번째는 `web-storefront`에서 `200`으로 응답하고, 두 번째는 그 준비 상태로 응답하며, `publira server`와 Valkey에 도달하면 `"status":"ok"`가 됩니다. 세 번째는 `publira server`에 도달하며, 서버는 빈 요청을 `invalid_argument`로 거부합니다. 네 번째는 테넌트 콘솔의 API를 호출하며, 엣지는 이를 전달하지 않고 `404`로 응답합니다. 마지막은 `https://comics.example.com/`로의 리디렉션으로 응답합니다. 콘솔 호스트에서도 같은 명령을 실행하세요. 그곳에서도 콘솔의 API는 `404`로 응답합니다. 콘솔은 엣지가 아니라 클러스터 네트워크를 통해 API를 호출하기 때문입니다.

그런 다음 Kubernetes 페이지의 [로그인](./index.md#7-로그인)으로 돌아가세요.
