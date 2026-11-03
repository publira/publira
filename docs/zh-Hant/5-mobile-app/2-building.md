---
title: 建置與簽署
description: 從租戶應用程式的資訊清單產生已簽署的Android App Bundle與iOS封存檔。
published: 2026-11-03
source_updated: 2026-10-25
---

租戶應用程式的一個版本只用一個指令`task mobile:build`建置，Android與iOS各執行一次。此指令會讀取[應用程式資訊清單](./1-app-manifest.md)，在開始前檢查每項輸入，並從未經修改的checkout建置應用程式的商店版本。本頁先說明它從環境中讀取的輸入，再說明兩種建置。

此指令接受的所有旗標都列在[行動應用程式參考文件](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app)中。

## 每次建置都需要的項目

### 應用程式連線的位址

將租戶網站的來源（origin）匯出為`PUBLIRA_BASE_URL`。應用程式會向它要求`/rpc`下的API與`/images`下的圖片，安裝實例的反向代理已經會路由這些路徑：

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

它必須是`https://`，且只有來源，不含路徑。建置會拒絕其他任何值，以免交付一個只在讀者手機上才失敗的應用程式。它通常就是資訊清單的`tenant.host`，但並非由資訊清單決定：安裝實例可以在另一個主機名稱上提供API，如[分開提供圖片與公開API](../2-deployments/7-scaling-out.md#分開提供圖片與公開api)所述。這樣的主機不提供圖片，因此在以它為對象建置之前，請先為租戶設定[圖片主機](../3-operations/2-tenants.md#圖片主機)：應用程式接著會以API提供的位址，從圖片主機載入所有圖片。

### 推播通知

應用程式接收推播通知所用的Firebase專案會內建在應用程式中。請在第一次發布前依[推播通知](./3-push-notifications.md)所述設定好，並將其值保存在獨立的檔案中，例如`~/example-reader/firebase.json`。沒有提供Firebase值的建置仍可運作，但沒有推播通知，應用程式的**帳戶**畫面上也不會有推播通知的開關。

### 版本

每次上傳到商店，都需要比商店上次接受的更高的組建編號，讀者則會看到版本名稱。請為每個發布用建置同時提供兩者：

```bash
--build-name 1.2.0 --build-number 7
```

沒有提供時，建置會是`1.0.0`、組建編號`1`，從第二次上傳起商店就會拒絕它。

## Android

### 建立上傳金鑰

Google Play要求每次上傳都以同一把金鑰簽署，也就是上傳金鑰。請在進行建置的電腦上或您的密鑰儲存區中建立一次：

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool`隨附於每個JDK，它會詢問金鑰庫的密碼與金鑰的密碼。請將檔案與兩組密碼保存在儲存庫之外並加以備份：Play Console可以更換遺失的上傳金鑰，但必須經過需要Google核准的申請，在核准之前都無法上傳。

Google Play上的新應用程式使用Play應用程式簽署：Google保管用來簽署已安裝應用程式的金鑰，上傳金鑰只用來證明上傳來自您。這個差別在[應用程式連結](./4-app-links.md)頁面上會再次變得重要。

### 建置App Bundle

在環境中指定金鑰庫及其密碼，然後建置：

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

請在儲存庫根目錄執行。資訊清單或金鑰庫的相對路徑，會從您開始執行的目錄讀取；Firebase檔案則從`mobile/`讀取，所以範例中寫出了它的完整路徑。

只要缺少四個簽署變數中的任何一個，建置就會在編譯前停止，而不是以Google Play會拒絕的金鑰簽署。要上傳的App Bundle是`mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`。

若要在上傳前先在手機上試用此版本，請在相同的變數下改為建置`apk`而不是`appbundle`，並安裝`mobile/build/app/outputs/flutter-apk/app-production-release.apk`。這樣的建置是以上傳金鑰簽署的，因此除非也在[應用程式連結](./4-app-links.md)中列出上傳金鑰的指紋，否則網站的連結不會開啟它。

## iOS

### 準備Mac

iOS建置在裝有Xcode的Mac上執行。請在**Xcode** › **Settings** › **Accounts**中，讓Xcode登入屬於出版社Apple Developer團隊的Apple帳戶。建置使用自動簽署：Xcode會以應用程式使用的功能（推播通知、關聯網域與Sign in with Apple）註冊Bundle ID，並自行建立憑證與描述檔，因此不需要從Apple Developer網站手動下載任何東西。

在Apple Developer網站的**Membership details**下找到團隊的Team ID（10個字母與數字），並在環境中指定它：

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

之後在[應用程式連結](./4-app-links.md)中也要輸入同一個Team ID。

### 建置封存檔

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

封存檔是`mobile/build/ios/archive/Runner.xcarchive`，要上傳的檔案是`mobile/build/ios/ipa/`中的`.ipa`。請以Apple的Transporter應用程式上傳`.ipa`，或在Xcode的**Organizer**中開啟封存檔並選擇**Distribute App**。App Store Connect處理完成後，就可以透過TestFlight在手機上測試，然後送交審查。

未設定`PUBLIRA_IOS_DEVELOPMENT_TEAM`時，裝置用的建置會在第一個步驟就停止，而不是以Xcode最先找到的團隊簽署。

## 建置留下的內容

建置只會將租戶的身分寫入Git忽略的檔案，若在儲存庫追蹤的任何檔案中留下變更，建置就會失敗。因此，同一份checkout不需要先清理，就能建置下一個租戶的應用程式或下一個版本。

下一步：[推播通知](./3-push-notifications.md)。
