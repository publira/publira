---
title: 監控
description: 以/livez和/readyz探測每個處理程序、值得設定警示的日誌行與指標，以及開啟OpenTelemetry指標與追蹤。
published: 2026-11-03
source_updated: 2026-11-01
---

安裝實例會以四種方式告訴您它的狀況：每個處理程序都會回應存活檢查和就緒檢查，`publira server`和`publira worker`會寫入結構化日誌，這兩者在您開啟後也會匯出OpenTelemetry指標，而除了`email-renderer`以外的每個處理程序都可以匯出OpenTelemetry追蹤。本頁說明它們各自回報什麼、如何將它們接到協調器和警示系統，以及什麼值得設定警示。由哪個監控系統接收它們由您決定；本頁只說明安裝實例會傳送什麼。

這些變數在[`publira server`和`publira worker`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[伺服器的追蹤與指標參考文件](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)，以及[Web應用程式的追蹤參考文件](https://github.com/publira/publira/blob/main/packages/tracing/README.md)中有完整說明；本頁只連結到這些文件，不再重複。

## 健康檢查

每個處理程序都會透過純HTTP回應兩種請求：

- **`GET /livez`**：只要處理程序還能回應，就會以`200`和文字`ok`回應。它不檢查其他任何東西，因此只有在處理程序當掉或停止時才會失敗。
- **`GET /readyz`**：會檢查處理程序所依賴的東西，在所有檢查都通過時回應`200`，任何一項失敗時回應`503`。回應主體會列出每一項檢查。

| 處理程序 | 連接埠 | `/readyz`檢查的內容 |
| --- | --- | --- |
| `publira server` | `8000`（`PUBLIRA_PUBLIC_API_ADDR`） | 它的三個資料庫登入身分：`db.public`、`db.admin`和`db.platform`，或`--role`指定給它的角色所對應的登入身分，以及在提供了[讀取複本](../2-deployments/7-scaling-out.md#從複本讀取)時的`db.public.replica` |
| `publira worker` | `8003`（`PUBLIRA_WORKER_ADDR`） | 它的三個資料庫登入身分：`db.outbox`、`db.ticker`和`db.content_stats`，或`--queue`指定給它的佇列所對應的登入身分，以及在負責`maintenance`佇列且提供了[讀取複本](../2-deployments/7-scaling-out.md#每日重建)時的`db.content_stats.replica`。在其工作佇列啟動之前，它也會回應尚未就緒 |
| `web-storefront`、`web-admin`、`web-platform` | `PORT`：在儲存庫建置的映像檔中分別為`3000`、`4000`和`4100` | `api`，即`PUBLIRA_GRPC_URL`所指定主機上`publira server`的`/readyz`；設定了`PUBLIRA_PUBLIC_GRPC_URL`的`web-admin`上還有`public-api`，即該變數所指定主機上的同一項檢查；以及`redis`，即對`PNCH_REDIS_URL`共用快取的ping，在該快取關閉時一律通過 |
| `email-renderer` | `8080`（`PORT`） | 不檢查任何東西：它不依賴任何其他服務，因此只要啟動就是就緒的 |

`publira server --with-worker`處理程序會在前兩列的兩個連接埠上回應，各自進行該列所列出的檢查，因此請像探測兩個處理程序那樣探測它。

它們都不會檢查物件儲存、SMTP伺服器或搜尋引擎。那些地方的失敗會出現在日誌和讀者看到的內容中，而不是在`/readyz`中。

健康的回應如下所示：

```json
{
  "status": "ok",
  "checks": {
    "db.outbox": { "status": "ok" },
    "db.ticker": { "status": "ok" },
    "db.content_stats": { "status": "ok" }
  }
}
```

所有檢查都通過時，`status`為`ok`，有一項失敗時為`unavailable`，worker的工作佇列尚未啟動時則為`starting`。失敗的檢查會帶有一個`error`，只說明是哪一種失敗——`timeout`、`dependency_failed`或`not configured`——絕不包含主機名稱或連線字串，因此可以安全地向任何人顯示這個回應。原因本身會以列出該檢查的`readiness check failed`行寫入處理程序的日誌。

每項檢查的時限為兩秒。`publira server`和`publira worker`會逐一執行檢查，因此當所有登入身分都卡住時，回應大約需要六秒；Web應用程式則會並行執行檢查，大約在兩秒內回應。

### 從協調器探測

請將每個處理程序的存活探測指向`/livez`，就緒探測指向`/readyz`。絕不要將`/readyz`用作存活探測：資料庫停止回應時，協調器會一次重新啟動所有處理程序，這既無法讓資料庫恢復，又會奪走處理程序原本仍能從快取提供的內容。

只要`publira server`的`/readyz`失敗，Web應用程式的`/readyz`也會失敗，因此只要有一個資料庫登入身分停止回應，所有Web應用程式都會與`publira server`一起變成尚未就緒。這是刻意的設計——無法連線到正常API的Web應用程式，無法提供未被快取的頁面——但這也意味著依就緒狀態運作的負載平衡器，會一次停止將流量送往所有應用程式。在將負載平衡器指向`/readyz`之前，請先決定這是否是您想要的行為。

請為`publira server`或`publira worker`的`/readyz`探測設定長於六秒的逾時，讓緩慢的檢查以其所指出的失敗回報，而不是以探測逾時回報。在Kubernetes上，worker的探測如下所示，[Kubernetes](../2-deployments/5-kubernetes/index.md#4-啟動處理程序)則列出了每個處理程序的探測：

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8003
readinessProbe:
  httpGet:
    path: /readyz
    port: 8003
  timeoutSeconds: 8
```

在ECS上，服務任務的每一項健康檢查都相當於存活探測，因為服務會替換未通過檢查的任務；[健康檢查](../2-deployments/6-ecs-fargate/index.md#健康檢查)將它們全部指向`/livez`。

[Docker Compose](../2-deployments/3-docker-compose.md)安裝實例為每個Publira處理程序設定了針對其`/readyz`的healthcheck，從容器內部詢問：啟動後的第一分鐘內每兩秒詢問一次，此時的失敗不計入；之後每十秒詢問一次，連續三次失敗就會將處理程序標記為`unhealthy`；`server`則在其兩個連接埠上都會被詢問。`docker compose ps`會在每個服務旁顯示結果，Web應用程式只有在`server`和Valkey健康之後才會啟動，代理伺服器則要等`server`、`web-storefront`和`web-admin`都健康之後才會啟動。映像檔本身沒有宣告Docker的`HEALTHCHECK`：由於它們都沒有附帶`curl`，Compose檔案在伺服器的映像檔中執行`bash`，在其他映像檔中執行`node`。

沒有任何東西會依這些結果重新啟動處理程序：Compose會重新啟動已結束的處理程序，但不會重新啟動卡住或變成unhealthy的處理程序，它只用這些結果來暫緩等待該處理程序的服務。若想在這種情況發生時收到通知，請從外部探測安裝實例，使用能連線到容器網路的監控工具，或觀察`docker compose ps`。租戶網站的`/livez`和`/readyz`也可以透過每個租戶網域上的反向代理存取，例如`https://comics.example.com/readyz`，網際網路上的運作時間監控工具可以使用它；API和worker的則不行，因為代理伺服器只將`/rpc`和`/images`轉送到`publira server`。

## 日誌

`publira server`、`publira worker`和`publiractl`會將日誌寫入標準輸出，每行一筆記錄，預設為`key=value`配對的形式：

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

設定`PUBLIRA_LOG_FORMAT=json`時，每筆記錄會改為帶有相同鍵的單一JSON物件，日誌收集器無須自訂剖析規則即可讀取：

```jsonl
{"time":"2026-10-07T09:41:03.402Z","level":"ERROR","msg":"outbox event dead","event_id":"0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80","event_type":"contact_message_reply_email","idempotency_key":"…","attempts":10,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","error":"dial tcp: connection refused"}
```

每筆記錄都有`time`、`level`（`DEBUG`、`INFO`、`WARN`或`ERROR`）和`msg`。在處理受追蹤的請求或工作時記錄的記錄，還會有`trace_id`和`span_id`，可藉此在追蹤後端中找到該追蹤。其餘內容取決於記錄者：outbox的記錄會指出項目（`event_id`、`event_type`、`attempts`），維護工作的記錄會指出執行（`job_kind`、`job_id`、`attempt`），而失敗則會帶有`error`。

`PUBLIRA_LOG_LEVEL`設定寫入的最低層級：`debug`、`info`（預設）、`warn`或`error`。`warn`會略去繁忙安裝實例的例行`INFO`記錄，並保留所有問題。稽核記錄的`audit`記錄，以及每次登入嘗試的`audit auth`記錄，無論層級為何都會以`INFO`寫入，因為它們記錄的是誰做了什麼，而不是處理程序的狀況。任一變數若設為它不認識的值，處理程序會在啟動時停止，並顯示指出該變數的訊息。

Web應用程式和`email-renderer`則會寫入Next.js和Node.js本身的純文字輸出。它們的失敗是以應用程式名稱為前綴的行，例如`[web-storefront] getTenantSiteInfo failed`，而失敗的就緒檢查會記錄為`health check api failed`。

### 應該設定警示的項目

對`publira server`和`publira worker`的每筆`ERROR`記錄設定警示，是個合理的起點：API無法回應的請求會以該層級記錄，並附上背後的錯誤。以下記錄值得單獨設定警示，因為每一筆都代表有東西遺失或卡住了：

| 記錄 | 處理程序 | 意義 |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | 郵件、推播通知或快取重新驗證已被永久放棄。`event_type`指出是哪一種；[outbox](./10-scheduled-jobs.md#查看被放棄的項目)說明其代價 |
| `outbox event retry scheduled`，重複出現 | `publira worker` | 項目的傳送目的地——SMTP伺服器、`email-renderer`、Web應用程式——正在失敗。它們會在大約九分鐘內被重試，之後變成dead |
| `episode publish failed after all retries` | `publira worker` | 預約的章節仍維持**已預約**。租戶的管理員和每位營運人員也會收到通知，如[預約發布](./10-scheduled-jobs.md#預約發布)所述 |
| `auditlog: queue is full; dropping entry`、`auditlog: failed to persist; dropping entry` | `publira server` | 租戶或平台稽核記錄中的一筆項目遺失了 |
| `readiness check failed` | `publira server`、`publira worker` | 它所指出的檢查失敗了；`error`欄位說明原因 |
| `opentelemetry error` | `publira server`、`publira worker` | 無法匯出指標或追蹤，通常是因為無法連線到收集器 |
| `failed to initialize …` | `publira server`、`publira worker` | 處理程序無法啟動並已結束。協調器會重新啟動它，而在原因排除之前，同一行會一再出現 |

worker的排程工作如何在日誌和`river_job`資料表中記錄其失敗，請參閱[工作失敗的記錄位置](./10-scheduled-jobs.md#工作失敗的記錄位置)。

## 指標

在`publira server`和`publira worker`上設定`PUBLIRA_METRICS_ENABLED=true`後，它們就會匯出OpenTelemetry指標。沒有這項設定時，它們不會匯出任何指標。Web應用程式和`email-renderer`不會匯出指標。

以`OTEL_METRICS_EXPORTER`選擇匯出方式：

- **`otlp`**（預設）每60秒將指標推送到`OTEL_EXPORTER_OTLP_ENDPOINT`，也就是追蹤所用的同一個收集器位址。
- **`prometheus`**：在連接埠`9464`的`/metrics`上提供指標給Prometheus抓取。請同時設定`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`：預設值`localhost`無法從容器外部存取。當`publira server`和`publira worker`共用網路命名空間時，例如在同一個Kubernetes pod中，請為各自指定不同的`OTEL_EXPORTER_PROMETHEUS_PORT`。

在[Docker Compose](../2-deployments/3-docker-compose.md)安裝實例上，請在`.env`中設定`PUBLIRA_METRICS_ENABLED`、`OTEL_METRICS_EXPORTER`和`OTEL_EXPORTER_PROMETHEUS_HOST`，它們會被傳給`server`，然後再次執行`docker compose up -d`。其他變數以及記錄內容的完整清單，請參閱[指標參考文件](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry)。每個處理程序都以一個`service.name`回報：`publira server`為`publira-api-server`，`publira worker`為`publira-worker`。`publira server --with-worker`處理程序（Compose檔案的`server`就是這種處理程序）會將所有內容都以`publira-api-server`回報。

### outbox

worker的指標追蹤的是outbox，所有郵件、推播通知和快取重新驗證都經由它傳送，如[outbox](./10-scheduled-jobs.md#outbox郵件推播與快取重新驗證)所述。每個指標都以`outbox.event_type`帶有項目的類型。

| 指標 | 計算的內容 | 觀察重點 |
| --- | --- | --- |
| `publira.outbox.events.dead` | 被永久放棄的項目 | 任何增加。請對它設定警示 |
| `publira.outbox.events.retry` | 將會再次嘗試的失敗嘗試 | 持續偏高的速率：該`outbox.event_type`的目的地正在失敗 |
| `publira.outbox.events.claimed` | worker接手項目準備傳送的次數。被重試或繼續處理的項目會再次被接手並再次計算，因此即使每個項目都已傳送，它的增長也會快於`done` | — |
| `publira.outbox.events.done` | 已傳送的項目 | — |
| `publira.outbox.events.resumed` | 在完成部分工作後被放回、稍後繼續處理的項目，例如傳送給大量讀者的推播通知 | — |
| `publira.outbox.handler.duration` | 一次嘗試所花的時間，以秒為單位 | 上升：SMTP伺服器、`email-renderer`或Web應用程式正在變慢 |

這些計數器說明的是worker做了什麼，而不是還有什麼在等待。停止傳送的worker不會回報任何東西，它的`/readyz`也不會察覺：它檢查的是資料庫登入身分，而不是項目是否在流動。若要查看等待中的項目，請以資料庫的[管理用登入身分](../2-deployments/2-installing.md#佈建服務)連線，使用`psql`計算已到期卻未傳送的項目，以及已被接手卻始終沒有完成的項目：

```sql
SELECT status, count(*), min(updated_at)
FROM outbox_events
WHERE (status = 'pending' AND available_at < now() - interval '5 minutes')
   OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
GROUP BY status;
```

健康的worker會在項目到期後幾秒內傳送它，並在15分鐘後將處理到一半的項目放回等待，因此這個查詢傳回的任何一列，都表示worker沒有在消化項目。

### 稽核記錄

`publira server`會透過佇列寫入租戶主控台和平台主控台的稽核記錄，因此請求不必等待其項目寫入。`publira.auditlog.queue.depth`是等待中的項目數，`publira.auditlog.entries.dropped`則依`auditlog.drop_reason`計算遺失的項目。請對任何遺失設定警示，也對持續增長的佇列深度設定警示：這表示資料庫跟不上。稽核記錄的其他指標請參閱其[參考文件](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log)。

## 追蹤

在除了`email-renderer`以外的每個處理程序上設定`PUBLIRA_TRACING_ENABLED=true`後，它們就會匯出OpenTelemetry追蹤。請同時為`publira server`、`publira worker`和Web應用程式開啟它：這樣一來，一次頁面請求就是一個追蹤，從Web應用程式經過API，一直到它所執行的資料庫查詢。

使用OpenTelemetry SDK本身會讀取的變數，將它們指向您的收集器：

| 變數 | 設定的值 |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 收集器，例如`http://otel-collector:4318` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`。`publira server`和`publira worker`也接受`grpc`，但Web應用程式不接受，因此`http/protobuf`才是對所有處理程序都有效的值 |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production`，或環境的名稱。它會記錄在每個span上，並決定下文的取樣方式 |

在[Docker Compose](../2-deployments/3-docker-compose.md)安裝實例上，請在`.env`中設定這些變數和`PUBLIRA_TRACING_ENABLED`，它們會被傳給同時執行worker的`server`以及Web應用程式，然後再次執行`docker compose up -d`。

每個處理程序都以各自的`service.name`回報：`publira server`所提供的三個API分別為`publira-api-server`、`publira-admin-api-server`和`publira-platform-api-server`，其圖片傳送為`publira-image-server`，`publira worker`為`publira-worker`以及每個排程工作各自的名稱，當`publira server --with-worker`在一個處理程序中同時執行兩者時，這些名稱全都會保留，而Web應用程式則為`publira-web-storefront`、`publira-web-admin`和`publira-web-platform`。完整清單以及每個span上記錄的內容，請參閱[伺服器的追蹤參考文件](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)。`publira server`的健康檢查不會被追蹤，因此探測不會每隔幾秒就在後端塞入一個追蹤。

### 取樣

未設定`PUBLIRA_DEPLOYMENT_ENVIRONMENT`時，每個處理程序都會將自己視為`development`並記錄所有追蹤。設為其他任何值時，則每十個追蹤記錄一個。這個決定只在追蹤開始的地方做一次，請求後續經過的每個處理程序都會沿用它，因此追蹤要嘛完整記錄，要嘛完全不記錄。請在每個處理程序上設定相同的值。

若要以其他比率取樣，請設定SDK本身的`OTEL_TRACES_SAMPLER`和`OTEL_TRACES_SAMPLER_ARG`，例如`parentbased_traceidratio`和`0.25`，它們會在設定了它們的每個處理程序上取代預設值。

### 為何邊緣要移除追蹤標頭

每個處理程序都信任請求帶來的追蹤脈絡：`traceparent`標頭會讓它的span成為呼叫者追蹤的一部分，並帶有呼叫者的取樣決定。正是這一點將Web應用程式的span與API的span連接起來。然而，瀏覽器或行動應用程式也可以傳送相同的標頭，藉此將自己的span附加到別人的追蹤上，或將每個請求都標記為已取樣，讓每個請求都匯出一個追蹤，超出十分之一的比率。

因此，安裝實例前方的邊緣會從它轉送的每個請求中移除`traceparent`、`tracestate`和`baggage`，如[追蹤脈絡](../2-deployments/4-edge/index.md#追蹤脈絡)對每個邊緣所要求的，而每個來自外部的請求都會開始一個新的追蹤。Web應用程式呼叫API，以及API和worker呼叫Web應用程式時，都是直接在私有網路上進行，而不經過邊緣，因此它們的追蹤脈絡會被保留。
