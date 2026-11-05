---
title: 安裝
description: 讓一個空的安裝實例開始提供服務，從它依賴的服務到首次登入租戶主控台。
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

本頁帶您將安裝實例從零開始，建置到第一位管理員能登入租戶主控台為止。內容依照步驟必須執行的順序排列，並說明每個步驟決定了什麼；各處理程序讀取的完整環境變數清單，以及`publiractl`的所有旗標，則留在各步驟所連結的參考文件中。

本頁說明的是[概觀](./1-overview.md)中的最小安裝實例：`web-storefront`、`web-admin`、`publira server`與`publira worker`，並透過`publiractl`管理。最後的[啟用選用處理程序](#啟用選用處理程序)會加入HTML郵件與平台主控台。

## 開始之前

每個版本都會將映像檔以`ghcr.io/publira/<name>:<tag>`的形式發布到GitHub Container Registry，標籤為該版本的版本號，也就是去掉`v`的Git標籤，例如`v0.1.0`的版本號為`0.1.0`：包括`publira`、`publiractl`、`web-storefront`與`web-admin`，以及選用處理程序所用的`web-platform`與`email-renderer`。這些映像檔是公開的，因此您的主機不需登入即可拉取，也不需要自行建置任何東西。每個映像檔都針對`linux/amd64`與`linux/arm64`發布；其他平台的主機將找不到可拉取的映像檔。本頁的範例將它們寫成`ghcr.io/publira/<name>:<tag>`；請將`<tag>`換成您要安裝的版本號。[版本](./10-releases.md)說明了標籤的編號方式。

若安裝實例修改了程式碼，或執行於其他平台，則改為依照其所執行的提交中的[映像檔建置說明](https://github.com/publira/publira/blob/main/infra/docker/README.md)自行建置映像檔，推送到主機拉取映像檔的位置，並在所有地方以這些映像檔取代已發布的映像檔。

每個`publiractl`步驟都執行您要安裝的版本的`publiractl`映像檔。該映像檔包含該版本的遷移與角色定義，因此若使用其他版本的映像檔，套用的結構描述將會是處理程序所預期之外的。

若要在單一主機上執行整個安裝實例，儲存庫中的Compose檔案會為您佈建服務並設定好環境變數，如[Docker Compose](./3-docker-compose.md)所述。它執行的仍然是以下的步驟。

## 佈建服務

請在第一個步驟之前建立以下各項。其中的一切都由Publira建立，因此每一項一開始都是空的。

- **PostgreSQL資料庫**，以及一個擁有該資料庫且可建立角色的管理用登入帳戶。在您自行執行的PostgreSQL伺服器上，這就是它的超級使用者。不開放超級使用者的代管PostgreSQL會改為提供這類登入帳戶，例如Cloud SQL的`postgres`使用者，而Publira需要的也僅止於此：不需要超級使用者，也不需要能略過資料列層級安全性的角色。只有`publiractl db`命令會以此登入帳戶連線，常駐處理程序絕不會使用它。
- **Valkey執行個體**，或任何使用Redis協定的伺服器。`publira server`、`web-storefront`與`web-admin`共用它，作為圖片轉換快取、速率限制計數器以及Web應用程式的快取。帶有密碼的連線必須使用採用TLS的`rediss://`：若`redis://`的URL中含有密碼，`publira server`會拒絕啟動。
- S3相容物件儲存中的**空儲存貯體**，以及可讀寫它的認證資訊。所有上傳的圖片都存放在這裡。`publiractl setup`會儲存儲存貯體與認證資訊，因此處理程序不需要其他任何設定就能存取它。若處理程序應改用其環境中的認證資訊，例如執行個體角色，請在設定時省略存取金鑰，並為`publira server`、`publira worker`與`publiractl`提供`AWS_*`環境變數。
- **SMTP伺服器**：它的主機、連接埠、加密方式、寄件地址，以及用於登入的使用者名稱與密碼；但若它不需認證即可轉送，例如本機MTA或信任主機地址的轉送伺服器，則不需要使用者名稱與密碼。讀者註冊、密碼重設與管理員邀請都會經由它寄出。
- 租戶網域與`admin.<domain>`的**DNS**，兩者都指向安裝實例前方的邊緣。前者提供租戶的公開網站，後者提供其主控台。若主控台應使用其他主機名稱，請現在決定：`publiractl setup`會以`--admin-domain`接收它。

## 產生密鑰

安裝實例需要幾個只有您持有的密鑰。請為每個環境產生一組新的密鑰，保存在您的密鑰儲存庫中，且絕不重複使用儲存庫中寫出的值：那些值是供本機開發使用的，而且是公開的。

| 密鑰 | 產生方式 | 設定於 | 保護的對象 |
| --- | --- | --- | --- |
| 密鑰加密金鑰 | 以`k1:$(openssl rand -base64 32)`作為`PUBLIRA_SECRET_ENCRYPTION_KEYS`，並以`k1`作為`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `publira server`、`publira worker`、`publiractl` | 安裝實例儲存的所有認證資訊：SMTP密碼、物件儲存的私密金鑰、搜尋引擎的密碼、Web Push私密金鑰，以及每個租戶的付款、推播與登入認證資訊 |
| 存取權杖簽署金鑰 | 以`openssl rand -base64 32`作為`PUBLIRA_AUTH_JWT_SECRET` | `publira server` | 所有已登入的工作階段。持有它的人可以為任何使用者簽署權杖，並以該使用者身分呼叫所有API |
| 各Web應用程式的工作階段金鑰 | 以`openssl rand -base64 32`作為該應用程式的`PUBLIRA_AUTH_SECRET` | `web-storefront`與`web-admin`，各一個 | 攜帶使用者存取權杖的工作階段Cookie。兩個應用程式可以共用一個，但不一定要共用 |
| 快取重新驗證權杖 | `openssl rand -hex 32` | `publira server`、`publira worker`、`web-storefront`與`web-admin`，作為`PUBLIRA_REVALIDATE_TOKEN` | 伺服器在變更後呼叫、用來捨棄Web應用程式所快取頁面的端點。若沒有它，伺服器不會傳送任何通知，Web應用程式會繼續提供變更前所快取的內容 |
| Web服務權杖 | 以`openssl rand -base64 32`作為`PUBLIRA_WEB_SERVICE_TOKEN` | `publira server`與`web-admin` | 主控台以自身身分而非以某位工作人員身分進行的讀取，例如所有工作人員看到的都相同的作品目錄清單，讓主控台能為所有人只快取一次。沒有它，`web-admin`不會啟動 |
| 每個資料庫角色各一個密碼 | `openssl rand -hex 32`，執行六次 | `publiractl db roles`，以及使用該角色的處理程序的連線URL | 資料庫本身。連線URL會以未跳脫的形式攜帶密碼，因此請只使用URL安全的字元，就像十六進位輸出那樣 |

加密金鑰最需要小心處理。當您提供SMTP密碼或物件儲存的金鑰時，`publiractl setup`會用加密金鑰將其封存，而`publira server`與`publira worker`則以它們所獲得的金鑰解封。獲得其他金鑰的處理程序無法讀取`publiractl`所儲存的內容：worker會無法寄送郵件，伺服器也會無法存取物件儲存。遺失金鑰後，所有已儲存的認證資訊都必須重新輸入。若日後要更換金鑰而不遺失其所封存的內容，請將新金鑰加在舊金鑰旁邊，而不是取代它，如[輪替密鑰加密金鑰](../3-operations/12-security/1-rotating-secrets.md#輪替密鑰加密金鑰)所述。

## 資料庫角色

處理程序絕不會以管理用登入帳戶連線。`publiractl db roles`會建立六個登入角色，安裝實例的每個部分都以符合其工作的角色連線：

| 角色 | 連線的用途 | 可存取的範圍 |
| --- | --- | --- |
| `publira_public` | `publira server`，服務公開網站與行動應用程式 | 請求所屬租戶的資料列 |
| `publira_admin` | `publira server`，服務租戶主控台 | 請求所屬租戶的資料列 |
| `publira_platform` | `publira server`，服務平台主控台，以及變更平台設定的`publiractl`命令，包括`setup` | 所有租戶，以及平台本身的設定 |
| `publira_outbox` | `publira worker`，寄送郵件與推播通知，並重新驗證快取 | 所有租戶，以及其郵件所需的平台設定 |
| `publira_ticker` | `publira worker`，執行在排程時間一到就立即動作的工作，例如發布章節 | 這些工作所接觸的少數資料表 |
| `publira_content_stats` | `publira worker`與`publiractl job`，執行維護與彙總工作 | 所有租戶，以及這些工作所讀取的平台設定 |

這樣的拆分讓各租戶的資料彼此隔離。回應讀者與租戶工作人員請求的兩個角色，受資料列層級安全性約束，只能存取請求所指定的租戶，因此即使其中一條路徑有缺陷，也無法讀取其他租戶的資料列。平台本身的資料表保存了營運人員的密碼雜湊與平台的郵件認證資訊，除了`publira_platform`之外，所有角色都無法存取，只有另外授予它們的少數讀取權限例外：worker的角色可讀取其工作與郵件所需的設定，租戶主控台的角色可讀取其請求所套用的少數設定，其中包括平台郵件的寄件地址，但不包括儲存在旁邊的郵件伺服器、帳戶與密碼。因此，每個處理程序會為其使用的每個角色各取得一個連線URL，[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)列出了哪個變數對應哪個角色。

## 啟動安裝實例

### 1. 套用遷移

以管理用登入帳戶的連線執行`db migrate`。它會建立結構描述，若沒有需要套用的內容，則不做任何變更就結束。

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`就是這個連線，例如`postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`。

### 2. 建立角色

以同一個連線執行`db roles`，並為每個角色提供您為其產生的密碼。它會在遷移所建立的資料表上授予權限，這就是它排在第二步的原因。

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

再次執行時，除了所提供的密碼之外不會變更任何東西，因此日後輪替角色密碼也是用這個方法。傳遞密碼的其他方式列於[`publiractl`參考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)。

### 3. 啟動四個處理程序

從同一個版本的映像檔啟動`publira server`、`publira worker`、`web-storefront`與`web-admin`：前兩者使用`ghcr.io/publira/publira:<tag>`，第二個以`worker`作為容器引數；後兩者使用`ghcr.io/publira/web-storefront:<tag>`與`ghcr.io/publira/web-admin:<tag>`，並設定[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)中的環境變數。每個連線URL都要指明其角色以及`db roles`為該角色設定的密碼，例如`PUBLIRA_PUBLIC_DB_URL`為`postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`。請設定所有連線URL：未設定的連線URL會改用開發用的URL，而不是您設定的其他變數，因此會登入失敗。

`publira worker`會在啟動時建立其工作佇列的資料表，因此不需要獨立的步驟。`publira server`與`publira worker`都會在`GET /readyz`中為每個資料庫登入帳戶回報一項檢查，因此密碼不符的角色會在那裡被指出。

### 4. 設定安裝實例

`publiractl setup`會儲存安裝實例服務第一個租戶所需的設定，並建立該租戶的第一位管理員：

1. 平台的預設語言、新租戶一開始使用的時區，以及租戶在其管理員選擇之前用來販售的貨幣（若未指定則為`USD`）。
2. 物件儲存，必須先通過連線測試。
3. 選擇性設定作品目錄的搜尋引擎；除非您選擇其他引擎，否則就是資料庫本身。
4. SMTP設定，若您提供了測試郵件的收件地址，還會寄送一封測試郵件。若轉送伺服器不需認證，請將使用者名稱留白：如此郵件會在不登入的情況下寄出，也不會詢問密碼。
5. 選擇性設定Web Push。
6. 租戶，以及其網域。
7. 租戶的第一位管理員，密碼可由您輸入，或由它產生。

它以`publira_platform`連線，並以加密金鑰封存所儲存的認證資訊，因此請提供與處理程序執行時相同的金鑰：

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

在終端機上執行時，它會詢問每個值。同樣的執行也可以在無人值守的情況下進行，例如從CI工作或init容器執行，並以旗標提供每個值；該形式列於[`publiractl`參考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)。它所輸出的連結以`PUBLIRA_TENANT_URL_SCHEME`為基礎，也就是讀者的瀏覽器存取租戶時所用的協定，未設定時為`https`。它描述的是公開位址，而非代理伺服器存取處理程序的方式，因此TLS終止點後方的一段純HTTP連線不會影響它。只有在瀏覽器確實透過HTTP開啟租戶時，才將它設為`http`，並且要同時設定在`publiractl`與各處理程序上。

若執行到一半停止，例如連線測試失敗，只要再次執行就能完成：它會保留已儲存的每個步驟，只詢問其餘部分。測試郵件被拒絕是例外：SMTP設定會在測試之前儲存，因此下一次執行會保留這些設定，且不會寄送測試郵件。請用`publiractl smtp set`修正錯誤的設定，再用`publiractl smtp test`寄送測試郵件，如[電子郵件](../3-operations/6-email.md#測試帳戶)所述，然後再次執行`setup`。

`setup`也可以自行完成步驟1與步驟2，並建立尚不存在的空儲存貯體。若提供`PUBLIRA_DB_URL`以及每個角色的密碼，它會在自身的步驟之前套用遷移並建立角色；若加上`--create-bucket`，它會在連線測試之前建立儲存貯體。若安裝實例在`setup`完成後才執行所有處理程序，例如[Docker Compose](./3-docker-compose.md)安裝實例，就不需要其他任何命令；相關旗標列於[`publiractl`參考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)。

最後的摘要會列出租戶網站與租戶主控台，若密碼是由它產生的，也會輸出管理員的密碼。產生的密碼只會出現在這裡，因此請在關閉終端機之前保存好。

### 5. 在前方放置邊緣

邊緣是接收讀者請求並將其轉送給處理程序的任何東西：由您的平台代管的負載平衡器、您自行執行的反向代理，或由它們串接而成的組合。請將兩個主機名稱路由到處理程序：

- `admin.<domain>`或您選擇的主控台主機，路由到`web-admin`。
- 租戶的網域，路由到`web-storefront`。
- 任一主機上的`/rpc/publira.v1.`與`/images`，路由到`publira server`，預設連接埠為`8000`。
- 任一主機上其餘的`/rpc`不路由到任何地方：由邊緣回應`404`。`publira server`在這些路徑上回應主控台的API，而Web應用程式是透過私人網路呼叫這些API的，如[只有公開API經過邊緣](./4-edge/index.md#只有公開api經過邊緣)所述。使用API金鑰的租戶自有系統，需要在主控台主機上轉送其中的[少數幾項讀取](./4-edge/index.md#api金鑰可進行的讀取)。

請在邊緣為兩個主機名稱終止TLS。無論邊緣由什麼構成，[邊緣必須做的事](./4-edge/index.md#邊緣必須做的事)都說明了它還需要做的其他事情：要傳遞與要移除的標頭、用戶端位址，以及必須放行的上傳與webhook。儲存庫中Traefik、nginx與Caddy的[設定範例](./4-edge/1-sample-configurations.md)是完成這一切的其中一種做法。

### 6. 登入

開啟`setup`摘要所輸出的租戶主控台URL，也就是`https://admin.<domain>`，或您以`--admin-domain`指定的主控台主機，並以管理員的電子郵件地址與密碼登入。租戶主控台會開啟在`setup`所建立的租戶上，從這裡可以邀請其工作人員並設定網站。租戶的公開網站則在`https://<domain>`提供服務。

## 啟用選用處理程序

這兩個處理程序都可以加入已在提供服務的安裝實例。兩者都不保有自己的資料；啟用其中一個，只需執行它，並重新啟動環境變數有所變更的處理程序。

### 使用`email-renderer`寄送HTML郵件

沒有`email-renderer`時，worker會以純文字寄送所有郵件。請執行它，並將`publira worker`的`PUBLIRA_EMAIL_RENDERER_URL`設為它在私人網路上的位址，例如`http://email-renderer:8080`；此後每封郵件都會在相同的純文字之外附上HTML部分。設定此變數後，轉譯器就成為寄送郵件的一環：在它停止運作期間，worker會保留每封郵件並重試，而不會改回以純文字寄送。

### 使用`web-platform`的平台主控台

`web-platform`就是平台主控台，營運人員可以從瀏覽器而非`publiractl`管理租戶與平台設定。若要執行它：

- 以與其他Web應用程式相同的方式為它產生工作階段金鑰，並將其設為它的`PUBLIRA_AUTH_SECRET`，長度至少32位元組；沒有它，任何營運人員都無法登入。為它設定與`web-admin`相同的`PUBLIRA_GRPC_URL`、`PUBLIRA_WEB_SERVICE_TOKEN`、`PNCH_REDIS_URL`與`PUBLIRA_REVALIDATE_TOKEN`。
- 在`publira server`與`publira worker`上設定`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`，讓快取重新驗證能送達它；並在`publira worker`上設定`PUBLIRA_PLATFORM_APP_URL`，也就是營運人員開啟它的位址，其郵件中的連結會以此建立。
- 為它選擇一個主機名稱，例如`platform.example.com`，將其指向邊緣，為邊緣提供它的憑證，並將它路由到`web-platform`，路徑與其他主機相同，如[路由](./4-edge/index.md#路由)所述。設定範例以`PUBLIRA_EDGE_PLATFORM_HOSTS`接收它。

開啟它，並在設定畫面上建立第一位營運人員。這位營運人員與`publiractl setup`所建立的租戶管理員是分開的：平台主控台有自己的帳戶，在第一個帳戶建立之前，都會顯示這個畫面。在該畫面上選擇的語言會成為平台的預設語言，取代`publiractl setup`所儲存的語言；時區也是如此，畫面一開始會顯示您瀏覽器的時區。畫面也會詢問預設貨幣，一開始會顯示`publiractl setup`所儲存的貨幣，因此維持不變就會保留它。其他所有設定都會保留，`publiractl`也能與主控台並行使用。

## 後續步驟

各處理程序讀取的完整環境變數清單位於[部署參考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)，選用的環境變數則位於[`publira server`與`publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md)、[`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md)與[`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)的README中。所有`publiractl`命令都列於[`publiractl`參考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)。

之後的每個版本，都由[升級](./8-upgrading.md)將安裝實例更新：先以該版本的`publiractl`映像檔套用遷移與角色，再更新其處理程序。
