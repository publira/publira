---
title: 빌드와 서명
description: 테넌트 앱의 매니페스트로부터 서명된 Android App Bundle과 iOS 아카이브를 만듭니다.
published: 2026-11-03
source_updated: 2026-10-25
---

테넌트 앱의 릴리스는 `task mobile:build` 명령 하나로, Android용과 iOS용을 한 번씩 빌드합니다. 이 명령은 [앱 매니페스트](./1-app-manifest.md)를 읽고, 시작하기 전에 모든 입력을 확인한 뒤, 수정하지 않은 체크아웃에서 스토어용 앱을 빌드합니다. 이 페이지에서는 먼저 명령이 환경에서 읽는 입력을 살펴보고, 이어서 두 가지 빌드를 다룹니다.

명령이 받는 모든 플래그는 [모바일 앱 레퍼런스](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app)에 나열되어 있습니다.

## 모든 빌드에 필요한 것

### 앱이 연결할 주소

테넌트 사이트의 오리진을 `PUBLIRA_BASE_URL`로 내보냅니다. 앱은 API를 `/rpc` 아래에서, 이미지를 `/images` 아래에서 요청하며, 설치 환경의 리버스 프록시가 이미 이를 라우팅합니다.

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

`https://`여야 하며, 경로 없이 오리진만 입력해야 합니다. 빌드는 독자의 휴대폰에서만 실패하는 앱을 내보내는 대신 그 밖의 값을 거부합니다. 대개 매니페스트의 `tenant.host`와 같지만 매니페스트가 이를 정하지는 않습니다. [이미지와 공개 API를 따로 제공하기](../2-deployments/7-scaling-out.md#이미지와-공개-api를-따로-제공하기)에서 설명하듯 설치 환경은 API를 다른 호스트 이름에서 제공할 수 있습니다. 그런 호스트는 이미지를 제공하지 않으므로, 그 호스트를 대상으로 빌드하기 전에 테넌트에 [이미지 호스트](../3-operations/2-tenants.md#이미지-호스트)를 지정하세요. 그러면 앱은 API가 알려 주는 주소로 이미지 호스트에서 모든 이미지를 불러옵니다.

### 푸시 알림

앱이 푸시 알림을 받는 Firebase 프로젝트는 앱에 포함되어 빌드됩니다. [푸시 알림](./3-push-notifications.md)에서 설명하듯 첫 릴리스 전에 설정하고, 그 값은 `~/example-reader/firebase.json`처럼 별도 파일에 보관하세요. Firebase 값 없이 빌드해도 앱은 작동하지만 푸시 알림이 없으며, 앱의 **계정** 화면에 푸시 알림 스위치가 표시되지 않습니다.

### 버전

스토어에 업로드할 때마다 스토어가 마지막으로 받은 것보다 높은 빌드 번호가 필요하며, 독자에게는 버전 이름이 보입니다. 모든 릴리스 빌드에 둘 다 지정하세요.

```bash
--build-name 1.2.0 --build-number 7
```

지정하지 않으면 빌드는 `1.0.0`, 빌드 `1`이 되며, 스토어는 두 번째 업로드부터 이를 거부합니다.

## Android

### 업로드 키 만들기

Google Play는 모든 업로드가 같은 키, 즉 업로드 키로 서명되어 있어야 합니다. 빌드하는 컴퓨터나 시크릿 저장소에서 한 번만 만듭니다.

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool`은 모든 JDK에 포함되어 있으며, 키스토어의 비밀번호와 키의 비밀번호를 묻습니다. 파일과 두 비밀번호는 리포지토리 밖에 보관하고 백업하세요. Play Console에서 잃어버린 업로드 키를 교체할 수는 있지만, Google이 승인해야 하는 요청을 거쳐야 하며 승인될 때까지 업로드가 막힙니다.

Google Play의 새 앱은 Play 앱 서명을 사용합니다. 설치된 앱에 서명하는 키는 Google이 보관하며, 업로드 키는 업로드가 본인에게서 왔다는 것을 증명할 뿐입니다. 이 구분은 [앱 링크](./4-app-links.md) 페이지에서 다시 중요해집니다.

### App Bundle 빌드하기

환경에 키스토어와 비밀번호를 지정한 뒤 빌드합니다.

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

리포지토리 루트에서 실행하세요. 매니페스트나 키스토어의 상대 경로는 명령을 시작한 디렉터리를 기준으로 읽힙니다. Firebase 파일은 `mobile/`을 기준으로 읽히므로 예시에서는 전체 경로를 지정합니다.

서명 변수 네 개 중 하나라도 없으면 Google Play가 거부할 키로 서명하는 대신 컴파일 전에 빌드를 멈춥니다. 업로드할 App Bundle은 `mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`입니다.

업로드하기 전에 휴대폰에서 릴리스를 시험해 보려면 같은 변수로 `appbundle` 대신 `apk`를 빌드하고 `mobile/build/app/outputs/flutter-apk/app-production-release.apk`를 설치하세요. 이 빌드는 업로드 키로 서명되므로, 업로드 키의 지문도 [앱 링크](./4-app-links.md)에 등록하지 않으면 사이트로의 링크가 이 앱에서 열리지 않습니다.

## iOS

### Mac 준비하기

iOS 빌드는 Xcode가 있는 Mac에서 실행됩니다. **Xcode** › **Settings** › **Accounts**에서 출판사의 Apple Developer 팀에 속한 Apple 계정으로 Xcode에 로그인하세요. 빌드는 자동 서명을 사용합니다. Xcode가 앱이 사용하는 기능(푸시 알림, 연결된 도메인, Sign in with Apple)과 함께 번들 ID를 등록하고 인증서와 프로필을 직접 만들므로, Apple Developer 웹사이트에서 직접 다운로드할 것은 없습니다.

Apple Developer 웹사이트의 **Membership details**에서 영문자와 숫자 10자로 된 팀의 Team ID를 찾아 환경에 지정합니다.

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

같은 Team ID를 나중에 [앱 링크](./4-app-links.md)에도 입력합니다.

### 아카이브 빌드하기

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

아카이브는 `mobile/build/ios/archive/Runner.xcarchive`이며, 업로드할 파일은 `mobile/build/ios/ipa/`에 있는 `.ipa`입니다. Apple의 Transporter 앱으로 `.ipa`를 업로드하거나, Xcode의 **Organizer**에서 아카이브를 열고 **Distribute App**을 선택하세요. App Store Connect에서 처리가 끝나면 TestFlight로 휴대폰에서 테스트한 뒤 심사에 제출할 수 있습니다.

기기용 빌드는 `PUBLIRA_IOS_DEVELOPMENT_TEAM`이 설정되지 않으면 Xcode가 처음 찾은 팀으로 서명하는 대신 첫 단계에서 멈춥니다.

## 빌드가 남기는 것

빌드는 테넌트의 정체성을 Git이 무시하는 파일에만 쓰며, 리포지토리가 추적하는 파일에 변경을 남기면 실패합니다. 따라서 같은 체크아웃으로 정리하지 않고도 다음 테넌트의 앱이나 다음 릴리스를 빌드할 수 있습니다.

다음: [푸시 알림](./3-push-notifications.md).
