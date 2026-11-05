---
title: Kubernetes上的邊緣
description: 在Kubernetes叢集上的安裝實例前方設置Gateway或Ingress，由cert-manager簽發其憑證，並從叢集外部進行檢查。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

本頁是[Kubernetes](./index.md)的第6步：在[設定安裝實例](./index.md#5-設定安裝實例)執行完畢後，將邊緣設置於[啟動處理程序](./index.md#4-啟動處理程序)所建立的Service前方。

邊緣會把每個主機與路徑路由到正確的Service、終止TLS，並移除呼叫端不得自行指定的標頭，這是[邊緣必須做的事](../4-edge/index.md#邊緣必須做的事)的要求。在叢集上，邊緣可以是實作Gateway API之控制器上的Gateway搭配HTTPRoute，也可以是Ingress。以下兩者都會說明，路由方式相同：

| 主機 | 路徑 | Service |
| --- | --- | --- |
| 租戶的網域 | `/images`、`/rpc/publira.v1.…` | `publira-server`，連接埠`8000` |
| 租戶的網域 | `/rpc`的其餘部分 | 無：由邊緣回應`404` |
| 租戶的網域 | 其他所有路徑 | `web-storefront`，連接埠`3000` |
| 租戶的主控台主機 | `/images`、`/rpc/publira.v1.…` | `publira-server`，連接埠`8000` |
| 租戶的主控台主機 | `/rpc`的其餘部分 | 無：由邊緣回應`404` |
| 租戶的主控台主機 | 其他所有路徑 | `web-admin`，連接埠`4000` |

在`/rpc`之下，只有公開API `publira.v1`會被轉送：主控台透過叢集的網路呼叫它們自己的API，因此邊緣會自行以`404`回應其餘請求，原因見[只有公開API經過邊緣](../4-edge/index.md#只有公開api經過邊緣)。自有系統從叢集外部使用API金鑰的租戶，還需要轉送[金鑰可進行的讀取](../4-edge/index.md#api金鑰可進行的讀取)：請將它們逐一以完全相符的路徑加入該租戶主控台主機的路由，指向`publira-server`的連接埠`8000`，在HTTPRoute中為`type: Exact`，在Ingress中為`pathType: Exact`，這兩種資源都會先比對這些路徑，再比對`/rpc`的其餘部分。路徑與`Host`標頭會以瀏覽器送出時的原樣抵達Service；請不要改寫其中任何一者。

公開API的前綴結束於路徑區段之中，也就是`v1`之後的句點，而Gateway的`PathPrefix`與Ingress的`Prefix`都是以整個區段比對，因此兩者都無法單獨表示這個前綴。兩種API也都沒有自行回應請求的方法。這兩件事都交由實作處理，以下各節會說明所採用的實作如何做到。

## 憑證

cert-manager會從Let's Encrypt等ACME簽發者，為Gateway或Ingress所指定的每個主機名稱簽發並更新憑證。若使用Gateway，請在安裝時啟用其Gateway API支援（其Helm chart以`config.enableGatewayAPI: true`啟用），並建立一個透過邊緣回應ACME挑戰的簽發者：

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

若使用Ingress，solver則改為`http01: {ingress: {ingressClassName: <your class>}}`。挑戰會在每個主機名稱的80連接埠抵達邊緣，因此必須先設定DNS記錄。

## 使用Gateway

這些路由使用了兩項被Gateway API標示為Extended的功能，實作即使不支援它們也能符合該API：`HTTPRouteSchemeRedirect`用於重新導向至HTTPS，`HTTPRouteRequestTimeout`用於解除實作對Web應用程式請求所需時間的限制。Gateway API的[Implementations](https://gateway-api.sigs.k8s.io/docs/implementations/)頁面比較了各實作支援的功能，並連結到其一致性報告。Envoy Gateway兩者都支援。在缺少其中之一的實作上，請以該實作自身資源所提供的方式完成該部分，或改用[Ingress](#使用ingress)。

這些路由也從Envoy Gateway本身借用了兩項功能。公開API的前綴是以`RegularExpression`比對路徑，而Gateway API把其語法與優先順序交由各實作決定：Envoy Gateway以RE2運算式比對整個路徑，並且先嘗試正規表示式，再嘗試前綴。`/rpc`其餘部分的`404`則是Envoy Gateway專屬的`HTTPRouteFilter`，它會自行回應請求：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: not-found
spec:
  directResponse:
    statusCode: 404
```

在其他實作上，請使用該實作本身以正規表示式比對路徑、以及以`404`回應請求的方法。

Gateway為每個主機名稱設有一個HTTPS listener，各自指定存放其憑證的Secret，另外還有一個純HTTP listener，負責重新導向至HTTPS並回應ACME挑戰。`cert-manager.io/cluster-issuer`註解會讓cert-manager為每個HTTPS listener簽發憑證，存入該listener所指定的Secret：

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

每個Web應用程式各有一個HTTPRoute，以名稱附加到該應用程式的HTTPS listener，並從中取得主機名稱。每條規則都以所有實作都支援的`RequestHeaderModifier`過濾器，從請求中移除追蹤脈絡標頭、`Forwarded`、`X-Forwarded-Host`與`X-Forwarded-CountryRegion`：

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

- **公開API與`404`**。由於Envoy Gateway會先嘗試正規表示式，符合`/rpc/publira\.v1\..*`的路徑會抵達`publira-server`；`/rpc`的其餘部分則落入帶有`not-found`過濾器的`PathPrefix`規則，而`/api`與其他所有路徑一樣抵達Web應用程式。帶有過濾器的規則沒有`backendRefs`：過濾器會回應所有符合該規則的請求，不會轉送任何東西。
- **移除的標頭**。`traceparent`、`tracestate`與`baggage`依[追蹤脈絡](../4-edge/index.md#追蹤脈絡)的要求移除。除非另行指示，Gateway會把呼叫端送來的`Forwarded`與`X-Forwarded-Host`原樣傳下去，而Publira會讀取兩者，如[用戶端位址](../4-edge/index.md#用戶端位址)與[請求所送往的主機](../4-edge/index.md#請求所送往的主機)所述；在這裡移除它們，就能讓每個處理程序的`PUBLIRA_FORWARDED_HEADER_ENABLED`維持預設值。`X-Forwarded-CountryRegion`依[讀者的地區](../4-edge/index.md#讀者的地區)的要求移除：Envoy Gateway本身不會查詢地區，因此租戶的Google代碼閘道不會傳送任何地區給Google。若Gateway前方有CDN將此標頭設為讀者的地區（如[ECS前方的CloudFront](../6-ecs-fargate/1-cloudfront.md#標頭)所示），只要`web-storefront`的規則不把它列入`remove`，該標頭就會抵達`web-storefront`；但只有在該CDN是唯一能連線到Gateway的對象時，這樣做才安全。
- **上傳逾時**。`timeouts.request: 0s`會依Gateway API對零時長的定義，關閉Web應用程式請求所需時間的限制。若沒有這項設定，規則就會套用實作的預設值，而它可能短得多：Envoy Gateway的預設是請求抵達後15秒內必須回應。如[租戶主控台中的上傳](../4-edge/index.md#租戶主控台中的上傳)所述，租戶主控台中的章節上傳最多需要300秒才能完整抵達，而Gateway API允許實作把這段時間也計算在內，也就是在`web-admin`儲存頁面並回應之前的時間。Web應用程式本身會給請求300秒的抵達時間，因此邊緣不需要自己的限制。Gateway API沒有用於請求本文大小的欄位，而Envoy Gateway除非由它自己的policy加上限制，否則不會限制大小；若您的實作確實有限制，請在主控台主機的`/api/v1/episode-pages`允許256 MiB，在租戶網域的`/api/v1/webhook/email/`之下允許33 MiB。
- **重新導向**。`https-redirect`只附加到`http` listener，並把那裡的每個請求送往HTTPS。在簽發憑證期間，cert-manager會在同一個listener上為挑戰加入自己的路由。該路由指定憑證所屬的主機，因此會從重新導向手中接走該主機的純HTTP請求；憑證簽發完成、路由移除後，這些請求又會由重新導向回應。

YAML錨點`&strip-request-headers`會在路由的每條規則上重複相同的過濾器；`kubectl apply`會將其展開。

## 使用Ingress

Ingress無法以自身的欄位移除請求標頭或設定逾時，因此Ingress邊緣的這兩件事都依賴其控制器。以下的manifest以Traefik作為Ingress控制器，並以這些值從其Helm chart安裝：

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

另外還有兩個Middleware：一個移除標頭，由上方的`websecure` entry point套用到它收到的每個請求；另一個在轉送前以`404`回應請求，由下方處理`/rpc`其餘部分的Ingress套用到其路徑：

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

Traefik沒有只負責回應請求的Middleware，因此`not-found`是一份只列出廣播位址的允許清單（沒有任何連線來自該位址），並以`404`拒絕其他所有位址。`rejectStatusCode`需要Traefik 3.4或更新版本。

除非被告知要信任前方的轉送節點，否則Traefik會以自己的值取代呼叫端的`X-Forwarded-For`與`X-Forwarded-Host`，如[用戶端位址](#用戶端位址)所述，因此這兩者都不需要移除。Traefik本身不會查詢地區，因此`X-Forwarded-CountryRegion`會依[讀者的地區](../4-edge/index.md#讀者的地區)的要求從每個請求中移除，租戶的Google代碼閘道也就不會傳送任何地區給Google。`readTimeout`給請求300秒的抵達時間，這是章節上傳所需要的；Traefik不限制請求本文的大小。`web`上的重新導向也會把ACME挑戰送往HTTPS，憑證授權單位會跟隨它過去，挑戰在憑證存在之前就會在那裡得到回應。在其他控制器上，請以其提供的註解或資源完成上述每一項。

接著，每個Web應用程式各以一個Ingress路由其主機。除非開啟`strictPrefixMatching`選項，否則Traefik會把`Prefix`或`ImplementationSpecific`路徑當作路徑字串的前綴來比對，而不是以整個區段比對，因此請保持該選項關閉。`/rpc/publira.v1.`就是這樣在路徑區段之中表示公開API的前綴；由於Ingress API把這個意義交由控制器決定，它以`ImplementationSpecific`指定。以整個區段比對的控制器則需要它自己的註解或資源來處理這一點。

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

`cert-manager.io/cluster-issuer`註解會讓cert-manager為每個`tls`項目的主機簽發憑證，存入該項目所指定的Secret。`api-not-found`沒有這個註解，它讀取的是另外兩個Ingress已簽發的憑證。

`api-not-found`接手兩個主機上`/rpc`的其餘部分，並以`not-found` Middleware回應。Traefik會先嘗試最長的規則，因此`/rpc/publira.v1.`保有它的路徑，Web應用程式也保有`/`。後端永遠不會被存取到，它之所以存在，只是因為Ingress路徑必須有一個後端：它指定的是Web應用程式而不是`publira-server`，這樣一來，萬一Middleware遺失，這些路徑抵達的也只是在那裡沒有頁面的Web應用程式，而不是主控台的API。Traefik把`/rpc`當作字串比對，因此像`/rpcabc`這樣的路徑也會得到`404`回應；任何Web應用程式在那裡也都沒有頁面。

## 用戶端位址

Publira會記錄每個請求背後讀者的位址，並從邊緣寫入的`X-Forwarded-For`標頭讀取，如[用戶端位址](../4-edge/index.md#用戶端位址)所述。在叢集上，有兩件事決定該位址是否為讀者的位址。

**讀者的位址必須抵達控制器**。類型為`LoadBalancer`的Service若原樣轉送連線（大多數雲端負載平衡器的passthrough模式就是如此），會經由負載平衡器所選的任一節點交付連線，而在預設的`externalTrafficPolicy: Cluster`下，該節點會在連線抵達控制器的Pod之前，以自己的位址取代讀者的位址。請在控制器的Service上設定`externalTrafficPolicy: Local`，讓連線只交付給執行控制器Pod的節點，並保留其來源位址。在哪裡設定則取決於控制器：除非另行指示，Envoy Gateway會在它為Gateway建立的Service上設定這一項，而上方的Traefik值則是在chart建立的Service上設定。若負載平衡器本身終止HTTP，它會改把讀者的位址寫入`X-Forwarded-For`，此時要信任的就是它自己的位址，見下文。

**`PUBLIRA_TRUSTED_PROXIES`指定叢集內的轉送節點**。控制器的Pod與Web應用程式的Pod都從Pod位址連線到`publira server`，因此其值就是Pod位址範圍，如[啟動處理程序](./index.md#4-啟動處理程序)中的`publira-server`與`web-storefront` Deployment所示。若未設定，它會信任所有私有範圍，其中也包括節點的位址；如此一來，因`externalTrafficPolicy`維持為`Cluster`而從節點位址抵達控制器的請求，就會以呼叫端在自己的`X-Forwarded-For`中寫入的任何位址被記錄。只信任Pod範圍時，這類請求會以節點的位址被記錄：所有讀者都會共用同一個位址，但沒有人能自行選擇它。

**控制器前方的轉送節點要在兩個地方信任**。在控制器前方終止HTTP的負載平衡器或CDN，會把`X-Forwarded-For`設為連線到它的位址，而不是附加在呼叫端的值之後，如[代理伺服器前方的轉送節點](../4-edge/1-sample-configurations.md#代理伺服器前方的轉送節點)所述。控制器必須把該標頭傳下去：

- Envoy Gateway會保留它收到的`X-Forwarded-For`，並附加轉送節點的位址，因此不需要任何設定。
- Traefik除非entry point信任該轉送節點，否則會取代此標頭。請在上方的Helm值中，於`ports.websecure.forwardedHeaders.trustedIPs`之下加入轉送節點的位址。Traefik接著也會保留轉送節點的`X-Forwarded-Host`，而Web應用程式會從中找出租戶，因此轉送節點也必須設定該標頭。

然後把相同的位址加到`PUBLIRA_TRUSTED_PROXIES`，與Pod範圍並列，讓`publira server`跳過轉送節點的位址，取得它所指定的位址，如[何時設定信任的代理伺服器](../4-edge/index.md#何時設定信任的代理伺服器)所述。若控制器沒有設定，無論`PUBLIRA_TRUSTED_PROXIES`如何設定，每個讀者都會以轉送節點的位址被記錄。請只信任轉送節點本身的位址：若受信任的範圍也涵蓋讀者，任何讀者都能指定自己想要的位址。

## 檢查邊緣

邊緣的Service取得位址後，請將DNS記錄指向該位址，並等待憑證：每張憑證簽發後，`kubectl get certificate`會將其顯示為`True`。接著從叢集外部檢查路由：

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

第一個指令會由`web-storefront`回應`200`；第二個會回應其就緒狀態，在它能連線到`publira server`與Valkey後為`"status":"ok"`。第三個會抵達`publira server`，後者以`invalid_argument`拒絕這個空的請求。第四個呼叫租戶主控台的API，邊緣不會轉送它，而是回應`404`。最後一個會回應重新導向至`https://comics.example.com/`。請在主控台主機上執行相同的檢查，在那裡主控台的API同樣會回應`404`：主控台是透過叢集的網路呼叫它，而不是經由邊緣。

接著回到Kubernetes頁面的[登入](./index.md#7-登入)。
