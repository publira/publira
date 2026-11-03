---
title: 백업과 복원
description: 설치 환경이 보관하고 백업해야 하는 것, 복원할 수 있는 백업을 받는 방법, 빈 서비스 위에 설치 환경을 되살리는 방법을 설명합니다.
published: 2026-11-03
source_updated: 2026-11-02
---

설치 환경은 상태를 세 곳에 보관합니다. PostgreSQL 데이터베이스, 오브젝트 스토리지 버킷, 그리고 운영자만 갖고 있는 시크릿 암호화 키입니다. 다른 것 없이 하나만 복원하면 불완전합니다. 행은 버킷에 없는 이미지를 가리키고, 버킷에는 어느 행도 가리키지 않는 이미지가 있으며, 데이터베이스의 자격 증명은 아무도 갖고 있지 않은 키로 봉인되어 있게 됩니다. 이 페이지에서는 무엇을 왜 백업하는지, 동작하는 설치 환경으로 복원할 수 있는 백업을 받는 방법, 그리고 빈 서비스 위에 백업에서 설치 환경을 되살리는 방법을 설명합니다.

이 단계는 [설치](./2-installing.md)에서 구성하는 것처럼 직접 운영하는 설치 환경을 기준으로 합니다. 리포지토리의 Compose 파일로 만든 설치 환경은 같은 단계를 자체 명령으로 실행하며, [Docker Compose 설치 환경의 경우](#docker-compose-설치-환경의-경우)에서 설명합니다.

명령의 `publiractl`은 [설치](./2-installing.md#시작하기-전에)에서처럼 설치 환경이 실행하는 릴리스의 `publiractl` 이미지를 뜻하며, 각 명령이 읽는 변수를 전달해 실행합니다. `db`는 관리용 로그인의 연결인 `PUBLIRA_DB_URL`을 읽고, `storage`는 `PUBLIRA_PLATFORM_DB_URL`을, `search reindex`는 `PUBLIRA_CONTENT_STATS_DB_URL`을 읽으며, 둘 다 `PUBLIRA_SECRET_ENCRYPTION_KEYS`와 `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`도 읽습니다. CI는 스키마가 바뀔 때마다 이 명령들로 백업을 받고 복원하며, 그 내용은 [`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)에 있습니다.

## 백업할 것

| 대상 | 담긴 것 | 백업 여부 |
| --- | --- | --- |
| PostgreSQL 데이터베이스 | 설치 환경이 저장하는 모든 것, 그리고 아직 해야 할 작업 | 예 |
| 오브젝트 스토리지 버킷 | 업로드된 모든 이미지 | 예, 데이터베이스 다음에 |
| 시크릿 암호화 키 | 저장된 모든 자격 증명을 봉인한 키 | 예, 데이터베이스와 따로 |
| 그 밖의 시크릿 | 역할 비밀번호, 서명 키, 프로세스가 공유하는 토큰 | 보관하세요. 각각 교체할 수 있습니다 |
| Valkey | 캐시와 카운터 | 아니요 |
| 검색 엔진의 인덱스 | 검색을 OpenSearch나 Elasticsearch에서 실행할 때의 카탈로그 사본 | 아니요. 데이터베이스에서 다시 빌드합니다 |

### 데이터베이스

데이터베이스에는 모든 테넌트, 모든 계정, 카탈로그, 모든 댓글과 구매, 그리고 플랫폼과 각 테넌트의 모든 설정이 들어 있습니다. 설치 환경이 아직 하지 않은 작업도 들어 있습니다. 아직 보내지 않은 메일과 푸시 알림, 그리고 Publira 자체 테이블 옆에 테이블을 두는 `publira worker`의 작업 큐입니다. 데이터베이스는 버킷보다 우선합니다. Publira에게 이미지는 어떤 행이 가리킬 때 존재하는 것입니다.

### 버킷

버킷에는 스태프가 업로드하는 모든 이미지(표지, 에피소드 페이지, 로고, 작가 사진)가 들어 있으며, 각 이미지는 `tenants/` 아래에 크기와 형식별로 하나씩, 여러 오브젝트로 저장됩니다. 데이터베이스의 행이 각 오브젝트를 키로 가리키며, Publira는 버킷에 그 밖의 것을 보관하지 않습니다.

### 시크릿 암호화 키

`PUBLIRA_SECRET_ENCRYPTION_KEYS`와 `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`는 설치 환경 어디에도 저장되지 않습니다. 데이터베이스에는 이 키로 봉인된 모든 자격 증명이 들어 있습니다.

- 플랫폼의 SMTP 비밀번호, 오브젝트 스토리지의 시크릿 키, 검색 엔진의 비밀번호, Web Push 개인 키.
- 각 테넌트 자체의 SMTP 비밀번호, 그리고 결제 제공자, App Store, Google Play, Firebase, Sign in with Apple, 수신 메일의 자격 증명.
- 2단계 인증을 켠 모든 테넌트 콘솔 관리자의 2단계 인증 시크릿.

키 없이 복원한 데이터베이스에는 모든 행이 있지만, 이 중 어느 것도 읽을 수 없습니다. 워커는 메일을 보낼 수 없고, 서버는 버킷에 접근할 수 없으며, 모든 테넌트가 자격 증명을 다시 입력해야 하고, 어느 관리자의 인증 앱도 2단계 인증을 통과하지 못합니다.

목록에 있는 모든 키를 보관하세요. 교체해서 더 이상 기본으로 쓰지 않는 키라도 아직 그 키로 봉인된 값이 있으면 보관해야 하며, 데이터베이스 백업과는 따로 보관하세요. 데이터베이스 사본과 키가 함께 있으면 설치 환경이 저장하는 모든 자격 증명을 손에 넣은 것과 같습니다.

### 백업이 필요 없는 것

- **Valkey**에는 이미지 변환 캐시, 요청 제한 카운터, 웹 앱의 캐시가 들어 있습니다. 그 안의 모든 항목은 데이터베이스와 버킷에서 다시 만들어지거나 저절로 만료되므로, 설치 환경은 빈 Valkey로 시작해도 아무것도 잃지 않습니다.
- **검색 엔진의 인덱스**는 검색을 OpenSearch나 Elasticsearch에서 실행할 때 데이터베이스에서 빌드되며, 복원 뒤에 [다시 빌드](#5-검색-인덱스-다시-빌드)합니다.
- **그 밖의 시크릿**은 각각 교체할 수 있습니다. 역할 비밀번호는 `publiractl db roles`로 다시 설정하고, 새 액세스 토큰 서명 키나 웹 앱 세션 키는 모든 사람을 한 번 로그아웃시킵니다. 캐시 재검증 토큰과 웹 서비스 토큰은 그것을 공유하는 프로세스 사이에서 일치하기만 하면 됩니다. 그래도 이 모두를 암호화 키와 함께 시크릿 저장소에 보관해 두면 그런 수고를 덜 수 있습니다.
- **프로세스의 이미지**는 실행하는 릴리스의 것을 다시 pull하거나, 직접 빌드한다면 다시 빌드합니다. 백업할 때마다 그 릴리스가 무엇인지 적어 두세요. 데이터베이스 백업은 그 백업을 받은 릴리스의 스키마로 복원합니다.

## 백업 받기

`publira worker`를 멈추고, 데이터베이스와 버킷을 순서대로 백업한 뒤, 워커를 다시 시작합니다. 키는 백업할 때마다 바뀌지 않습니다. 키를 생성하거나 교체할 때 별도의 안전한 곳에 복사해 두세요.

### 1. 워커 멈추기

데이터베이스 백업을 시작하기 전에 모든 `publira worker` 복제본을 멈추고, 버킷 복사가 끝날 때까지 멈춘 상태로 둡니다. 버킷에서 오브젝트를 삭제하는 것은 워커의 사용하지 않는 이미지 삭제와 독자의 만료된 데이터 다운로드 삭제뿐이며, 이를 멈춰 두면 데이터베이스 백업이 가리키는 오브젝트가 복사되기 전에 지워지는 일이 없습니다. 백업하는 동안에는 `publiractl job purge-orphan-images`나 `publiractl job purge-data-exports`도 실행하지 마세요.

설치 환경의 나머지는 계속 서비스합니다. 그동안 워커가 했을 일(메일, 푸시 알림, 캐시 재검증, 예약 시각이 된 에피소드 공개)은 데이터베이스에서 기다렸다가 워커가 다시 시작되면 바로 처리됩니다.

### 2. 데이터베이스 백업

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`은 [관리용 로그인](./2-installing.md#서비스-준비)의 연결이며, `pg_dump`는 PostgreSQL 서버와 같은 메이저 버전이거나 그보다 새로워야 합니다. `pg_dump`는 모든 테이블을 하나의 스냅샷에서 읽으므로, 프로세스가 계속 서비스하는 동안에도 백업은 일관성을 유지하며, 시작한 시점에 커밋된 내용을 담습니다.

`db version`은 데이터베이스의 스키마 버전을 출력하며, 이것이 백업을 복원할 릴리스입니다. `publira.version`과 릴리스의 태그를 백업과 함께 보관하세요.

관리형 PostgreSQL의 스냅샷도 같은 역할을 합니다. 스냅샷은 제공업체가 설명하는 방법으로 복원하며, 역할도 함께 담겨 있습니다.

### 3. 버킷 백업

`aws s3 sync`나 `rclone copy`처럼 버킷 전체를 복사하는 S3 클라이언트로 버킷의 모든 오브젝트를 다른 곳의 스토리지에 복사합니다. 복사 대상에서 아무것도 삭제하지 않는 복사 방식을 쓰고(두 도구 모두 삭제하지 않습니다), 매번 같은 대상에 복사하세요. 그래야 최신 백업뿐 아니라 보관하는 모든 데이터베이스 백업이 그곳에서 자신의 오브젝트를 찾을 수 있습니다. AWS CLI로 버킷 `publira-images`에서 디렉터리 `publira-bucket`으로 복사하는 예는 다음과 같습니다.

```bash
aws s3 sync s3://publira-images publira-bucket
```

두 백업이 서로 맞아떨어지는 것은 이 순서 덕분입니다. 업로드는 오브젝트를 먼저 쓰고 그다음 그것을 가리키는 행을 쓰며, 오브젝트는 다시 쓰이지 않으므로, 데이터베이스 백업의 행이 가리키는 모든 오브젝트는 그 백업이 시작될 때 이미 버킷에 있었습니다. 워커가 멈춰 있으면 복사가 닿기 전에 그중 어느 것도 삭제되지 않으므로, 버킷 백업에는 그 모든 오브젝트가 담깁니다.

워커를 복사가 끝날 때까지 멈춰 두어야 하는 이유도 여기에 있습니다. 데이터베이스 백업이 시작된 뒤에 교체된 이미지의 이전 오브젝트는 그 백업에서는 여전히 가리켜지지만, 실행 중인 데이터베이스에서는 어느 행도 가리키지 않습니다. 고아 이미지 삭제는 어느 행도 가리키지 않는 오브젝트를 삭제하므로, 복사 중에 삭제가 실행되면 복사가 닿기 전에 그 오브젝트를 지울 수 있고, 그러면 복원한 행은 버킷에도 그 백업에도 없는 오브젝트를 가리키게 됩니다.

버킷 백업에는 결국 데이터베이스 백업이 가리키는 것보다 많은 것이 담깁니다. 복사하는 동안 업로드된 모든 이미지와, 복사 대상을 처음 사용한 이후 교체된 모든 이미지입니다. 이는 공간만 차지할 뿐 다른 문제는 없습니다. 복원한 뒤에는 고아 이미지 삭제가 복원된 어느 행도 가리키지 않는 오브젝트를 삭제합니다.

순서를 반대로 복사하면 버킷 백업에는 두 백업 사이에 업로드된 모든 이미지가 빠지고, 데이터베이스 백업이 복원하는 그 이미지들의 행은 존재하지 않는 오브젝트를 가리킵니다. 그 이미지들은 사이트와 콘솔에서 깨진 상태로 표시됩니다.

### 4. 워커 시작

멈췄던 모든 복제본을 시작합니다. 워커는 멈춰 있는 동안 기다리던 것을 보내고, 그사이 예약 시각이 지난 모든 에피소드를 공개합니다.

## 빈 설치 환경에 복원하기

백업을 받은 릴리스에 그 릴리스의 `publiractl` 이미지로 복원합니다. 더 새로운 릴리스를 실행하려면 먼저 복원한 다음 [업그레이드](./8-upgrading.md)하세요.

[설치](./2-installing.md#서비스-준비)에서 설명하는 대로 서비스를 준비합니다. 같은 메이저 버전이거나 더 새로운 PostgreSQL 서버와 빈 데이터베이스, 빈 버킷, 빈 Valkey입니다. `db migrate`는 실행하지 마세요. 백업이 스키마를 함께 가져옵니다.

### 1. 데이터베이스 복원

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`은 전부 복원하거나 아무것도 복원하지 않습니다. 도중에 멈춘 복원은 실패 이후의 테이블이 빠진 상태가 아니라 빈 데이터베이스를 남깁니다. 이는 워커가 시작될 때 중요합니다. 워커는 어느 행도 가리키지 않는 모든 오브젝트를 버킷에서 삭제하기 때문입니다.

`--no-owner`와 `--no-acl`은 여섯 역할에 대한 권한 부여와 `publira_outbox`의 작업 큐 테이블 소유권을 제외하고, 목록은 `publira_rls_bypass`라는 이름의 정책을 제외합니다. 이 정책은 테넌트를 가로질러 작업하는 역할이 모든 테넌트의 행을 읽을 수 있게 합니다. 역할은 데이터베이스가 아니라 PostgreSQL 서버에 속하므로 새 서버에는 아직 없으며, 역할을 가리키는 모든 문이 실패하게 됩니다. 이것들을 빼면 모든 오브젝트는 관리용 로그인의 소유가 되고, 다음 단계에서 권한과 정책을 되돌려 놓습니다.

### 2. 역할 만들기

```bash
publiractl db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

설치할 때 [역할 만들기](./2-installing.md#2-역할-만들기)에서 실행하는 명령으로, 컨테이너가 `/run/secrets`에 마운트한 파일에서 각 비밀번호를 읽으며, 여기서도 같은 일을 합니다. 여섯 역할을 만들고 릴리스가 정의하는 권한을 부여하며, `publira_outbox`에 작업 큐의 테이블을 맡기고 다른 모든 역할이 그 테이블에 접근하지 못하게 하고, 모든 비밀번호를 설정합니다. 설치 환경이 쓰던 비밀번호를 쓰면 프로세스의 연결 URL은 그대로 동작하고, 새 비밀번호를 쓰면 URL을 갱신하세요.

### 3. 버킷 복원

버킷 백업의 모든 오브젝트를 같은 키로 새 버킷에 복사합니다. AWS CLI로 백업을 복사해 둔 디렉터리에서 복사하는 예는 다음과 같습니다.

```bash
aws s3 sync publira-bucket s3://publira-images
```

버킷의 이름, 주소, 자격 증명이 설치 환경에서 쓰던 것과 같다면 그 밖에 바꿀 것은 없습니다. 그렇지 않으면 `setup`이 이전 버킷을 저장했던 것처럼 새 버킷을 저장하고 테스트하세요.

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

Amazon S3 이외의 스토리지에는 `--endpoint`와 `--force-path-style`을 추가합니다. `storage set`의 모든 플래그는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)에 있습니다.

### 4. 프로세스 시작

`publira server`, `publira worker`, `web-storefront`, `web-admin`, 그리고 실행한다면 `web-platform`과 `email-renderer`를, 설치 환경에서 쓰던 암호화 키로 시작합니다. 그 밖의 시크릿은 보관해 둔 것이든, [시크릿 생성](./2-installing.md#시크릿-생성)에서 설명하는 대로 새로 설정한 것이든 상관없습니다.

빈 Valkey로 시작하세요. 복원 전에 설치 환경에 쓰이던 Valkey에는 복원으로 되돌려진 데이터에서 캐시된 페이지와 이미지가 들어 있어, 웹 앱은 각 항목이 만료될 때까지 그것을 계속 제공합니다. 그 Valkey가 다른 용도로 쓰이지 않는다면 `FLUSHALL`로 비우세요.

### 5. 검색 인덱스 다시 빌드

검색을 OpenSearch나 Elasticsearch에서 실행한다면, 복원한 데이터베이스에서 인덱스를 다시 빌드합니다.

```bash
publiractl search reindex
```

복원 뒤에도 남아 있는 인덱스는 백업 이후에 공개된 것을 여전히 찾아내고, 복원한 데이터베이스에 더 이상 없는 시리즈로 연결됩니다. 인덱스를 잃었다면 검색 결과는 비어 있습니다. 데이터베이스 자체를 쓰는 기본 검색에서는 다시 빌드할 것이 없습니다.

### 워커가 따라잡는 것

`publira worker`는 복원한 데이터베이스를 백업 시점부터 자신이 떠나 있던 데이터베이스처럼 다루며, 시작하자마자 따라잡습니다.

- **메일과 알림.** 백업 시점에 전송을 기다리던 모든 것이 전송되며, 푸시 알림과 캐시 재검증도 포함됩니다. 그중 일부는 백업 이후 설치 환경을 잃기 전에 이미 나갔으므로, 일부 독자와 스태프는 같은 메일을 한 번 더 받습니다.
- **예약 작업.** 백업 이후 예약 시각이 지난 모든 에피소드가 공개되고, 캐시된 페이지는 그사이 시작되거나 끝난 무료 열람 기간을 반영하며, 기한이 지난 고정 공지는 고정이 해제됩니다.
- **일일 재구축.** 열람 통계, 랭킹, 추천은 백업에 담긴 열람 활동을 바탕으로 백업 이후의 날짜마다 다시 구축됩니다.
- **고아 이미지 삭제.** 첫 번째 삭제는 복원된 어느 행도 가리키지 않는 오브젝트를, 만들어진 지 하루가 지나면 삭제합니다. 백업을 받은 뒤에 업로드된 이미지입니다.

### 복원으로 되돌아오지 않는 것

백업을 받은 뒤에 쓴 모든 것입니다. 독자가 만든 계정, 댓글, 업로드, 설정, 구매가 그렇습니다. 그동안 이루어진 구매는 결제 제공자나 App Store, Google Play가 이미 청구했지만 설치 환경에는 기록이 없으므로, 구매자는 더 이상 그 에피소드를 열 수 없습니다. 백업 시점부터 설치 환경을 잃은 시점까지 각 제공업체의 기록에서 찾아보세요.

## 복원 확인

- `db version`이 백업과 함께 `publira.version`에 보관한 버전을 보고하고, dirty 상태가 아닙니다.

  ```bash
  publiractl db version
  ```

- 모든 프로세스가 `GET /readyz`에 준비됨으로 응답합니다. `publira server`와 `publira worker`는 데이터베이스 로그인마다 하나의 검사를 보고하므로, 비밀번호가 연결 URL과 맞지 않는 역할이 있으면 거기에 나타납니다.
- `storage test`가 통과합니다. 이 명령은 데이터베이스에 봉인되어 있는 시크릿 키로 버킷에 접근하므로, 암호화 키가 올바르다는 것도 증명합니다.

  ```bash
  publiractl storage test
  ```

- 테넌트 콘솔에 로그인할 수 있고, 테넌트의 사이트가 이미지와 함께 열립니다. 시리즈의 표지와, 백업 직전에 업로드된 에피소드의 페이지를 확인하세요.

한 번도 복원해 보지 않은 백업은 백업이 아니라 희망일 뿐입니다. 가끔 예비 서비스에 백업을 복원하고, 이 목록을 확인해 보세요.

## Docker Compose 설치 환경의 경우

[Docker Compose](./3-docker-compose.md) 설치 환경은 데이터베이스를 `publira-deploy_postgres-data` 볼륨에, 버킷을 `publira-deploy_rustfs-data`에, 암호화 키와 그 밖의 모든 시크릿을 `.env`에 보관합니다. 모든 명령은 설치 환경을 실행하는 디렉터리에서 실행하세요. 릴리스 아카이브를 풀어 놓은 디렉터리이거나, 체크아웃이라면 `infra/deploy/`입니다.

### 백업 받기

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

워커는 [워커 멈추기](#1-워커-멈추기)에서 설명한 이유로 멈춥니다. 워커는 `server` 안에서 실행되므로 API도 함께 멈추며, `server`가 다시 시작될 때까지 테넌트의 사이트와 콘솔은 응답하지 않습니다. `-T`는 출력이 터미널을 거치지 않게 합니다. 터미널을 거치면 출력이 손상됩니다.

RustFS 이미지에는 S3 클라이언트가 없으므로, 버킷은 오브젝트 단위가 아니라 RustFS가 볼륨에 보관하는 파일 단위로 백업합니다. 파일을 복사하는 동안에는 RustFS를 멈춰야 합니다. 그렇지 않으면 아카이브에 쓰는 도중의 오브젝트가 담길 수 있습니다. Compose 파일은 RustFS 이미지의 버전을 고정하므로, 같은 릴리스의 Compose 파일로 복원하면 같은 RustFS로 아카이브를 복원합니다.

`publira.dump`, `publira.version`, `publira-bucket.tar.gz`를 호스트 밖으로 복사하고, 설치할 때 만든 `.env`의 사본은 호스트와도 이 파일들과도 다른 곳에 보관하세요.

### 복원

[Compose 파일 다운로드](./3-docker-compose.md#compose-파일-다운로드)에서 설명하는 대로 백업한 릴리스의 아카이브에서 풀어 낸 그 릴리스의 Compose 파일이 있는 호스트에서, `.env`를 `compose.yaml` 옆에 되돌려 놓은 뒤 다음을 실행합니다.

```bash
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c 'cat > /tmp/publira.dump' < publira.dump
docker compose exec -T postgres sh -c "pg_restore --list /tmp/publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > /tmp/publira.list"
docker compose exec -T postgres pg_restore -U postgres -d publira --no-owner --no-acl --single-transaction --use-list=/tmp/publira.list /tmp/publira.dump
docker compose exec -T postgres rm /tmp/publira.dump /tmp/publira.list
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose run --rm --no-deps -T --entrypoint tar rustfs -xzf - -C /data < publira-bucket.tar.gz
docker compose up -d
```

PostgreSQL은 처음 시작할 때 빈 `publira` 데이터베이스를 만들고, 복원이 그것을 채웁니다. 아카이브를 컨테이너 안으로 복사하는 것은 [데이터베이스 복원](#1-데이터베이스-복원)에서처럼 `pg_restore`가 `publira_rls_bypass` 정책을 제외할 수 있게 하기 위해서이며, `db roles`가 그 정책을 되돌려 놓습니다. 아카이브는 RustFS가 처음 시작되기 전에 버킷과 그 안의 모든 오브젝트를 담은 채 RustFS 볼륨에 들어갑니다. Valkey는 아무것도 보관하지 않으므로 빈 상태로 시작합니다.

이 명령들은 설치 환경의 두 볼륨이 아직 없는 호스트를 전제로 합니다. 호스트에 아직 남아 있는 설치 환경 위에 복원하려면, 먼저 `docker compose down -v`로 설치 환경과 볼륨을 제거하세요. 그러면 그 안의 모든 행과 이미지가 삭제되므로, 백업이 손에 있을 때만 실행하세요.

그다음 [복원 확인](#복원-확인)에서처럼 복원을 확인합니다. `publiractl`은 `docker compose run --rm publiractl db version`과 `docker compose run --rm publiractl storage test`로 실행하고, 버전을 `publira.version`과 비교하세요.

## 다음 단계

`db roles`, `storage`, `search reindex`가 하는 일과 그 모든 플래그는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)에 있습니다. 이전 릴리스로 복원한 뒤 업그레이드를 이어 가는 방법은 [업그레이드](./8-upgrading.md)에 있습니다.
