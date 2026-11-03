---
title: 行動應用程式
description: 建置、簽署並發布租戶自己的iOS與Android應用程式。
published: 2026-11-03
source_updated: 2026-10-28
---

每個租戶都可以用自己的名義發布Publira讀者應用程式：有自己的啟動器名稱與商店資訊頁面、自己的推播通知，以及在應用程式中開啟的網站連結。這些頁面寫給建置並發布該應用程式的人，無論是營運人員還是出版社自己的工作人員，且不需要了解建置它的Flutter程式碼。

應用程式是從儲存庫建置的，而不是下載取得。一份checkout可以建置任何租戶的應用程式：讓它成為特定租戶應用程式的一切，都放在您保存於儲存庫之外的一個小檔案（應用程式資訊清單）中，以及建置從環境中讀取的值裡。

## 開始之前

- **租戶的網站已上線服務**。應用程式從租戶的公開網站讀取所有內容，商店也會對照同一個主機檢查它宣告的連結。讓安裝實例上線服務的方式，請見[部署](../2-deployments/index.md)。
- **Apple Developer Program會員資格與Google Play Console開發人員帳戶**，以發布應用程式的出版社名義申請。兩者都需付費，且審核需要時間，請先申請。
- **Firebase專案**，用於推播通知。它是免費的。
- **安裝實例所執行版本的checkout**，讓應用程式與它呼叫的API來自同一個版本。
- **建置應用程式的電腦**。Android可以在Linux、macOS或Windows上建置；iOS只能在裝有Xcode的Mac上建置。兩者都需要儲存庫指定版本的Flutter SDK，如[事前準備](https://github.com/publira/publira/blob/main/mobile/README.md#prerequisites)所述。儲存庫的Dev Container會安裝Flutter，`task mobile:android-install`則會在其中加入Android SDK與JDK。

複製儲存庫後，請在儲存庫根目錄執行一次`task setup`；若在該處只建置應用程式，則執行`task mobile:deps`。

## 本節內容

前六頁依照作業的順序排列。第一次發布需要全部完成；之後的版本只需要建置與提交。最後一頁說明應用程式在裝置上保存的內容，供需要為此負責的工作人員參考。

- [應用程式資訊清單](./1-app-manifest.md)：為應用程式命名，並指定它服務的租戶以及商店用來識別它的識別碼。
- [建置與簽署](./2-building.md)：從資訊清單產生已簽署的Android App Bundle與iOS封存檔。
- [推播通知](./3-push-notifications.md)：Firebase專案、Apple的推播金鑰，以及租戶主控台用來傳送通知的認證資訊。
- [應用程式連結](./4-app-links.md)：讓租戶網站的連結在應用程式中開啟。
- [應用程式內購買與登入](./5-purchases-and-sign-in.md)：應用程式透過商店販售章節，以及讓讀者以Apple與Google登入所需的項目。
- [提交到商店](./6-store-submission.md)：商店資訊頁面，以及App Review與Google Play的審查要求出版社提供的內容。
- [離線閱讀](./7-offline-reading.md)：應用程式為了在沒有網路時閱讀而儲存的內容、付費章節可以閱讀多久，以及螢幕截圖提示。
