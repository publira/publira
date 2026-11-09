---
title: Kubernetes
description: Secret과 Deployment, 그 앞에 두는 Gateway 또는 Ingress부터 테넌트 콘솔에 처음 로그인하기까지, Kubernetes 클러스터에서 설치 환경을 실행합니다.
published: 2026-11-03
updated: 2026-11-09
source_updated: 2026-11-09
---

이 페이지는 Kubernetes 클러스터의 빈 네임스페이스에서 시작해 테넌트 콘솔에 처음 로그인하기까지 설치 환경을 만들어 갑니다. 단계는 [설치](../2-installing.md)와 같습니다. 각 단계가 왜 필요한지, 각 시크릿이 무엇을 보호하는지, 각 데이터베이스 역할이 무엇에 접근할 수 있는지는 그 페이지가 설명하며, 엣지는 [엣지](../4-edge/index.md#엣지가-해야-하는-일)가 요구하는 방식으로 앞에 둡니다. 이 페이지는 클러스터에 고유한 부분, 즉 각 구성 요소가 어떤 리소스가 되는지, 그리고 두 페이지의 각 요구 사항을 그 리소스로 어떻게 충족하는지를 다룹니다.

아래의 매니페스트는 환경에 맞게 고쳐 쓰는 예시이며, 유지 관리되는 세트가 아닙니다. 저장소는 Helm 차트, Kustomize 베이스, Operator를 제공하지 않습니다. 매니페스트는 공개된 이미지 `ghcr.io/publira/<name>:<tag>`를 지정합니다. [시작하기 전에](../2-installing.md#시작하기-전에)에서 설명하는 대로 `<tag>` 자리에 설치하는 릴리스의 버전을 쓰세요.

## 클러스터에서 실행되는 것

오래 실행되는 프로세스는 모두 Deployment이며, 무언가가 호출하는 프로세스는 모두 같은 이름의 Service를 통해 접근합니다.

| Deployment | 이미지와 인수 | 포트 | Service | 복제본 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 있음: 엣지와 웹 앱이 호출합니다 | 개수 제한 없음 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`, 인수로 `worker` | `8003`, 프로브 전용 | 없음: 호출하는 곳이 없습니다 | 개수 제한 없음 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 있음: 엣지, 그리고 서버와 워커의 캐시 재검증이 호출합니다 | 개수 제한 없음 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | 있음, `web-storefront`와 같습니다 | 개수 제한 없음 |
| `web-platform`, 실행하는 경우 | `ghcr.io/publira/web-platform:<tag>` | `4100` | 있음, `web-storefront`와 같습니다 | 개수 제한 없음 |
| `email-renderer`, 실행하는 경우 | `ghcr.io/publira/email-renderer:<tag>` | `8080` | 있음: 워커가 호출합니다 | 개수 제한 없음 |

워커는 복제본을 여러 개 실행해도 됩니다. 모든 예약 작업은 실행 중인 동안 유일하므로, 두 복제본이 같은 작업을 동시에 실행하는 일은 없습니다. 반복되는 작업도 모두 워커가 직접 예약하므로 설치 환경에는 CronJob이 필요하지 않습니다. 서버나 워커의 복제본은 각각 데이터베이스 로그인마다 풀을 하나씩 열기 때문에, 복제본을 늘리려면 더 많은 연결을 받아들이는 데이터베이스가 필요합니다. 계산 방법은 [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)에 있습니다.

`publira server`와 `publira worker`는 하나의 `publira server --with-worker`가 아니라 위의 두 Deployment로 실행하세요. 이 플래그는 호스트 한 대에 설치하는 경우를 위한 것입니다. 클러스터에서는 두 프로세스를 따로 확장할 수 없게 되고, [개요](../1-overview.md#설치-환경이-실행하는-것)에서 설명하듯 워커의 데이터베이스 로그인을 엣지가 요청을 전달하는 프로세스에 두게 되며, 클러스터에 필요한 것은 아무것도 얻지 못합니다.

`publiractl`은 계속 실행해 두지 않습니다. 설치하는 릴리스의 이미지로 Job으로 실행하거나, 연결(attach)하는 Pod로 실행합니다.

## 시작하기 전에

다음이 필요합니다.

- **클러스터**: 노드가 이미지가 공개된 두 플랫폼인 `linux/amd64` 또는 `linux/arm64`이고, `kubectl`이 그 클러스터에 로그인되어 있어야 합니다. 각 단계는 `publira` 네임스페이스에서 Secret, Deployment, Service, Job, Pod를 생성·변경·삭제하고, Pod 로그를 읽고, Pod에 연결하며, 엣지의 리소스(Gateway, HTTPRoute, Envoy Gateway HTTPRouteFilter, 또는 Ingress와 Traefik Middleware 두 개)를 관리합니다. 네임스페이스와 어떤 네임스페이스에도 속하지 않는 `ClusterIssuer`를 만들고 cert-manager와 엣지의 컨트롤러를 설치하려면 클러스터 관리자가 필요합니다. 나머지는 네임스페이스에 바인딩한 기본 제공 `admin` 역할로 충분하지만, 커스텀 리소스는 예외입니다. 커스텀 리소스는 그것을 설치할 때 해당 역할에 추가되는 경우에만 포함되며, Envoy Gateway의 설치는 Gateway, HTTPRoute, 자체 HTTPRouteFilter를 추가하지 않습니다.
- **Gateway API 구현 또는 Ingress 컨트롤러**: 엣지 역할을 하며, **cert-manager**가 인증서를 발급합니다. 자세한 내용은 [Kubernetes의 엣지](./1-edge.md)에 있습니다. 엣지의 Service는 인터넷에서 접근할 수 있어야 하며, 보통 `LoadBalancer` 타입의 Service로 둡니다.
- **설치 환경이 의존하는 서비스**: [서비스 준비](../2-installing.md#서비스-준비)에 나열된 대로 준비합니다. 클러스터 밖의 관리형 서비스든 클러스터 안에서 실행하든 상관없습니다. 데이터베이스를 소유하고 역할을 만들 수 있는 관리용 로그인이 있는 PostgreSQL 데이터베이스, Valkey 인스턴스, 빈 버킷과 그 자격 증명, SMTP 서버가 필요합니다. 설치 환경의 모든 Pod가 이들에 접근할 수 있어야 합니다.
- **DNS**: 테넌트의 도메인과 그 콘솔 호스트(`admin.<domain>` 또는 `--admin-domain`으로 지정할 호스트) 둘 다, 엣지의 Service에 주소가 생기면 그 주소를 가리키도록 합니다.

아래의 모든 명령은 `publira` 네임스페이스에서 실행합니다.

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. Secret 만들기

[시크릿 생성](../2-installing.md#시크릿-생성)에 설치 환경에 필요한 모든 시크릿과 각각이 보호하는 대상이 나열되어 있습니다. 같은 방법으로 한 번만 생성하세요.

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

그런 다음 각 프로세스에는 그 프로세스가 읽는 것만, 전용 Secret으로 전달합니다. 연결 URL에는 역할 비밀번호가 들어 있으므로 이것도 시크릿이며, 비밀번호가 들어간 Redis URL도 마찬가지입니다. 아래의 값 대신 사용하는 데이터베이스의 호스트와 Valkey URL을 쓰세요.

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
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_WORKER_DB_URL="postgres://publira_outbox:$OUTBOX_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_TICKER_DB_URL="postgres://publira_ticker:$TICKER_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_CONTENT_STATS_DB_URL="postgres://publira_content_stats:$CONTENT_STATS_DB_PASSWORD@$DB"

kubectl create secret generic web-storefront \
  --from-literal=PUBLIRA_AUTH_SECRET="$STOREFRONT_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL"

kubectl create secret generic web-admin \
  --from-literal=PUBLIRA_AUTH_SECRET="$ADMIN_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
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

| Secret | 읽는 곳 | 방법 |
| --- | --- | --- |
| `publira-encryption` | `publira-server`, `publira-worker`, 그리고 모든 `publiractl` 실행 | 환경 변수로 |
| `publira-server` | `publira-server`, 그리고 `publiractl setup` | 환경 변수로. `setup`은 여기서 `PUBLIRA_PLATFORM_DB_URL`만 `secretKeyRef`로 가져옵니다 |
| `publira-worker` | `publira-worker` | 환경 변수로 |
| `web-storefront`, `web-admin` | 같은 이름의 웹 앱 | 환경 변수로 |
| `publiractl` | `db` Job | 환경 변수로. [관리용 로그인](../2-installing.md#서비스-준비)의 연결인 `PUBLIRA_DB_URL`만 담습니다. 이를 읽는 것은 `db` 명령뿐이므로, 다른 `publiractl` 명령이나 계속 실행되는 어떤 것에도 전달하지 않습니다 |
| `publira-db-roles` | `db roles` Job | 역할마다 하나씩 파일로. `db roles`가 `--<role>-password-file` 플래그로 읽습니다 |

클러스터의 Secret은 백업이 아닙니다. 암호화 키는 자체 시크릿 저장소에도 보관하세요. 키를 잃어버리면 [시크릿 생성](../2-installing.md#시크릿-생성)에서 말하듯, 설치 환경이 저장한 모든 자격 증명을 다시 입력해야 합니다. 클러스터가 동기화해 오는 저장소에 시크릿을 보관한다면(예를 들어 그 저장소에서 Secret을 작성하는 오퍼레이터를 사용하는 경우), 같은 키를 가진 같은 Secret을 작성하도록 하세요.

## 2. 마이그레이션 적용

`db migrate`는 릴리스의 `publiractl` 이미지로, 관리용 로그인의 연결을 사용해 Job으로 실행합니다.

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

`backoffLimit: 0`은 실패한 마이그레이션을 Kubernetes가 스스로 다시 실행하지 않게 합니다. 실패한 실행은 데이터베이스를 dirty 상태로 표시하며, 이는 [마이그레이션이 실패했을 때](../8-upgrading.md#마이그레이션이-실패했을-때)에 따라 직접 해결합니다. `kubectl wait`는 Job이 실패했든 아직 실행 중이든 10분이 지나면 기다리기를 멈추므로, 어느 경우든 로그를 읽으세요.

Job은 한 번 만들어지면 변경할 수 없으며, 완료했든 실패했든 끝난 Job은 매니페스트를 적용해도 다시 실행되지 않습니다. 이 Job은 끝나고 하루가 지나면 삭제됩니다. 그 전에 다시 실행하려면(그 복구 절차의 마지막 단계처럼) 먼저 Job을 삭제합니다.

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

아래의 `db roles` Job과 `setup` Job도 같은 방법으로 다시 실행합니다.

## 3. 역할 만들기

`db roles`는 마이그레이션 다음에 같은 방법으로 실행합니다. 역할 비밀번호는 파일로 마운트한 `publira-db-roles` Secret에서 읽습니다.

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

로그에는 역할마다 한 줄씩 출력됩니다. 나중에 역할의 비밀번호를 교체할 때도 같은 Job을 사용합니다. `publira-db-roles`와 그 비밀번호가 들어 있는 연결 URL에서 비밀번호를 바꾸고, Job을 다시 실행한 다음, 그 역할로 연결하는 Deployment를 재시작합니다. 마이그레이션과 마찬가지로, 다시 적용하기 전에 끝난 Job을 삭제합니다. `publira-server`가 URL을 가지고 있는 `publira_admin`의 경우는 다음과 같습니다.

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. 프로세스 시작

각 프로세스는 Secret을 환경 변수로 받고, [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)에 나열된 나머지 변수는 Deployment에서 받습니다. liveness 프로브는 `/livez`, readiness 프로브는 `/readyz`이며, 타임아웃은 [오케스트레이터에서 프로브하기](../../3-operations/11-monitoring.md#오케스트레이터에서-프로브하기)에 나온 값을 씁니다. 검사를 차례로 실행하는 서버와 워커는 6초보다 길게, 웹 앱은 2초보다 길게 둡니다.

`publira server`와 `publira worker`는 종료 지시를 받은 뒤 30초 안에 멈추므로, Deployment는 Kubernetes가 강제 종료하기 전까지 기본값 30초 대신 45초를 줍니다. 또한 `publira-server`는 먼저 `preStop` 훅에서 5초를 기다려, 요청 수락을 멈추기 전에 엣지가 요청 보내기를 멈추게 합니다. 둘 다 필요한 이유는 [복제본 멈추기](../7-scaling-out.md#복제본-멈추기)에 있습니다. 훅은 `sleep` 액션을 사용하는데, 이미지에 셸이 필요 없고 Kubernetes 1.30 이상에서 실행됩니다.

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
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-server
          image: ghcr.io/publira/publira:<tag>
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

`PUBLIRA_TRUSTED_PROXIES`는 클러스터가 Pod에 주소를 할당하는 범위로, 프로바이더에서는 클러스터의 Pod 주소 범위로 표시됩니다. 이 값을 설정하는 이유는 [클라이언트 주소](./1-edge.md#클라이언트-주소)에 있습니다.

Service가 필요 없는 `publira-worker.yaml`:

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
      terminationGracePeriodSeconds: 45
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

두 웹 앱도 같은 형태이며, 둘 다 Service를 통해 `publira server`를 호출합니다. `web-storefront.yaml`:

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

`web-storefront`는 테넌트의 Google tag gateway에 전달할 독자의 주소를 찾기 위해 `publira server`와 같은 `PUBLIRA_TRUSTED_PROXIES`를 받습니다. `web-admin.yaml`은 `web-storefront`가 나오는 모든 곳(Secret 이름 포함)을 `web-admin`으로 바꾸고, 포트를 `3000` 대신 `4000`으로 하고, `web-admin`이 읽지 않는 `PUBLIRA_TRUSTED_PROXIES`를 뺀 것과 같습니다.

모두 적용하고, 모든 Deployment가 준비될 때까지 기다립니다.

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker`는 시작할 때 작업 큐의 테이블을 만들므로 별도의 Job이 필요 없습니다. 준비 상태가 되지 않는 Deployment는 그 Pod의 `/readyz`와, 로그의 `readiness check failed` 줄에 이유를 표시합니다. 비밀번호가 연결 URL과 일치하지 않는 역할은 거기에 `db.public` 같은 로그인 이름으로 표시됩니다.

## 5. 설치 환경 설정

`publiractl setup`은 한 번 실행합니다. 터미널에 연결해 모든 값을 묻게 하거나, 모든 값을 플래그로 주어 Job으로 실행합니다. 어느 쪽이든 `publira-server` Secret의 `PUBLIRA_PLATFORM_DB_URL`로 `publira_platform`으로 연결하고, 저장하는 값을 암호화 키로 봉인하므로, 둘 다 프로세스가 읽는 `publira-encryption` Secret을 읽습니다. 어느 쪽에도 `publiractl` Secret은 주지 않습니다. `setup`은 관리용 로그인으로 연결하지 않습니다.

어느 쪽이든 출력은 컨테이너 로그로 가고, 클러스터의 로그 수집이 이를 보관할 수 있습니다. 따라서 관리자의 비밀번호는 생성하게 하지 말고 직접 지정하세요. 생성된 비밀번호는 요약에 출력됩니다. 프롬프트에 입력한 비밀번호는 화면에 표시되지 않으며, 파일로 준 비밀번호는 출력되지 않습니다.

터미널에서는 연결하는 Pod에서 실행하며, 이 Pod는 종료되면 삭제됩니다.

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

무인으로 실행할 때는 모든 값을 플래그로 주고, 저장되는 시크릿(관리자의 비밀번호 포함)은 전용 Secret의 파일로 줍니다.

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

Amazon S3가 아닌 스토리지에서는 `--endpoint`로 그 URL을 추가하고, 경로 방식으로 버킷을 지정하는 경우 `--force-path-style`도 추가합니다. 모든 플래그와 선택 사항인 단계는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)에 나열되어 있습니다.

연결 테스트를 거부하는 오브젝트 스토리지 등에서 실행이 도중에 멈추면, 저장한 내용은 남아 있으며 원인을 고친 뒤 다시 실행하면 마무리됩니다. 마이그레이션과 마찬가지로 실패한 Job을 삭제하고 다시 적용하세요.

관리자의 비밀번호는 `publiractl-setup` Secret의 `admin-password` 키입니다. 관리자가 로그인해 비밀번호를 변경하고 나면 이 Secret을 삭제하세요. 그 뒤로는 아무것도 이를 읽지 않습니다.

## 6. 엣지를 앞에 두기

엣지는 각 호스트와 경로를 알맞은 Service로 라우팅하고, TLS를 종단하며, 호출자가 정해서는 안 되는 헤더를 제거합니다. [Kubernetes의 엣지](./1-edge.md)는 cert-manager가 인증서를 발급하는 Gateway 또는 Ingress로 엣지를 앞에 두고, 클러스터 밖에서 이를 확인합니다. 그 확인이 통과하면 로그인하러 이 페이지로 돌아오세요.

## 7. 로그인

`https://admin.comics.example.com` 또는 `--admin-domain`으로 지정한 콘솔 호스트에서 테넌트 콘솔을 열고, 관리자의 이메일 주소와 비밀번호로 로그인합니다. 이후의 설치 환경은 [로그인](../2-installing.md#6-로그인)에서 설명하는 것과 같습니다.

## 이 섹션의 내용

- [Kubernetes의 엣지](./1-edge.md): 인증서, Service 앞에 두는 Gateway 또는 Ingress, 클라이언트 주소, 클러스터 밖에서 엣지 확인하기.
- [Kubernetes에서의 운영](./2-operating.md): 테넌트 추가, 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기, 메트릭, 업그레이드.

## 다음 단계

Gateway 또는 Ingress가 해야 하는 일의 전체 내용은 [엣지](../4-edge/index.md)에, 설치 환경이 서비스를 시작한 뒤 지켜봐야 할 것은 [모니터링](../../3-operations/11-monitoring.md)에 있습니다. 각 프로세스가 읽는 변수는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md)에 있으며, 선택 사항인 프로세스는 [선택 프로세스 켜기](../2-installing.md#선택-프로세스-켜기)에서 설명하는 대로, 각각 위와 같은 Deployment와 Service로 켭니다.
