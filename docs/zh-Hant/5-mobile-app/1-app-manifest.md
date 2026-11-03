---
title: 應用程式資訊清單
description: 撰寫為租戶應用程式命名、並指定商店用來識別它之識別碼的檔案，並在建置前檢查它。
published: 2026-11-03
source_updated: 2026-10-21
---

應用程式資訊清單是一個簡短的YAML檔案，說明某次建置是誰的應用程式：主畫面上的名稱、它服務的唯一租戶，以及發布時使用的識別碼。租戶應用程式的每次建置都會讀取它，因此請將它與租戶的其他建置輸入放在一起，置於儲存庫之外，並以您自己的版本控制管理。

## 撰寫資訊清單

將[`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml)複製到您自己的目錄，例如`~/example-reader/app.yaml`，並將每個值換成該租戶的值：

```yaml
# yaml-language-server: $schema=https://www.publira.dev/schemas/app-manifest/v1.json
schemaVersion: 1

app:
  name: Example Reader

tenant:
  host: reader.example.com

android:
  applicationId: com.example.reader

ios:
  bundleIdentifier: com.example.reader
  googleSignInClientId: 123456789012-abc123.apps.googleusercontent.com
```

| 欄位 | 要輸入的內容 |
| --- | --- |
| `schemaVersion` | `1`。它表示檔案的格式，而不是應用程式的版本 |
| `app.name` | 主畫面上圖示下方的名稱。請保持夠短，以免在該處被截斷；商店資訊頁面另有自己的標題 |
| `tenant.host` | 租戶公開網站的主機名稱，不含`https://`或路徑。應用程式只服務這個租戶，Android與iOS會對照這個主機檢查它的連結 |
| `android.applicationId` | Google Play用來識別應用程式的應用程式ID，例如`com.example.reader`：以點分隔的兩個以上部分，每個部分都以字母開頭，且只包含字母、數字與底線 |
| `ios.bundleIdentifier` | App Store用來識別應用程式的Bundle ID：以點分隔的兩個以上部分，由字母、數字與連字號組成 |
| `ios.googleSignInClientId` | 選填。租戶Google登入的iOS用戶端，如[應用程式內購買與登入](./5-purchases-and-sign-in.md#使用apple與google登入)所述。若iOS應用程式不提供Google登入，請省略這一行 |

其他所有欄位都是必填，格式中未定義的欄位會被視為錯誤，而不是被忽略。

### 識別碼只選一次

應用程式ID與Bundle ID是商店識別應用程式的依據。一旦商店有了以某個識別碼上傳的建置，就無法再變更：不同的識別碼就是不同的應用程式，沒有評論、沒有安裝數，也無法將讀者移轉過去。請在第一次上傳之前選定，並在之後的每個版本都沿用。

常見的形式是將出版社擁有的網域反轉，後面接上應用程式的名稱：`example.com`就是`com.example.reader`。兩者可以相同，通常也是相同的。兩者也可以不同，讓已經在某個商店有應用程式的出版社，在那裡沿用原本的識別碼。

應用程式的開發版建置會在兩者後面加上`.dev`，讓它可以與已發布的應用程式並存在測試裝置上。該建置永遠不會上傳，它的識別碼也永遠不需要在任何地方輸入。

## 檢查資訊清單

在儲存庫根目錄，先檢查檔案再用它建置：

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

它輸出的那一行，就是以這份資訊清單建置所得到的身分，也是您之後要複製到租戶主控台與商店主控台的內容。有問題的資訊清單會一次列出所有問題，並以非零值結束；建置也會以同樣方式拒絕它：

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

支援JSON Schema的編輯器會在您輸入時檢查檔案：第一行的註解會將編輯器指向[格式定義](https://www.publira.dev/schemas/app-manifest/v1.json)。

下一步：[建置與簽署](./2-building.md)。
