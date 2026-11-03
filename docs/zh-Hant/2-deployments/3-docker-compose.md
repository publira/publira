---
title: Docker Compose
description: 使用每個版本發布的Compose檔案在單一主機上執行整個安裝實例，從下載檔案到首次登入租戶主控台。
published: 2026-11-03
source_updated: 2026-10-28
---

每個版本都會發布一個Compose檔案，可在單一主機上執行整個安裝實例：Publira依賴的服務、安裝實例的各個處理程序，以及位於它們前方的反向代理，全都已經串接好。這是取得可運作安裝實例的最短途徑，本頁帶您從一台空的主機開始，直到首次登入租戶主控台。

Compose檔案執行的步驟與[安裝](./2-installing.md)相同，該頁說明了每個步驟存在的理由、每個密鑰保護的對象，以及每個資料庫角色可存取的範圍。本頁說明Compose檔案特有的部分：它執行什麼、您要在其中設定什麼，以及啟動它的命令。它讀取的完整環境變數清單位於[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)。

## 檔案執行的內容

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)定義了以下服務：

| 服務 | 內容 | 保存在主機上的資料 |
| --- | --- | --- |
| `postgres` | PostgreSQL，保存安裝實例儲存的一切資料 | `postgres-data`磁碟區 |
| `valkey` | Valkey，保存圖片轉換快取、速率限制計數器，以及Web應用程式的快取 | 無；每次重新啟動後都從空的狀態開始 |
| `rustfs` | [RustFS](https://github.com/rustfs/rustfs)，S3相容的物件儲存，保存所有上傳的圖片 | `rustfs-data`磁碟區 |
| `proxy` | Caddy，即反向代理，使用儲存庫本身的路由，並為您的主機名稱取得及更新憑證 | `caddy-data`磁碟區，保存憑證 |
| `server` | 以單一處理程序`publira server --with-worker`執行的`publira server`與`publira worker`，如[概觀](./1-overview.md#安裝實例執行的部分)所述 | 無 |
| `web-storefront`、`web-admin` | 公開網站與租戶主控台 | 無 |
| `web-platform`、`email-renderer` | 選用處理程序，只在您啟用時執行 | 無 |
| `publiractl` | 命令列工具，不會常駐執行：以`docker compose run --rm publiractl <command>`執行 | 無 |
| `setup` | 已帶入安裝實例的資料庫密碼與其RustFS儲存貯體的`publiractl setup`，不會常駐執行：以`docker compose run --rm setup`執行 | 無 |

伺服器與worker以單一處理程序執行，因此主機少執行一個容器。如果以下任何一點對您的安裝實例很重要，請改為將它們分成兩個處理程序執行：需要分別擴展兩者，或不想讓worker的資料庫登入帳戶出現在代理伺服器轉送請求的處理程序中。[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出了兩者各自讀取的環境變數。

代理伺服器會在主機的所有網路介面上公開連接埠80與443，是網際網路唯一能存取的服務：它為您列出的主機名稱提供HTTPS，並將純HTTP重新導向到HTTPS。其他所有服務都只能由彼此存取。

這些服務分屬兩個Docker網路。`edge`包含代理伺服器及其轉送的對象：`server`與各Web應用程式。`default`包含代理伺服器以外的所有服務。因此，代理伺服器既無法存取資料庫，也無法存取Valkey，即使代理伺服器有漏洞，也無法藉此進入兩者。

專案名稱固定為`publira-deploy`，因此無論您從哪個目錄執行任何命令，磁碟區都會保持相同的名稱，而一台主機只執行一個安裝實例。

## 開始之前

您需要：

- **一台安裝了Docker Engine與Compose外掛程式（`docker compose`）的主機**，平台為`linux/amd64`或`linux/arm64`，也就是映像檔所發布的兩種平台。在其他平台上，第一次拉取會以`no matching manifest`失敗，主機必須改為執行為其平台建置的映像檔，如[映像檔](#映像檔)所述。
- **您要安裝的版本**，以`publira-deploy-<version>.tar.gz`的形式附加在[Releases](https://github.com/publira/publira/releases)頁面上對應的版本中，由[下載Compose檔案](#下載compose檔案)取得。主機上不需要儲存庫中的其他任何東西。
- **主機能存取`ghcr.io`**，每個版本都在這裡發布其映像檔。`docker compose`會在命令第一次需要時拉取映像檔，不需要登入，因此不需要在主機上建置任何東西。
- **SMTP伺服器**，`publiractl setup`會詢問它的資訊：主機、連接埠、加密方式、寄件地址，以及用於登入的使用者名稱與密碼；但若它不需認證即可轉送，則不需要使用者名稱與密碼。
- 租戶網域及其主控台主機（`admin.<domain>`，或您將以`--admin-domain`指定的主機）的**DNS**，兩者都指向這台主機。
- **對網際網路開放的連接埠80與443**，且主機上沒有其他程式監聽這兩個連接埠。代理伺服器會在兩者上回應，而憑證授權單位在為每個主機名稱簽發憑證之前，會透過其中一個連接埠檢查該主機名稱。

## 下載Compose檔案

下載您要安裝的版本的封存檔，`<version>`為其版本號：去掉`v`的標籤，例如`v0.1.0`的版本號為`0.1.0`。接著解壓縮，並進入解壓縮出來的目錄：

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

其中包含`compose.yaml`、`.env.example`、代理伺服器的`Caddyfile`，以及列出完整環境變數清單的`README.md`。本頁的所有命令都從這個目錄執行。

如果您修改了程式碼，請改從儲存庫在該版本標籤上的簽出，於`infra/deploy/`中執行安裝實例。那裡有相同的檔案，只是其中的`Caddyfile`是指向`infra/proxy/`的連結，因此請保留整個簽出，而不要只把`infra/deploy/`複製出來。

## 撰寫`.env`

檔案所需的每個值都來自其旁邊的`.env`檔案。`publiractl env generate`會依據`.env.example`寫出它；`.env.example`列出了檔案讀取的每個環境變數，並附有說明，而該命令會為每個密鑰填入專屬的值。請使用您要安裝的版本的`publiractl`映像檔執行它，`<version>`為該版本的版本號，與[下載Compose檔案](#下載compose檔案)相同：

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

它會輸出`Wrote .env with 17 secrets generated.`，除此之外不會輸出任何東西。映像檔以您的使用者身分執行，因此檔案屬於您，且建立時只有您能讀取。它會拒絕覆寫已存在的`.env`，因為其中可能保存著用來封存安裝實例資料的金鑰。`docker compose run`無法執行這個步驟，因為在`.env`缺少接下來三節所設定的值時，它會停止。

`.env`保存了安裝實例的所有密鑰，其中包括加密金鑰，因此請在主機以外的地方保留一份副本。

其中有三個值留給您設定：兩個主機清單`PUBLIRA_EDGE_SITE_HOSTS`與`PUBLIRA_EDGE_ADMIN_HOSTS`，以及啟用HTTPS的`PUBLIRA_EDGE_ACME_EMAIL`。在簽出中，`PUBLIRA_IMAGE_TAG`是第四個。

### 映像檔

`PUBLIRA_IMAGE_REGISTRY`與`PUBLIRA_IMAGE_TAG`以`<registry>/<name>:<tag>`的形式指定映像檔。範例中的登錄`ghcr.io/publira`是每個版本發布映像檔的位置；請保留它。標籤已經是您所下載版本的版本號，例如在`v0.1.0`的封存檔中為`0.1.0`：

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

這個值也請保留。所有映像檔都執行這同一個標籤，而它必須與`.env`旁邊的檔案相符：`publiractl`攜帶其版本的遷移，處理程序預期的是其版本的結構描述，代理伺服器則執行旁邊`Caddyfile`的路由。在簽出中，`.env.example`的標籤是空的：請將它設為簽出所在版本的版本號。

如果您修改了程式碼，或主機既不是`linux/amd64`也不是`linux/arm64`，請改為依照[映像檔建置說明](https://github.com/publira/publira/blob/main/infra/docker/README.md)自行建置映像檔，並將兩個變數設為映像檔所在的位置：您推送映像檔的登錄位址，例如`registry.example.com/publira`，以及您自己的標籤；若是`task docker:verify:full`在主機本身建置的映像檔，則設為`publira`與`local`。

### HTTPS與租戶URL協定

`PUBLIRA_EDGE_ACME_EMAIL`會啟用HTTPS。請將它設為您的地址，代理伺服器會用它在憑證授權單位註冊帳戶：

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

接著，代理伺服器會從[Let's Encrypt](https://letsencrypt.org/)取得主機清單中每個主機名稱的憑證，若Let's Encrypt失敗則改從ZeroSSL取得，在每張憑證到期前更新，於連接埠443提供HTTPS，並將連接埠80上的純HTTP重新導向到HTTPS。若留空，代理伺服器只會提供純HTTP，只有[在單一機器上試用](#在單一機器上試用)與[前方有CDN或負載平衡器](#前方有cdn或負載平衡器)才需要這樣做。

`PUBLIRA_EDGE_HTTP_PORT`與`PUBLIRA_EDGE_HTTPS_PORT`是代理伺服器公開的連接埠，分別為`80`與`443`。在代理伺服器取得憑證期間請保留它們：憑證授權單位只會透過這兩個連接埠存取它。

當瀏覽器透過HTTPS存取安裝實例時，請將`PUBLIRA_TENANT_URL_SCHEME`留空。它是Publira在郵件與`setup`摘要中所建立連結的協定。只有在瀏覽器確實透過HTTP開啟安裝實例時，才將它設為`http`，例如[在單一機器上試用](#在單一機器上試用)。

### 主機名稱

`PUBLIRA_EDGE_SITE_HOSTS`與`PUBLIRA_EDGE_ADMIN_HOSTS`是代理伺服器路由到租戶網站與租戶主控台的主機名稱：租戶的網域，例如`comics.example.com`，以及其主控台主機，除非您將以`--admin-domain`指定其他主機，否則為`admin.comics.example.com`。主機名稱請不要加上連接埠。每個變數都可以用空格分隔多個名稱，每個租戶一個；對於兩者都不包含的主機，代理伺服器會自行回應404。

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`是平台主控台的主機，除非您執行平台主控台，否則保持空白。`PUBLIRA_EDGE_IMAGE_HOSTS`保存您為其指定了圖片主機的各租戶的圖片主機，如[圖片主機](../3-operations/2-tenants.md#圖片主機)所述，在您指定之前保持空白；代理伺服器在這些主機上只轉送`/images`。設定了`PUBLIRA_EDGE_ACME_EMAIL`時，代理伺服器會為這四個變數中的所有名稱取得憑證。

### 密鑰

`env generate`已填入以下各項，每一項都是其他安裝實例不會共用的新值：

| 變數 | 產生的內容 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 以十六進位表示的32個隨機位元組 |
| `PUBLIRA_PUBLIC_DB_PASSWORD`、`PUBLIRA_ADMIN_DB_PASSWORD`、`PUBLIRA_PLATFORM_DB_PASSWORD`、`PUBLIRA_OUTBOX_DB_PASSWORD`、`PUBLIRA_TICKER_DB_PASSWORD`、`PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 以十六進位表示的32個隨機位元組，各一個 |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`加上以base64表示的32個隨機位元組 |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`，即上述金鑰前方的ID |
| `PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`、`PUBLIRA_WEB_ADMIN_AUTH_SECRET`、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`、`PUBLIRA_WEB_SERVICE_TOKEN` | 以base64表示的32個隨機位元組，各一個 |
| `PUBLIRA_REVALIDATE_TOKEN` | 以十六進位表示的32個隨機位元組 |
| `PUBLIRA_RUSTFS_ACCESS_KEY`、`PUBLIRA_RUSTFS_SECRET_KEY` | 以十六進位表示的32個隨機位元組，各一個 |

請維持這些值不變。資料庫密碼會以未跳脫的形式放入連線URL，這就是它們採用十六進位的原因；若改為手動設定值，也必須只使用URL安全的字元。第一個是PostgreSQL超級使用者的密碼，只有`publiractl setup`與`publiractl db`命令會以它連線；其他六個是`setup`為處理程序所連線的角色設定的密碼。兩個RustFS值是物件儲存本身的認證資訊：RustFS以它啟動，而`setup`會將它儲存為Publira存取儲存貯體所用的認證資訊。其餘各項保護的對象請參閱[產生密鑰](./2-installing.md#產生密鑰)。

### 會讓`docker compose`停止的情況

`PUBLIRA_IMAGE_TAG`與兩個主機清單是必填的，除了`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`以外的所有密鑰也是。只要其中任何一個是空的，每個`docker compose`命令（包括`run`）都會在啟動任何東西之前停止，並指出每個缺少的變數，每個讀取該變數的服務各一次：

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`為空時不會讓`docker compose`停止：代理伺服器會改為提供純HTTP。檔案中的其他變數也可以保持空白：`PUBLIRA_TENANT_URL_SCHEME`、`COMPOSE_PROFILES`、`PUBLIRA_EDGE_PLATFORM_HOSTS`、`PUBLIRA_EDGE_IMAGE_HOSTS`、只有[前方有CDN或負載平衡器](#前方有cdn或負載平衡器)才會填入的`PUBLIRA_EDGE_TRUSTED_PROXIES`，以及選用處理程序的變數，下一節會在您啟用其中一個時填入。

在您執行`docker compose`的shell中匯出的變數，會優先於`.env`中的同名變數。如果您寫在`.env`中的值似乎被忽略了，請檢查shell環境中是否有`PUBLIRA_*`變數。

## 選擇選用處理程序

當`COMPOSE_PROFILES`以逗號分隔的清單列出選用處理程序時，它們就會執行。每個處理程序也需要在`.env`中設定其下方列出的變數：

| 設定檔 | 增加的功能 | `.env`中還需設定的項目 |
| --- | --- | --- |
| `email-renderer` | 在每封郵件中加入HTML部分 | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | 平台主控台 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`；將`PUBLIRA_PLATFORM_APP_URL`設為營運人員開啟它的位址，例如`https://platform.example.com`；並將`PUBLIRA_EDGE_PLATFORM_HOSTS`設為該位址中的主機名稱，例如`platform.example.com`。`env generate`已填入它的工作階段金鑰`PUBLIRA_WEB_PLATFORM_AUTH_SECRET` |

例如，若要同時執行兩者：

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`為空時，`docker compose`不會停止，因為只有在該設定檔執行時才需要它；但沒有它，任何營運人員都無法登入平台主控台，因此請保留`env generate`所寫入的值。它的主機名稱也需要指向這台主機的DNS，設定了`PUBLIRA_EDGE_ACME_EMAIL`時，代理伺服器會連同其他名稱一起取得它的憑證。

您可以現在選擇，也可以之後再選擇。若要在已執行中的安裝實例中啟用其中一個，請將它加入`COMPOSE_PROFILES`，設定其變數，然後再次執行`docker compose up -d`：它會啟動新的處理程序，並重新啟動變數有所變更的處理程序。每個處理程序執行後的作用，請參閱[啟用選用處理程序](./2-installing.md#啟用選用處理程序)。

## 啟動安裝實例

請依照以下順序，從您解壓縮的目錄執行每個步驟。

### 1. 設定安裝實例

```bash
docker compose run --rm setup
```

第一個命令會拉取所需的映像檔，啟動PostgreSQL與RustFS，並等待兩者都有回應。接著，`setup`會一步一步地將安裝實例從空的資料庫帶到管理員可以登入的租戶，並在每個步驟完成時輸出結果：

1. 它會套用遷移，並以`.env`中的密碼建立六個資料庫角色；Compose檔案以檔案形式將密碼交給它，因此密碼絕不會出現在命令列上。
2. 它會在RustFS中建立名為`publira`的儲存貯體，並在測試通過後，將它與`.env`中的RustFS認證資訊一起儲存。
3. 它會在終端機上詢問其他所有項目：平台的預設語言、時區與貨幣、SMTP設定、是否設定Web Push、租戶的名稱與網域，以及其第一位管理員。[設定安裝實例](./2-installing.md#4-設定安裝實例)說明了每個步驟。

當它詢問租戶網站網域時，請提供您在`PUBLIRA_EDGE_SITE_HOSTS`中列出的網域，例如`comics.example.com`。當它詢問租戶主控台網域時，若您在`PUBLIRA_EDGE_ADMIN_HOSTS`中列出的是`admin.<domain>`，請留白；否則請提供您列出的名稱。

最後的摘要會列出租戶網站與租戶主控台，若密碼是由`setup`產生的，也會輸出管理員的密碼。密碼只會出現在這裡，因此請在關閉終端機之前保存好。

若執行到一半停止，例如連線測試失敗或您按下了Ctrl+C，請再次執行相同的命令：它會保留已完成的每個步驟，只詢問其餘部分。在已完成的安裝實例上執行時，它不會變更任何東西。

測試郵件被拒絕是例外。`setup`會在寄送測試郵件之前儲存SMTP設定，因此下一次執行會保留這些設定，且不會寄送測試郵件。請先用`docker compose run --rm publiractl smtp set`修正錯誤的設定，它會以所提供的旗標取代所有已儲存的設定，如[變更帳戶](../3-operations/6-email.md#變更帳戶)所述；若設定正確、只是SMTP伺服器無法連線，則維持設定不變。用`docker compose run --rm publiractl smtp test --to operator@example.com`寄送測試郵件，寄出後再次執行`docker compose run --rm setup`，完成SMTP之後的步驟。

### 2. 啟動安裝實例

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`會先啟動`server`，在`server`回報就緒且Valkey狀態正常後啟動各Web應用程式，在`web-storefront`與`web-admin`也就緒後啟動代理伺服器，並在所有東西都啟動後返回。`docker compose ps`會將安裝實例的每個服務列為執行中，並將`server`、各Web應用程式與`email-renderer`也列為`healthy`；`publiractl`與`setup`不在其中，因為它們只會為單一命令執行。沒有任何東西會等待`web-platform`或`email-renderer`，因此在命令返回後的幾秒內，兩者仍可能顯示`health: starting`。若處理程序持續重新啟動，或變成`unhealthy`，原因會記錄在`docker compose logs <service>`中。

若`server`在啟動時就結束，或在啟動一分半鐘後仍未就緒，`docker compose up -d`會以指名`publira-deploy-server-1`為unhealthy或已結束的`dependency failed to start`錯誤停止，且不會啟動各Web應用程式與代理伺服器。`docker compose logs server`會說明原因：若`setup`尚未建立某個角色，或其密碼與`.env`不符，會記錄為`failed to initialize db`，並附上它嘗試使用的登入帳戶。若`server`在執行但未就緒，會將失敗的檢查記錄為一行`readiness check failed`，如[健康檢查](../3-operations/11-monitoring.md#健康檢查)所述。修正原因後，請再次執行`docker compose up -d`。

設定了`PUBLIRA_EDGE_ACME_EMAIL`時，代理伺服器會在啟動時申請憑證，`docker compose logs proxy`會為每個主機名稱輸出一次`certificate obtained successfully`。無法取得憑證的名稱會記錄為`could not get certificate from issuer`，並附上憑證授權單位提供的原因，最常見的是DNS尚未指向這台主機，或連接埠未對網際網路開放。代理伺服器會自行持續重試，因此只要修正原因即可。

### 3. 登入

開啟`setup`摘要所輸出的租戶主控台URL，也就是`https://admin.<domain>`或您指定的主控台主機，並以管理員的電子郵件地址與密碼登入。租戶主控台會開啟在`setup`所建立的租戶上，租戶的公開網站則在`https://<domain>`提供服務。

如果您啟用了平台主控台，請開啟`PUBLIRA_PLATFORM_APP_URL`，並在設定畫面上建立第一位營運人員。它的帳戶與租戶管理員的帳戶是分開的。

## 在單一機器上試用

若要在自己的電腦上試用安裝實例，而不使用DNS或憑證，請使用`.localhost`下的主機名稱。以Chromium為基礎的瀏覽器與Firefox會將所有`.localhost`名稱送往電腦本身，並且即使透過純HTTP也將其視為安全的，因此會保留登入時設定的工作階段Cookie。若在其他主機名稱上使用純HTTP，登入看似成功，但您開啟的下一個頁面會把您帶回登入畫面。

1. 在`.env`中設定`PUBLIRA_TENANT_URL_SCHEME=http`，並列出`.localhost`名稱：`PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`與`PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`，若您執行平台主控台，再加上`PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`。將`PUBLIRA_EDGE_ACME_EMAIL`留空：沒有任何憑證授權單位能存取`.localhost`名稱，因此代理伺服器會提供純HTTP。
2. 依照上述步驟1與步驟2進行，並將租戶網域`comics.localhost`提供給`setup`。
3. 開啟`http://admin.comics.localhost`登入。

租戶網站在`http://comics.localhost`提供服務；若您以`PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`啟用了平台主控台，它就在該位址提供服務。

即使代理伺服器只提供純HTTP，它也會公開連接埠443，因此若您的電腦上已有程式監聽其中任一個連接埠，`docker compose up`就無法啟動它。若是連接埠443，請將`PUBLIRA_EDGE_HTTPS_PORT`設為另一個未使用的連接埠，例如`8443`；其他都不需要變更，因為試用時不會用到它。若是連接埠80，請將`PUBLIRA_EDGE_HTTP_PORT`設為另一個連接埠，例如`8080`，並將它加到上述每個位址中：此時您提供給`setup`的租戶網域為`comics.localhost:8080`，主控台則在`http://admin.comics.localhost:8080`開啟。只要瀏覽器透過80或443以外的連接埠存取安裝實例，連接埠就是網域的一部分，但不是代理伺服器所列名稱的一部分。

請只在試用安裝實例時使用這種方式：您的瀏覽器與主機之間傳送的任何內容都沒有加密，而且代理伺服器會在您電腦的所有網路介面上回應，而不只是回應電腦本身。

## 前方有CDN或負載平衡器

如果改由您的平台的CDN或負載平衡器為安裝實例終止TLS，請將`PUBLIRA_EDGE_ACME_EMAIL`留空，並讓它轉送到代理伺服器的連接埠80，同時保留瀏覽器所送出的`Host`標頭：代理伺服器依據它選擇租戶網站、租戶主控台或平台主控台，Publira也依據它選擇租戶。若前方的轉送節點改為透過HTTPS存取代理伺服器，則可以保留該設定，只要憑證授權單位仍能透過連接埠80或443在每個主機名稱上存取代理伺服器即可。

此時，代理伺服器會以轉送節點的位址記錄每個請求，因此稽核記錄對所有人只會顯示一個位址，而Publira依用戶端位址維持的限制也會由所有讀者共用。若要改為記錄讀者的位址，請讓轉送節點自行設定`X-Forwarded-For`、`X-Forwarded-Host`與`X-Forwarded-Proto`，並將`.env`中的`PUBLIRA_EDGE_TRUSTED_PROXIES`設為它連線時所用的位址或CIDR範圍（由其供應商公布），以空格分隔。接著執行`docker compose up -d proxy`，以這些設定重新建立代理伺服器。[代理伺服器前方的轉送節點](./4-edge/1-sample-configurations.md#代理伺服器前方的轉送節點)說明了信任轉送節點代表的意義。

代理伺服器也會傳遞受信任的轉送節點所送出的`X-Forwarded-CountryRegion`，它會將讀者的地區傳給租戶的Google代碼閘道，如[讀者的地區](./4-edge/index.md#讀者的地區)所述。請讓會查詢讀者地區的轉送節點設定這個標頭，不會查詢的則移除它，以免讀者自行指定任意地區。

## 單一主機無法提供的部分

Compose檔案是完整的安裝實例，但其中每個部分都位於同一台機器上：

- **沒有備援**。每個處理程序只執行一次。Docker會重新啟動結束的處理程序，並在主機重新開機時重新啟動整個安裝實例，但只要主機停止運作，所有租戶的網站也會跟著停止。
- **資料庫與圖片共用同一個磁碟**。PostgreSQL與RustFS將資料保存在主機本身磁碟上的`publira-deploy_postgres-data`與`publira-deploy_rustfs-data`磁碟區中。磁碟故障會同時失去兩者，因此請備份兩者，並連同`.env`一起備份：沒有其中的加密金鑰，就無法讀取SMTP密碼以及安裝實例儲存的其他所有認證資訊。Valkey不保存任何需要備份的資料，`publira-deploy_caddy-data`磁碟區也一樣：代理伺服器發現它是空的時，會重新取得憑證。[備份與還原](./9-backup-and-restore.md#在docker-compose安裝實例上)提供了相關命令。
- **`docker compose down -v`會刪除資料**。`-v`會移除磁碟區，連同其中的每一筆資料列與每一張圖片。若只要停止安裝實例並保留資料，請不要加上它。

當安裝實例超出單一主機的負荷時，相同的處理程序可以改為搭配其他地方的代管PostgreSQL與S3相容物件儲存執行；[安裝](./2-installing.md)會逐步建立這樣的安裝實例，[水平擴展](./7-scaling-out.md)則說明了要為哪些處理程序執行更多副本，以及它們必須共用哪些部分。

## 後續步驟

新增租戶時，請將其網域與主控台主機加入`.env`中的主機清單，並執行`docker compose up -d proxy`：代理伺服器會路由這兩個名稱，並在設定了`PUBLIRA_EDGE_ACME_EMAIL`時取得它們的憑證。[新增租戶](./4-edge/index.md#新增租戶)列出了先設定DNS等步驟的順序。

之後的每個版本，都由[升級](./8-upgrading.md#在docker-compose安裝實例上)將安裝實例更新到該版本：下載版本、備份、遷移，以及以新的映像檔重新啟動。

Compose檔案讀取的完整環境變數清單，以及儲存庫對它執行的檢查，都位於[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)。
