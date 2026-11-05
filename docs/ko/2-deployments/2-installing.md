---
title: 설치
description: 의존하는 서비스 준비부터 테넌트 콘솔에 처음 로그인하기까지, 빈 설치 환경을 서비스에 투입하는 방법을 설명합니다.
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

이 페이지에서는 아무것도 없는 상태에서 시작해, 첫 관리자가 테넌트 콘솔에 로그인할 수 있는 상태까지 설치 환경을 만듭니다. 단계는 실행해야 하는 순서대로 나열되어 있으며 각 단계에서 무엇이 결정되는지 설명합니다. 각 프로세스가 읽는 환경 변수의 전체 목록과 `publiractl`의 모든 플래그는 각 단계에서 링크한 레퍼런스에 있습니다.

여기서 다루는 것은 [개요](./1-overview.md)에서 설명한 가장 작은 설치 환경입니다. `web-storefront`, `web-admin`, `publira server`, `publira worker`로 이루어지며 `publiractl`로 관리합니다. 마지막의 [선택 프로세스 켜기](#선택-프로세스-켜기)에서 HTML 메일과 플랫폼 콘솔을 추가합니다.

## 시작하기 전에

모든 릴리스는 이미지를 GitHub Container Registry에 `ghcr.io/publira/<name>:<tag>`로 게시합니다. 태그는 릴리스의 버전, 즉 Git 태그에서 `v`를 뺀 것으로, `v0.1.0`이라면 `0.1.0`입니다. 게시되는 이미지는 `publira`, `publiractl`, `web-storefront`, `web-admin`이며, 선택 프로세스용으로 `web-platform`과 `email-renderer`가 있습니다. 이 이미지들은 공개되어 있으므로 호스트는 로그인 없이 이미지를 가져올 수 있고, 아무것도 빌드할 필요가 없습니다. 각 이미지는 `linux/amd64`와 `linux/arm64`용으로 게시되며, 그 밖의 플랫폼의 호스트에서는 가져올 이미지가 없습니다. 이 페이지의 예에서는 이미지를 `ghcr.io/publira/<name>:<tag>`로 표기합니다. `<tag>` 자리에는 설치하는 릴리스의 버전을 쓰세요. 태그의 번호 체계는 [릴리스](./10-releases.md)에서 설명합니다.

코드를 변경하는 설치 환경이나 다른 플랫폼에서 실행하는 설치 환경은 실행하는 커밋의 [이미지 빌드 안내](https://github.com/publira/publira/blob/main/infra/docker/README.md)에 따라 직접 이미지를 빌드하고, 호스트가 이미지를 가져오는 곳에 푸시한 뒤, 이 페이지 전체에서 게시된 이미지 대신 그 이미지를 지정합니다.

`publiractl` 단계는 모두 설치하는 릴리스의 `publiractl` 이미지로 실행합니다. 이 이미지에는 해당 릴리스의 마이그레이션과 역할 정의가 들어 있으므로, 다른 릴리스의 이미지를 쓰면 프로세스가 예상하지 않는 스키마가 적용됩니다.

설치 환경 전체를 한 대의 호스트에서 실행하려면 저장소의 Compose 파일이 서비스를 준비하고 환경 변수를 연결해 줍니다. 자세한 내용은 [Docker Compose](./3-docker-compose.md)에서 설명합니다. 그 경우에도 실행되는 것은 아래 단계와 같습니다.

## 서비스 준비

첫 단계 전에 다음을 만들어 두세요. 그 안의 모든 것은 Publira가 만들므로, 모두 빈 상태로 시작합니다.

- **PostgreSQL 데이터베이스**와, 그 데이터베이스를 소유하고 역할을 생성할 수 있는 관리용 로그인. 직접 운영하는 PostgreSQL 서버라면 슈퍼유저가 이에 해당합니다. 슈퍼유저를 사업자가 보유하는 관리형 PostgreSQL에서는 Cloud SQL의 `postgres` 사용자처럼 이런 종류의 로그인을 대신 제공하며, Publira에는 그것으로 충분합니다. 슈퍼유저도, 행 수준 보안을 우회하는 역할도 필요하지 않습니다. 이 로그인으로 접속하는 것은 `publiractl db` 명령뿐이며, 상시 실행되는 프로세스는 이 로그인을 사용하지 않습니다.
- **Valkey 인스턴스**, 또는 Redis 프로토콜을 지원하는 서버. `publira server`, `web-storefront`, `web-admin`이 이미지 변환 캐시, 요청 제한 카운터, 웹 앱의 캐시용으로 공유합니다. 비밀번호를 사용하는 연결은 TLS를 쓰는 `rediss://`여야 합니다. 비밀번호가 들어 있는 `redis://` URL이 주어지면 `publira server`는 시작을 거부합니다.
- S3 호환 오브젝트 스토리지의 **빈 버킷**과, 그 버킷을 읽고 쓸 수 있는 자격 증명. 업로드된 모든 이미지가 여기에 보관됩니다. `publiractl setup`이 버킷과 자격 증명을 저장하므로, 프로세스가 버킷에 접근하는 데 다른 것은 필요하지 않습니다. 인스턴스 역할처럼 프로세스가 자기 환경의 자격 증명을 사용해야 한다면 설정 시 액세스 키를 생략하고, `publira server`, `publira worker`, `publiractl`에 `AWS_*` 환경 변수를 지정하세요.
- **SMTP 서버**: 호스트, 포트, 암호화 방식, 메일 발신 주소, 그리고 로그인에 쓸 사용자 이름과 비밀번호. 로컬 MTA나 호스트의 주소를 신뢰하는 릴레이처럼 자격 증명 없이 중계하는 서버라면 사용자 이름과 비밀번호는 필요하지 않습니다. 독자 회원가입, 비밀번호 재설정, 관리자 초대 메일은 모두 이 서버를 거칩니다.
- 테넌트의 도메인과 `admin.<domain>`의 **DNS**. 둘 다 설치 환경 앞의 엣지를 가리켜야 합니다. 앞의 것은 테넌트의 공개 사이트를, 뒤의 것은 콘솔을 제공합니다. 콘솔을 다른 호스트 이름에 두려면 지금 정하세요. `publiractl setup`이 이를 `--admin-domain`으로 받습니다.

## 시크릿 생성

설치 환경에는 여러분만 보유하는 시크릿이 몇 가지 필요합니다. 환경마다 새로 생성해 시크릿 저장소에 보관하고, 저장소에 적혀 있는 값은 절대 재사용하지 마세요. 그 값들은 로컬 개발용이며 공개되어 있습니다.

| 시크릿 | 생성 방법 | 설정 대상 | 보호하는 것 |
| --- | --- | --- | --- |
| 시크릿 암호화 키 | `PUBLIRA_SECRET_ENCRYPTION_KEYS`로 `k1:$(openssl rand -base64 32)`, `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`로 `k1` | `publira server`, `publira worker`, `publiractl` | 설치 환경이 저장하는 모든 자격 증명. SMTP 비밀번호, 오브젝트 스토리지의 시크릿 키, 검색 엔진의 비밀번호, Web Push 개인 키, 그리고 각 테넌트의 결제·푸시·로그인 자격 증명 |
| 액세스 토큰 서명 키 | `PUBLIRA_AUTH_JWT_SECRET`으로 `openssl rand -base64 32` | `publira server` | 로그인한 모든 세션. 이 키를 가진 사람은 어떤 사용자의 토큰이든 서명할 수 있고, 그 사용자로서 모든 API를 호출할 수 있습니다 |
| 각 웹 앱의 세션 키 | 그 앱의 `PUBLIRA_AUTH_SECRET`으로 `openssl rand -base64 32` | `web-storefront`와 `web-admin`에 각각 하나씩 | 사용자의 액세스 토큰을 담는 세션 쿠키. 두 앱이 같은 값을 공유해도 되지만, 그럴 필요는 없습니다 |
| 캐시 재검증 토큰 | `openssl rand -hex 32` | `publira server`, `publira worker`, `web-storefront`, `web-admin`에 `PUBLIRA_REVALIDATE_TOKEN`으로 | 변경 후 서버가 웹 앱의 캐시된 페이지를 버리게 할 때 호출하는 엔드포인트. 이 토큰이 없으면 서버는 아무것도 보내지 않고, 웹 앱은 변경 전에 캐시한 내용을 계속 제공합니다 |
| 웹 서비스 토큰 | `PUBLIRA_WEB_SERVICE_TOKEN`으로 `openssl rand -base64 32` | `publira server`와 `web-admin` | 콘솔이 스태프 개인이 아니라 콘솔 자신으로서 수행하는 읽기. 예를 들어 모든 스태프가 똑같이 보는 카탈로그 목록이 이에 해당하며, 덕분에 모든 스태프를 위해 한 번만 캐시할 수 있습니다. 이 토큰이 없으면 `web-admin`은 시작하지 않습니다 |
| 데이터베이스 역할마다 하나의 비밀번호 | `openssl rand -hex 32`를 여섯 번 | `publiractl db roles`, 그리고 그 역할을 사용하는 프로세스의 연결 URL | 데이터베이스 자체. 연결 URL에는 비밀번호가 이스케이프되지 않은 채 들어가므로, hex 출력처럼 URL에 안전한 문자만 사용하세요 |

가장 주의가 필요한 것은 암호화 키입니다. `publiractl setup`은 SMTP 비밀번호나 오브젝트 스토리지의 키가 주어지면 그것을 이 키로 봉인하고, `publira server`와 `publira worker`는 자신에게 주어진 키로 이를 해제합니다. 다른 키가 주어진 프로세스는 `publiractl`이 저장한 것을 읽을 수 없습니다. 워커는 메일 발송에, 서버는 오브젝트 스토리지 접근에 실패합니다. 키를 잃어버리면 저장된 모든 자격 증명을 다시 입력해야 합니다. 나중에 키를 교체할 때 그 키로 봉인한 것을 잃지 않으려면, 기존 키를 대체하지 말고 새 키를 기존 키 옆에 추가하세요. 방법은 [시크릿 암호화 키 교체](../3-operations/12-security/1-rotating-secrets.md#시크릿-암호화-키-교체)에서 설명합니다.

## 데이터베이스 역할

프로세스는 관리용 로그인으로 접속하지 않습니다. `publiractl db roles`가 로그인 역할 여섯 개를 만들고, 설치 환경의 각 부분은 하는 일에 맞는 역할로 접속합니다.

| 역할 | 접속하는 쪽과 용도 | 접근할 수 있는 범위 |
| --- | --- | --- |
| `publira_public` | 공개 사이트와 모바일 앱에 응답하는 `publira server` | 요청 대상 테넌트의 행 |
| `publira_admin` | 테넌트 콘솔에 응답하는 `publira server` | 요청 대상 테넌트의 행 |
| `publira_platform` | 플랫폼 콘솔에 응답하는 `publira server`, 그리고 `setup`을 비롯해 플랫폼 설정을 변경하는 `publiractl` 명령 | 모든 테넌트와 플랫폼 자체의 설정 |
| `publira_outbox` | 메일과 푸시 알림을 보내고 캐시를 재검증하는 `publira worker` | 모든 테넌트와 메일에 필요한 플랫폼 설정 |
| `publira_ticker` | 에피소드 공개처럼 예약 시각이 지나는 즉시 동작하는 작업을 실행하는 `publira worker` | 그 작업들이 다루는 몇 개의 테이블 |
| `publira_content_stats` | 유지 관리 작업과 집계 작업을 실행하는 `publira worker`와 `publiractl job` | 모든 테넌트와 그 작업들이 읽는 플랫폼 설정 |

이렇게 나누어 두기 때문에 한 테넌트의 데이터가 다른 테넌트로부터 보호됩니다. 독자와 테넌트 스태프의 요청에 응답하는 두 역할은 행 수준 보안에 의해 요청이 지정한 테넌트로 한정되므로, 이 경로 중 하나에 결함이 있더라도 다른 테넌트의 행을 읽을 수 없습니다. 운영자의 비밀번호 해시와 플랫폼의 메일 자격 증명을 담은 플랫폼 자체의 테이블에는 `publira_platform`만 접근할 수 있고, 다른 역할은 별도로 허용된 좁은 범위의 읽기만 할 수 있습니다. 워커의 역할은 작업과 메일에 필요한 설정을 읽고, 테넌트 콘솔의 역할은 요청에 적용하는 몇 가지 설정을 읽습니다. 여기에는 플랫폼 메일의 발신 주소가 포함되지만, 그 옆에 저장된 메일 서버, 계정, 비밀번호는 포함되지 않습니다. 따라서 각 프로세스는 사용하는 역할마다 연결 URL을 하나씩 받습니다. 어느 환경 변수가 어느 연결 URL을 담는지는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)에 나와 있습니다.

## 설치 환경 가동

### 1. 마이그레이션 적용

관리용 로그인의 연결로 `db migrate`를 실행합니다. 스키마를 만들며, 적용할 것이 없으면 아무것도 변경하지 않고 종료합니다.

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`은 그 연결이며, 예를 들면 `postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`입니다.

### 2. 역할 만들기

같은 연결로 `db roles`를 실행하고, 각 역할에 생성해 둔 비밀번호를 지정합니다. 이 명령은 마이그레이션이 만든 테이블에 권한을 부여하므로 두 번째로 실행합니다.

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

다시 실행해도 주어진 비밀번호 외에는 아무것도 바뀌지 않으므로, 나중에 역할의 비밀번호를 교체할 때도 이 명령을 씁니다. 비밀번호를 전달하는 다른 방법은 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)에 나와 있습니다.

### 3. 네 개의 프로세스 시작

`publira server`, `publira worker`, `web-storefront`, `web-admin`을 같은 릴리스의 이미지로 시작합니다. 앞의 둘은 `ghcr.io/publira/publira:<tag>`로 시작하되 두 번째는 컨테이너 인수로 `worker`를 지정하고, 나머지는 `ghcr.io/publira/web-storefront:<tag>`와 `ghcr.io/publira/web-admin:<tag>`로 시작합니다. 환경 변수는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)에 나온 대로 설정합니다. 각 연결 URL에는 역할과 `db roles`가 그 역할에 부여한 비밀번호를 지정합니다. 예를 들어 `PUBLIRA_PUBLIC_DB_URL`이라면 `postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`입니다. 연결 URL은 모두 설정하세요. 설정하지 않은 연결 URL은 여러분이 설정한 다른 환경 변수가 아니라 개발용 URL로 대체되므로 로그인에 실패합니다.

`publira worker`는 시작할 때 작업 큐의 테이블을 만들므로 별도의 단계가 필요하지 않습니다. `publira server`와 `publira worker`는 각각 `GET /readyz`에서 데이터베이스 로그인마다 하나씩 검사 결과를 보고하므로, 비밀번호가 맞지 않는 역할이 있으면 거기에 그 이름이 나타납니다.

### 4. 설치 환경 설정

`publiractl setup`은 설치 환경이 첫 테넌트를 서비스하는 데 필요한 것을 저장하고, 테넌트의 첫 관리자를 만듭니다.

1. 플랫폼의 기본 로케일, 새 테넌트의 초기 시간대, 그리고 테넌트 관리자가 직접 정하기 전까지 테넌트가 판매에 사용하는 통화(따로 지정하지 않으면 `USD`).
2. 오브젝트 스토리지. 연결 테스트를 통과해야 합니다.
3. 선택적으로, 카탈로그 검색 엔진. 다른 것을 선택하지 않으면 데이터베이스 자체를 사용합니다.
4. SMTP 설정, 그리고 주소를 지정했다면 테스트 메시지. 자격 증명을 받지 않는 릴레이라면 사용자 이름을 비워 두세요. 그러면 로그인하지 않고 메일을 보내며, 비밀번호는 묻지 않습니다.
5. 선택적으로, Web Push.
6. 테넌트와 그 도메인.
7. 테넌트의 첫 관리자. 비밀번호는 직접 입력하거나 자동으로 생성할 수 있습니다.

이 명령은 `publira_platform`으로 접속하며, 저장하는 자격 증명을 암호화 키로 봉인합니다. 따라서 프로세스가 실행될 때 쓰는 것과 같은 키를 지정하세요.

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

터미널에서 실행하면 모든 값을 묻습니다. 모든 값을 플래그로 지정하면 CI 작업이나 init 컨테이너에서 무인으로 실행할 수도 있으며, 그 형식은 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)에 나와 있습니다. 출력되는 링크는 `PUBLIRA_TENANT_URL_SCHEME`을 바탕으로 만들어집니다. 이는 독자의 브라우저가 테넌트에 접속하는 스킴이며, 설정하지 않으면 `https`입니다. 이 값은 공개 주소를 나타낼 뿐 프록시가 프로세스에 접속하는 방식을 나타내지 않으므로, TLS 종단 뒤의 구간이 일반 HTTP여도 바뀌지 않습니다. 브라우저가 실제로 HTTP로 테넌트를 여는 경우에만 `http`로 설정하고, 그때는 `publiractl`과 프로세스 모두에 같은 값을 설정하세요.

연결 테스트 실패 등으로 실행이 중간에 멈추면, 다시 실행해서 마무리합니다. 이미 저장된 단계는 그대로 유지하고 나머지만 묻습니다. 단, 테스트 메시지가 거부된 경우는 예외입니다. SMTP 설정은 테스트 전에 저장되므로, 다음 실행에서는 그 설정을 유지한 채 테스트 메시지를 보내지 않습니다. 잘못된 설정은 `publiractl smtp set`으로 고치고, [이메일](../3-operations/6-email.md#계정-테스트)에서 설명하는 대로 `publiractl smtp test`로 테스트 메시지를 보낸 다음 `setup`을 다시 실행하세요.

`setup`은 1단계와 2단계도 직접 수행할 수 있고, 아직 없는 빈 버킷을 만들 수도 있습니다. `PUBLIRA_DB_URL`과 각 역할의 비밀번호가 주어지면 자기 단계에 앞서 마이그레이션을 적용하고 역할을 만들며, `--create-bucket`을 지정하면 연결 테스트 전에 버킷을 만듭니다. [Docker Compose](./3-docker-compose.md) 설치 환경처럼 `setup`이 끝난 뒤에만 모든 프로세스를 실행하는 설치 환경이라면 다른 명령은 필요하지 않습니다. 해당 플래그는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)에 나와 있습니다.

마지막의 요약에는 테넌트 사이트와 테넌트 콘솔이 표시되고, 관리자의 비밀번호를 생성한 경우에는 그 비밀번호가 출력됩니다. 생성된 비밀번호가 표시되는 곳은 여기뿐이므로 터미널을 닫기 전에 보관해 두세요.

### 5. 엣지 배치

엣지는 독자의 요청을 받아 프로세스로 전달하는 것으로, 플랫폼이 관리하는 로드 밸런서, 직접 운영하는 리버스 프록시, 또는 이들을 연결한 것입니다. 두 호스트 이름을 다음과 같이 프로세스로 라우팅합니다.

- `admin.<domain>` 또는 직접 정한 콘솔 호스트는 `web-admin`으로.
- 테넌트의 도메인은 `web-storefront`로.
- 두 호스트 모두에서 `/rpc/publira.v1.`과 `/images`는 `publira server`로. 기본 포트는 `8000`입니다.
- 두 호스트 모두에서 나머지 `/rpc`는 어디로도 보내지 않습니다. 엣지가 `404`로 응답합니다. 이 경로는 `publira server`가 콘솔용 API에 응답하는 곳이며, 웹 앱은 이를 사설 네트워크로 호출합니다. 자세한 내용은 [공개 API만 엣지를 거친다](./4-edge/index.md#공개-api만-엣지를-거친다)에서 설명합니다. API 키를 사용하는 테넌트 자체 시스템에는 콘솔 호스트에서 [몇 가지 읽기 요청](./4-edge/index.md#api-키로-보낼-수-있는-읽기-요청)의 전달이 필요합니다.

두 호스트 이름의 TLS는 엣지에서 종단합니다. 엣지가 무엇으로 구성되든 필요한 나머지 사항, 즉 전달하는 헤더와 제거하는 헤더, 클라이언트 주소, 통과시켜야 하는 업로드와 웹훅은 [엣지가 해야 하는 일](./4-edge/index.md#엣지가-해야-하는-일)에 나와 있습니다. 저장소에 있는 Traefik, nginx, Caddy [샘플 구성](./4-edge/1-sample-configurations.md)은 이 모두를 구현하는 한 가지 방법입니다.

### 6. 로그인

`setup` 요약에 출력된 테넌트 콘솔 URL, 즉 `https://admin.<domain>` 또는 `--admin-domain`으로 지정한 콘솔 호스트를 열고, 관리자의 이메일 주소와 비밀번호로 로그인합니다. 테넌트 콘솔은 `setup`이 만든 테넌트로 열리며, 거기서 스태프를 초대하고 사이트를 설정할 수 있습니다. 테넌트의 공개 사이트는 `https://<domain>`에서 응답합니다.

## 선택 프로세스 켜기

두 프로세스 모두 이미 서비스 중인 설치 환경에 추가할 수 있습니다. 어느 것도 자체 데이터를 갖지 않으므로, 켜려면 그 프로세스를 실행하고 환경 변수가 바뀌는 프로세스를 다시 시작하기만 하면 됩니다.

### `email-renderer`로 HTML 메일 보내기

`email-renderer`가 없으면 워커는 모든 메일을 일반 텍스트로 보냅니다. 이를 실행하고 `publira worker`의 `PUBLIRA_EMAIL_RENDERER_URL`을 사설 네트워크상의 주소(예: `http://email-renderer:8080`)로 설정하면, 그때부터 모든 메일에 같은 텍스트와 함께 HTML 파트가 들어갑니다. 이 환경 변수를 설정한 뒤에는 렌더러가 메일 발송의 일부가 됩니다. 렌더러가 중단된 동안 워커는 일반 텍스트로 대체하지 않고 각 메일을 보류했다가 다시 시도합니다.

### `web-platform`으로 플랫폼 콘솔 사용하기

`web-platform`은 운영자가 `publiractl` 대신 브라우저에서 테넌트와 플랫폼 설정을 관리하는 플랫폼 콘솔입니다. 실행하려면 다음을 수행하세요.

- 다른 웹 앱과 같은 방법으로 세션 키를 생성해 32바이트 이상의 값을 `PUBLIRA_AUTH_SECRET`으로 설정합니다. 이 키가 없으면 어떤 운영자도 로그인할 수 없습니다. `PUBLIRA_GRPC_URL`, `PUBLIRA_WEB_SERVICE_TOKEN`, `PNCH_REDIS_URL`, `PUBLIRA_REVALIDATE_TOKEN`은 `web-admin`과 같은 값을 지정합니다.
- 캐시 재검증이 `web-platform`에 도달하도록 `publira server`와 `publira worker`에 `PUBLIRA_WEB_PLATFORM_INTERNAL_URL`을 설정하고, `publira worker`에 `PUBLIRA_PLATFORM_APP_URL`을 설정합니다. 이는 운영자가 플랫폼 콘솔을 여는 주소이며, 플랫폼 콘솔 메일의 링크가 이 주소로 만들어집니다.
- `platform.example.com` 같은 호스트 이름을 정해 엣지를 가리키게 하고, 엣지에 그 인증서를 설정한 다음, [라우팅](./4-edge/index.md#라우팅)에서 설명하는 대로 다른 호스트와 같은 경로로 `web-platform`에 라우팅합니다. 샘플 구성에서는 이 호스트 이름을 `PUBLIRA_EDGE_PLATFORM_HOSTS`로 받습니다.

플랫폼 콘솔을 열고 설정 화면에서 첫 운영자를 만듭니다. 이 운영자는 `publiractl setup`이 만든 테넌트 관리자와는 별개입니다. 플랫폼 콘솔은 자체 계정을 가지며, 설정 화면은 첫 계정이 생길 때까지 표시됩니다. 이 화면에서 선택한 언어는 `publiractl setup`이 저장한 것을 대신해 플랫폼의 기본 로케일이 되며, 시간대도 마찬가지입니다. 시간대는 브라우저의 시간대로 미리 채워집니다. 이 화면은 기본 통화도 묻는데, `publiractl setup`이 저장한 통화로 미리 채워지므로 그대로 두면 그 값이 유지됩니다. 그 밖의 설정은 모두 유지되며, 플랫폼 콘솔과 함께 `publiractl`도 계속 사용할 수 있습니다.

## 다음 단계

각 프로세스가 읽는 환경 변수의 전체 목록은 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md)에, 선택 환경 변수는 [`publira server`와 `publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md), [`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md), [`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md), [`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)의 README에 있습니다. `publiractl`의 모든 명령은 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)에 있습니다.

이후 릴리스가 나올 때마다 [업그레이드](./8-upgrading.md)에 따라 설치 환경을 올립니다. 먼저 그 릴리스의 `publiractl` 이미지로 마이그레이션과 역할을 적용하고, 그다음 프로세스를 올립니다.
