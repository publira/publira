---
title: 升級
description: 把執行中的安裝實例升級到新版本，從升級前的備份一路到新版本的處理程序開始提供服務。
published: 2026-11-03
source_updated: 2026-10-24
---

版本可能會變更其處理程序所預期的資料庫結構描述，因此升級安裝實例不只是換上新映像檔重新啟動。資料庫要先處理：由新版本的`publiractl`映像檔把結構描述與資料庫角色更新到新版本，之後才在其上啟動新版本的處理程序。本頁依序說明這些步驟、如何確認每個步驟，以及遷移失敗時該怎麼做。

這些步驟是為您自行執行的安裝實例而寫，也就是依[安裝](./2-installing.md)建立的那種。以儲存庫的Compose檔案建立的安裝實例，會用它自己的指令執行相同的步驟，見[在Docker Compose安裝實例上](#在docker-compose安裝實例上)。

## 開始之前

### 閱讀版本說明

每個版本都是儲存庫的一個標籤，並連同版本說明發布在儲存庫的[Releases](https://github.com/publira/publira/releases)頁面上。請閱讀您目前執行的版本之後、直到要升級的目標版本（含）為止的每個版本的說明。就結構描述而言，跳過版本沒有問題，因為`db migrate`會在一次執行中套用其間每個版本的遷移；但說明中要求您做的事，沒有任何機制會代您完成。

版本說明的開頭是**Upgrade notes**，它在造成變更的Pull Request下列出該版本中每項需要您處理的變更；沒有這類變更時也會註明。它列出的變更有以下幾種：

- **新增、重新命名或不再讀取的環境變數**。請在新版本的處理程序啟動前設定。
- **新的資料庫角色**。`db roles`需要尚不存在的角色的密碼：請以安裝時的方式產生一個，並透過該角色的旗標傳入。
- **邊緣必須做的事有所變更**，例如某個路徑改為路由到另一個處理程序。請依[邊緣](./4-edge/index.md#邊緣必須做的事)針對新版本的說明，在您的邊緣做同樣的變更。若您的邊緣是從某個[設定範例](./4-edge/1-sample-configurations.md)改寫而來，`git diff <current tag> <new tag> -- infra/proxy/`會顯示範例中的變更，供您套用到自己的副本。
- **安裝實例必須執行、但以前沒有執行的處理程序或服務。**
- **執行時間長或會鎖定繁忙資料表的遷移**，讓您可以選擇執行的時機。

只有主要版本才會列出上述任何一項，在`1.0.0`之前則是次要版本。`1.0.0`之前的修補版本仍要執行本頁的每個步驟：它可能帶有遷移，而且它的處理程序在`db migrate`尚未更新的結構描述上會失敗，因此要在替換其處理程序之前執行`db migrate`與`db roles`。各類版本可以變更什麼，以及哪些版本會收到修正，見[版本](./10-releases.md)。

### 取得新版本的映像檔

在變更任何東西之前，先把新版本的每個映像檔`ghcr.io/publira/<name>:<new version>`拉取到執行它的主機上。這樣從套用遷移到重新啟動處理程序之間的時間，就只剩處理程序啟動所需的時間。若您的安裝實例執行的是自行建置的映像檔，請從新版本的標籤建置，帶入您的變更，並推送到主機拉取映像檔的位置。

`publiractl`也要使用新版本的：它帶有該版本的遷移與角色定義，而一個版本的處理程序需要的是它自己的結構描述，絕不是較早的版本。

本頁的範例使用已發布的映像檔名稱，例如`ghcr.io/publira/publiractl:<new version>`，其中的版本是該版本的Git標籤去掉`v`：`v0.2.0`即為`0.2.0`。自行建置映像檔的安裝實例，請改用自己的名稱。

### 決定是否先停止處理程序

一個版本的處理程序可以與下一個版本的處理程序並存運作，因此升級到下一個版本時，在兩個版本同時執行的兩個時段中，安裝實例都可以持續提供服務：

- **在`db migrate`與重新啟動之間**，您目前執行的版本的處理程序，會在新版本的結構描述與角色上提供服務。版本會保留前一個版本讀取的每個資料表、欄位與授權，刪除它們的工作留給之後的版本，因此那些處理程序做的事都不會失敗。
- **在替換處理程序的期間**，兩個版本的Web應用程式與`publira server`會互相呼叫，無論以什麼順序替換、是否一次一個副本，也無論回復其中哪一個。兩個版本的worker處理程序共用outbox：您目前執行的版本的worker處理程序，會把只有新版本才會寫入的項目留給新版本的worker處理程序寄送。您目前執行的版本已經在做的事都會繼續運作；新版本新增的功能，要等兩邊都執行新版本後才會運作。

這項保證只涵蓋您目前執行的版本的下一個版本。跳過版本時，您正在執行的處理程序可能會讀取其間某個版本已淘汰的欄位或呼叫已淘汰的API，因此請先停止它們，或一次升級一個版本。

保持執行的處理程序在您取得備份後也會繼續寫入。若之後遷移失敗而您回到該備份，備份之後寫入的所有內容都會被捨棄：期間的每筆註冊、購買、留言與編輯，包括付款服務商已經扣款的購買。

在備份之前停止處理程序可以避免這種情況：因為備份之後沒有任何寫入，備份會包含每一筆寫入。這樣安裝實例會從備份開始停止服務，直到新版本的處理程序啟動為止。只要無法接受遺失這些寫入，就請先停止處理程序；在販售章節的安裝實例上，每次都是如此。

## 升級

### 1. 備份資料庫

若您決定停止處理程序，請現在、在備份之前停止。

`publiractl`只會把結構描述往前更新，遷移一旦套用就無法復原。您現在取得的備份，就是回到目前執行版本的途徑。

```bash
pg_dump --format=custom --file=publira-before-upgrade.dump --dbname="$PUBLIRA_DB_URL"
```

`PUBLIRA_DB_URL`是`db migrate`所使用的[管理用登入](./2-installing.md#佈建服務)的連線，`pg_dump`的主要版本必須與您的PostgreSQL伺服器相同或更新。受管理PostgreSQL的快照也能達到相同目的。遷移不會變更物件儲存、Valkey或您的密鑰中的任何內容，因此在遷移之前要備份的是資料庫。請保留備份，直到新版本已經運作一段時間。

### 2. 套用遷移

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db migrate
```

它會記錄起始的版本，完成時再記錄結束的版本：

```text
time=2026-11-20T09:41:02.118Z level=INFO msg=migrating from_version=20261006125036
time=2026-11-20T09:41:03.402Z level=INFO msg=migrated from_version=20261006125036 to_version=20261120093000
```

版本未帶有遷移時，兩個版本號相同，而它同樣會以零結束。

遷移要在新處理程序啟動之前執行，因為處理程序啟動時不會檢查結構描述。若在舊的結構描述上啟動，它們會以健康的狀態啟動，然後在每個觸及該版本新增的資料表或欄位的請求上失敗。

### 3. 更新角色

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db roles
```

不加旗標時，每個角色都會保留原本的密碼，指令只會把角色更新為新版本所定義的狀態：對剛由遷移建立的資料表的授權，以及該版本對角色可存取範圍所做的其他變更。它會為每個角色輸出一行，例如`publira_public: kept its password`。若略過此步驟，新的處理程序會在該版本新增的每個資料表上因權限錯誤而失敗。

若版本新增了角色，請以該角色的`--<name>-password-file`旗標傳入其密碼，做法同[建立角色](./2-installing.md#2-建立角色)。未傳入時，指令會指出它需要的旗標並結束，不會建立任何東西。

### 4. 替換處理程序

依以下順序，以新版本的映像檔替換每個處理程序，並設定版本說明要求您設定的變數：

1. **`email-renderer`**（若有執行），讓任一版本的worker處理程序都能找到它要算繪的範本。
2. **`publira worker`、`publira server`、`web-storefront`與`web-admin`**，若有執行`web-platform`也一併替換，順序不限，也可以一次一個副本：在協調工具逐一替換時，安裝實例會持續提供服務。只有新版本才會寄送的郵件或通知，會在outbox中等待，直到新worker處理程序的副本取用它。您目前執行的版本的副本每次會把這類項目擱置一分鐘，因此在這些副本的最後一個停止後，該項目會在一分鐘內可供新的worker處理程序取用，之後就像其他項目一樣寄出。worker處理程序啟動時會套用它自己作業佇列的遷移，因此它的資料表不需要另外的步驟。

執行`publira server --with-worker`的安裝實例也以相同方式替換其副本，可以一次一個。若您在步驟1停止了處理程序，請將它們全部啟動。

### 5. 檢查安裝實例

- 每個處理程序都對`GET /readyz`回應就緒。
- `db version`回報該版本最新的遷移，而且沒有dirty狀態：

  ```bash
  docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db version
  ```

  ```text
  version 20261120093000
  dirty false
  ```

  這個版本號是新標籤中`db/migrations/`最新檔案開頭的時間戳記。

- 可以登入租戶主控台，租戶的網站也能開啟。

## 遷移失敗時

`db migrate`會以非零值結束，並記錄`failed to migrate`與PostgreSQL傳回的錯誤，而`db version`會回報dirty狀態：

```text
version 20261120093000
dirty true
```

這時資料庫的狀態如下：

- 失敗的遷移之前的每個遷移都已套用，並維持套用狀態。
- 若是PostgreSQL拒絕了失敗的遷移，該遷移會被回復。一個遷移檔案以單一交易執行，因此它的陳述式都不會留下。例外是以`CREATE INDEX CONCURRENTLY`建立索引的遷移，它在交易之外執行：失敗時會留下一個同名的無效索引。
- 若是連線中斷，失敗的遷移可能在回應遺失之前就已提交，而`db migrate`無法判斷是哪一種。
- 記錄的版本是失敗的遷移，並標示為dirty；在清除這個標記之前，`db migrate`會拒絕再次執行。

您原本執行的處理程序會在目前已套用的遷移上繼續執行，就像任何一次`db migrate`與重新啟動之間那樣。請不要在這個狀態上啟動新版本的處理程序。

### 修正原因後再次執行

日誌可以區分這兩種情況。若是PostgreSQL拒絕了遷移，`failed to migrate`那一行的結尾會是它傳回的錯誤與SQLSTATE，例如`(details: ERROR: canceling statement due to statement timeout (SQLSTATE 57014))`。連線中斷時則會顯示網路錯誤，沒有SQLSTATE。

若PostgreSQL是因遷移以外的原因拒絕了遷移（例如磁碟已滿，或陳述式等待繁忙的資料表而逾時），請修正原因，把紀錄設回失敗的遷移的前一個遷移，再次執行`db migrate`：

1. 找出失敗的遷移的前一個遷移版本。在新版本的checkout根目錄執行以下指令，會先印出它：

   ```bash
   ls db/migrations | grep '\.up\.sql$' | grep -B1 '^20261120093000_'
   ```

   相同的清單也可以在GitHub上新標籤的`db/migrations/`下找到。

2. 若失敗的遷移以`CONCURRENTLY`建立索引，請以管理用登入刪除它留下的無效索引：

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <index name>;
   ```

3. 以管理用登入把紀錄設回：

   ```sql
   UPDATE schema_migrations SET version = <previous version>, dirty = false;
   ```

4. 再次執行`db migrate`。它會從失敗的遷移開始；成功後，請從[步驟3](#3-更新角色)繼續。

若是連線中斷，請先閱讀新標籤中失敗的遷移的`.up.sql`檔案，在資料庫中尋找它所做的變更。由於遷移以單一交易執行，這些變更要不是全部都在，就是全部都不在：

- **全部都不在**：遷移已被回復。請依照上述步驟進行。
- **全部都在**：遷移已提交。請把紀錄設為失敗的遷移本身，而不是前一個，執行`UPDATE schema_migrations SET version = <failed version>, dirty = false;`，然後再次執行`db migrate`，繼續套用它之後的遷移。
- **無法判斷**，例如只變更資料列、沒有留下可尋找之物的遷移：請依下方說明回到您原本執行的版本。再次執行這類遷移，可能會把相同的資料列變更兩次。

### 回到原本執行的版本

若問題出在遷移本身，或您找不到原因、無法判斷它是否已套用，請還原備份並繼續執行原本的版本。還原會捨棄備份之後寫入的所有內容，因此若處理程序在升級期間持續執行，它們在那之後的寫入都會遺失。請在[Issue](https://github.com/publira/publira/issues)中回報失敗，並附上`db migrate`的日誌與`db version`的輸出。

1. 停止處理程序：在它們持有連線時，無法刪除資料庫。
2. 刪除資料庫，再以最初建立時相同的擁有者與設定重新建立一個空的資料庫。
3. 把備份還原到其中：

   ```bash
   pg_restore --dbname="$PUBLIRA_DB_URL" publira-before-upgrade.dump
   ```

   角色屬於PostgreSQL伺服器而非資料庫，因此刪除資料庫後仍會保留，而備份帶有它們的授權。

4. 啟動您原本執行的版本的處理程序。

受管理PostgreSQL的快照，請依其供應商說明的方式還原，以取代上述步驟。

## 在Docker Compose安裝實例上

[Docker Compose](./3-docker-compose.md)安裝實例以`docker compose`執行上述每個步驟。新版本的Compose檔案放在自己的目錄中，與您目前用來執行安裝實例的目錄並列；步驟1建立它之後，請從那裡執行每個指令。專案名稱是固定的，因此無論從哪個目錄，`docker compose`都會連到相同的容器與磁碟區。

### 1. 下載新版本

從包含目前執行安裝實例之目錄的上層目錄執行以下指令，其中`<current version>`與`<new version>`是兩個版本的版本號，也就是去掉`v`的標籤：

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<new version>/publira-deploy-<new version>.tar.gz
tar -xzf publira-deploy-<new version>.tar.gz
diff publira-deploy-<current version>/.env.example publira-deploy-<new version>/.env.example
cp -p publira-deploy-<current version>/.env publira-deploy-<new version>/.env
cd publira-deploy-<new version>
```

diff會顯示新版本在Compose檔案中新增或不再讀取的每個變數：請把新的變數加入`.env`。必要的變數若留空，每個`docker compose`指令都會停止並指出該變數。接著把`.env`中的`PUBLIRA_IMAGE_TAG`設為新版本，diff中也會顯示這一項。`cp -p`會讓`.env`維持只有您能讀取，而留在舊目錄中的副本仍然指向您目前執行的版本，這就是遷移失敗時的退路。

若版本說明指出該版本從Compose檔案中移除了某個服務，請從仍然列有它的舊目錄以`docker compose stop <service>`停止該服務。新的Compose檔案沒有列出它，因此它會繼續以您原本執行的版本、在新版本的結構描述上執行，直到[步驟5](#5-啟動新版本)將它移除。

從checkout執行的安裝實例，則改為擷取新標籤並在`infra/deploy/`中checkout它，並在checkout之前以`git diff <current tag> <new tag> -- .env.example`取代`diff`。它的`.env`不受版本控制，因此會留在原處，而版本移除的服務要在checkout之前停止。若要把這樣的安裝實例改為使用封存檔，請以它的`infra/deploy/`取代`publira-deploy-<current version>`，執行上述步驟。

### 2. 取得映像檔

```bash
docker compose pull
docker compose pull publiractl
```

第一個指令會以您剛設定的版本，拉取安裝實例所執行的每個處理程序的映像檔；第二個指令拉取`publiractl`，因為它從不持續執行，第一個指令不會包含它。不會建置任何東西。

若您的安裝實例執行的是自行建置的映像檔，請改從新版本標籤的checkout建置，帶入您的變更，並推送到`PUBLIRA_IMAGE_REGISTRY`指向的位置；在主機本身以`task docker:verify:full`建置的映像檔則不需要推送。

### 3. 備份資料庫

若您決定[停止處理程序](#決定是否先停止處理程序)，請先停止它們；若有執行`web-platform`與`email-renderer`，也要一併指定：

```bash
docker compose stop server web-storefront web-admin
```

接著取得備份：

```bash
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira-before-upgrade.dump
```

`-T`可以避免傾印內容經過終端機，否則會損壞傾印。

### 4. 套用遷移並更新角色

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles
```

若版本新增了角色，請以安裝時的方式，透過`--<name>-password-file /run/secrets/<name>-db-password`傳入其密碼，並在`.env`中設定`.env.example`的diff所顯示的變數。

### 5. 啟動新版本

```bash
docker compose up -d --remove-orphans
docker compose ps
```

`up -d`會重新建立映像檔或設定有所變更的每個容器，包括代理，因為它現在掛載的是新目錄的`Caddyfile`；`--remove-orphans`則會移除新版本Compose檔案中已不存在的服務的容器。代理取得的憑證會留在`caddy-data`磁碟區中。

從checkout執行的安裝實例，還要在`up -d`之後執行`docker compose restart proxy`：代理是以單一檔案的方式掛載`Caddyfile`，而`git checkout`會在同一路徑以新檔案取代該檔案，因此持續執行的代理會一直讀取您原本執行的版本的路由。

接著依[步驟5](#5-檢查安裝實例)檢查安裝實例，並以`docker compose run --rm publiractl db version`執行`db version`。通過之後，就不再需要舊目錄。它的`.env`保存安裝實例的所有密鑰，因此請刪除該目錄或其中的`.env`，不要在主機上留下第二份副本。

### 在Compose上遷移失敗時

[修正原因後再次執行](#修正原因後再次執行)中的SQL，請透過`postgres`容器中的`psql`以超級使用者身分執行，一次一個陳述式：

```bash
docker compose exec postgres psql -U postgres -d publira -c "UPDATE schema_migrations SET version = <previous version>, dirty = false"
```

若要改為回到原本執行的版本：

```bash
docker compose stop server web-storefront web-admin
docker compose exec postgres psql -U postgres -d postgres -c 'DROP DATABASE publira' -c 'CREATE DATABASE publira'
docker compose exec -T postgres pg_restore -U postgres -d publira < publira-before-upgrade.dump
cd ../publira-deploy-<current version>
docker compose up -d --remove-orphans
```

舊目錄的`.env`仍然指向您原本執行的版本，因此`up -d`會再次啟動它，代理也會使用舊的`Caddyfile`。從checkout執行的安裝實例，則以`git checkout <current tag>`取代`cd`，把`PUBLIRA_IMAGE_TAG`設回原本執行的版本，並在`up -d`之後執行`docker compose restart proxy`。

## 後續步驟

每個`db`指令的作用，以及`db roles`的每個旗標，見[`publiractl`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)；若版本說明提到某個變數，各處理程序讀取的變數見[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)。
