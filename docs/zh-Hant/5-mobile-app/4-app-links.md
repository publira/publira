---
title: 應用程式連結
description: 在租戶主控台中指定已發布的應用程式，讓租戶網站的連結在應用程式中開啟。
published: 2026-11-03
source_updated: 2026-10-17
---

租戶網站的連結（系列、章節、公告，或網站郵件中的確認連結與密碼重設連結）在已安裝應用程式時會在應用程式中開啟，而不是在瀏覽器中開啟。Android與iOS只有在確認網站為該應用程式背書之後才會允許這麼做。它們會向網站要求兩個檔案：

- `https://<tenant.host>/.well-known/assetlinks.json`，供Android使用
- `https://<tenant.host>/.well-known/apple-app-site-association`，供iOS使用

網站會根據租戶主控台中**整合** › **應用程式連結**下儲存的內容產生這兩個檔案。不需要上傳任何東西到網頁伺服器。

這兩個檔案也會為應用程式使用網站的通行金鑰背書。讀者註冊的通行金鑰屬於租戶的主機，而Android與iOS只有在該主機的檔案為此指定了應用程式時，才允許應用程式使用該主機的通行金鑰：在`assetlinks.json`中，是與連結用的`delegate_permission/common.handle_all_urls`並列的`delegate_permission/common.get_login_creds`關係；在`apple-app-site-association`中，則是與`applinks`並列的`webcredentials`項目。網站會為它指定的每個應用程式寫入這兩者，因此通行金鑰不需要另外輸入任何內容。Android應用程式的通行金鑰登入，是以其簽署憑證而不是網站的身分到達伺服器，伺服器只接受來自已在此處儲存指紋之憑證的登入，因此以未列出的金鑰簽署的建置無法使用網站的通行金鑰。

同一個頁面也會向安裝實例的其他部分指定應用程式。應用程式內購買的App Store與Google Play區段，會在此處指定的應用程式中販售；使用Apple登入也會信任此處指定的應用程式。因此，在應用程式中試用其中任何一項之前，請先填寫此頁。

## 何時填寫

Android的指紋不是由您選擇的：使用Play應用程式簽署時，它屬於Google用來簽署已安裝應用程式的金鑰，在Play Console中建立應用程式並上傳第一個App Bundle後，Play Console才會顯示它。iOS的部分隨時都可以填寫，Android的部分則在Play Console顯示金鑰後再填寫。

這些值一律是商店發行之應用程式的值，也就是[建置與簽署](./2-building.md)中的商店建置。只要有一個字元與已發布的應用程式不同，其連結就會在瀏覽器中開啟，且不會有任何地方回報這個不一致。

## 輸入應用程式

在租戶主控台中開啟**整合** › **應用程式連結**。

### Android

勾選**在租戶的Android應用程式中開啟連結**，並填寫：

| 欄位 | 值的來源 |
| --- | --- |
| **應用程式ID** | 資訊清單中的`android.applicationId`。Google Play會將同樣的值顯示為應用程式商店網址中的`id=` |
| **SHA-256簽署憑證指紋** | Play Console中應用程式**App signing**頁面上**app signing key certificate**的SHA-256指紋。不是上傳金鑰的指紋：上傳金鑰不會簽署Play所交付的內容 |

指紋是以冒號分隔的32組十六進位數字`AA:BB:…`，此欄位最多可輸入十個，每行一個。若以其他方式簽署的建置也應開啟連結，請列出第二個：例如為測試而安裝、以上傳金鑰簽署的發布用APK，或金鑰輪替期間的新金鑰。上傳金鑰的指紋是下列指令輸出中的`SHA256:`那一行：

```bash
keytool -list -v -keystore ~/example-reader/upload.jks -alias upload
```

### iOS

勾選**在租戶的iOS應用程式中開啟連結**，並填寫：

| 欄位 | 值的來源 |
| --- | --- |
| **Apple Team ID** | Apple Developer網站**Membership details**下的10個字元Team ID：也就是建置應用程式時使用的`PUBLIRA_IOS_DEVELOPMENT_TEAM` |
| **Bundle ID** | 資訊清單中的`ios.bundleIdentifier`。App Store Connect會在**App Information**下將同樣的值顯示為Bundle ID |

選擇**儲存應用程式連結**。未勾選的平台會得到`404`回應，藉此告訴該平台沒有應用程式；沒有應用程式的租戶兩者都不勾選。

資訊清單的`tenant.host`在這裡沒有欄位，因為它已經決定了：Android與iOS會詢問連結所指向的主機，而應用程式只宣告該主機。因此它必須是提供租戶網站的主機。

## 檢查連結

首先確認網站有提供這兩個檔案：

```bash
curl -i https://reader.example.com/.well-known/assetlinks.json
curl -i https://reader.example.com/.well-known/apple-app-site-association
```

兩者都會以`200`回應，並包含您儲存的識別碼：`assetlinks.json`會為Android應用程式列出兩種關係，`apple-app-site-association`則會在`applinks`與`webcredentials`下都指定iOS應用程式。兩種手機都會拒絕經由重新導向取得的檔案，因此安裝實例前方的反向代理必須在租戶主機本身上，透過HTTPS回應這些路徑。

在Android上，手機會在安裝或更新應用程式時檢查網站。安裝建置後，詢問手機的判定結果：

```bash
adb shell pm get-app-links com.example.reader
```

檢查通過時，租戶主機會列為`verified`。在主控台中修正值之後，以`adb shell pm verify-app-links --re-verify com.example.reader`要求手機重新檢查。

在iOS上，是由Apple的伺服器取得檔案，而不是手機，手機則在安裝應用程式時從Apple的伺服器取得。透過這種方式，主控台中的變更可能需要一段時間才會到達手機；稍後重新安裝應用程式就會套用。

在任一種手機上，點一下郵件或備忘錄中指向租戶網站某個系列的連結，它會在應用程式中開啟該系列。在瀏覽器網址列中輸入的連結會留在瀏覽器中；這是兩個平台的正常行為，不是檢查失敗。

下一步：[應用程式內購買與登入](./5-purchases-and-sign-in.md)。
