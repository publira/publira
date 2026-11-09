---
title: 水平擴展
description: 安裝實例超出起初的規模時該多執行哪些處理程序、每個副本必須共用什麼，以及哪些部分無法水平擴展。
published: 2026-11-03
updated: 2026-11-09
source_updated: 2026-11-09
---

安裝實例變慢或即將成長時，要增加的是它原本就在執行的處理程序：繁忙的處理程序多執行幾個副本，`publira server`依其回應的流量拆分，`publira worker`依其負責的工作拆分。本頁說明哪些處理程序可以執行多個副本、在那之前必須先準備好什麼、安裝實例的負載落在哪裡、`publira server`可以拆分到什麼程度、`publira worker`如何拆分、副本增加時資料庫必須能接受什麼、如何把讀者的目錄讀取與worker處理程序的每日重建移到資料庫的複本上，以及哪些部分無論增加多少副本都無法減輕負擔。本頁適用於任何平台，[Kubernetes](./5-kubernetes/index.md)與[在AWS Fargate上執行Amazon ECS](./6-ecs-fargate/index.md)頁面備有對應的資訊清單與指令。

## 可以執行多個副本的處理程序

每個常駐處理程序都可以執行任意數量的副本：`publira server`、`publira worker`、`web-storefront`、`web-admin`、`web-platform`與`email-renderer`。它們都不會自行保存第二個副本需要的狀態：

