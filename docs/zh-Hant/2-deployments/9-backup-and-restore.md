---
title: 備份與還原
description: 安裝實例保存哪些內容、哪些必須備份、如何取得可以還原的備份，以及如何在空的服務上讓安裝實例恢復運作。
published: 2026-11-03
source_updated: 2026-11-02
---

安裝實例把狀態保存在三個地方：PostgreSQL資料庫、物件儲存的儲存貯體，以及只有您持有的密鑰加密金鑰。只還原其中一個而缺少其他兩個，就是不完整的：資料列會指向儲存貯體中沒有的圖片，儲存貯體會保存沒有任何資料列指向的圖片，而資料庫中的認證資訊是以沒有人持有的金鑰封裝的。本頁說明要備份什麼及其原因、如何取得能還原為可運作安裝實例的備份，以及如何從備份在空的服務上讓安裝實例恢復運作。

這些步驟是為您自行執行的安裝實例而寫，也就是依[安裝](./2-installing.md)建立的那種。以儲存庫的Compose檔案建立的安裝實例，會用它自己的指令執行相同的步驟，見[在Docker Compose安裝實例上](#在docker-compose安裝實例上)。

指令中的`publiractl`代表安裝實例所執行版本的`publiractl`映像檔，如同[安裝](./2-installing.md#開始之前)中所述，並傳入各指令讀取的變數：`db`讀取管理用登入的連線`PUBLIRA_DB_URL`；`storage`讀取`PUBLIRA_PLATFORM_DB_URL`，`search reindex`讀取`PUBLIRA_CONTENT_STATS_DB_URL`，兩者都另外讀取`PUBLIRA_SECRET_ENCRYPTION_KEYS`與`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`。每當結構描述有所變更，CI都會在[`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)中以這些指令取得備份並還原。

## 要備份的內容

| 內容 | 保存的資料 | 是否備份 |
| --- | --- | --- |
| PostgreSQL資料庫 | 安裝實例儲存的所有內容，以及它尚待完成的工作 | 是 |
| 物件儲存的儲存貯體 | 每張上傳的圖片 | 是，在資料庫之後 |
| 密鑰加密金鑰 | 封裝每個已儲存認證資訊所用的金鑰 | 是，與資料庫分開保存 |
| 其他密鑰 | 角色密碼、簽署金鑰，以及處理程序之間共用的權杖 | 請保留；每一個都可以替換 |
| Valkey | 快取與計數器 | 否 |
| 搜尋引擎的索引 | 搜尋在OpenSearch或Elasticsearch上執行時的目錄副本 | 否；可從資料庫重建 |

### 資料庫

資料庫保存每個租戶、每個帳戶、目錄、每則留言與每筆購買，以及每項設定，包括平台的與每個租戶的。它也保存安裝實例尚未完成的工作：仍待寄送的郵件與推播通知，以及`publira worker`的作業佇列，其資料表與Publira自己的資料表並存。它是儲存貯體的權威來源：對Publira而言，只有某個資料列指向的圖片才算存在。

### 儲存貯體

儲存貯體保存工作人員上傳的每張圖片（封面、章節頁面、標誌、作者肖像），每張圖片都是`tenants/`底下的一組物件，每種尺寸與格式各一個。資料庫中的資料列以鍵指向每個物件，Publira不會在儲存貯體中保存其他任何東西。

### 密鑰加密金鑰

`PUBLIRA_SECRET_ENCRYPTION_KEYS`與`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`不會儲存在安裝實例的任何地方。資料庫保存以它們封裝的每個認證資訊：

- 平台的SMTP密碼、物件儲存的秘密存取金鑰、搜尋引擎的密碼，以及Web Push私密金鑰。
- 每個租戶自己的SMTP密碼，以及其付款服務商、App Store、Google Play、Firebase、Sign in with Apple與收信郵件的認證資訊。
- 每位已開啟兩步驟驗證的租戶主控台管理員的兩步驟驗證密鑰。

在沒有金鑰的情況下還原的資料庫，雖然擁有每一列資料，但上述內容都無法讀取。worker處理程序無法寄送郵件，伺服器無法連到儲存貯體，每個租戶都必須重新輸入認證資訊，而且任何管理員的驗證器應用程式都無法通過兩步驟驗證。

請保留清單中的每一把金鑰，包括已輪替掉、但仍有值以它封裝的金鑰，並與資料庫備份分開保存。資料庫的副本加上金鑰，就等於安裝實例儲存的所有認證資訊。

### 不需要備份的內容

- **Valkey**保存圖片轉換快取、速率限制計數器，以及Web應用程式的快取。其中的每個項目不是可以從資料庫與儲存貯體重建，就是會自行到期，因此安裝實例在空的Valkey上啟動也不會遺失任何東西。
- **搜尋引擎的索引**（搜尋在OpenSearch或Elasticsearch上執行時）是從資料庫建置的，還原後會[重建](#5-重建搜尋索引)。
- **其他密鑰**都可以替換。角色密碼可以用`publiractl db roles`重新設定，而新的存取權杖簽署金鑰或Web應用程式工作階段金鑰只會讓所有人登出一次。快取重新驗證權杖與Web服務權杖，只需在共用它們的處理程序之間一致即可。即使如此，把它們全部與加密金鑰一起保存在您的密鑰儲存區中，仍可省去這些工作。
- **處理程序的映像檔**可以為您執行的版本重新拉取，若是自行建置則重新建置。請在每次備份時記下是哪個版本：資料庫備份要還原到取得備份時該版本的結構描述上。

## 取得備份

停止`publira worker`，先備份資料庫再備份儲存貯體，然後再次啟動worker處理程序。金鑰不會在每次備份之間改變：請在產生或輪替金鑰時，把它複製到專屬的安全位置。

### 1. 停止worker處理程序

在資料庫備份開始之前停止每個`publira worker`副本，並讓它們維持停止，直到儲存貯體複製完成。worker處理程序對未使用圖片與讀者已過期資料下載的清除，是唯一會從儲存貯體刪除物件的動作；停止它們之後，在複製到達之前，就不會有任何東西移除資料庫備份所指向的物件。備份期間也不要執行`publiractl job purge-orphan-images`或`publiractl job purge-data-exports`。

安裝實例的其他部分會持續提供服務。worker處理程序在此期間原本要做的事（郵件、推播通知、快取重新驗證，以及發布排定時間已到的章節）會在資料庫中等待，並在worker處理程序再次啟動後立即完成。

### 2. 備份資料庫

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`是[管理用登入](./2-installing.md#佈建服務)的連線，`pg_dump`的主要版本必須與您的PostgreSQL伺服器相同或更新。它會在一個快照中讀取每個資料表，因此即使處理程序持續提供服務，備份也是一致的，並包含它開始時已提交的內容。

`db version`會印出資料庫的結構描述版本，也就是備份要還原到的版本。請把`publira.version`與該版本的標籤一起和備份保存。

受管理PostgreSQL的快照也能達到相同目的。它要依其供應商說明的方式還原，並會連同角色一起還原。

### 3. 備份儲存貯體

使用任何能複製整個儲存貯體的S3用戶端（例如`aws s3 sync`或`rclone copy`），把儲存貯體中的每個物件複製到其他地方的儲存空間。請使用絕不從目的地刪除的複製方式（這兩者都不會刪除），並每次都複製到同一個目的地，這樣您保留的每份資料庫備份（不只最新的那份）都能在那裡找到它的物件。使用AWS CLI，從儲存貯體`publira-images`複製到目錄`publira-bucket`：

```bash
aws s3 sync s3://publira-images publira-bucket
```

這個順序就是讓兩份備份相符的關鍵。上傳時會先寫入物件，再寫入指向它們的資料列，而且物件從不會被覆寫，因此資料庫備份中資料列所指向的每個物件，在該備份開始時都已經在儲存貯體中。由於worker處理程序已停止，在複製到達之前，它們都不會被刪除，因此儲存貯體備份會包含所有這些物件。

這也是worker處理程序必須維持停止直到複製結束的原因。在資料庫備份開始之後被替換的圖片，其舊物件仍由該備份指向，但執行中的資料庫已沒有任何資料列指向它們。孤立物件清除會刪除沒有資料列指向的物件，因此在複製期間執行的清除，可能會在複製到達之前刪除它們，而還原後的資料列就會指向儲存貯體與其備份中都沒有的物件。

儲存貯體備份最終保存的內容會比資料庫備份所指向的更多：它執行期間上傳的每張圖片，以及自首次使用該目的地以來被替換的每張圖片。這只會多佔空間，沒有其他代價。還原後，孤立物件清除會刪除沒有任何還原資料列指向的物件。

若以相反的順序複製，儲存貯體備份會遺漏在兩次備份之間上傳的每張圖片，而資料庫備份為它們還原的資料列會指向不存在的物件。這些圖片在網站與主控台上都會顯示為損壞。

### 4. 啟動worker處理程序

啟動您停止的每個副本。它會寄送停止期間等待的內容，並發布排定時間在此期間已過的每個章節。

## 還原到空的安裝實例

請以取得備份時的版本及該版本的`publiractl`映像檔還原。若要執行較新的版本，請先還原，再[升級](./8-upgrading.md)。

依[安裝](./2-installing.md#佈建服務)的說明準備服務：主要版本相同或更新的PostgreSQL伺服器及一個空的資料庫、一個空的儲存貯體，以及一個空的Valkey。請不要執行`db migrate`：備份會帶有結構描述。

### 1. 還原資料庫

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`會讓還原全部成功或完全不做。中途停止的還原會讓資料庫保持空白，而不是缺少失敗之後的資料表；這在worker處理程序啟動後很重要，因為它會從儲存貯體刪除沒有資料列指向的每個物件。

`--no-owner`與`--no-acl`會略過對六個角色的授權，以及`publira_outbox`對作業佇列資料表的擁有權；清單則會略過名為`publira_rls_bypass`的政策，這些政策讓跨租戶工作的角色能讀取每個租戶的資料列。角色屬於PostgreSQL伺服器而非資料庫，因此新的伺服器還沒有它們，任何指定它們的陳述式都會失敗。略過之後，每個物件都屬於管理用登入，下一個步驟會把授權與政策放回去。

### 2. 建立角色

```bash
publiractl db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

這是[建立角色](./2-installing.md#2-建立角色)在安裝時執行的指令，從容器掛載在`/run/secrets`的檔案讀取每個密碼，而它在這裡做的事也相同：建立六個角色並授予該版本所定義的權限，把作業佇列的資料表交給`publira_outbox`並讓其他角色無法存取，再設定每個密碼。使用安裝實例原本的密碼時，處理程序的連線URL會繼續運作；使用新的密碼時，請更新URL。

### 3. 還原儲存貯體

把儲存貯體備份中的每個物件，以相同的鍵複製到新的儲存貯體。使用AWS CLI，從備份所複製到的目錄：

```bash
aws s3 sync publira-bucket s3://publira-images
```

若儲存貯體的名稱、位址與認證資訊都與安裝實例原本的相同，就不需要變更其他任何東西。否則請像`setup`儲存舊的儲存貯體那樣儲存新的儲存貯體，並加以測試：

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

若使用Amazon S3以外的儲存，請加上`--endpoint`與`--force-path-style`；`storage set`的每個旗標見[`publiractl`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)。

### 4. 啟動處理程序

以安裝實例原本使用的加密金鑰，啟動`publira server`、`publira worker`、`web-storefront`與`web-admin`，若有執行`web-platform`與`email-renderer`也一併啟動。其他密鑰可以是您保留的，也可以是依[產生密鑰](./2-installing.md#產生密鑰)所述設定的新密鑰。

請在空的Valkey上啟動它們。在還原之前服務過安裝實例的Valkey，保存著從還原已收回之資料所快取的頁面與圖片，Web應用程式會持續提供它們，直到各項目到期為止。若它沒有服務其他東西，請以`FLUSHALL`清空它。

### 5. 重建搜尋索引

搜尋在OpenSearch或Elasticsearch上執行時，請從還原後的資料庫重建索引：

```bash
publiractl search reindex
```

在還原後仍保留下來的索引，仍會找到備份之後發布的內容，並連結到還原後的資料庫已經沒有的系列；遺失的索引則會讓搜尋結果是空的。使用預設的搜尋（也就是資料庫本身）時，沒有需要重建的東西。

### worker處理程序會補做的工作

`publira worker`會把還原後的資料庫視為自取得備份以來就未曾處理過的資料庫，並在啟動後立即補做：

- **郵件與通知**。取得備份時正在等待寄送的所有內容都會寄出，包括推播通知與快取重新驗證。其中有些已在備份之後、安裝實例遺失之前寄出，因此部分讀者與工作人員會再次收到郵件。
- **排程工作**。排定時間在備份之後已過的每個章節都會發布，快取的頁面會跟上每個已開始或結束的免費閱讀期間，時間已到的置頂公告也會取消置頂。
- **每日重建**。閱讀統計、排行榜與推薦內容，會根據備份所保存的閱讀活動，為備份以來的每一天重新建置。
- **孤立物件清除**。第一次清除會在沒有任何還原資料列指向的物件存在超過一天後刪除它們，也就是取得備份之後上傳的圖片。

### 還原無法找回的內容

取得備份之後寫入的所有內容：讀者建立的帳戶、留言、上傳、設定與購買。在這段期間進行的購買，付款服務商、App Store或Google Play都已經扣款，但安裝實例不再有其紀錄，因此購買者無法再開啟該章節。請在各服務商的紀錄中，查詢從取得備份到安裝實例遺失之間的購買。

## 確認還原結果

- `db version`回報您與備份一起保存在`publira.version`中的版本，而且沒有dirty狀態：

  ```bash
  publiractl db version
  ```

- 每個處理程序都對`GET /readyz`回應就緒。`publira server`與`publira worker`會為每個資料庫登入回報一項檢查，因此密碼與連線URL不符的角色會在那裡被指出。
- `storage test`通過。它使用資料庫中封裝保存的秘密存取金鑰連到儲存貯體，因此也能證明加密金鑰是正確的：

  ```bash
  publiractl storage test
  ```

- 可以登入租戶主控台，租戶的網站也能連同圖片開啟：系列的封面，以及在備份前不久上傳的章節頁面。

從未還原過的備份只是一種期望，而不是備份。請不時把備份還原到備用的服務上，並對它逐一檢查這份清單。

## 在Docker Compose安裝實例上

[Docker Compose](./3-docker-compose.md)安裝實例把資料庫保存在`publira-deploy_postgres-data`磁碟區，把儲存貯體保存在`publira-deploy_rustfs-data`，並把加密金鑰與其他所有密鑰保存在`.env`中。請從執行安裝實例的目錄執行每個指令：也就是該版本封存檔解壓縮到的目錄，或checkout中的`infra/deploy/`。

### 取得備份

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

停止worker處理程序的原因見[停止worker處理程序](#1-停止worker處理程序)。它在`server`內執行，因此API會一起停止，在`server`再次啟動之前，租戶網站與主控台都不會回應。`-T`可以避免輸出經過終端機，否則會損壞輸出內容。

由於RustFS映像檔沒有附帶S3用戶端，儲存貯體是以RustFS保存在其磁碟區中的檔案備份，而不是逐一備份物件。複製這些檔案時必須停止RustFS，否則封存檔可能包含它寫到一半的物件。Compose檔案固定了RustFS映像檔的版本，因此同一個版本的Compose檔案會以相同的RustFS還原封存檔。

請把`publira.dump`、`publira.version`與`publira-bucket.tar.gz`複製到主機以外的地方，並把您在安裝時製作的`.env`副本保存在既不是主機、也不與這些檔案放在一起的地方。

### 還原

在一台擁有備份版本之Compose檔案的主機上（依[下載Compose檔案](./3-docker-compose.md#下載compose檔案)所述，從該版本的封存檔解壓縮而來），把`.env`放回`compose.yaml`旁邊，然後執行：

```bash
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c 'cat > /tmp/publira.dump' < publira.dump
docker compose exec -T postgres sh -c "pg_restore --list /tmp/publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > /tmp/publira.list"
docker compose exec -T postgres pg_restore -U postgres -d publira --no-owner --no-acl --single-transaction --use-list=/tmp/publira.list /tmp/publira.dump
docker compose exec -T postgres rm /tmp/publira.dump /tmp/publira.list
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose run --rm --no-deps -T --entrypoint tar rustfs -xzf - -C /data < publira-bucket.tar.gz
docker compose up -d
```

PostgreSQL在第一次啟動時會建立空的`publira`資料庫，再由還原填入內容。傾印檔會被複製到容器中，讓`pg_restore`能像[還原資料庫](#1-還原資料庫)那樣略過`publira_rls_bypass`政策，再由`db roles`把它們放回去。封存檔會在RustFS第一次啟動之前放入RustFS磁碟區，連同儲存貯體及其中的每個物件。Valkey不保存任何東西，因此以空的狀態啟動。

這些指令預期在安裝實例的兩個磁碟區都還不存在的主機上執行。若要還原到仍在主機上的安裝實例，請先以`docker compose down -v`移除它及其磁碟區。這會刪除它保存的每一列資料與每張圖片，因此請只在備份就在手邊時執行。

接著依[確認還原結果](#確認還原結果)確認還原，並以`docker compose run --rm publiractl db version`與`docker compose run --rm publiractl storage test`執行`publiractl`，再把版本與`publira.version`比較。

## 後續步驟

`db roles`、`storage`與`search reindex`的作用及其接受的每個旗標，見[`publiractl`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)。還原到較舊版本後要進一步升級，見[升級](./8-upgrading.md)。
