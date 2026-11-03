---
title: 推播通知
description: 設定租戶應用程式接收推播通知所用的Firebase專案，並將傳送通知所需的認證資訊交給租戶主控台。
published: 2026-11-03
source_updated: 2026-11-02
---

當讀者追蹤的系列發布新章節，或發布了列名為其追蹤作者的新章節時，應用程式會在讀者的手機上通知他們，點一下就會開啟該章節。在應用程式中開啟公告通知的讀者，也會在出版社發送公告時收到通知，點一下就會開啟該公告。安裝實例將通知傳送到Firebase Cloud Messaging，由它直接傳遞到Android手機，並透過Apple的推播服務傳遞到iPhone。要讓這一切運作，有三者必須指向同一個Firebase專案：

1. **應用程式**，它以該專案的值建置，並將每支手機註冊到該專案。
2. **Apple**，該專案以Apple的推播金鑰轉送iPhone的通知。
3. **租戶主控台**，它保存該專案的服務帳戶金鑰，`publira worker`以此傳送通知。

每個租戶應用程式使用一個Firebase專案。專案屬於建置應用程式的人，因此出版社可以完全擁有自己的專案。

## 建立Firebase專案

在[Firebase主控台](https://console.firebase.google.com/)中，為租戶的應用程式新增一個專案。不需要Google Analytics，可以關閉。

接著從專案的**Project settings** › **General**，在專案中新增兩個應用程式：

- **Android應用程式**，以資訊清單的`android.applicationId`作為套件名稱。下載它提供的`google-services.json`。
- **Apple應用程式**，以資訊清單的`ios.bundleIdentifier`作為Bundle ID。下載它提供的`GoogleService-Info.plist`。

Firebase主控台接著會要求您將每個檔案加入應用程式的原始碼，並修改其建置檔案。請略過這些步驟：Publira應用程式改從建置指令取得相同的值，因此儲存庫中不會包含任何單一租戶的專案。

## 將專案的值交給建置

從兩個檔案中複製七個值，寫入建置讀取的檔案，也就是[建置與簽署](./2-building.md#推播通知)中的`~/example-reader/firebase.json`：

```json
{
  "PUBLIRA_FIREBASE_PROJECT_ID": "example-reader",
  "PUBLIRA_FIREBASE_MESSAGING_SENDER_ID": "123456789012",
  "PUBLIRA_FIREBASE_ANDROID_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_ANDROID_APP_ID": "1:123456789012:android:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_IOS_APP_ID": "1:123456789012:ios:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_BUNDLE_ID": "com.example.reader"
}
```

| 值 | 在`google-services.json`中 | 在`GoogleService-Info.plist`中 |
| --- | --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | `project_info.project_id` | `PROJECT_ID` |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | `project_info.project_number` | `GCM_SENDER_ID` |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | Android應用程式的`api_key`下的`current_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | Android應用程式的`client_info`下的`mobilesdk_app_id` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

這些值不是密鑰：每一份應用程式都帶有它們。缺少專案ID或寄件者ID的建置完全沒有推播通知，缺少某個平台那一組值的建置，在該平台上就沒有推播通知。

## 將Apple的推播金鑰交給Firebase

在取得Apple推播服務的金鑰之前，Firebase無法將通知送達iPhone。一把金鑰可以供Apple Developer團隊的所有應用程式使用，因此已經有金鑰的團隊可以沿用。

1. 在Apple Developer網站的**Certificates, Identifiers & Profiles** › **Keys**下建立一把金鑰，並為它啟用**Apple Push Notifications service (APNs)**。
2. 下載`.p8`檔案。Apple只提供一次；請將它保存在您的密鑰儲存區中。記下金鑰的Key ID。
3. 在Firebase主控台中開啟**Project settings** › **Cloud Messaging**，在Apple應用程式的設定下，將`.p8`檔案作為APNs驗證金鑰上傳，並一併填入其Key ID與團隊的Team ID。

應用程式本身已經在開發與正式兩種環境中向iOS要求推播通知，因此不需要在Xcode中開啟任何設定。

## 將傳送用的認證資訊交給租戶主控台

`publira worker`以Firebase專案的服務帳戶身分傳送每則通知，因此租戶主控台需要該帳戶的金鑰。

1. 在Firebase主控台中開啟**Project settings** › **Service accounts**，並選擇**Generate new private key**。系統會下載一個JSON檔案。
2. 在租戶主控台中開啟**整合** › **行動推播**。
3. 輸入**Firebase專案ID**（與建置應用程式時相同的`PUBLIRA_FIREBASE_PROJECT_ID`），並選擇下載的檔案作為**服務帳戶金鑰檔案**。
4. 選擇**儲存憑證**。

若金鑰來自與所輸入專案不同的專案，主控台會拒絕它，因為應用程式永遠收不到它傳送的內容。金鑰為唯寫：頁面會顯示它所屬的服務帳戶與儲存時間，但絕不會顯示金鑰本身，儲存新檔案就會取代它。儲存後請刪除下載的檔案。

若主控台回應API伺服器沒有加密金鑰，表示安裝實例啟動時沒有設定`PUBLIRA_SECRET_ENCRYPTION_KEYS`。營運人員依[安裝](../2-deployments/2-installing.md#產生密鑰)所述設定它，等`publira server`以它重新啟動後，就可以儲存金鑰。

在儲存金鑰之前，應用程式收不到任何推播通知。無論如何，應用程式內的通知收件匣都會收到通知，讀者也仍會針對其偏好設定中開啟郵件的每類通知收到電子郵件。

## 確認通知是否送達

請在實體手機上試用：Firebase不會傳遞到iOS模擬器。安裝發布用建置（iPhone透過TestFlight，Android則使用發布用APK），然後：

1. 以讀者身分登入應用程式，開啟**帳戶**，開啟**在此裝置上接收推播通知**，並在手機詢問時允許通知。上方**通知設定**中的**應用程式**開關，決定哪些類型的通知會送達讀者的手機：保持開啟，並開啟**公告**下預設關閉的那一個。
2. 在應用程式中追蹤一個系列。
3. 從租戶主控台發布該系列的新章節，其**顯示位置**須包含應用程式。
4. 從租戶主控台的[**公告**](../4-console/3-setup/4-announcements.md)發送一則公告。

`publira worker`傳送後，每則通知都會送達。點一下章節的通知會開啟該章節；公告的通知以公告的標題為標題，點一下會開啟該公告。再次關閉**公告**下的**應用程式**開關，並再發送一則公告：這則公告不會送達任何通知。應用程式只在讀者開啟開關時才會向手機要求權限，絕不會在啟動時要求，因此尚未開啟開關的讀者不會收到任何通知。

下一步：[應用程式連結](./4-app-links.md)。
