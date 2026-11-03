---
title: Kubernetes
description: 在Kubernetes叢集上執行安裝實例，從Secret與Deployment、置於其前方的Gateway或Ingress，一直到第一次登入租戶主控台。
published: 2026-11-03
source_updated: 2026-10-31
---

本頁從Kubernetes叢集上一個空的namespace開始，帶著安裝實例一路走到第一次登入租戶主控台。它執行的步驟與[安裝](../2-installing.md)相同；每個步驟為何存在、每個密鑰保護什麼、每個資料庫角色能存取什麼，都在該頁說明。邊緣則依[邊緣](../4-edge/index.md#邊緣必須做的事)的要求設置於前方。本頁涵蓋叢集特有的部分：每個部分會成為哪些資源，以及如何用這些資源滿足上述兩頁的每項要求。

以下的manifest是供您調整使用的範例，並非持續維護的一套設定：儲存庫不提供Helm chart、Kustomize base或Operator。這些manifest指定已發布的映像檔`ghcr.io/publira/<name>:<tag>`；請依[開始之前](../2-installing.md#開始之前)的說明，把`<tag>`換成您要安裝的版本號。

## 在叢集中執行的內容

每個長時間執行的處理程序都是一個Deployment，而每個會被呼叫的處理程序，都透過同名的Service來存取：

| Deployment | 映像檔與引數 | 連接埠 | Service | 副本數 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 有：邊緣與Web應用程式會呼叫它 | 任意數量 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`，引數為`worker` | `8003`，僅供探測使用 | 無：沒有任何東西呼叫它 | 任意數量 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 有：邊緣，以及來自伺服器與worker的快取重新驗證 | 任意數量 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | 有，同`web-storefront` | 任意數量 |
| `web-platform`（若有執行） | `ghcr.io/publira/web-platform:<tag>` | `4100` | 有，同`web-storefront` | 任意數量 |
| `email-renderer`（若有執行） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | 有：worker會呼叫它 | 任意數量 |

worker可以執行多個副本，因為每個排程工作在執行期間都是唯一的，兩個副本不會同時執行同一個工作。worker也會自行排定所有週期性工作，因此安裝實例不需要CronJob。伺服器或worker的每個副本都會為每個資料庫登入開啟一個連線池，所以副本越多，資料庫就必須接受越多連線，計算方式見[Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

請將`publira server`與`publira worker`分別以上述兩個Deployment執行，而不是合併為一個`publira server --with-worker`。該旗標是供單一主機上的安裝實例使用的：在叢集中使用它，等於放棄分開擴充兩者，並且讓worker的資料庫登入出現在邊緣轉送請求的處理程序中（如[概觀](../1-overview.md#安裝實例執行的部分)所述），卻換不到任何叢集需要的東西。

`publiractl`不會持續執行。它以Job的形式，或以您附加（attach）的Pod形式，從您要安裝之版本的映像檔執行。

## 開始之前

您需要：

- **一個叢集**，其節點為`linux/amd64`或`linux/arm64`（映像檔所發布的兩種平台），以及已登入該叢集的`kubectl`。在`publira` namespace中，以下步驟會建立、變更與刪除Secret、Deployment、Service、Job與Pod，讀取Pod的日誌，附加到Pod，並管理邊緣的資源：一個Gateway、數個HTTPRoute與一個Envoy Gateway HTTPRouteFilter，或是數個Ingress與兩個Traefik Middleware。建立namespace與不屬於任何namespace的`ClusterIssuer`，以及安裝cert-manager與邊緣的控制器，需要叢集管理員執行。在該namespace中繫結內建的`admin`角色即可涵蓋其餘部分，但自訂資源除外：自訂資源只有在其安裝程序將它加入該角色時才會涵蓋，而Envoy Gateway的安裝程序並不會為Gateway、HTTPRoute與它自己的HTTPRouteFilter這麼做。
- **一個Gateway API實作或Ingress控制器**作為邊緣，以及**cert-manager**來簽發憑證，如[Kubernetes上的邊緣](./1-edge.md)所述。邊緣的Service必須能從網際網路存取，通常是類型為`LoadBalancer`的Service。
- **安裝實例所依賴的服務**，依[佈建服務](../2-installing.md#佈建服務)所列準備，無論是叢集外部的代管服務，還是在叢集內執行：一個PostgreSQL資料庫，以及擁有該資料庫且可建立角色的管理登入；一個Valkey執行個體；一個空的儲存貯體及其認證資訊；以及一台SMTP伺服器。安裝實例的每個Pod都必須能連線到這些服務。
- **DNS**：租戶的網域，以及其主控台主機（`admin.<domain>`，或您將以`--admin-domain`指定的主機），兩者都要在邊緣的Service取得位址後指向該位址。

以下每個指令都在`publira` namespace中執行：

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. 建立Secret

[產生密鑰](../2-installing.md#產生密鑰)列出了安裝實例所需的每個密鑰，以及每個密鑰保護的內容。以相同方式產生一次：

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

接著，只把每個處理程序會讀取的內容放進它專屬的Secret。連線URL中含有角色的密碼，因此它們也是密鑰；Redis URL一旦含有密碼也是如此。請把下方的資料庫主機與Valkey URL換成您自己的：

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

| Secret | 讀取者 | 方式 |
| --- | --- | --- |
| `publira-encryption` | `publira-server`、`publira-worker`，以及每次執行的`publiractl` | 作為環境變數 |
| `publira-server` | `publira-server`與`publiractl setup` | 作為環境變數。`setup`只透過`secretKeyRef`從中取得`PUBLIRA_PLATFORM_DB_URL` |
| `publira-worker` | `publira-worker` | 作為環境變數 |
| `web-storefront`、`web-admin` | 同名的Web應用程式 | 作為環境變數 |
| `publiractl` | `db`系列的Job | 作為環境變數。它只存放`PUBLIRA_DB_URL`，也就是[管理登入](../2-installing.md#佈建服務)的連線：只有`db`系列指令會讀取它，因此其他`publiractl`指令以及任何持續執行的處理程序都不會拿到它 |
| `publira-db-roles` | `db roles`的Job | 作為檔案，每個角色一個，由`db roles`以其`--<role>-password-file`旗標讀取 |

叢集中的Secret並不是備份。請同時把加密金鑰保存在您自己的密鑰儲存庫中：一旦遺失，安裝實例所儲存的每項認證資訊都必須重新輸入，如[產生密鑰](../2-installing.md#產生密鑰)所述。如果您把密鑰放在叢集會從中同步的儲存庫裡（例如透過從該儲存庫寫入Secret的operator），請讓它以相同的鍵寫入相同的Secret。

## 2. 套用遷移

`db migrate`以Job的形式，從該版本的`publiractl`映像檔執行，並使用管理登入的連線：

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

`backoffLimit: 0`可防止Kubernetes自行重新執行失敗的遷移：失敗的執行會讓資料庫被標記為dirty，這需要依[遷移失敗時](../8-upgrading.md#遷移失敗時)的說明手動處理。無論Job是失敗還是仍在執行，`kubectl wait`都會在十分鐘後放棄等待，因此無論哪種情況都請讀取它的日誌。

Job一旦建立就無法變更；已結束的Job，無論是完成還是失敗，在再次套用其manifest時都不會重新執行。這個Job會在結束一天後被刪除。在那之前若要再次執行它（如該復原流程的最後一步所做的），請先刪除它：

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

下方的`db roles`與`setup` Job也以相同方式重新執行。

## 3. 建立角色

`db roles`在遷移之後以相同方式執行。它從以檔案形式掛載的`publira-db-roles` Secret讀取角色密碼：

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

日誌中每個角色會有一行。之後輪替角色密碼也是用這個Job：在`publira-db-roles`以及含有該密碼的連線URL中變更密碼，再次執行Job，然後重新啟動以該角色連線的Deployment。與遷移相同，再次套用前請先刪除已結束的Job。以`publira-server`所持有其URL的`publira_admin`為例：

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. 啟動處理程序

每個處理程序都以環境變數的形式取得自己的Secret，[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出的其餘變數則寫在其Deployment中。它的存活探測（liveness probe）是`/livez`，就緒探測（readiness probe）是`/readyz`，逾時時間依[從協調器探測](../../3-operations/11-monitoring.md#從協調器探測)的建議設定：伺服器與worker的檢查會依序執行，因此要長於六秒；Web應用程式則要長於兩秒。

`publira server`與`publira worker`在收到停止指示後30秒內就會停止，因此它們的Deployment在Kubernetes強制終止前給予45秒（預設為30秒）；此外，`publira-server`會先在`preStop` hook中等待五秒，讓邊緣在它停止接受請求之前就不再傳送請求給它。兩者為何都需要，請見[停止副本](../7-scaling-out.md#停止副本)。這個hook使用`sleep` action，它不需要映像檔中有shell，Kubernetes自1.30版起支援。

`publira-server.yaml`：

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

`PUBLIRA_TRUSTED_PROXIES`是叢集分配Pod位址的範圍，您的供應商會將其顯示為叢集的Pod位址範圍；設定它的原因請見[用戶端位址](./1-edge.md#用戶端位址)。

`publira-worker.yaml`，不需要Service：

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

兩個Web應用程式採用相同的結構，並且都透過Service呼叫`publira server`。`web-storefront.yaml`：

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

`web-storefront`採用與`publira server`相同的`PUBLIRA_TRUSTED_PROXIES`，用來找出它要傳給租戶Google代碼閘道的讀者位址。`web-admin.yaml`與此相同，只是把所有出現`web-storefront`之處（包括其Secret的名稱）換成`web-admin`，連接埠以`4000`取代`3000`，並且沒有`PUBLIRA_TRUSTED_PROXIES`，因為`web-admin`不會讀取它。

套用全部檔案，並等待每個Deployment就緒：

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker`啟動時會建立其工作佇列的資料表，因此不需要專屬的Job。無法就緒的Deployment會在其Pod的`/readyz`中，以及在日誌的`readiness check failed`行中指出原因：密碼與連線URL不相符的角色會在那裡以`db.public`或其他登入的名稱標示出來。

## 5. 設定安裝實例

`publiractl setup`只執行一次，可以附加到終端機執行，此時它會逐一詢問每個值；也可以作為Job執行，此時每個值都以旗標提供。兩種方式都以`publira_platform`身分、使用`publira-server` Secret中的`PUBLIRA_PLATFORM_DB_URL`連線，並以加密金鑰密封它所儲存的內容，因此兩者都會讀取處理程序所讀取的`publira-encryption` Secret。兩者都不會拿到`publiractl` Secret：`setup`從不以管理登入連線。

無論採用哪種方式，它所輸出的內容都會進入容器的日誌，而叢集的日誌收集機制可能會保留這些日誌，因此請為管理員提供密碼，而不是讓系統產生：產生的密碼會印在摘要中。在提示中輸入的密碼不會回顯，以檔案提供的密碼也不會被印出。

在終端機上，於您附加的Pod中執行它，該Pod會在結束時被刪除：

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

若要無人值守執行，請以旗標提供每個值，並將它要儲存的密鑰（包括管理員的密碼）以檔案形式，從專屬的Secret提供：

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

若使用Amazon S3以外的物件儲存，請以`--endpoint`加上其URL；若它以路徑定址儲存貯體，再加上`--force-path-style`。[`publiractl`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)列出了每個旗標，以及哪些步驟是選用的。

在中途停止的執行（例如物件儲存拒絕了連線測試）會保留已儲存的內容，在排除原因後再次執行即可完成。與遷移相同，請刪除失敗的Job後再次套用。

管理員的密碼就是`publiractl-setup` Secret中的`admin-password`鍵。管理員登入並變更密碼後，請刪除這個Secret：之後不會再有任何東西讀取它。

## 6. 在前方設置邊緣

邊緣會把每個主機與路徑路由到正確的Service、終止TLS，並移除呼叫端不得自行指定的標頭。[Kubernetes上的邊緣](./1-edge.md)說明如何把它設置於前方（以Gateway或Ingress的形式，並由cert-manager簽發其憑證），以及如何從叢集外部檢查它。待這些檢查通過後，再回到這裡登入。

## 7. 登入

開啟位於`https://admin.comics.example.com`（或您以`--admin-domain`指定的主控台主機）的租戶主控台，並以管理員的電子郵件地址與密碼登入。從這裡開始，安裝實例就與[登入](../2-installing.md#6-登入)所描述的相同。

## 本節內容

- [Kubernetes上的邊緣](./1-edge.md)：憑證、Service前方的Gateway或Ingress、用戶端位址，以及從叢集外部檢查邊緣。
- [在Kubernetes上營運](./2-operating.md)：新增租戶、讓主控台的認證資訊遠離租戶的網域、指標，以及升級。

## 後續步驟

[邊緣](../4-edge/index.md)完整說明了Gateway或Ingress必須做到的事，[監控](../../3-operations/11-monitoring.md)則說明安裝實例開始提供服務後要觀察什麼。每個處理程序讀取的變數列在[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md)中，選用的處理程序則依[啟用選用處理程序](../2-installing.md#啟用選用處理程序)的說明啟用，各自是與上述相同的一個Deployment與一個Service。
