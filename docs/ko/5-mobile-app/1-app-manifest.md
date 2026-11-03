---
title: 앱 매니페스트
description: 테넌트 앱의 이름과 스토어가 앱을 식별하는 식별자를 정하는 파일을 작성하고, 빌드하기 전에 확인합니다.
published: 2026-11-03
source_updated: 2026-10-21
---

앱 매니페스트는 빌드가 누구의 앱인지를 나타내는 짧은 YAML 파일입니다. 홈 화면의 이름, 앱이 제공하는 단 하나의 테넌트, 그리고 앱을 게시하는 식별자를 담습니다. 테넌트 앱의 모든 빌드가 이 파일을 읽으므로, 테넌트의 다른 빌드 입력과 함께 리포지토리 밖에 두고 직접 버전 관리하세요.

## 매니페스트 작성하기

[`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml)을 `~/example-reader/app.yaml`처럼 자신의 디렉터리에 복사하고, 모든 값을 테넌트의 값으로 바꿉니다.

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

| 필드 | 입력할 내용 |
| --- | --- |
| `schemaVersion` | `1`. 앱의 버전이 아니라 파일의 형식을 나타냅니다 |
| `app.name` | 홈 화면의 아이콘 아래에 표시되는 이름. 그곳에서 잘리지 않을 만큼 짧게 하세요. 스토어 등록 정보에는 별도의 제목이 있습니다 |
| `tenant.host` | 테넌트 공개 사이트의 호스트 이름으로, `https://`나 경로 없이 입력합니다. 앱은 이 테넌트만 제공하며, Android와 iOS는 앱의 링크를 이 호스트와 대조해 확인합니다 |
| `android.applicationId` | Google Play가 앱을 식별할 애플리케이션 ID로, `com.example.reader`와 같은 형태입니다. 점으로 구분된 두 개 이상의 부분으로 이루어지며, 각 부분은 영문자로 시작하고 영문자, 숫자, 밑줄만 포함합니다 |
| `ios.bundleIdentifier` | App Store가 앱을 식별할 번들 ID. 영문자, 숫자, 하이픈으로 된 두 개 이상의 부분을 점으로 구분합니다 |
| `ios.googleSignInClientId` | 선택 사항. [인앱 결제와 로그인](./5-purchases-and-sign-in.md#apple-및-google로-로그인)에서 설명하는 테넌트 Google 로그인의 iOS 클라이언트입니다. iOS 앱에서 Google을 제공하지 않는다면 이 줄을 빼세요 |

그 밖의 필드는 모두 필수이며, 형식에 정의되지 않은 필드는 무시되지 않고 오류가 됩니다.

### 식별자는 한 번만 정하기

애플리케이션 ID와 번들 ID는 스토어가 앱을 식별하는 수단입니다. 스토어에 한 번 그 식별자로 빌드가 올라가면 바꿀 수 없습니다. 식별자가 다르면 다른 앱이 되며, 리뷰도 설치도 없고 독자를 옮길 방법도 없습니다. 첫 업로드 전에 정하고, 이후 모든 릴리스에서 그대로 유지하세요.

일반적인 형식은 출판사가 소유한 도메인을 거꾸로 쓰고 그 뒤에 앱 이름을 붙이는 것입니다. `example.com`이라면 `com.example.reader`입니다. 두 식별자는 같아도 되며, 대개 같습니다. 달라도 되므로, 이미 한쪽 스토어에 앱이 있는 출판사는 그곳의 식별자를 그대로 유지할 수 있습니다.

앱의 개발용 빌드는 두 식별자 모두에 `.dev`를 덧붙이므로, 테스트 기기에서 게시된 앱과 나란히 설치할 수 있습니다. 이 빌드는 업로드되지 않으며, 그 식별자를 어디에도 입력하지 않습니다.

## 매니페스트 확인하기

빌드하기 전에 리포지토리 루트에서 파일을 확인합니다.

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

출력되는 줄은 이 매니페스트로 빌드한 앱이 갖게 되는 정체성이며, 나중에 테넌트 콘솔과 스토어 콘솔에 복사해 넣는 값이기도 합니다. 문제가 있는 매니페스트에는 모든 문제가 한꺼번에 표시되고 0이 아닌 종료 코드가 반환되며, 빌드도 같은 방식으로 거부합니다.

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

JSON Schema를 이해하는 편집기는 입력하는 동안 파일을 확인합니다. 첫 줄의 주석이 편집기에 [형식](https://www.publira.dev/schemas/app-manifest/v1.json)을 알려 줍니다.

다음: [빌드와 서명](./2-building.md).
