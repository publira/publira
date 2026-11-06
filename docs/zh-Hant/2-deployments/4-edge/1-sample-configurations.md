---
title: 設定範例
description: 儲存庫中能完成邊緣必須做的事的Traefik、nginx與Caddy設定範例，以及如何將其調整為適合您的安裝實例。
published: 2026-11-03
updated: 2026-11-06
source_updated: 2026-11-06
---

儲存庫提供三個反向代理的設定範例，它們會依照[邊緣必須做的事](./index.md#邊緣必須做的事)的要求路由請求，並處理請求的標頭、本文與逾時：Traefik、nginx與Caddy各一個。其中有一項要求留給執行它的安裝實例負責：TLS listener。Traefik與nginx的範例留給您自行加入，Caddy的範例則在獲得要以HTTPS服務的主機名稱後自行加入。它們只是範例，而非邊緣的定義。[Docker Compose](../3-docker-compose.md)安裝實例執行的是Caddy範例，而自行執行代理伺服器的安裝實例可以從其中任何一個開始。由代管負載平衡器、Ingress或Gateway構成的邊緣只要遵循這些要求即可，不需要任何範例；[Kubernetes上的邊緣](../5-kubernetes/1-edge.md)展示了符合要求的Gateway與Ingress，[ECS前方的CloudFront](../6-ecs-fargate/1-cloudfront.md)則展示了位於Application Load Balancer前方的CloudFront。

| 代理伺服器 | 檔案 | 後端位址的設定位置 | 是否自行取得憑證 |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | 是，需加入ACME解析器 |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | 否 |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | `PUBLIRA_UPSTREAM_*`環境變數 | 是，針對`PUBLIRA_EDGE_TLS_HOSTS`中的主機名稱 |

請從您要安裝的版本取得您所執行的範例的檔案。[路由規範](https://github.com/publira/publira/blob/main/infra/proxy/README.md)逐條列出了三者共同的規則。

## 各範例做的事

- **路由**。每個範例都會路由四個清單中的主機名稱（提供方式如[主機清單](#主機清單)所述），並在每個主機名稱上套用[路由](./index.md#路由)的路徑規則，對其餘的`/rpc`自行回應404。在租戶的圖片主機上，它只轉送`/images`，對其他所有路徑都自行回應404，這是[租戶的圖片主機](./index.md#租戶的圖片主機)留給邊緣決定的部分。不在任何清單中的主機無法存取任何東西：範例會在所有路徑上自行回應404。這是範例的選擇，並非Publira的要求。
- **用戶端位址**。Traefik會設定`X-Forwarded-For`，並以`strip-forwarded`中介軟體移除`Forwarded`。nginx與Caddy會將`Forwarded`只設為用戶端位址，並移除`X-Forwarded-For`。在任何一個範例後方，都請保持`PUBLIRA_FORWARDED_HEADER_ENABLED`啟用。
- **主機**。每個範例都會照原樣傳遞`Host`，並自行設定`X-Forwarded-Host`與`X-Forwarded-Proto`，而不傳遞呼叫端的值，但信任其[前方的轉送節點](#代理伺服器前方的轉送節點)時除外。
- **追蹤脈絡**。每個範例都會移除這三個標頭。Traefik以`strip-trace-context`中介軟體執行，每個進入點除了`strip-forwarded`之外也都需要它。
- **讀者的地區**。沒有任何範例會自行查詢地區，因此每個範例都會從每個請求中移除`X-Forwarded-CountryRegion`，但來自它所信任的[前方轉送節點](#代理伺服器前方的轉送節點)的請求除外，這種請求的值會被傳遞下去。Traefik在`web-storefront-trusted-hop`以外的每個路由器上以`strip-country-region`中介軟體執行，因此您加入的路由器也需要它。
- **上傳與webhook**。除非您自行加入限制，否則Traefik與Caddy不會限制本文大小。nginx預設會拒絕超過1 MB的內容，其範例將主控台主機上`/api/v1/episode-pages`與`/api/v1/series-import`的上限提高為`256m`，`/api/v1/`下其餘路徑提高為`33m`，頁面路徑則提高為`11m`。除非另有設定，Traefik會中斷任何未在60秒內完整送達的請求，且此設定是依進入點而非依路徑設定，因此範例以`transport.respondingTimeouts.readTimeout`給予其`web`進入點上的每個請求300秒。nginx等待的是本文兩次讀取之間最多60秒，而非整個本文送達的時間，Caddy則完全不限制時間，因此這兩個範例都不變更它。
- **請求速率**。Traefik與nginx範例會限制單一用戶端可以向租戶網域與圖片主機上的公開API、搜尋與圖片送出的請求數，如[速率限制](../../3-operations/12-security/5-rate-limits.md)所述，並對超過限制的請求自行回應`429`。允許量列於[路由規範](https://github.com/publira/publira/blob/main/infra/proxy/README.md#request-rates)。nginx將其保存在`default.conf.template`的`limit_req_zone`行中，Traefik則在`dynamic/routes.yaml`中為每種允許量各設一個`rateLimit`中介軟體，套用在網站與圖片主機的路由器上，因此您為這些主機加入的路由器也需要它。Caddy範例中的`rate_limit`區塊已被註解掉：它需要[`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)模組，而`caddy`映像檔不包含該模組，會因此拒絕Caddyfile。若要使用該區塊，請執行以該模組建置的Caddy，例如以`xcaddy build --with github.com/mholt/caddy-ratelimit`建置的Caddy，並取消註解。[Docker Compose](../3-docker-compose.md)安裝實例執行的是`caddy`映像檔，因此其邊緣不做任何限制。
- **TLS**。每個範例都會以純HTTP接聽，直到您為它加入TLS listener，或為Caddy提供要以HTTPS服務的主機名稱為止，如[在範例中終止TLS](#在範例中終止tls)所述。

調整範例時，請保留上述每一項，並為您加入的進入點或`server`區塊設定相同的標頭、限制與逾時。

## 後端位址

每個範例都將後端位址與路由分開保存，而已提交的位址指向的是開發容器，因此它們是您要最先替換的部分：

| 後端 | 位址 |
| --- | --- |
| `web-storefront` | `web-storefront`，使用它所監聽的連接埠 |
| `web-admin` | `web-admin`，使用它所監聽的連接埠 |
| `web-platform` | `web-platform`，使用它所監聽的連接埠（若您執行它） |
| `api` | `publira server`，連接埠為`8000`，除非`PUBLIRA_PUBLIC_API_ADDR`設定了其他連接埠 |

## 主機清單

主機名稱來自代理伺服器的環境，因此不需要為此編輯路由檔案。每個變數都保存以空格分隔、不含連接埠的主機名稱，而一個主機只屬於其中一個變數：

| 變數 | 保存的內容 | 處理程序 |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 每個租戶的網域 | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 每個租戶的主控台主機 | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | 平台主控台的主機 | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 每個租戶的圖片主機 | `publira server`，僅限`/images` |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

每個範例都以各自的方式讀取它們：

- **Traefik**會將`dynamic/routes.yaml`作為範本轉譯，因此這些變數要放在Traefik處理程序的環境中。
- **nginx**透過官方nginx映像檔接收它們，該映像檔會在容器啟動時將它們填入`default.conf.template`。請將`nginx`目錄掛載到`/etc/nginx/templates`，而非`/etc/nginx/conf.d`：映像檔會將結果寫入並覆蓋其自身的`conf.d/default.conf`。若不使用該映像檔，請依照檔案第一行註解所述，自行以`envsubst`轉譯檔案。
- **Caddy**會在讀取Caddyfile時將它們代入其中。

不執行平台主控台的安裝實例會將`PUBLIRA_EDGE_PLATFORM_HOSTS`留空，並可以從後端位址中省略`web-platform`的位址。只要沒有任何租戶擁有圖片主機，或圖片主機是透過專屬的負載平衡器而非這個代理伺服器存取`publira server`，`PUBLIRA_EDGE_IMAGE_HOSTS`就保持空白。兩種情況都不需要移除任何路由區塊：每個範例在清單為空時都是有效的。

每個範例都只在代理伺服器啟動時讀取一次清單。當您[新增租戶](./index.md#新增租戶)時，請將其網域加入`PUBLIRA_EDGE_SITE_HOSTS`，將其主控台主機加入`PUBLIRA_EDGE_ADMIN_HOSTS`，若您為它指定了圖片主機，則將圖片主機加入`PUBLIRA_EDGE_IMAGE_HOSTS`，然後以新的環境重新啟動代理伺服器；重新載入會保留舊的清單。只以檔案形式加入nginx或Caddy的憑證，仍需要重新載入：`nginx -s reload`或`caddy reload --config /etc/caddy/Caddyfile`，兩者都不會中斷進行中的連線。自行取得憑證的Caddy，會在以新名稱重新啟動時申請加入`PUBLIRA_EDGE_TLS_HOSTS`的名稱的憑證；使用ACME解析器的Traefik則在路由指名這些名稱後申請。

在[Docker Compose](../3-docker-compose.md)安裝實例中，清單位於`.env`，而`docker compose up -d proxy`會以這些清單重新建立代理伺服器，接著代理伺服器會取得新名稱的憑證。

## 代理伺服器前方的轉送節點

當負載平衡器、CDN或TLS終止器連線到範例時，代理伺服器的對端就是該轉送節點。若範例維持原樣，每個請求都會以轉送節點的位址記錄：稽核記錄對所有人只會顯示一個位址，而Publira與範例依用戶端位址維持的限制也會由所有讀者共用。

若要記錄讀者本身的位址：

- **轉送節點自行設定`X-Forwarded-For`、`X-Forwarded-Host`與`X-Forwarded-Proto`**，分別設為連線到它的位址、瀏覽器所要求的主機，以及瀏覽器所用的協定，而不是傳遞呼叫端的值或附加在其後。Traefik會信任來自轉送節點的這三個標頭，而Web應用程式會依據`X-Forwarded-Host`找出租戶，因此在Traefik後方，若轉送節點只設定了`X-Forwarded-For`，呼叫端就能選擇租戶。當Caddy不信任其前方的任何代理伺服器時，預設會自行設定這三個標頭。
- **代理伺服器只信任該轉送節點的位址**，並從轉送節點的標頭取得用戶端位址。Traefik與nginx範例中的這項設定已被註解掉，並指名文件用範圍`192.0.2.0/24`：請取消註解，並將該範圍替換為轉送節點的位址。Caddy範例則從其環境讀取這些位址。
  - Traefik：`traefik.yaml`中`web`進入點（或轉送節點所連線的進入點）上的`forwardedHeaders.trustedIPs`，以及在Traefik處理程序環境中的`PUBLIRA_EDGE_TRUSTED_PROXIES`設定相同的位址，以空格分隔；`dynamic/routes.yaml`會讀取它，以傳遞轉送節點提供的地區，並依轉送節點所指名的位址計算每位讀者。
  - nginx：`default.conf.template`開頭附近的`set_real_ip_from`，以及其下方的`real_ip_header`與`real_ip_recursive`，每個位址或範圍一行`set_real_ip_from`；並在其下方的`geo`區塊中列出相同的位址，每行一個，以` 1;`結尾。
  - Caddy：Caddy處理程序環境中的`PUBLIRA_EDGE_TRUSTED_PROXIES`，位址以空格分隔，由Caddyfile全域選項中的`trusted_proxies static`讀取。
  - Docker Compose安裝實例：`.env`中的`PUBLIRA_EDGE_TRUSTED_PROXIES`，如[前方有CDN或負載平衡器](../3-docker-compose.md#前方有cdn或負載平衡器)所述。

接著，每個範例都會傳遞轉送節點所指名的`X-Forwarded-Proto`，因為轉送節點是透過純HTTP存取代理伺服器，而讀者使用的是HTTPS；也會傳遞它所指名的`X-Forwarded-CountryRegion`，讓知道讀者地區的轉送節點能經由代理伺服器將地區交給[Google代碼閘道](./index.md#讀者的地區)。這樣的轉送節點會自行設定該標頭，取代呼叫端送出的任何值；不知道地區的轉送節點則會移除它，因為代理伺服器會傳遞受信任轉送節點送出的任何值。nginx與Caddy會取用轉送節點的`X-Forwarded-For`中最右側、不屬於信任位址的那個位址，只將該位址放在`Forwarded`中傳遞，並繼續自行設定`X-Forwarded-Host`，因此它們前方的轉送節點不需要列入`PUBLIRA_TRUSTED_PROXIES`。Traefik則會將轉送節點的`X-Forwarded-For`附加上轉送節點本身的位址後傳遞，因此只有在`publira server`也信任該轉送節點時，才會跳過該位址，取用轉送節點所指名的位址：位於私人網路上的轉送節點預設就會被信任，而具有公開位址的轉送節點（例如CDN）則要在`PUBLIRA_TRUSTED_PROXIES`列出其範圍後才會被信任。來自其他任何位址的請求，處理方式與沒有這項設定時相同。

請只信任轉送節點本身的位址。讀者也能使用的信任範圍，會讓其中任何人自行指定任意位址。

## 在範例中終止TLS

以下的變更會為每個範例加入TLS listener，並以重新導向將純HTTP導向HTTPS。Caddy與Traefik可以為它們獲得的每個名稱，從Let's Encrypt或其他ACME憑證授權單位取得憑證，並在到期前更新。憑證授權單位必須能透過該名稱的連接埠80或443存取代理伺服器，因此要先設定DNS記錄，並對網際網路開放這兩個連接埠。在其他地方簽發的憑證，例如由certbot等獨立ACME用戶端、您自己的憑證授權單位或憑證服務所簽發的憑證，會寫入代理伺服器讀取的檔案中：此時更新由該工具負責，而代理伺服器必須載入更新後的檔案。

[Docker Compose](../3-docker-compose.md)安裝實例執行的Caddy範例，在設定了ACME聯絡地址後，就會依照下述方式為每個列出的主機終止TLS。

### Caddy

在Caddy處理程序的環境中，將`PUBLIRA_EDGE_TLS_HOSTS`設為四個清單所列的每個主機名稱，以空格分隔，並將`PUBLIRA_EDGE_ACME_EMAIL`設為在憑證授權單位註冊帳戶所用的聯絡地址。接著，Caddy會為每個名稱取得憑證並更新，在連接埠443上提供，並將這些名稱的純HTTP重新導向到HTTPS：

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddy將憑證保存在`/data`下，因此請為該目錄提供一個比容器存續更久的磁碟區；若磁碟區從空的狀態開始，Caddy會重新申請每張憑證。不在任何清單中的主機不會取得憑證，因此其TLS交握會失敗，而透過純HTTP時，範例仍會自行回應404。

若要使用在其他地方簽發的憑證，請將網站區塊的位址`:80 {$PUBLIRA_EDGE_TLS_HOSTS}`替換為主機名稱，並在區塊內加入`tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`：Caddy會使用這些檔案，而不自行取得憑證，且在同時以純HTTP接聽的區塊中會拒絕它們。Caddy在其容器內讀取這些檔案，因此請將保存它們的目錄以唯讀方式掛載到`/etc/caddy/tls`：在Docker Compose安裝實例中，將`- <directory>:/etc/caddy/tls:ro`加入`proxy`服務的`volumes`，並執行`docker compose up -d proxy`，以這個掛載重新建立它。當連接埠80上不再有任何網站時，Caddy會將所有主機（無論是否列出）的純HTTP重新導向到HTTPS，因此不在任何清單中的主機會收到這個重新導向，而非範例的404，接著TLS交握失敗。

### nginx

在`default.conf.template`的五個`server`區塊中，將每個`listen 80`改為`listen 443 ssl`，並在第一個區塊（也就是回應不在任何清單中的主機的區塊）保留`default_server`。接著，在同一個檔案的結尾加入憑證，以及一個重新導向純HTTP的伺服器：

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

寫在這裡的憑證會服務每個`server`區塊，因此它必須列出代理伺服器服務的每個主機。若要改為每個租戶各一張憑證，請以主機名稱為每組憑證的目錄命名，讓nginx依據瀏覽器所要求的名稱選擇：

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

此時，nginx會在每個新連線上讀取這組檔案，因此新的或更新後的憑證不需要重新載入就會生效。不過，這些檔案是由worker處理程序而非master處理程序讀取的，因此金鑰必須能被worker執行時的使用者讀取（官方映像檔中為`nginx`），而不只是root。只有root能讀取的金鑰，會讓所有連往其主機的連線失敗。

nginx不會自行取得憑證。若您的ACME用戶端透過nginx回應其HTTP驗證，請在連接埠80的伺服器上、於重新導向之前提供`/.well-known/acme-challenge/`。

### Traefik

在`traefik.yaml`中，將`web`進入點導向`websecure`，並啟用範例中已被註解掉的`websecure`進入點：

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      middlewares:
        - strip-trace-context@file
        - strip-forwarded@file
      tls: {}
    transport:
      respondingTimeouts:
        readTimeout: 300s
```

`websecure`帶有與`web`相同的兩個中介軟體與相同的300秒：若沒有這個逾時設定，透過HTTPS的上傳會在一分鐘後被中斷。

在`dynamic/routes.yaml`中，將每個路由器上的`entryPoints: [web]`改為`entryPoints: [websecure]`。路由器只會在它所指名的進入點上回應，因此仍留在`web`上的路由器，永遠無法透過HTTPS存取。

若要讓Traefik取得憑證，請在`traefik.yaml`中加入解析器，並將其`storage`檔案保存在比容器存續更久的磁碟區上：

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

路由器會在其規則中指名每個列出的主機，因此Traefik能據此判斷要申請哪些名稱。在上述的`websecure`進入點中，將`tls: {}`替換為解析器，其上的每個路由器就會為其主機取得憑證：

```yaml
tls:
  certResolver: letsencrypt
```

若要使用在其他地方簽發的憑證，請省略解析器，並在`dynamic`目錄中的新檔案（例如`dynamic/tls.yaml`）中列出這些檔案。Traefik會為每張憑證所包含的名稱提供該憑證：

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefik會監看`dynamic`目錄，因此對其中檔案的變更（例如新增憑證項目）不需要重新啟動就會生效。對`traefik.yaml`的變更則需要重新啟動。不過，Traefik不會察覺原地替換的憑證檔案，因此每次更新憑證後，請更新`dynamic/`中的某個檔案，例如執行`touch dynamic/tls.yaml`，否則它會繼續提供舊的憑證，直到憑證到期。

## 後續步驟

當邊緣開始提供HTTPS後，請在主控台主機上[登入租戶主控台](../2-installing.md#6-登入)。範例共同的規則、規則的順序，以及儲存庫如何依據這些規則檢查每個範例，都列於[路由規範](https://github.com/publira/publira/blob/main/infra/proxy/README.md)。
