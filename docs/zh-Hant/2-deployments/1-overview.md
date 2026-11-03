---
title: 概觀
description: Publira安裝實例執行哪些部分，以及它依賴哪些服務。
published: 2026-11-03
source_updated: 2026-10-25
---

Publira安裝實例由四個常駐處理程序、它們依賴的幾項服務，以及一個需要手動執行的命令列工具組成。本頁說明能服務一個租戶的最小安裝實例：它的公開網站與主控台，並透過`publiractl`而非平台主控台來管理。

## 安裝實例執行的部分

| 處理程序 | 提供的服務 | 由誰存取 |
| --- | --- | --- |
| `web-storefront` | 所有租戶的公開網站 | 邊緣，透過各租戶的網域 |
| `web-admin` | 租戶主控台 | 邊緣，透過各租戶的主控台主機；除非為租戶指定了其他主機，否則為`admin.<domain>` |
| `publira server` | 在同一個連接埠上提供`/rpc`下的API與圖片傳遞 | 邊緣，透過`/rpc`下的公開API與`/images`；`web-storefront`與`web-admin`，透過`/rpc` |
| `publira worker` | 外寄郵件與推播通知、快取重新驗證，以及所有排程工作 | 無；它只回應健康檢查 |

每個處理程序都會回應`GET /livez`與`GET /readyz`，讓協調工具能夠探測它。Web應用程式由同一個映像檔建置，`publira server`與`publira worker`則由另一個映像檔建置；[映像檔建置說明](https://github.com/publira/publira/blob/main/infra/docker/README.md)列出了這些映像檔。

若安裝實例只在單一主機上執行，且伺服器與worker永遠不會執行超過一個副本，可以將兩者合併為一個處理程序執行：`publira server --with-worker`會在同樣的兩個連接埠上完成兩個處理程序的所有工作，並讀取兩者的環境變數。這樣做會失去兩件事。第一，您無法再分別擴展伺服器與worker。第二，面向網際網路的處理程序也會持有worker的三個資料庫登入帳戶，其中包括擁有工作佇列資料表、且可自行建立資料表的那一個。[Docker Compose](./3-docker-compose.md)安裝實例就是將它們合併為一個處理程序執行。如果其中任何一點對您很重要，也就是需要分別擴展兩者，或不想讓worker的登入帳戶出現在面向網際網路的處理程序中，請將兩者分開執行。

`publira server`只監聽一個連接埠，因此像Cloud Run這種每個服務只公開一個連接埠的平台，可以直接將它作為一個服務執行。您也可以在負載平衡器後方，以`--role storefront`執行第二個`publira server`服務，讓它只提供公開API與租戶網站的圖片，並將租戶的網域以及只呼叫公開API的`web-storefront`路由到它：如此一來，服務讀者的處理程序只會以店面的登入帳戶登入資料庫，且每個請求只限於一個租戶，既不持有任一主控台的登入帳戶，也不持有Web應用程式用來呼叫主控台的認證資訊。第一個服務則繼續服務`web-admin`、`web-platform`與主控台主機。[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes)列出了每個角色提供的服務與讀取的設定。

圖片傳遞與公開API也可以分開存取，各自使用自己的主機名稱，並位於各自的負載平衡器後方：租戶網站的圖片使用您為其指定的圖片主機，公開API則使用Web應用程式與行動應用程式所指向的主機。兩者都是`--role storefront`處理程序，因此處理程序本身不需任何變更，變的只有主機名稱以及前方的負載平衡器。[分開提供圖片與公開API](./7-scaling-out.md#分開提供圖片與公開api)說明了這種做法。

沒有任何處理程序保有自己的狀態。安裝實例儲存的資料位於PostgreSQL與物件儲存，處理程序執行期間共用的資料位於Valkey，而工作階段則是瀏覽器回傳的Cookie，因此任何處理程序都可以執行多個副本，邊緣也不需要黏性工作階段就能將請求分散給它們。[水平擴展](./7-scaling-out.md)說明了安裝實例成長時應增加哪些處理程序，以及哪些部分必須先共用。

## 依賴的服務

| 服務 | 使用者 | 保存的內容 |
| --- | --- | --- |
| 邊緣：負載平衡器、反向代理，或位於兩者之一前方的CDN | 瀏覽器與行動應用程式 | 將每個主機與路徑送往正確處理程序的路由，以及TLS |
| PostgreSQL | 所有處理程序 | 安裝實例儲存的一切資料 |
| Valkey，或任何Redis協定的伺服器 | `publira server`、`web-storefront`、`web-admin` | 圖片轉換快取、速率限制計數器，以及Web應用程式的共用快取 |
| S3相容的物件儲存 | `publira server`、`publira worker` | 所有上傳的圖片 |
| SMTP伺服器 | `publira worker` | 無；它負責遞送安裝實例寄出的郵件，例如讀者註冊與密碼重設 |

資料庫與儲存貯體由您建立；其中的一切則由Publira建立。邊緣可以是您的平台在處理程序前方提供的任何東西，例如代管的負載平衡器或您自行執行的代理伺服器，無論是哪一種，[邊緣](./4-edge/index.md#邊緣必須做的事)都說明了它必須做的事。儲存庫中Traefik、nginx與Caddy的設定範例是其中一種做法。

## 需要手動執行的命令

`publiractl`會在每個版本套用資料庫遷移與角色、設定新的安裝實例，並在之後變更平台設定。不需要任何機制定時執行它：`publira worker`會自行排程所有週期性工作。

## 可以加入的處理程序

| 處理程序 | 增加的功能 |
| --- | --- |
| `email-renderer` | 在每封郵件中加入HTML部分。若沒有它，相同的郵件會以純文字寄出 |
| `web-platform` | 平台主控台，營運人員可從瀏覽器而非`publiractl`管理租戶與平台設定 |

## 後續步驟

[安裝](./2-installing.md)會逐步讓一個空的安裝實例開始提供服務。各處理程序讀取的環境變數列於[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)。
