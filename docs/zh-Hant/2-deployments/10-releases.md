---
title: 版本
description: 版本號代表什麼、各類版本可以變更什麼、0.x有何不同、哪些版本可以並存執行、哪些版本會收到修正，以及如何驗證版本發布的內容。
published: 2026-11-03
updated: 2026-11-08
source_updated: 2026-11-08
---

Publira以儲存庫中名為`vMAJOR.MINOR.PATCH`的標籤發布，從`v0.1.0`開始。每個版本都會連同版本說明發布在儲存庫的[Releases](https://github.com/publira/publira/releases)頁面上，其映像檔則以該版本的版本號（去掉`v`的標籤）推送，不使用其他任何標籤：`v0.1.0`以`ghcr.io/publira/<name>:0.1.0`拉取。沒有`latest`，也沒有`0.1`，因此只有在您變更安裝實例執行的版本時，它才會移到新版本。版本也會以`publira-deploy-<version>.tar.gz`提供[Docker Compose](./3-docker-compose.md)安裝實例：Compose檔案、指定該版本映像檔的`.env.example`，以及代理的`Caddyfile`，內容與該標籤時儲存庫中的相同。映像檔和這個封存檔都由發布它們的工作流程簽章，驗證方式請見[驗證版本](#驗證版本)。本頁說明在升級之前，版本號能告訴您什麼、哪些版本可以並存執行、哪些版本會收到修正，以及如何驗證您拉取的內容。

## 版本號代表什麼

- **主要版本**（例如`v2.0.0`）是所有[會破壞安裝實例的變更](#會破壞安裝實例的變更)發布的地方。升級前請閱讀它的說明。
- **次要版本**（例如`v2.1.0`）會新增功能，並可能帶有由`db migrate`套用、不需要您做其他事的遷移。
- **修補版本**（例如`v2.1.1`）修正它所屬的次要版本，除了替換映像檔之外，不需要您做任何事。
- **帶有後綴的標籤**（例如`v2.0.0-rc.1`）是預先發行版本，Releases頁面也會如此標示。它是用來在版本正式推出之前試用的，不會收到修正；在服務讀者的安裝實例上，請執行正式版本。

`1.0.0`之前的版本對這些的編號方式不同，詳見[1.0.0之前](#100之前)。

## 會破壞安裝實例的變更

要求您做的事超出每次升級都會執行之步驟的變更，會在主要版本中發布：

- 環境變數：新增了處理程序必要的變數、重新命名了變數，或不再讀取某個變數；
- 資料庫角色：新增角色，或變更角色可存取的範圍；
- [邊緣必須做的事](./4-edge/index.md#邊緣必須做的事)；
- 安裝實例以前沒有執行的處理程序或服務；
- 執行時間長或會鎖定繁忙資料表的遷移；
- 搜尋索引的變更，之後必須重建索引。

代理的[設定範例](./4-edge/1-sample-configurations.md)有所變更，本身並不屬於這類變更：它們是您為自己的邊緣改寫的起點，而Docker Compose安裝實例會隨版本收到它的`Caddyfile`。

每項這類變更都會列在版本說明開頭的**Upgrade notes**中，沒有時也會註明；各項該怎麼處理，見[閱讀版本說明](./8-upgrading.md#閱讀版本說明)。

無論說明寫了什麼，都請依[升級](./8-upgrading.md)所述的方式升級到這類版本：先處理遷移與角色，再處理處理程序。

## 兩個版本並存

無論版本號為何，每個版本都能與它前一個版本搭配運作，預先發行版本除外：

- 兩個版本的Web應用程式與`publira server`會雙向互相呼叫。
- 較早版本的處理程序，會在較新版本的`db migrate`與`db roles`所留下的結構描述與角色上繼續運作。版本只有在前一個版本不再讀取某個資料表、欄位或授權之後，才會刪除或重新命名它。

因此升級到下一個版本時，安裝實例可以持續提供服務，處理程序可以一次替換一個副本，而新版本新增的功能會在每個處理程序都執行新版本後開始運作。這項保證只涵蓋一個版本：相隔更遠的版本之間，請在升級前停止處理程序，或一次升級一個版本。

## 修補版本

修補版本只帶有修正，並限於替換映像檔就能套用的內容：沒有遷移，沒有新增、重新命名或不再讀取的環境變數，沒有資料庫角色，邊緣必須做的事沒有變更，沒有安裝實例以前沒有執行的處理程序或服務，也不需要重建搜尋索引。需要上述任何一項的修正，會改在下一個次要版本中發布。

因此，它的Upgrade notes不會要求您做任何事。即使如此，仍請依[升級](./8-upgrading.md)所述的方式升級，從備份到替換處理程序：結構描述沒有變更時，這些步驟的成本很低，而萬一修補版本帶有不該有的變更，備份仍是退路。

## 1.0.0之前

主要版本號為`0`時，由次要版本號取代它的角色。會破壞安裝實例的變更會在次要版本中發布（例如`v0.2.0`），其他所有變更，包括新功能與只做新增的遷移，都在修補版本中發布（例如`v0.2.1`）。

因此，`0.x`的修補版本可能帶有遷移，而它的處理程序可能會讀取該遷移新增的內容，並在沒有這些內容的結構描述上失敗。只替換映像檔是不夠的：請依[升級](./8-upgrading.md)所述，在替換處理程序之前執行`db migrate`與`db roles`。

## 哪些版本會收到修正

只有最新的次要版本會收到修正（包括安全性修正），並以它的修補版本發布。新的次要版本發布後，前一個次要版本就不再收到修正，因此執行較早次要版本的安裝實例，要升級到最新版本才能取得修正。

請透過儲存庫Security分頁上的[Report a vulnerability](https://github.com/publira/publira/security/advisories/new)私下回報弱點，不要在公開的Issue中回報。

## 跳過版本

您可以一步從任何版本升級到任何較新的版本。`db migrate`會在一次執行中套用其間每個版本的遷移，因此結構描述不需要您做任何事。

它不會代您完成的，是版本說明要求您做的事，因此請閱讀您目前執行的版本之後、直到要升級的目標版本（含）為止的每個版本的說明。其中只有主要版本會列出事項，在`1.0.0`之前則是次要版本。它們的Upgrade notes是累加的：設定它們新增的每個變數，為其間新增的每個角色把密碼傳給`db roles`，並把邊緣必須做的事的每項變更套用到您的邊緣。其間的某個版本也可能已淘汰您目前執行的版本仍在讀取的內容，因此跳過版本之前，請先[停止處理程序](./8-upgrading.md#決定是否先停止處理程序)。

## 驗證版本

版本的每個映像檔及其Docker Compose安裝實例，都帶有儲存庫的工作流程在發布時產生的無金鑰[Sigstore](https://www.sigstore.dev/)簽章。簽章記錄了該工作流程與版本的標籤，因此不需要取得或信任任何金鑰，在其他任何地方建置的映像檔或封存檔都無法通過驗證。驗證需要[cosign](https://docs.sigstore.dev/cosign/system_config/installation/)。驗證並非必要：不驗證的話，`docker pull`與Compose安裝實例也會照常運作。

### 映像檔

針對推送映像檔的工作流程驗證您執行的每個映像檔，其中`<version>`是版本的版本號，例如`v0.1.0`對應`0.1.0`：

```bash
cosign verify ghcr.io/publira/publira:<version> \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-images.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

它會列出所做的檢查，接著以JSON輸出簽章的宣告，其中`docker-manifest-digest`是簽章所涵蓋映像檔的摘要。若映像檔沒有該工作流程在該標籤下所做的簽章，驗證就會失敗。對`publiractl`、`web-storefront`與`web-admin`重複此步驟；若您執行`web-platform`與`email-renderer`，也對它們重複。標籤可以重新推送，因此若要執行的正是您驗證過的內容，請以該摘要而非標籤指定映像檔，例如`ghcr.io/publira/publira@sha256:<digest>`。

### 證明包含的內容

每個映像檔的每個平台都帶有兩份證明（attestation），由BuildKit在建置映像檔時寫入：

- **SBOM**，SPDX格式：映像檔中的作業系統套件、Node.js套件與Go模組。
- **SLSA provenance**：建置映像檔的提交與工作流程執行、建置所用的Dockerfile及其引數，以及作為起點的基礎映像檔摘要。

它們儲存在映像檔的平台清單中，緊鄰所描述的平台，因此清單會在`linux/amd64`與`linux/arm64`旁各顯示一個`unknown/unknown`項目。`docker pull`與容器執行環境會略過這些項目。簽章涵蓋該清單，而清單以摘要指向每份證明，因此請透過`cosign verify`輸出的摘要讀取它們：

```bash
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .Provenance}}'
```

每個命令都會輸出一個JSON物件，其中`linux/amd64`與`linux/arm64`各有一個項目。

### Compose安裝實例

版本在封存檔旁附上了它的簽章`publira-deploy-<version>.tar.gz.sigstore.json`，由發布該版本的工作流程產生。請下載這兩個檔案，並在解開之前驗證封存檔：

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz.sigstore.json
cosign verify-blob publira-deploy-<version>.tar.gz \
  --bundle publira-deploy-<version>.tar.gz.sigstore.json \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-notes.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

驗證成功時會輸出`Verified OK`；封存檔與工作流程簽章的那一份即使只差一個位元組，驗證也會失敗。封存檔以標籤指定映像檔，因此也請依照[映像檔](#映像檔)的說明驗證映像檔。

## 後續步驟

[升級](./8-upgrading.md)說明如何把執行中的安裝實例升級到任何類型的新版本，以及遷移失敗時該怎麼做。
