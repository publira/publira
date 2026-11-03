---
title: 푸시 알림
description: 테넌트 앱이 푸시 알림을 받는 Firebase 프로젝트를 설정하고, 테넌트 콘솔에 발송용 자격 증명을 넘겨줍니다.
published: 2026-11-03
source_updated: 2026-11-02
---

앱은 독자가 팔로우하는 시리즈의 새 에피소드가 공개되거나 독자가 팔로우하는 작가의 새 에피소드가 공개되면 독자의 휴대폰으로 알려 주며, 알림을 탭하면 그 에피소드가 열립니다. 앱에서 공지사항 알림을 켠 독자는 출판사가 공지사항을 전달할 때도 알림을 받으며, 탭하면 그 공지사항이 열립니다. 설치 환경은 알림을 Firebase Cloud Messaging으로 보내고, Firebase Cloud Messaging은 Android 휴대폰에는 직접, iPhone에는 Apple의 푸시 서비스를 통해 알림을 전달합니다. 이것이 작동하려면 세 곳이 같은 Firebase 프로젝트를 가리켜야 합니다.

1. **앱.** 프로젝트의 값으로 빌드되며, 각 휴대폰을 프로젝트에 등록합니다.
2. **Apple.** 프로젝트는 Apple의 푸시 키로 iPhone 알림을 중계합니다.
3. **테넌트 콘솔.** `publira worker`가 발송에 사용하는 프로젝트의 서비스 계정 키를 보관합니다.

테넌트 앱마다 Firebase 프로젝트를 하나씩 사용하세요. 프로젝트는 앱을 빌드하는 사람의 소유이므로, 출판사가 자신의 프로젝트를 온전히 소유할 수 있습니다.

## Firebase 프로젝트 만들기

