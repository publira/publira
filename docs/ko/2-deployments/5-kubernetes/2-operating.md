---
title: Kubernetes에서의 운영
description: Kubernetes 클러스터에서 실행되는 설치 환경에 테넌트를 추가하고, 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두고, 이미지와 공개 API를 분리해 제공하고, 메트릭을 노출하고, 업그레이드합니다.
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

[Kubernetes](./index.md)로 서비스를 시작한 설치 환경에 이후 가하는 변경입니다. 각각은 그 페이지와 [Kubernetes의 엣지](./1-edge.md)에서 만든 리소스를 변경합니다.

## 테넌트 추가

`publiractl tenant create`나 플랫폼 콘솔에서 만든 테넌트는 [테넌트 추가](../4-edge/index.md#테넌트-추가)에서 설명하듯 엣지에 호스트 이름 두 개가 필요합니다. 클러스터에서는 다음과 같습니다.

- **Gateway 사용 시**: Gateway에 HTTPS 리스너 두 개(테넌트의 도메인용 하나, 콘솔 호스트용 하나)를 두고, 각각 고유한 Secret 이름을 지정하며, 각 리스너의 이름을 해당 웹 앱의 HTTPRoute의 `parentRefs`에 넣습니다. cert-manager는 Gateway의 애너테이션에 따라 두 인증서를 모두 발급합니다. Gateway 하나에는 리스너를 최대 64개까지 둘 수 있으므로, Gateway 하나는 `http` 리스너 외에 최대 31개의 테넌트를 제공합니다. 그다음 테넌트는 전용 HTTPRoute와 함께 별도의 Gateway에 두세요.
- **Ingress 사용 시**: 도메인을 `web-storefront` Ingress의 `tls` 항목과 규칙에, 콘솔 호스트를 `web-admin`의 그것에, 둘 다 `api-not-found`의 그것에 추가합니다. [Ingress 사용](./1-edge.md#ingress-사용)의 YAML 앵커(`&storefront-paths`, `&admin-paths`, `&not-found-paths`)를 쓰면 새 규칙에서 `paths: *storefront-paths`로 경로를 재사용할 수 있습니다. `tls` 항목이 바뀌면 cert-manager가 새 이름의 인증서를 발급합니다.

cert-manager의 챌린지가 엣지에 도달하도록, 변경을 적용하기 전에 두 이름이 엣지의 주소를 가리키게 하세요.

## 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기

엣지는 API 키로 보낼 수 있는 읽기 요청을 제외하면 이미 콘솔의 API를 인터넷에서 차단하지만, 엣지가 테넌트의 도메인을 전달하는 `publira-server`는 여전히 그 API를 제공하며, 이를 위해 데이터베이스 로그인과 웹 서비스 토큰을 가지고 있습니다. [공개 API만 엣지를 거친다](../4-edge/index.md#공개-api만-엣지를-거친다)에서 설명하듯 엣지 규칙과는 별개의 계층으로서, 이 세 가지를 독자가 도달하는 프로세스에서 모두 빼려면 `--role storefront`로 두 번째 Deployment를 실행하고 테넌트의 도메인과 `web-storefront`를 그쪽으로 라우팅하세요. [역할별로 서버 나누기](../7-scaling-out.md#역할별로-서버-나누기)에서 설명하듯, 각 Deployment가 고유한 복제본을 가지므로 이 분할로 독자 트래픽을 콘솔과 따로 확장할 수도 있습니다.

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

이 Deployment의 Secret에는 그것이 읽는 `publira server`의 값을 담으며, 웹 서비스 토큰과 `publira_public` 이외의 모든 연결은 빠집니다. [다른 Secret을 만든](./index.md#1-secret-만들기) 셸, 즉 그 값들이 아직 남아 있는 셸에서 만드세요.

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

그런 다음 `web-storefront` HTTPRoute 또는 Ingress에서 테넌트 도메인의 `/images`와 `/rpc` 아래 공개 API의 백엔드만 `publira-server`에서 `publira-storefront`로 바꾸고, 공개 API만 호출하는 `web-storefront`도 그쪽을 가리키게 하세요. 즉 `web-storefront`의 Deployment에서 `PUBLIRA_GRPC_URL`을 `http://publira-storefront:8000/rpc`로 설정합니다. 콘솔 호스트의 라우트, `web-admin`, `web-platform`은 [콘솔 서버에서 공개 API 빼기](#콘솔-서버에서-공개-api-빼기)에서 공개 API를 빼기 전까지, 모든 역할을 제공하는 `publira-server`를 계속 호출합니다.

어느 경우든 엣지는 모든 호스트에서 콘솔 API 대부분에 `404`로 응답하므로, 확인은 대신 클러스터 안에서 두 Service를 호출해 수행합니다.

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`는 그 API를 제공하지 않으므로 `404`로 응답합니다. `publira-server`는 `400`으로 응답합니다. 그곳에서는 API를 제공하며, 빈 요청을 거부하기 때문입니다.

### 콘솔 서버에서 공개 API 빼기

`web-admin`이 테넌트의 테마와 태그를 위해 공개 API를 호출하고 콘솔 호스트의 라우트가 공개 API를 `publira-server`로 전달하므로, `publira-server`는 여전히 공개 API를 제공하며 `publira_public`을 가지고 있습니다. 이 둘을 `publira-storefront`로 보내면, [역할별로 서버 나누기](../7-scaling-out.md#역할별로-서버-나누기)의 4단계에서 설명하듯 `publira-server`를 `--role admin,platform`으로 실행할 수 있습니다. `publira-server`가 공개 API 요청 처리를 멈출 때 그 요청을 보내는 곳이 남아 있지 않도록, 다음 순서로 변경하세요.

먼저 `web-admin`의 공개 API 호출이 스토어프런트 Service를 가리키게 합니다. Deployment의 `env`에, 계속 `publira-server`를 지정하는 `PUBLIRA_GRPC_URL`과 함께 다음 변수를 추가하고 적용합니다.

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

이제 `web-admin`의 `/readyz`는 그 Service도 `public-api`로 검사합니다.

다음으로 콘솔 호스트의 공개 API를 어떤 호스트에서든 응답하는 `publira-storefront`로 라우팅하고, 콘솔 화면에 표시되는 이미지는 `admin` 역할의 것이므로 `/images`는 `publira-server`에 둡니다. `web-admin` HTTPRoute에서 첫 번째 규칙을 둘로 나눕니다.

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

`web-admin` Ingress에서는 대신 `/rpc/publira.v1.` 경로의 백엔드를 `publira-storefront`로 바꿉니다.

마지막으로 `publira-server.yaml`에서 `publira-server` 컨테이너에 `args: ["server", "--role", "admin,platform"]`을 지정하고, 다른 곳에서는 읽지 않는 `PUBLIRA_PUBLIC_DB_URL`을 그 Secret에서 빼고, Deployment를 적용합니다.

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

`publira-server`가 더 이상 공개 API를 제공하지 않는지 확인합니다. 이 호출은 전에는 `400`으로 응답했지만 이제 `404`로 응답합니다.

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

테넌트 콘솔에 로그인하세요. 이전처럼 테넌트의 테마를 그리고 태그를 나열하며, 이제 이들은 `publira-storefront`에서 읽습니다.

## 이미지와 공개 API를 따로 제공하기

[이미지와 공개 API를 따로 제공하기](../7-scaling-out.md#이미지와-공개-api를-따로-제공하기)에서 설명하듯, 테넌트의 이미지와 공개 API는 각각 전용 로드 밸런서를 거쳐 전용 호스트 이름으로 접근하게 할 수 있습니다. Gateway를 사용하는 클러스터에서는 Gateway 하나하나가 별개의 로드 밸런서이므로, 이미지에는 전용 Deployment 앞에 두 번째 Gateway를 두고, 공개 API에는 기존 Gateway에 `publira-storefront` 앞의 호스트 이름을 둡니다. 이는 `publira-storefront`를 만든 [콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기](#콘솔의-자격-증명을-테넌트의-도메인에서-떼어-두기)를 전제로 합니다. 아래의 이름은 예시로, 테넌트의 이미지 호스트는 `images.comics.example.com`, 공개 API의 호스트는 `api.example.com`입니다.

### 이미지

이미지의 트래픽이 API의 트래픽과 따로 확장되도록, 이미지를 전용 Deployment에서 실행합니다. `publira-storefront`의 Deployment와 Service를 `publira-images.yaml`에 복사하고, 이름, 레이블, 셀렉터, 컨테이너 이름에서 `publira-storefront`를 `publira-images`로 바꾸되, `secretRef: {name: publira-storefront}`는 그대로 둡니다. 둘은 같은 역할을 제공하고 같은 Secret을 읽습니다. 그런 다음 적용합니다.

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

이미지 호스트에는 이미지 호스트마다 HTTPS 리스너가 있는 전용 Gateway와, 그 호스트의 `/images`만 `publira-images`로 전달하는 HTTPRoute를 둡니다. 어떤 규칙과도 일치하지 않는 경로에는 Gateway 자체가 `404`로 응답합니다.

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

필터는 [Gateway 사용](./1-edge.md#gateway-사용)에서 설명하듯 다른 라우트와 같은 헤더를 제거합니다. cert-manager는 이미지 호스트의 ACME 챌린지에 새 Gateway의 `http` 리스너에서 응답하므로, `letsencrypt` 발급자 솔버의 `parentRefs`에 [인증서](./1-edge.md#인증서)에서 지정한 것과 함께 이 리스너를 추가하세요.

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

각 이미지 호스트가 새 Gateway의 주소를 가리키게 하고, 인증서를 기다린 다음, [이미지 호스트](../../3-operations/2-tenants.md#이미지-호스트)에서 설명하듯 플랫폼 콘솔의 **이미지 호스트** 또는 `publiractl tenant update --image-domain`으로 테넌트에 지정합니다. 나중에 추가하는 테넌트는 이미지 호스트를 위한 리스너를 `publira-images`에 두고, 그 리스너의 이름을 `images` HTTPRoute의 `parentRefs`에 넣습니다.

### 공개 API

`publira` Gateway에 공개 API 전용 호스트 이름과, 그 호스트의 공개 API만 `publira-storefront`로 전달하는 HTTPRoute를 둡니다. Gateway의 `listeners`에 리스너를 추가하고,

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

라우트를 적용합니다.

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

웹 앱은 이미 로드 밸런서를 거치지 않고 클러스터 네트워크를 통해 `publira-storefront`를 호출합니다. `web-storefront`는 `PUBLIRA_GRPC_URL`로, `web-admin`은 [콘솔 서버에서 공개 API 빼기](#콘솔-서버에서-공개-api-빼기)를 마친 뒤 `PUBLIRA_PUBLIC_GRPC_URL`로 호출합니다. 클러스터 밖에서 실행되는 웹 앱은 대신 `https://api.example.com/rpc`를 지정합니다. 테넌트에 이미지 호스트가 생기면, [앱이 연결할 주소](../../5-mobile-app/2-building.md#앱이-연결할-주소)에서 설명하듯 테넌트의 모바일 앱을 `PUBLIRA_BASE_URL=https://api.example.com`으로 빌드하세요. 테넌트의 도메인은 라우트를 그대로 유지하므로, 테넌트의 도메인으로 빌드한 앱도 계속 동작합니다.

### Ingress 사용

한 클래스의 모든 Ingress는 그 컨트롤러의 Service, 즉 하나의 로드 밸런서를 통해 접근합니다. 이미지 호스트에는 [Ingress 사용](./1-edge.md#ingress-사용)의 값으로 설치한, 고유한 클래스를 가진 두 번째 컨트롤러를 두거나, [테넌트의 이미지 호스트](../4-edge/index.md#테넌트의-이미지-호스트)에서도 허용하듯 기존 컨트롤러에 둡니다. 어느 경우든 Ingress 하나가 이를 라우팅하며, 그 호스트의 다른 모든 경로는 어떤 규칙도 지정하지 않으므로 Traefik이 직접 `404`로 응답합니다.

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

공개 API의 호스트는 기존 컨트롤러에 둔 같은 형태의 Ingress 하나로, 호스트는 `api.example.com`이고, 유일한 경로는 `publira-storefront`로 가는 `/rpc/publira.v1.`(`ImplementationSpecific`)입니다.

### 분할 확인

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

첫 번째는 `404`로 응답합니다. 이미지 호스트는 이미지 외에는 아무것도 제공하지 않습니다. 두 번째는 `publira-storefront`에 도달하며, 서버는 빈 요청을 `invalid_argument`로 거부합니다. 세 번째도 `404`로 응답합니다. API의 호스트는 이미지를 제공하지 않습니다. 그런 다음 테넌트의 사이트를 열어 보세요. 이미지가 `https://images.comics.example.com/images/…`에서 로드됩니다.

## 메트릭

[메트릭](../../3-operations/11-monitoring.md#메트릭)에서 `PUBLIRA_METRICS_ENABLED=true`, `OTEL_METRICS_EXPORTER=prometheus`, `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`으로 켜면, `publira server`와 `publira worker`는 포트 `9464`에서 Prometheus 메트릭을 제공합니다. [프로세스 시작](./index.md#4-프로세스-시작)에서는 각각 별도의 Pod에서 실행되므로, 충돌 없이 각자 그 포트에서 수신합니다. 둘을 컨테이너 두 개로 실행하는 Pod는 하나의 네트워크 네임스페이스를 공유하므로, 나중에 시작한 쪽은 먼저 시작한 쪽이 점유한 포트에서 수신할 수 없습니다. 각각에 고유한 `OTEL_EXPORTER_PROMETHEUS_PORT`를 주거나, 별도의 Pod로 유지하세요.

## 업그레이드

[업그레이드](../8-upgrading.md)는 설치 환경을 새 릴리스로 올립니다. 백업, 새 릴리스의 `publiractl`로 마이그레이션과 역할 적용, 그다음 프로세스 순서입니다. 먼저 그 페이지와 릴리스 노트를 읽으세요. 클러스터에서는 그 단계가 다음과 같이 됩니다.

1. **프로세스 중지**: [먼저 프로세스를 멈출지 결정하기](../8-upgrading.md#먼저-프로세스를-멈출지-결정하기)에서 판단한 결과 먼저 중지하기로 했다면, 설치 환경의 모든 Deployment를 0으로 스케일해 중지합니다.

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   이 레이블은 설치 환경의 모든 Deployment의 Pod를 선택하고, Job의 Pod는 제외합니다. Job의 Pod는 이미 끝났으며 로그를 위해 남아 있는 것입니다.

2. **데이터베이스 백업**: [데이터베이스 백업](../8-upgrading.md#1-데이터베이스-백업)에서 설명하듯, 데이터베이스에 접근할 수 있는 호스트에서 `pg_dump`로 하거나 관리형 데이터베이스의 스냅숏으로 합니다.
3. **마이그레이션과 역할 적용**: Job은 변경할 수 없으므로 이전 릴리스의 Job이 아직 남아 있다면 삭제하고, [마이그레이션 적용](./index.md#2-마이그레이션-적용)과 [역할 만들기](./index.md#3-역할-만들기)의 두 Job에서 `<tag>`를 새 릴리스로 바꾼 다음, 그 순서대로 실행하며 각각이 완료되기를 기다립니다.

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   역할 Job은 각 역할에 `publira-db-roles`가 그 역할에 대해 가진 비밀번호, 즉 이미 가진 비밀번호를 주므로 플래그를 바꾸지 않고 실행합니다. 역할을 추가하는 릴리스에서는 그 역할의 비밀번호를 `publira-db-roles`에 넣고 플래그를 추가해야 합니다.

4. **새 릴리스 시작**: 모든 Deployment에서 `<tag>`를 바꾸고, 릴리스 노트에 나온 변수를 추가하고, 적용합니다. 매니페스트를 적용하면 0으로 스케일했던 복제본이 복원됩니다.
5. **설치 환경 확인**: [설치 환경 확인](../8-upgrading.md#5-설치-환경-확인)에서 설명하는 대로 합니다.

반대로 업그레이드 중에도 프로세스를 계속 실행한다면, 4단계에서 [프로세스 교체](../8-upgrading.md#4-프로세스-교체)에 나온 순서로 프로세스를 교체합니다. `email-renderer`를 실행한다면 먼저 적용하고, 그다음 다른 Deployment를 적용합니다. 이들은 설치 환경이 서비스를 계속하는 동안 복제본을 하나씩 교체합니다.
