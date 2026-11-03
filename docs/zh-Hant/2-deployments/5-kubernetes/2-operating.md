---
title: 在Kubernetes上營運
description: 在Kubernetes叢集上執行的安裝實例中新增租戶、讓主控台的認證資訊遠離租戶的網域、分開提供圖片與公開API、公開指標，以及升級。
published: 2026-11-03
source_updated: 2026-10-25
---

本頁說明[Kubernetes](./index.md)讓安裝實例開始提供服務之後，對它所做的變更。每項變更都會修改該頁與[Kubernetes上的邊緣](./1-edge.md)所建立的資源。

## 新增租戶

以`publiractl tenant create`或在平台主控台中建立的租戶，需要在邊緣上設定它的兩個主機名稱，如[新增租戶](../4-edge/index.md#新增租戶)所述。在叢集上，做法如下：

- **使用Gateway時**：在Gateway上加入兩個HTTPS listener，一個用於租戶的網域，一個用於其主控台主機，各自使用自己的Secret名稱，並把每個listener的名稱加入其Web應用程式之HTTPRoute的`parentRefs`。cert-manager會依Gateway的註解簽發這兩張憑證。一個Gateway最多可容納64個listener，因此除了`http` listener之外，一個Gateway最多可服務31個租戶；之後的租戶請放在另一個Gateway上，並使用該Gateway自己的HTTPRoute。
- **使用Ingress時**：把網域加入`web-storefront` Ingress的`tls`項目與規則，把主控台主機加入`web-admin`的對應位置，並把兩者都加入`api-not-found`。[使用Ingress](./1-edge.md#使用ingress)中的YAML錨點（`&storefront-paths`、`&admin-paths`、`&not-found-paths`）可讓新規則以`paths: *storefront-paths`重用這些路徑。`tls`項目變更時，cert-manager會為新的名稱簽發憑證。

套用變更之前，請先把兩個名稱指向邊緣的位址，讓cert-manager的挑戰能夠抵達邊緣。

## 讓主控台的認證資訊遠離租戶的網域

邊緣已經讓主控台的API不暴露於網際網路，但邊緣把租戶網域轉送過去的`publira-server`仍然提供這些API，並為此持有它們的資料庫登入與Web服務權杖。若要把這三者都移出讀者會接觸到的處理程序，作為與邊緣規則不同的另一層防護（如[只有公開API經過邊緣](../4-edge/index.md#只有公開api經過邊緣)所述），請以`--role storefront`執行第二個Deployment，並把租戶的網域與`web-storefront`路由到它。這樣拆分也能讓讀者的流量與主控台分開擴充，因為每個Deployment都有自己的副本，如[依角色拆分伺服器](../7-scaling-out.md#依角色拆分伺服器)所述：

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

它的Secret存放它所讀取的`publira server`值，其中不含Web服務權杖，也不含`publira_public`以外的任何連線。請在您[建立其他Secret](./index.md#1-建立secret)時所用、仍保有那些值的shell中建立它：

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

接著，只在租戶的網域上（也就是`web-storefront`的HTTPRoute或Ingress中），把`/images`與`/rpc`下公開API的後端從`publira-server`改為`publira-storefront`；`web-storefront`只呼叫公開API，因此也讓它指向`publira-storefront`：在其Deployment中把`PUBLIRA_GRPC_URL`設為`http://publira-storefront:8000/rpc`。主控台主機的路由、`web-admin`與`web-platform`則繼續呼叫提供所有角色的`publira-server`，直到[讓主控台的伺服器不提供公開API](#讓主控台的伺服器不提供公開api)把公開API從它身上移除。

無論如何，邊緣都會在每個主機上對主控台API回應`404`，因此改從叢集內部呼叫這兩個Service來檢查：

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`會回應`404`，因為它不提供該API。`publira-server`會回應`400`：該API在那裡有提供，並拒絕了這個空的請求。

### 讓主控台的伺服器不提供公開API

`publira-server`仍然提供公開API並持有`publira_public`，因為`web-admin`會呼叫公開API來取得租戶的主題與標籤，而主控台主機的路由也會把公開API轉送到那裡。把這兩者都送往`publira-storefront`後，`publira-server`就能以`--role admin,platform`執行，如[依角色拆分伺服器](../7-scaling-out.md#依角色拆分伺服器)的第4步所述。請依以下順序進行變更，這樣在`publira-server`停止提供公開API時，就不會再有任何東西向它傳送公開API請求。

首先，讓`web-admin`的公開API呼叫指向storefront的Service。在其Deployment的`env`中、於`PUBLIRA_GRPC_URL`（仍指定`publira-server`）旁加入此變數，然後套用：

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

此後它的`/readyz`也會以`public-api`的名稱檢查該Service。

接著，把主控台主機的公開API路由到`publira-storefront`（它在任何主機上都會回應），並讓其`/images`留在`publira-server`，因為主控台頁面所顯示的圖片屬於`admin`角色。在`web-admin` HTTPRoute中，把第一條規則拆成兩條：

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

若使用`web-admin` Ingress，則改為把`/rpc/publira.v1.`路徑的後端改成`publira-storefront`。

最後，在`publira-server.yaml`中為`publira-server`容器加上`args: ["server", "--role", "admin,platform"]`，從其Secret中移除`PUBLIRA_PUBLIC_DB_URL`（沒有其他東西從這裡讀取它），然後套用Deployment：

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

確認`publira-server`已不再提供公開API。以下呼叫先前回應`400`，現在則會回應`404`：

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

登入租戶主控台：它會和先前一樣顯示租戶的主題並列出標籤，只是現在是從`publira-storefront`讀取。

## 分開提供圖片與公開API

租戶的圖片與公開API可以使用各自的主機名稱，並各自經由自己的負載平衡器存取，如[分開提供圖片與公開API](../7-scaling-out.md#分開提供圖片與公開api)所述。在使用Gateway的叢集上，每個Gateway都是獨立的負載平衡器，因此圖片會在專屬的Deployment前方有第二個Gateway，而公開API則是在既有Gateway上、位於`publira-storefront`前方的一個主機名稱。這是建立在建立了`publira-storefront`的[讓主控台的認證資訊遠離租戶的網域](#讓主控台的認證資訊遠離租戶的網域)之上。以下名稱為範例：`images.comics.example.com`是租戶的圖片主機，`api.example.com`是公開API的主機。

### 圖片

讓圖片在專屬的Deployment上執行，使其流量能與API分開擴充。把`publira-storefront`的Deployment與Service複製到`publira-images.yaml`，將其名稱、標籤、selector與容器名稱中的`publira-storefront`改為`publira-images`，並保留`secretRef: {name: publira-storefront}`：兩者提供相同的角色，讀取相同的Secret。然後套用：

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

為圖片主機設置專屬的Gateway，每個圖片主機一個HTTPS listener，再加上一個HTTPRoute，只把這些主機上的`/images`轉送到`publira-images`，其他一概不轉送。沒有任何規則符合的路徑，會由Gateway本身回應`404`：

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

這個過濾器移除的標頭與其他路由相同，原因見[使用Gateway](./1-edge.md#使用gateway)。cert-manager會在新Gateway的`http` listener上回應圖片主機的ACME挑戰，因此請把它加入`letsencrypt`簽發者之solver的`parentRefs`，與[憑證](./1-edge.md#憑證)中設定的那一項並列：

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

把每個圖片主機指向新Gateway的位址，等待其憑證簽發，然後在平台主控台的**圖片主機**中，或以`publiractl tenant update --image-domain`，將它指定給租戶，如[圖片主機](../../3-operations/2-tenants.md#圖片主機)所述。之後新增的租戶，要在`publira-images`上為其圖片主機加入一個listener，並把該listener的名稱加入`images` HTTPRoute的`parentRefs`。

### 公開API

在`publira` Gateway上為公開API設置專屬的主機名稱，再加上一個HTTPRoute，只把該主機上的公開API轉送到`publira-storefront`，其他一概不轉送。把listener加入Gateway的`listeners`：

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

然後套用路由：

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

Web應用程式已經透過叢集的網路呼叫`publira-storefront`，不經過負載平衡器：`web-storefront`透過`PUBLIRA_GRPC_URL`，`web-admin`則在完成[讓主控台的伺服器不提供公開API](#讓主控台的伺服器不提供公開api)後透過`PUBLIRA_PUBLIC_GRPC_URL`。在叢集外部執行的Web應用程式則改為指定`https://api.example.com/rpc`。租戶有了圖片主機之後，請以`PUBLIRA_BASE_URL=https://api.example.com`建置租戶的行動應用程式，如[應用程式連線的位址](../../5-mobile-app/2-building.md#應用程式連線的位址)所述。租戶的網域維持原有的路由，因此以租戶網域建置的應用程式仍可繼續運作。

### 使用Ingress

同一類別的每個Ingress都經由其控制器的Service存取，而那就是一個負載平衡器。請為圖片主機安裝第二個具有專屬類別的控制器（以[使用Ingress](./1-edge.md#使用ingress)中的值安裝），或讓它們留在既有的控制器上，[租戶的圖片主機](../4-edge/index.md#租戶的圖片主機)也允許這種做法。無論哪種方式，都以一個Ingress路由它們；由於沒有任何規則指定其他路徑，Traefik會自行以`404`回應這些主機上的其他所有路徑：

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

公開API的主機則是在既有控制器上再加一個相同結構的Ingress，主機為`api.example.com`，唯一的路徑是以`ImplementationSpecific`指定、導向`publira-storefront`的`/rpc/publira.v1.`。

### 檢查拆分結果

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

第一個指令會回應`404`：圖片主機只提供圖片。第二個會抵達`publira-storefront`，後者以`invalid_argument`拒絕這個空的請求。第三個也會回應`404`：API的主機不提供圖片。接著開啟租戶的網站：其圖片會從`https://images.comics.example.com/images/…`載入。

## 指標

當[指標](../../3-operations/11-monitoring.md#指標)以`PUBLIRA_METRICS_ENABLED=true`、`OTEL_METRICS_EXPORTER=prometheus`與`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`啟用指標後，`publira server`與`publira worker`會在`9464`連接埠提供Prometheus指標。在[啟動處理程序](./index.md#4-啟動處理程序)中，兩者各自在專屬的Pod中執行，因此各自監聽該連接埠也不會衝突。若一個Pod以兩個容器執行這兩者，它們會共用同一個網路namespace，後啟動的那一個就無法監聽先啟動者已占用的連接埠：請為各自設定不同的`OTEL_EXPORTER_PROMETHEUS_PORT`，或讓它們維持在各自的Pod中。

## 升級

[升級](../8-upgrading.md)說明如何把安裝實例升級到新版本：備份、以新版本的`publiractl`執行遷移與建立角色，然後是處理程序。請先閱讀該頁及該版本的版本說明。在叢集上，其步驟如下：

1. **停止處理程序**（若您決定先停止它們，判斷依據見[決定是否先停止處理程序](../8-upgrading.md#決定是否先停止處理程序)），做法是把安裝實例的每個Deployment縮減為零：

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   這個標籤會選取安裝實例所有Deployment的Pod，並排除Job的Pod，後者已經結束，保留下來是為了其日誌。

2. **備份資料庫**：從能連線到資料庫的主機執行`pg_dump`，或為代管資料庫建立快照，如[備份資料庫](../8-upgrading.md#1-備份資料庫)所述。
3. **套用遷移與角色**：由於Job無法變更，若前一個版本的Job仍然存在，請先刪除它們；接著把[套用遷移](./index.md#2-套用遷移)與[建立角色](./index.md#3-建立角色)這兩個Job中的`<tag>`改為新版本，並依此順序執行，等待每一個完成：

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   角色的Job會為每個角色設定`publira-db-roles`中為它保存的密碼，也就是它目前已有的密碼，因此旗標不需變更即可執行。若某個版本新增了角色，則需要在`publira-db-roles`中加入該角色的密碼，並加上其旗標。

4. **啟動新版本**：在每個Deployment中變更`<tag>`，加入版本說明所列的變數，然後套用。套用manifest會還原您先前縮減為零的副本數。
5. **檢查安裝實例**，如[檢查安裝實例](../8-upgrading.md#5-檢查安裝實例)所述。

若改為在升級期間讓處理程序持續執行，第4步會依[替換處理程序](../8-upgrading.md#4-替換處理程序)所列的順序替換它們。若有執行`email-renderer`，請先套用它，再套用其他Deployment；這些Deployment會一次滾動更新一個副本，而安裝實例在此期間持續提供服務。
