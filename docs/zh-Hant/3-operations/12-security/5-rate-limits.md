---
title: 速率限制
description: 在安裝實例前方要依用戶端限制哪些請求、哪些絕不能限制，以及如何將限制寫成AWS WAF、Cloud Armor或Cloudflare規則，或寫在您執行的代理伺服器中。
published: 2026-11-03
source_updated: 2026-10-31
---

`publira server`會限制它能區分的內容：密碼嘗試、它寄送的郵件，以及每一項讀者操作，例如發表留言或使用等免費券，如[速率限制](../9-platform-policies.md#速率限制)所述。它也會限制匿名瀏覽，但只是寬鬆的限制，如[publira server自身的限制](#publira-server自身的限制)所述：在該限制之下，單一用戶端仍可以取得每個免費章節的每一頁，或持續執行搜尋直到資料庫跟不上，而最早的徵兆就是`/readyz`失敗。這些請求也必須在它前方依用戶端加以限制：由代管的WAF或CDN限制，或由邊緣的代理伺服器限制。

## 要限制的內容

在租戶的網域及其圖片主機上，依每位讀者的位址（也就是[用戶端位址](../../2-deployments/4-edge/index.md#用戶端位址)要求邊緣記錄的位址）加以限制：

- **公開API**，`/rpc/publira.v1.`，由行動應用程式呼叫。
- **搜尋**，它執行的是讀者能要求的最昂貴的查詢：公開API的搜尋程序`/rpc/publira.v1.CatalogService/SearchPublished…`，以及在伺服器上執行相同搜尋的網站搜尋頁面`/search`或`/<locale>/search`。請給它比API其餘部分更低的限制。
- **圖片**，`/images`，章節的每一頁都是圖片。讀者開啟章節時會一次載入其所有頁面，因此請允許數百個請求的突發流量。

對超過限制的請求，請以`429 Too Many Requests`回應。每項限制都依位址計算，因此位於同一個位址後方的讀者（例如電信業者的NAT或辦公室網路）會共用它：請依您預期合法讀者可能來自的最繁忙位址來設定，而不是依單一讀者設定。

主控台主機則交由`publira server`所保有的限制處理：它們的流量來自您的工作人員，而那裡的章節上傳和編輯畫面，是安裝實例所提供最繁重的內容。

## 絕不能限制的內容

- **Webhook**，位於`/api/v1/webhook/`下，列於[Webhook](../../2-deployments/4-edge/index.md#webhook)。在那裡被拒絕的服務商會重試，導致付款延遲記錄，或讀者的回覆始終無法到達主控台。
- **健康檢查**，`GET /readyz`和`GET /livez`，由負載平衡器或協調器傳送給每個處理程序。因速率而被拒絕的健康檢查，會讓健康的處理程序退出服務。

路徑前方的機器人驗證或登入提示，也會拒絕行動應用程式和Webhook服務商，如[機器人驗證](./4-waf.md#機器人驗證)所述。

## 在代管的WAF或CDN中

雲端平台上的安裝實例幾乎總是有代管的負載平衡器或CDN位於其前方，而隨附的[Web應用程式防火牆](./4-waf.md)就是設定限制的地方。CloudFront或Application Load Balancer上的AWS WAF、Google Cloud負載平衡器上的Cloud Armor，以及Cloudflare的速率限制規則，都會依連線到它們的位址計算讀者，並在請求到達您執行的任何東西之前將其拒絕。在那裡限制了上述路徑後，其後方的代理伺服器就不需要自己的限制。請移除這些限制，或先[信任這個轉送節點](../../2-deployments/4-edge/1-sample-configurations.md#代理伺服器前方的轉送節點)：不信任該轉送節點的代理伺服器，會將每位讀者都算作該轉送節點的位址，並將他們一起拒絕。

代管的WAF會在一個時間窗口（例如10秒或一分鐘）內計算讀者的請求，達到次數後就拒絕該窗口剩餘時間內的請求。請為下表的每一列各寫一條規則，比對租戶網域和圖片主機上的對應路徑，讓其他任何東西都不被計算，包括Webhook和健康檢查。這些次數是範例設定在該時間內從單一用戶端接受的最大數量：

| 請求 | 10秒內 | 一分鐘內 |
| --- | --- | --- |
| 公開API，`/rpc/publira.v1.`，搜尋除外 | 320 | 1,320 |
| 搜尋程序，`/rpc/publira.v1.CatalogService/SearchPublished…` | 40 | 140 |
| 搜尋頁面，`/search`或`/<locale>/search` | 40 | 140 |
| 圖片，`/images` | 1,200 | 4,200 |

一個時間窗口會一次放行其全部次數，因此請優先選擇您的WAF所提供最短的窗口。

- **AWS WAF**：在CloudFront分佈或負載平衡器的Web ACL中，為每一列設定一條[以速率為基礎的規則](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)，搭配比對主機和路徑的縮小範圍陳述式、以來源IP位址作為彙總鍵，以及其最短的60秒評估窗口，並以一分鐘的次數作為限制。請為其Block動作設定狀態碼為`429`的自訂回應；否則它會回應`403`。
- **Google Cloud Armor**：在負載平衡器後端服務的安全性政策中，為每一列設定一條[速率限制規則](https://cloud.google.com/armor/docs/rate-limiting-overview)，使用`throttle`動作、對`request.headers['host']`和`request.path`的比對運算式、以`IP`作為鍵、10或60秒的間隔並以對應的次數作為門檻，超過時的動作為`deny(429)`。請優先使用`throttle`而非`rate_based_ban`：封鎖會在整段期間持續拒絕讀者，即使他們已經放慢速度。
- **Cloudflare**：為每一列設定一條[速率限制規則](https://developers.cloudflare.com/waf/rate-limiting-rules/)，比對主機名稱和URI路徑並依IP計算，期間為10秒或一分鐘，動作為Block，它會回應`429`。區域可擁有的規則數取決於方案：Free方案為一條，且只能以10秒計算；Pro方案為兩條；Business方案為五條。若少於四條，請優先限制搜尋，因為它對資料庫的負擔最大。

## 在您執行的代理伺服器中

當前方沒有任何東西限制請求時，就由您執行的代理伺服器來限制。Traefik和nginx的[設定範例](../../2-deployments/4-edge/1-sample-configurations.md#各範例做的事)隨附時就已限制上述路徑，而Caddy的範例設定則將其限制註解掉了，因為它們需要`caddy`映像檔未包含的模組。

## publira server自身的限制

在邊緣後方，`publira server`對相同的讀取保有自己的限制，讓不做任何限制的邊緣（例如[Docker Compose](../../2-deployments/3-docker-compose.md)安裝實例的標準`caddy`映像檔）使安裝實例的防護變弱，而不是完全沒有防護。它會以10秒的時間窗口計算每位讀者的位址，當`PUBLIRA_REDIS_URL`指定了Redis時，會透過它在所有執行個體之間共用次數。在您變更之前，它允許的次數是上表10秒欄的兩倍：

| 請求 | 10秒內，內建值 | 10秒內，最小值 | `publiractl policy set`旗標 |
| --- | --- | --- | --- |
| 公開API，`/rpc/publira.v1.`，搜尋除外 | 640 | 320 | `--anonymous-read-public-api-per-10-seconds` |
| 搜尋程序，`/rpc/publira.v1.CatalogService/SearchPublished…` | 80 | 40 | `--anonymous-read-search-per-10-seconds` |
| 租戶網域和圖片主機的圖片，`/images` | 2,400 | 1,200 | `--anonymous-read-images-per-10-seconds` |

超過限制的呼叫會以`resource_exhausted`被拒絕，圖片則以`429`被拒絕，兩者都帶有指出等待時間的`Retry-After`標頭。在設有上述限制的邊緣後方，讀者會先被邊緣拒絕。無論邊緣允許多少，伺服器的限制都會適用，因此若為了共用同一個位址（例如電信業者的NAT）的讀者而將邊緣的允許量調高到超過它，邊緣放行的請求就會被伺服器拒絕。請一併調高伺服器的限制：它是[平台政策](../9-platform-policies.md#匿名瀏覽)的一部分，可以透過平台主控台的**安全性**頁面或上述旗標變更。儲存的變更會在十秒內套用到所有執行個體，無須重新啟動。低於最小值（也就是範例設定在10秒內接受的次數）的值會被拒絕，並指出其欄位或旗標，好讓邊緣始終是第一個拒絕讀者的一方。位於同一個位址後方的讀者會共用伺服器的限制，就像共用邊緣的限制一樣。

伺服器無法計算從安裝實例內部到達它的請求。每個轉送節點都是[受信任的代理伺服器](../../2-deployments/4-edge/index.md#publira信任的代理伺服器)之一的請求，是Web應用程式以自身名義、同時代表其所有讀者發出的呼叫，因此不會被計算。這包括網站的搜尋頁面，它是由`web-storefront`在伺服器上執行的，因此`web-storefront`會自行限制該頁面，如[web-storefront自身的限制](#web-storefront自身的限制)所述。主控台主機、Webhook和健康檢查也不會被計算。

## web-storefront自身的限制

`web-storefront`會依每位讀者的位址限制網站的搜尋頁面`/search`或`/<locale>/search`，它以與`publira server`相同的方式從轉送標頭中找出該位址。它允許10秒內80個請求，是上表10秒欄的兩倍，讓位於設有上述限制之邊緣後方的讀者會先被邊緣拒絕，並對超過限制的請求以`429`和指出等待時間的`Retry-After`標頭回應。`web-storefront`的每個執行個體都會透過其`PUBLIRA_REDIS_URL`所指定的Valkey或Redis（也就是伺服器所用的那一個）共同計算讀者。若沒有該變數，或在無法連線到該Valkey或Redis期間，每個執行個體會各自計算，因此限制會放寬為每個執行個體各一份，而不會消失。發布在`/search`以取代搜尋頁面的頁面，也會以相同方式計算。

這項限制沒有設定項目。若為了共用同一個位址的讀者，將邊緣對搜尋頁面的允許量調高到超過它，邊緣放行的請求就會被`web-storefront`拒絕。

## 分散式阻斷服務

保護安裝實例免受分散式阻斷服務攻擊是託管服務商的工作，而不是邊緣的工作：依位址設定的限制，對來自大量位址的請求毫無作用。