- **安裝實例儲存的內容都在PostgreSQL與物件儲存中**。每一列資料都在資料庫中，每張上傳的圖片都在儲存貯體中，因此無論在哪裡啟動副本，服務的都是同一個安裝實例。
- **工作階段是一個Cookie**。Web應用程式會把讀者或工作人員的工作階段封裝進加密的Cookie，瀏覽器在每次請求時都會送回；API則在每次呼叫時檢查其中的存取權杖。應用程式的任何副本都能開啟其他副本簽發的工作階段，因此邊緣不需要黏性工作階段。也因此，同一個應用程式的每個副本都需要相同的`PUBLIRA_AUTH_SECRET`，`publira server`的每個副本都需要相同的`PUBLIRA_AUTH_JWT_SECRET`與密鑰加密金鑰。
- **設定是從資料庫讀取，而不是由處理程序保存**。儲存的平台政策會在十秒內傳到每個執行中的`publira server`副本，儲存的物件儲存或搜尋引擎設定則會在30秒內傳到伺服器與worker處理程序的每個副本。因此儲存設定不需要重新啟動，也不會有副本停留在舊值。
- **副本在執行期間共用的內容都在Valkey中**。速率限制計數器、轉換後的圖片，以及Web應用程式的頁面快取都保存在那裡，而不是處理程序的記憶體中，詳見[必須先共用的內容](#必須先共用的內容)。

因此，每個處理程序也都可以作為平台自動擴展的對象，例如Kubernetes的HorizontalPodAutoscaler或ECS服務自動擴展。請依自動擴展可能啟動的最多副本數來規劃資料庫的規模，計算方式見[資料庫連線預算](#資料庫連線預算)。

## 必須先共用的內容

在任何處理程序執行第二個副本之前，每個使用Valkey或任何Redis協定伺服器的處理程序都必須指向同一台：`publira server`與`web-storefront`的`PUBLIRA_REDIS_URL`，以及`web-storefront`、`web-admin`與`web-platform`的`PNCH_REDIS_URL`。[安裝](./2-installing.md#佈建服務)時已經準備好這台伺服器，它保存四種內容：

| 內容 | 保存者 | 沒有共用的Valkey時 |
| --- | --- | --- |
| 速率限制計數器：讀者的寫入限制、step-up密碼限制與郵件限制 | `publira server` | 每個副本各自計數，因此請求分散到三個副本的讀者會得到三倍的限制。詳見[次數保存的位置](../3-operations/9-platform-policies.md#次數保存的位置) |
| 搜尋頁面的速率限制計數器 | `web-storefront` | 每個副本各自計數，因此搜尋頁面請求分散到三個副本的讀者會得到三倍的限制 |
| 轉換後的圖片 | `publira server` | 每個副本把自己轉換的圖片保存在自己的記憶體中，因此每個副本都會重新轉換同一張圖片 |
| Web應用程式快取的頁面與資料 | `web-storefront`、`web-admin`、`web-platform` | Web應用程式算繪的內容都不會被快取：每個請求都會重新算繪頁面，並為頁面上的所有內容呼叫`publira server` |

每個Web應用程式都以自己的鍵前綴保存項目，因此各應用程式共用同一台伺服器而不共用項目。當某次寫入使快取的頁面過時，伺服器的快取重新驗證會送達每個Web應用程式的其中一個副本，該副本把這次清除記錄到Valkey，其他所有副本都會從那裡讀取：無論執行多少副本，快取都保持最新。`publira worker`不在其中保存任何內容；給它同一個`PUBLIRA_REDIS_URL`後，它會從中刪除營運人員已刪除的租戶的轉換後圖片與計數器。`email-renderer`不使用Valkey。

## 負載的去向

安裝實例的流量落在三組處理程序上，每組各自成長：

| 流量 | 處理程序 | 要增加的內容 |
| --- | --- | --- |
| 讀者：租戶的網站與行動應用程式 | `web-storefront`，以及`publira server`的公開API與圖片 | `web-storefront`的副本，以及租戶網域所連到的`publira server`的副本 |
| 工作人員與營運人員：主控台 | `web-admin`、`web-platform`，以及它們呼叫的`publira server` | 主控台及其`publira server`的副本，通常不需要那麼多 |
| 背景工作：郵件、推播通知、快取重新驗證、排程工作 | `publira worker` | worker處理程序的副本 |

### 讀者

轉換圖片是安裝實例最繁重的工作。`publira server`會在收到請求時，把頁面上顯示的每張圖片調整大小並轉換為WebP或AVIF，並把結果在Valkey中保存`PUBLIRA_IMAGE_CACHE_TTL`所指定的時間（未設定時為一小時），因此一個副本轉換圖片後，其他所有副本在快取到期前都會提供快取的結果。快取中還沒有的內容，會由請求所抵達的副本轉換，因此網站成長時，最先耗盡CPU的是提供租戶圖片的處理程序。

在邊緣前方放置CDN可以分擔大部分這類工作。`publira server`會把任何人都可以看到的圖片（例如免費章節的頁面或租戶的標誌）標示為`public, max-age=3600`，免費閱讀期間較早結束時則更短；需要讀者認證資訊的圖片則標示為`private`。CDN可以在一小時內提供公開圖片，不必再次詢問安裝實例。它的快取鍵必須包含主機、`Accept`標頭、`Authorization`標頭與完整的查詢字串，CloudFront的設定方式見[快取政策](./6-ecs-fargate/1-cloudfront.md#快取政策)。除了`/images`之外，沒有值得在CDN快取的內容：頁面取決於讀者的工作階段，而且Web應用程式本身已經快取了頁面。

### 背景工作

除非只指派部分工作，否則每個`publira worker`副本都會執行worker處理程序的所有工作，且同一件工作不會在兩個副本上執行：

- **outbox**負責寄送郵件與推播通知，並重新驗證Web應用程式的快取，其工作會分散到各副本。每隔`PUBLIRA_OUTBOX_DRAIN_INTERVAL`（未設定時為兩秒），會有一個副本認領最多`PUBLIRA_OUTBOX_CLAIM_LIMIT`個到期項目（未設定時為一百個），並為每個項目排入一個作業。之後由任一副本執行這些作業，每個副本同時最多執行`PUBLIRA_OUTBOX_MAX_WORKERS`個（未設定時為八個），且每個作業只在一個副本上執行。副本越多，同時寄送的項目就越多，這在寄送緩慢時有幫助；但無論執行多少副本，outbox每個間隔最多仍只取用`PUBLIRA_OUTBOX_CLAIM_LIMIT`個項目。
- **排程工作**，也就是在排定時間發布章節、開始與結束免費閱讀期間，以及重建與清除儲存資料的工作，每一項同一時間都只由一個副本執行。工作在一次執行進行中時是唯一的，因此第二個副本不會再排入第二次執行，執行時間超過間隔的工作也不會在自己仍在執行時再次啟動。
- **重建與清除**在所有副本之間一次只執行一個。輪到某個副本時若另一個副本正在執行，它會等到那次執行結束，而不會同時啟動，這段等待也不算失敗的執行。執行所有工作的副本若正忙於長達一小時的重建，它同時也是寄送郵件的副本之一，[依佇列拆分worker處理程序](#依佇列拆分worker處理程序)可以避免這種情況。

因此，副本越多，代表同時寄出的郵件與推播通知越多，而不是重建更快或排程執行更多次。各排程工作的內容見[排程工作](../3-operations/10-scheduled-jobs.md)，調整worker處理程序的所有變數列於[`publira worker`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#publira-worker)。

## 依角色拆分伺服器

`publira server`在一個處理程序中提供公開API、兩個主控台的API與圖片，並可依提供的內容拆分。以下每個步驟都會保留前一步帶來的效益：

1. **一個處理程序**。`publira server --with-worker`同時執行伺服器與worker處理程序，[Docker Compose](./3-docker-compose.md)安裝實例就是這樣做。增加一個副本就會同時增加兩者。
2. **伺服器與worker處理程序分開**。以兩個處理程序分別執行`publira server`與`publira worker`，就像[安裝](./2-installing.md)中所做的。兩者各自擴展，而且worker處理程序的資料庫登入不再位於邊緣轉送請求的處理程序中。
3. **專供讀者的伺服器**。以`--role storefront`執行第二個`publira server`，負責每個租戶網域的公開API與圖片；由於`web-storefront`只呼叫公開API，它的`PUBLIRA_GRPC_URL`也指向這個伺服器。第一個伺服器繼續服務`web-admin`、`web-platform`與主控台主機。這樣所有讀者流量都會抵達專屬的處理程序，可以與主控台分開擴展，而且這些處理程序既不持有任一主控台的資料庫登入，也不持有Web服務認證資訊。兩者各自讀取的內容列於[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)。
4. **專供主控台的伺服器**。第一個`publira server`以`--role admin,platform`執行，把公開API交給讀者的伺服器。`web-admin`除了租戶主控台的API之外，也會為了租戶的主題與標籤呼叫公開API，因此它的`PUBLIRA_PUBLIC_GRPC_URL`指向讀者的伺服器，而`PUBLIRA_GRPC_URL`仍指向第一個伺服器。邊緣也會把主控台主機的公開API送到讀者的伺服器（它在任何主機上都會回應），但主控台主機的圖片仍留在第一個伺服器上，因為`--role storefront`處理程序對主控台主機的圖片會回應`404`。這樣主控台的伺服器就不持有`publira_public`登入，也不做任何公開API的工作，而讀者的伺服器只需隨公開API的流量擴展。
5. **各自的副本**。依各處理程序的流量需要，執行所需數量的副本。

邊緣還可以讓圖片轉換不落在回應公開API的處理程序上。它會依路徑轉送租戶網域上的`/images`與`/rpc/publira.v1.`，因此兩者可以各自送到一組專屬的`--role storefront`處理程序：一組轉換圖片，另一組回應API，各自依流量執行所需數量的副本。`web-storefront`本身從不擷取圖片，因此呼叫API那一組；步驟4之後，`web-admin`也透過`PUBLIRA_PUBLIC_GRPC_URL`呼叫那一組。處理程序本身不需任何變更，只需變更邊緣轉送各路徑的後端，以及提供給Web應用程式的URL。請把主控台主機的`/images`留在`web-admin`透過`PUBLIRA_GRPC_URL`呼叫的`publira server`上，因為`--role storefront`處理程序對主控台主機的圖片會回應`404`；主控台主機的`/rpc/publira.v1.`也一起留在那裡，直到步驟4把它送到API那一組。

步驟3與步驟4在Kubernetes與ECS上所需的資源，見Kubernetes的[讓主控台的認證資訊遠離租戶的網域](./5-kubernetes/2-operating.md#讓主控台的認證資訊遠離租戶的網域)，以及ECS的[同名章節](./6-ecs-fargate/2-operating.md#讓主控台的認證資訊遠離租戶的網域)。

### 分開提供圖片與公開API

這兩組處理程序也可以放在兩個負載平衡器後方，而不是一個，讓前方CDN可以快取的圖片，與無法快取的API呼叫，永遠不共用負載平衡器。每組都透過專屬的主機名稱連線：

- **圖片**位於每個租戶的[圖片主機](../3-operations/2-tenants.md#圖片主機)上，例如`images.comics.example.com`。每個圖片主機都指向圖片組前方的負載平衡器，由它為該主機終止TLS，並且只轉送該主機上的`/images`，不變更`Host`，詳見[租戶的圖片主機](./4-edge/index.md#租戶的圖片主機)。租戶設定圖片主機後，公開API就會在那裡提供其網站的圖片，因此其網站與行動應用程式都會透過該負載平衡器載入圖片。沒有圖片主機的租戶會繼續透過邊緣在自己的網域上提供圖片，因此在仰賴這種拆分之前，請為每個租戶設定圖片主機。
- **公開API**位於專屬的主機名稱上，例如`api.example.com`，它指向API組前方的負載平衡器，並且只轉送`/rpc/publira.v1.`。公開API是從請求而非主機判斷租戶，因此一個主機就能服務所有租戶，處理程序也不需為此變更。`web-storefront`的`PUBLIRA_GRPC_URL`，以及步驟4之後`web-admin`的`PUBLIRA_PUBLIC_GRPC_URL`，都指向這一組：Web應用程式在該組的網路外執行時為`https://api.example.com/rpc`，在其旁邊執行時則為該組的私人位址，可略過負載平衡器。租戶的行動應用程式以`PUBLIRA_BASE_URL=https://api.example.com`建置，詳見[應用程式連線的位址](../5-mobile-app/2-building.md#應用程式連線的位址)。

兩個負載平衡器對其轉送的路徑，都要做到[邊緣](./4-edge/index.md#邊緣必須做的事)對邊緣的要求，且每組的`PUBLIRA_TRUSTED_PROXIES`都要涵蓋自己的負載平衡器，詳見[用戶端位址](./4-edge/index.md#用戶端位址)。每組都以`--role storefront`執行，並使用與步驟3讀者伺服器相同的變數。租戶網域與主控台主機仍和以前一樣留在邊緣上，也和以前一樣繼續轉送`/images`與`/rpc/publira.v1.`：主控台的圖片仍在主控台主機上載入，而拆分之前建置的應用程式仍會在租戶網域上呼叫API。

只保留一個邊緣的安裝實例，也可以改為在該邊緣上提供圖片主機，路由方式見[租戶的圖片主機](./4-edge/index.md#租戶的圖片主機)；範例設定透過`PUBLIRA_EDGE_IMAGE_HOSTS`接收這些主機。在Kubernetes上使用兩個負載平衡器所需的資源，見[分開提供圖片與公開API](./5-kubernetes/2-operating.md#分開提供圖片與公開api)，ECS則見[同名章節](./6-ecs-fargate/2-operating.md#分開提供圖片與公開api)。

## 依佇列拆分worker處理程序

worker處理程序把工作放在七個佇列上：`outbox`是outbox的郵件、推播通知與快取重新驗證；`ticker`是在排定時間執行的工作；`maintenance`是重建與清除；`search_index`是搜尋索引的建置；`payment_reconciliation`是租戶管理員發起的付款對帳；`data_export`是讀者要求的資料副本；`tenant_erasure`是刪除營運人員已刪除的租戶的資料。以`--queue`啟動的副本只會負責它所指定佇列的工作，不會負責其他佇列，因此outbox可以擁有專屬的副本，與執行長達一小時重建的副本分開規劃規模。當安裝實例的郵件與推播通知必須在重建進行時及時寄出，請以兩個處理程序取代原本的一個`publira worker`：

```bash
publira worker --queue outbox
publira worker --queue ticker,maintenance,search_index,payment_reconciliation,data_export,tenant_erasure
```

第一個處理程序只負責寄送與重新驗證，不做其他事：請隨outbox的負載擴展它，而且它以一個登入而非三個登入連線到資料庫。第二個處理程序執行所有排程工作，很少需要第二個副本，因為無論有多少副本，它的每項工作同一時間都只在一個副本上執行。在`publira server --with-worker`上，同一個旗標會縮小它所承載的worker處理程序的範圍。

每個佇列至少都需要一個承載它的執行中副本。被作業佇列選為排程者的副本，無論自己負責哪些佇列，都會排程所有工作，因此即使某項工作的佇列沒有任何執行中副本負責，工作也不會遺失：它會在資料庫中等待，直到負責該佇列的副本啟動之前都不會執行。每個副本啟動時，都會以`worker leaves queues to other replicas`記錄它交給其他副本的佇列。請為每個副本設定相同的間隔變數，因為負責排程的副本會依自己的設定排程。各佇列帶來的資料庫登入與變數列於[`--queue`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#hosting-some-queues---queue)，兩個處理程序各自讀取的內容列於[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)。

## 資料庫連線預算

每個`publira server`與`publira worker`副本，都會為它登入的每個資料庫登入開啟一個連線池，每個連線池最多保有`PUBLIRA_DB_MAX_OPEN_CONNS`個連線（未設定時為十個）。Web應用程式與`email-renderer`不開啟任何連線。因此，資料庫必須能接受：

```text
(the pools of every copy of publira server and publira worker, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

| 處理程序 | 每個副本的連線池數 |
| --- | --- |
| `publira server` | 3 |
| `publira server --role <roles>` | 每個指定的角色1個：`--role storefront`為1個，`--role admin,platform`為2個 |
| 使用複本提供`storefront`的`publira server` | 再多1個，位於複本而非主要資料庫上 |
| `publira server --with-worker` | 6 |
| `publira worker` | 3 |
| `publira worker --queue <queues>` | 1個，含`ticker`時再多1個，含`maintenance`、`search_index`、`payment_reconciliation`、`data_export`與`tenant_erasure`任一者時再多1個：`--queue outbox`為1個 |
| 使用複本承載`maintenance`的`publira worker` | 再多1個，位於複本而非主要資料庫上 |
| 執行中的`publiractl`指令 | 1個；指定了複本時，`job aggregate-content-stats`與`job build-recommend-features`會在複本上再多1個 |

總和必須在資料庫的`max_connections`扣除PostgreSQL保留給超級使用者的連線`superuser_reserved_connections`（未設定時為三個）之後的範圍內。一個伺服器與一個worker處理程序會用掉PostgreSQL預設100個連線中的60個。執行三個`publira server --role storefront`副本、兩個`publira server`副本與兩個`publira worker`副本的安裝實例，會用掉 (3 × 1 + 2 × 3 + 2 × 3) × 10 = 150個，預設值已經無法接受。

對公開API的請求從開始到結束都會佔用公開API連線池的一個連線，對租戶主控台API的請求則佔用主控台連線池的一個連線，而每個連線池都會保留一個連線，供這些請求在租戶範圍外執行的查詢使用。因此，一個副本最多可以同時回應比`PUBLIRA_DB_MAX_OPEN_CONNS`少一個的公開API請求；同時提供兩者時，還能另外同時回應同樣數量的租戶主控台請求。提高上限可以讓每個副本回應更多請求，增加副本也可以；兩者都會消耗資料庫的連線。完整的參考資訊見[連線池](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

## 從複本讀取

有兩種讀取會隨安裝實例的讀者增加而成長。讀者本身的流量幾乎都是讀取已發布的目錄：系列與章節頁面、列表與搜尋，以及提供每張租戶圖片前所讀取的資料列。此外，讀者的每次瀏覽都會成為`content_events`的一列，worker處理程序的每日重建會跨所有租戶讀回這些資料列，以統計當天的數字並建立推薦內容。這兩種讀取都可以在資料庫的熱備援上進行，讓構成安裝實例成長的讀者不再為主要資料庫增加這些負載。

備援必須是同一個叢集的熱備援，從主要資料庫串流複寫，例如受管理PostgreSQL的唯讀複本：這樣角色、角色的授權與密碼都會隨其他內容一起傳到備援，而且它最多只落後片刻。從備份還原的副本，或不處於復原狀態的資料庫，都不是熱備援。請為它設定專屬的`max_connections`，依[資料庫連線預算](#資料庫連線預算)所計算的複本連線池來規劃；PostgreSQL也會拒絕啟動`max_connections`小於主要資料庫的備援。一個備援可以同時服務這兩種讀取。

在複本上讀到的內容，不會比主要資料庫當時會讀到的內容更舊。在進行可由複本處理的讀取之前，處理程序會先讀取主要資料庫的位置，複本要等重播到該位置後才會進行讀取，因此當時已提交的每筆寫入都包含在內。等待之後仍然落後的複本，會被排除在這次讀取之外，改由主要資料庫進行。因此，落後較久或被提升為獨立主要資料庫的複本，會把讀取送回主要資料庫，主要資料庫的負載也會隨之回來，直到複本追上為止。主要資料庫仍要為複本承接的每次讀取回應一個陳述式，也就是讀取其位置，這不會觸及任何資料表。

若要確認複本正在承接讀取，請開啟[追蹤](../3-operations/11-monitoring.md)：每個查詢span都會在`server.address`與`server.port`中標示回應的伺服器，每個查詢指標也是如此。

### 讀者的目錄讀取

在每個提供`storefront`角色的`publira server`上（也就是`--role storefront`處理程序，或每個未指定`--role`的處理程序），把`PUBLIRA_PUBLIC_DB_REPLICA_URL`設為以`publira_public`登入備援的連線，密碼與`PUBLIRA_PUBLIC_DB_URL`相同。以其他任何登入連線的URL會讓處理程序在啟動時停止。未設定時（預設值），所有讀取都留在主要資料庫上。

複本回應的內容：

- 訪客讀取的目錄：系列、章節、作者、書系、類型與標籤的頁面與列表、排行榜、向所有讀者顯示的推薦內容、相關系列、活動橫幅，以及網站地圖。這些是`web-storefront`會快取並在讀者之間共用的讀取。
- 安裝實例沒有搜尋引擎、改在PostgreSQL中搜尋時的目錄搜尋。
- 租戶的圖片，但章節的頁面除外，因為它們會檢查讀者可以閱讀的內容。

`publira server`回應的其他所有內容都留在主要資料庫上：已登入讀者的每個請求、每筆寫入、登入，以及主控台。

讀者會等待這些請求的每一個，因此複本只有50毫秒的時間追上。`/readyz`把複本的連線池命名為`db.public.replica`，因此複本停止回應時，處理程序會變成未就緒，就像主要資料庫停止回應時一樣。

### 每日重建

在每個承載`maintenance`佇列的`publira worker`上（包括每個未指定`--queue`的worker處理程序），把`PUBLIRA_CONTENT_STATS_DB_REPLICA_URL`設為以`publira_content_stats`登入備援的連線，密碼與`PUBLIRA_CONTENT_STATS_DB_URL`相同。`publiractl job aggregate-content-stats`與`publiractl job build-recommend-features`也會讀取它，因此在手動執行這些指令的地方也要設定。以其他任何登入連線的URL會讓處理程序或指令在啟動時停止。未設定時（預設值），所有讀取都留在主要資料庫上。

複本依序為每個租戶回應的內容：

- 內容統計重建所統計的那一天：來自`content_events`的瀏覽、讀完、評分與收藏，以及購買與留言。
- 推薦特徵建置為每位已登入讀者讀取的、租戶`content_events`的近期區間（未設定時為四週）。

worker處理程序做的其他所有事都留在主要資料庫上：重建寫入的每一列、排行榜與推薦內容的各作品數據（這些是從重建剛寫入的當天統計讀取的）、把讀完的紀錄投射到`content_events`、每次清除、搜尋索引的建置，以及其他佇列上的工作。

沒有人會等待重建，因此複本有5秒的時間追上，逾時後該租戶的重建會改在主要資料庫上讀取。一天結束時並不會停止對它的寫入：較晚投射的讀完紀錄會歸入讀者讀完的那一天，工作人員也可以隱藏任何一天的留言，因此這段等待能避免重建在缺少這些資料的情況下統計某一天。`/readyz`把複本的連線池命名為`db.content_stats.replica`。

在大型租戶上，重建在備援上的讀取可能會執行好幾分鐘；當重播主要資料庫的清理會移除查詢仍在讀取的資料列時，PostgreSQL會取消備援上的查詢，並顯示`canceling statement due to conflict with recovery`。這時該租戶的重建會失敗，下一次執行會從中斷處重新建置那一天。請在備援上開啟`hot_standby_feedback`，讓主要資料庫保留這些資料列直到讀取結束；代價是主要資料庫對所有資料表的無效資料列清理都要等待它。

## 無法水平擴展的部分

處理程序的副本只會分散它們自己的工作。它們所依賴的服務，對Publira而言各自都是一個服務；要擴大其中任何一個，或讓它在提供給Publira的單一位址後方達到高可用性，都要在該服務本身進行：

- **PostgreSQL**。每個連線池都連到其變數指定的單一URL，因此每筆寫入都送到同一個主要資料庫，除了[複本](#從複本讀取)可以承接的讀者目錄讀取與每日重建對`content_events`的讀取之外，每次讀取也是如此。主控台、已登入的讀者，以及worker處理程序的其他工作仍然只會連到主要資料庫，因此成長中的安裝實例的負載最終都會落在它身上：處理程序的副本越多，送給它的查詢就越多，只有更大的主要資料庫才能減輕負擔。
- **Valkey**。每個處理程序都讀取同一個URL。
- **物件儲存**。安裝實例只有一個儲存貯體，儲存在平台設定中。
- **SMTP伺服器**。worker處理程序透過設定所指定的SMTP伺服器寄送每封郵件。
- **搜尋引擎**（若安裝實例有執行）。安裝實例只有一個，儲存在平台設定中。

## 日常執行多個副本

### 停止副本

`publira server`與`publira worker`會在收到`SIGTERM`後30秒內停止：它們最多等待這麼久讓進行中的請求與作業完成，屆時仍在執行的則會被中斷。請給平台一段比這更長的寬限期再終止處理程序，例如在Kubernetes上把`terminationGracePeriodSeconds`設為45（預設為30），或在ECS的容器定義中把`stopTimeout`設為45秒（預設同樣為30）。在期限時被中斷的請求會失敗，呼叫端會看到連線關閉。被中斷的作業會重新執行：作業佇列會在一小時後把仍在執行的排程工作視為卡住並再次執行，而每項工作都可以安全地重複執行。仍在處理中的outbox項目會在`PUBLIRA_OUTBOX_STALE_PROCESSING`（未設定時為十五分鐘）之後回到佇列，並在那時寄送：投遞至少會進行一次，因此若郵件或推播通知在副本被終止前剛好寄出，該項目會被寄送第二次。

`publira server`一收到停止指示就會停止接受連線，而不會先讓`/readyz`回應未就緒。因此，邊緣必須在副本停止之前就停止把請求送給它。ECS會這樣做：服務會先把工作從其Application Load Balancer目標群組中移除，並等待目標排空，再停止工作。在Kubernetes上，Pod會在收到`SIGTERM`的同時離開其Service的端點，因此在這項變更傳到邊緣的期間，請求仍可能送達；等待幾秒的`preStop` hook（例如使用`sleep`動作的hook）能在處理程序停止接受連線之前給這項變更一些時間，這可以縮小這段空隙，但無法保證不會有請求在其中抵達。新的副本在其`/readyz`回應就緒後，邊緣才會把請求送給它，詳見[健康檢查](../3-operations/11-monitoring.md#健康檢查)。

### 重新啟動副本

不變更版本的變更（例如變數的新值）可以一次一個副本地推出，安裝實例在推出期間會持續提供服務。儲存的設定則完全不需要重新啟動。您目前執行版本的下一個版本也可以一次一個副本地推出（包括worker處理程序），因為相鄰兩個版本的副本可以並存運作，兩個版本的worker處理程序也會共用outbox：做法以及跳過版本時有何不同，見[升級](./8-upgrading.md#決定是否先停止處理程序)。

### 備份

備份期間，從資料庫備份開始之前直到儲存貯體複製結束，worker處理程序都必須保持停止，而且是它的每一個副本，詳見[停止worker處理程序](./9-backup-and-restore.md#1-停止worker處理程序)。在執行`publira server --with-worker`的安裝實例上，這代表該處理程序的每個副本，伺服器也會一起停止。

## 後續步驟

[升級](./8-upgrading.md)說明如何把擁有任意數量副本的安裝實例升級到新版本。[監控](../3-operations/11-monitoring.md)提供用來觀察負載的指標與日誌。