[Firebase 콘솔](https://console.firebase.google.com/)에서 테넌트 앱용 프로젝트를 추가합니다. Google Analytics는 필요 없으므로 꺼도 됩니다.

그런 다음 프로젝트의 **Project settings** › **General**에서 앱 두 개를 추가합니다.

- **Android 앱.** 패키지 이름으로 매니페스트의 `android.applicationId`를 입력합니다. 제공되는 `google-services.json`을 다운로드합니다.
- **Apple 앱.** 번들 ID로 매니페스트의 `ios.bundleIdentifier`를 입력합니다. 제공되는 `GoogleService-Info.plist`를 다운로드합니다.

이어서 Firebase 콘솔은 각 파일을 앱의 소스 코드에 추가하고 빌드 파일을 수정하라고 안내합니다. 이 단계는 건너뛰세요. Publira 앱은 같은 값을 빌드 명령에서 받으므로, 리포지토리에 특정 테넌트의 프로젝트가 들어가지 않습니다.

## 빌드에 프로젝트의 값 넘겨주기

두 파일에서 일곱 개의 값을 복사해, 빌드가 읽는 파일인 [빌드와 서명](./2-building.md#푸시-알림)의 `~/example-reader/firebase.json`에 넣습니다.

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

| 값 | `google-services.json`에서 | `GoogleService-Info.plist`에서 |
| --- | --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | `project_info.project_id` | `PROJECT_ID` |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | `project_info.project_number` | `GCM_SENDER_ID` |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | Android 앱의 `api_key` 아래 `current_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | Android 앱의 `client_info` 아래 `mobilesdk_app_id` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

이 값들은 시크릿이 아닙니다. 앱의 모든 사본에 들어 있습니다. 프로젝트 ID나 발신자 ID가 없는 빌드에는 푸시 알림이 전혀 없으며, 한 플랫폼의 값 쌍이 빠진 빌드는 그 플랫폼에서 푸시 알림이 없습니다.

## Firebase에 Apple의 푸시 키 넘겨주기

Firebase는 Apple 푸시 서비스용 키를 갖기 전까지 iPhone에 알림을 보낼 수 없습니다. 키 하나로 Apple Developer 팀의 모든 앱을 처리하므로, 이미 키가 있는 팀은 그것을 재사용합니다.

1. Apple Developer 웹사이트의 **Certificates, Identifiers & Profiles** › **Keys**에서 **Apple Push Notifications service (APNs)** 옵션을 켠 키를 만듭니다.
2. `.p8` 파일을 다운로드합니다. Apple은 이 파일을 한 번만 제공하므로 시크릿 저장소에 보관하세요. 키의 Key ID를 메모해 둡니다.
3. Firebase 콘솔에서 **Project settings** › **Cloud Messaging**을 열고, Apple 앱의 구성에서 `.p8` 파일을 APNs 인증 키로 업로드하며, 그 Key ID와 팀의 Team ID를 함께 입력합니다.

앱 자체가 이미 개발 환경과 프로덕션 환경 모두에서 iOS에 푸시 알림을 요청하므로, Xcode에서 켤 것은 없습니다.

## 테넌트 콘솔에 발송용 자격 증명 넘겨주기

`publira worker`는 각 알림을 Firebase 프로젝트의 서비스 계정으로 보내므로, 테넌트 콘솔에 그 계정의 키가 필요합니다.

1. Firebase 콘솔에서 **Project settings** › **Service accounts**를 열고 **Generate new private key**를 선택합니다. JSON 파일이 다운로드됩니다.
2. 테넌트 콘솔에서 **연동** › **모바일 푸시**를 엽니다.
3. **Firebase 프로젝트 ID**에 앱을 빌드할 때 사용한 것과 같은 `PUBLIRA_FIREBASE_PROJECT_ID`를 입력하고, **서비스 계정 키 파일**로 다운로드한 파일을 선택합니다.
4. **인증 정보 저장**을 선택합니다.

콘솔은 입력한 프로젝트와 다른 프로젝트의 키를 거부합니다. 그렇게 보낸 알림은 앱이 결코 받지 못하기 때문입니다. 키는 쓰기 전용입니다. 페이지에는 키가 속한 서비스 계정과 저장 시각만 표시되고 키 자체는 표시되지 않으며, 새 파일을 저장하면 교체됩니다. 저장한 뒤에는 다운로드한 파일을 삭제하세요.

콘솔이 API 서버에 암호화 키가 없다고 응답한다면, 설치 환경이 `PUBLIRA_SECRET_ENCRYPTION_KEYS` 없이 시작된 것입니다. 운영자가 [설치](../2-deployments/2-installing.md#시크릿-생성)에서 설명하는 대로 이를 설정하고, `publira server`가 그 값으로 재시작되면 키를 저장할 수 있습니다.

키를 저장하기 전까지 앱은 푸시 알림을 받지 않습니다. 앱 안의 알림함은 어느 경우든 채워지며, 독자는 알림 설정에서 이메일을 켜 둔 종류의 알림에 대해서는 계속 이메일을 받습니다.

## 알림이 도착하는지 확인하기

실제 휴대폰에서 시험하세요. Firebase는 iOS 시뮬레이터에는 알림을 전달하지 않습니다. iPhone에서는 TestFlight로, Android에서는 릴리스 APK로 릴리스 빌드를 설치한 다음 다음을 수행합니다.

1. 앱에 독자로 로그인하고 **계정**을 열어 **이 기기에서 푸시 알림 받기**를 켠 뒤, 휴대폰이 물으면 알림을 허용합니다. 그 위에 있는 **알림 설정**의 **앱** 스위치는 어떤 종류의 알림이 독자의 휴대폰에 도착할지를 정합니다. 이 스위치들은 켠 채로 두고, 처음에는 꺼져 있는 **공지사항** 아래의 스위치를 켜세요.
2. 앱에서 시리즈를 팔로우합니다.
3. 테넌트 콘솔에서 **표시 위치**에 앱이 포함된 그 시리즈의 새 에피소드를 공개합니다.
4. 테넌트 콘솔의 [**공지사항**](../4-console/3-setup/4-announcements.md)에서 공지사항을 전달합니다.

각 알림은 `publira worker`가 보낸 뒤 도착합니다. 에피소드 알림을 탭하면 에피소드가 열리고, 공지사항 제목이 붙은 공지사항 알림을 탭하면 공지사항이 열립니다. **공지사항** 아래의 **앱** 스위치를 다시 끄고 공지사항을 하나 더 전달해 보세요. 이번에는 알림이 도착하지 않습니다. 앱은 독자가 스위치를 켤 때만 휴대폰에 권한을 요청하며 실행 시에는 요청하지 않으므로, 스위치를 켜지 않은 독자는 아무것도 받지 않습니다.

다음: [앱 링크](./4-app-links.md).
