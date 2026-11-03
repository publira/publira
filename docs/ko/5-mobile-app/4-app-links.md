---
title: 앱 링크
description: 테넌트 콘솔에서 게시된 앱을 지정하여, 테넌트 사이트로의 링크가 그 앱에서 열리게 합니다.
published: 2026-11-03
source_updated: 2026-10-17
---

테넌트 사이트로의 링크(시리즈, 에피소드, 공지사항, 또는 사이트 메일에 있는 확인 링크와 비밀번호 재설정 링크)는 앱이 설치되어 있으면 브라우저가 아니라 앱에서 열립니다. Android와 iOS는 사이트가 앱을 보증한다는 것을 확인한 뒤에만 이를 허용합니다. 두 플랫폼은 사이트에 다음 두 파일을 요청합니다.

- Android용 `https://<tenant.host>/.well-known/assetlinks.json`
- iOS용 `https://<tenant.host>/.well-known/apple-app-site-association`

사이트는 테넌트 콘솔의 **연동** › **앱 링크**에 저장된 내용으로 두 파일을 만듭니다. 웹 서버에 업로드할 것은 없습니다.

같은 두 파일은 앱이 사이트의 패스키를 사용하는 것도 보증합니다. 독자가 등록한 패스키는 테넌트의 호스트에 속하며, Android와 iOS는 호스트의 파일이 그 용도로 앱을 지정할 때만 앱이 그 호스트의 패스키를 사용하게 합니다. 링크용 `delegate_permission/common.handle_all_urls` 옆의 `assetlinks.json`의 `delegate_permission/common.get_login_creds` 관계와, `applinks` 옆의 `apple-app-site-association`의 `webcredentials` 항목이 그것입니다. 사이트는 지정한 모든 앱에 대해 둘 다 기록하므로, 패스키를 위해 더 입력할 것은 없습니다. Android 앱의 패스키 로그인은 사이트가 아니라 앱의 서명 인증서 명의로 서버에 도달하며, 서버는 여기에 지문이 저장된 인증서에서 온 것만 받아들입니다. 따라서 목록에 없는 키로 서명한 빌드는 사이트의 패스키를 사용할 수 없습니다.

같은 페이지는 설치 환경의 다른 부분에도 앱을 알려 줍니다. 인앱 결제의 App Store 및 Google Play 섹션은 여기서 지정한 앱에서 판매하며, Apple로 로그인은 여기서 지정한 앱을 신뢰합니다. 따라서 앱에서 이 둘 중 하나를 시험하기 전에 이 페이지를 채우세요.

## 언제 채우는가

Android 지문은 직접 고를 수 있는 것이 아닙니다. Play 앱 서명을 사용하면 지문은 Google이 설치되는 앱에 서명하는 키의 것이며, Play Console은 그곳에서 앱을 만들고 첫 App Bundle을 업로드한 뒤에 그 키를 보여 줍니다. iOS 쪽은 언제든 채우고, Android 쪽은 Play Console에 키가 표시된 뒤에 채우세요.

값은 항상 스토어가 배포하는 앱, 즉 [빌드와 서명](./2-building.md)의 스토어용 빌드의 값입니다. 게시된 앱과 한 글자라도 다른 값이면 그 앱의 링크는 브라우저에서 열리며, 불일치를 알려 주는 것은 아무것도 없습니다.

## 앱 입력하기

테넌트 콘솔에서 **연동** › **앱 링크**를 엽니다.

### Android

**테넌트의 Android 앱에서 링크 열기**를 선택하고 다음을 입력합니다.

| 필드 | 값을 가져오는 곳 |
| --- | --- |
| **애플리케이션 ID** | 매니페스트의 `android.applicationId`. Google Play는 같은 값을 앱의 스토어 주소에 있는 `id=`로 표시합니다 |
| **SHA-256 서명 인증서 지문** | Play Console에서 앱의 **App signing** 페이지에 있는 **app signing key certificate**의 SHA-256 지문. 업로드 키의 지문이 아닙니다. 업로드 키는 Play가 전달하는 것에 서명하지 않습니다 |

지문은 콜론으로 구분된 16진수 숫자 32쌍(`AA:BB:…`)이며, 이 입력란에는 한 줄에 하나씩 최대 10개까지 입력할 수 있습니다. 다른 방식으로 서명한 빌드에서도 링크가 열려야 할 때는 두 번째 지문을 추가하세요. 테스트용으로 설치하는, 업로드 키로 서명된 릴리스 APK나 키 교체 중의 새 키가 그런 경우입니다. 업로드 키의 지문은 다음 명령 출력의 `SHA256:` 줄입니다.

```bash
keytool -list -v -keystore ~/example-reader/upload.jks -alias upload
```

### iOS

**테넌트의 iOS 앱에서 링크 열기**를 선택하고 다음을 입력합니다.

| 필드 | 값을 가져오는 곳 |
| --- | --- |
| **Apple Team ID** | Apple Developer 웹사이트의 **Membership details**에 있는 10자 Team ID. 앱을 빌드할 때 사용한 `PUBLIRA_IOS_DEVELOPMENT_TEAM`입니다 |
| **번들 ID** | 매니페스트의 `ios.bundleIdentifier`. App Store Connect는 같은 값을 **App Information**의 Bundle ID로 표시합니다 |

**앱 링크 저장**을 선택합니다. 선택하지 않은 플랫폼에는 `404`로 응답하며, 이는 그 플랫폼에 앱이 없음을 알립니다. 앱이 없는 테넌트는 둘 다 선택하지 않습니다.

매니페스트의 `tenant.host`에 해당하는 입력란은 여기에 없습니다. 이미 정해져 있기 때문입니다. Android와 iOS는 링크가 가리키는 호스트에 요청하며, 앱은 그 호스트만 주장합니다. 따라서 이는 테넌트의 사이트가 제공되는 호스트여야 합니다.

## 링크 확인하기

먼저 사이트가 두 파일을 제공하는지 확인합니다.

```bash
curl -i https://reader.example.com/.well-known/assetlinks.json
curl -i https://reader.example.com/.well-known/apple-app-site-association
```

각각 저장한 식별자와 함께 `200`으로 응답합니다. `assetlinks.json`에는 Android 앱에 대한 두 관계가 모두 나열되고, `apple-app-site-association`에는 `applinks`와 `webcredentials` 양쪽에 iOS 앱이 지정됩니다. 두 휴대폰 모두 리다이렉트를 거쳐 도달한 파일은 거부하므로, 설치 환경 앞의 리버스 프록시는 이 경로에 대해 테넌트 호스트에서 직접 HTTPS로 응답해야 합니다.

Android에서는 앱이 설치되거나 업데이트될 때 휴대폰이 사이트를 확인합니다. 빌드를 설치한 뒤 휴대폰이 어떻게 판정했는지 물어봅니다.

```bash
adb shell pm get-app-links com.example.reader
```

확인을 통과하면 테넌트 호스트가 `verified`로 표시됩니다. 콘솔에서 값을 수정한 뒤에는 `adb shell pm verify-app-links --re-verify com.example.reader`로 휴대폰에 다시 확인하도록 요청하세요.

iOS에서는 휴대폰이 아니라 Apple의 서버가 파일을 가져오며, 휴대폰은 앱이 설치될 때 Apple의 서버에서 그것을 받습니다. 그 때문에 콘솔의 변경이 휴대폰에 반영되기까지 시간이 걸릴 수 있으며, 나중에 앱을 다시 설치하면 반영됩니다.

어느 휴대폰에서든 메일이나 메모에 있는 테넌트 사이트의 시리즈 링크를 탭해 보세요. 앱에서 그 시리즈가 열립니다. 브라우저 주소 표시줄에 입력한 링크는 브라우저에 머무릅니다. 이는 두 플랫폼의 원래 동작이며, 확인에 실패한 것이 아닙니다.

다음: [인앱 결제와 로그인](./5-purchases-and-sign-in.md).
