---
title: 업그레이드
description: 실행 중인 설치 환경을 새 릴리스로 올리는 과정을, 업그레이드 전의 백업부터 새 릴리스의 프로세스가 서비스를 시작할 때까지 설명합니다.
published: 2026-11-03
source_updated: 2026-10-24
---

릴리스는 프로세스가 기대하는 데이터베이스 스키마를 바꿀 수 있으므로, 설치 환경의 업그레이드는 새 이미지로 재시작하는 것만으로 끝나지 않습니다. 데이터베이스가 먼저입니다. 새 릴리스의 `publiractl` 이미지가 스키마와 데이터베이스 역할을 앞으로 진행시키고, 그다음에야 새 릴리스의 프로세스가 그 위에서 시작됩니다. 이 페이지에서는 그 순서와 각 단계를 확인하는 방법, 마이그레이션이 실패했을 때 할 일을 설명합니다.

이 단계는 [설치](./2-installing.md)에서 구성하는 것처럼 직접 운영하는 설치 환경을 기준으로 합니다. 리포지토리의 Compose 파일로 만든 설치 환경은 같은 단계를 자체 명령으로 실행하며, [Docker Compose 설치 환경의 경우](#docker-compose-설치-환경의-경우)에서 설명합니다.

## 시작하기 전에

### 릴리스 노트 읽기

각 릴리스는 리포지토리의 태그이며, 릴리스 노트와 함께 리포지토리의 [Releases](https://github.com/publira/publira/releases) 페이지에 게시됩니다. 지금 실행 중인 릴리스 다음부터 업그레이드할 릴리스까지, 모든 릴리스의 노트를 읽으세요. `db migrate`가 그 사이 모든 릴리스의 마이그레이션을 한 번의 실행으로 적용하므로 스키마만 보면 릴리스를 건너뛰어도 괜찮지만, 노트가 요구하는 작업은 아무것도 대신 해 주지 않습니다.

릴리스 노트는 **Upgrade notes**로 시작합니다. 여기에는 그 릴리스의 변경 중 운영자에게 무언가를 요구하는 것이 그 변경을 만든 풀 리퀘스트별로 모두 적혀 있고, 해당하는 것이 없으면 없다고 적혀 있습니다. 적히는 변경은 다음과 같습니다.

- **환경 변수의 추가, 이름 변경, 더 이상 읽지 않음.** 새 릴리스의 프로세스가 시작되기 전에 설정하세요.
- **새 데이터베이스 역할.** `db roles`에는 아직 존재하지 않는 역할의 비밀번호가 필요합니다. 설치할 때처럼 비밀번호를 생성해 그 역할의 플래그로 전달하세요.
- **엣지가 해야 하는 일의 변경.** 예를 들어 어떤 경로를 다른 프로세스로 라우팅하는 것입니다. 새 릴리스의 [엣지](./4-edge/index.md#엣지가-해야-하는-일)에 적힌 대로 자신의 엣지에도 같은 변경을 적용하세요. 엣지를 [샘플 구성](./4-edge/1-sample-configurations.md) 중 하나에서 가져와 고쳐 쓴 경우, `git diff <current tag> <new tag> -- infra/proxy/`로 샘플의 변경을 확인해 자신의 사본에 반영할 수 있습니다.
- **설치 환경이 실행해야 하는 프로세스나 서비스**로, 이전에는 실행하지 않던 것.
- **오래 걸리거나 사용량이 많은 테이블을 잠그는 마이그레이션.** 실행할 시점을 고를 수 있도록 적혀 있습니다.

이 중 무언가가 적히는 것은 메이저 릴리스뿐이며, `1.0.0` 이전에는 마이너 릴리스입니다. `1.0.0` 이전의 패치 릴리스도 이 페이지의 모든 단계를 실행합니다. 패치 릴리스에도 마이그레이션이 들어 있을 수 있고, 그 프로세스는 `db migrate`가 앞으로 진행시키지 않은 스키마에서는 실패하므로, 프로세스를 교체하기 전에 `db migrate`와 `db roles`를 실행합니다. 각 종류의 릴리스가 무엇을 바꿀 수 있는지, 어떤 릴리스가 수정을 받는지는 [릴리스](./10-releases.md)에서 설명합니다.

### 새 릴리스의 이미지 받기

무엇이든 바꾸기 전에 새 릴리스의 모든 이미지 `ghcr.io/publira/<name>:<new version>`을 그것을 실행할 호스트에 pull하세요. 그러면 마이그레이션 적용과 프로세스 재시작 사이의 시간은 프로세스가 시작되는 데 걸리는 시간뿐입니다. 직접 빌드한 이미지를 실행하는 설치 환경이라면, 새 릴리스의 이미지를 그 태그에서 자신의 변경을 반영해 빌드하고, 호스트가 pull하는 곳에 push하세요.

`publiractl`도 새 릴리스의 것을 사용합니다. `publiractl`에는 그 릴리스의 마이그레이션과 역할 정의가 들어 있으며, 릴리스의 프로세스에는 그 릴리스의 스키마가 필요하고 이전 스키마로는 안 됩니다.

이 페이지의 예는 `ghcr.io/publira/publiractl:<new version>`처럼 게시된 이미지를 사용합니다. 여기서 버전은 릴리스의 Git 태그에서 `v`를 뺀 것으로, `v0.2.0`이면 `0.2.0`입니다. 직접 빌드하는 설치 환경은 그 이미지 이름을 대신 사용합니다.

### 먼저 프로세스를 멈출지 결정하기

한 릴리스의 프로세스는 바로 다음 릴리스의 프로세스와 나란히 동작하므로, 다음 릴리스로의 업그레이드는 두 릴리스가 함께 실행되는 두 시점 모두에서 설치 환경의 서비스를 유지할 수 있습니다.

- **`db migrate`와 재시작 사이에는** 지금 실행 중인 릴리스의 프로세스가 새 릴리스의 스키마와 역할 위에서 서비스합니다. 릴리스는 이전 릴리스가 읽는 테이블, 열, 권한을 모두 유지하고 그것을 삭제하는 일은 이후 릴리스에 맡기므로, 그 프로세스가 하는 일은 실패하지 않습니다.
- **프로세스를 교체하는 동안에는** 두 릴리스의 웹 앱과 `publira server`가 서로를 호출합니다. 어느 순서로 교체하든, 복제본을 하나씩 교체하든, 어느 쪽을 롤백하든 마찬가지입니다. 두 릴리스의 워커는 아웃박스를 공유합니다. 지금 실행 중인 릴리스의 워커는 새 릴리스만 쓰는 종류의 항목을 새 릴리스의 워커가 보내도록 남겨 둡니다. 지금 실행 중인 릴리스가 이미 하던 일은 모두 계속 동작하고, 새 릴리스가 추가하는 기능은 양쪽 모두 새 릴리스를 실행하면 동작합니다.

이 보장은 지금 실행 중인 릴리스의 바로 다음 릴리스까지만입니다. 릴리스를 건너뛰면, 실행 중인 프로세스가 그 사이 릴리스에서 폐지된 열을 읽거나 API를 호출할 수 있으므로, 먼저 프로세스를 멈추거나 한 릴리스씩 업그레이드하세요.

실행 중인 프로세스는 백업을 받은 뒤에도 계속 씁니다. 그 뒤에 마이그레이션이 실패해 백업으로 되돌아가면, 백업 이후에 쓴 것은 모두 버려집니다. 그사이의 회원가입, 구매, 댓글, 편집이 모두 사라지며, 결제 제공자가 이미 청구한 구매도 포함됩니다.

백업 전에 프로세스를 멈추면 이를 피할 수 있습니다. 백업 뒤에 아무것도 쓰지 않으므로 백업에 모든 쓰기가 담깁니다. 대신 설치 환경은 백업부터 새 릴리스의 프로세스가 시작될 때까지 중단됩니다. 그런 쓰기를 잃을 수 없을 때는 언제나 먼저 멈추세요. 에피소드를 판매하는 설치 환경이라면 항상 그렇습니다.

## 업그레이드

### 1. 데이터베이스 백업

프로세스를 멈추기로 했다면, 지금 백업 전에 멈추세요.

`publiractl`은 스키마를 앞으로만 진행시키며, 한번 적용된 마이그레이션을 되돌리는 방법은 없습니다. 지금 받는 백업이 실행 중인 릴리스로 돌아가는 방법입니다.

```bash
pg_dump --format=custom --file=publira-before-upgrade.dump --dbname="$PUBLIRA_DB_URL"
```

`PUBLIRA_DB_URL`은 `db migrate`가 사용하는 [관리용 로그인](./2-installing.md#서비스-준비)의 연결이며, `pg_dump`는 PostgreSQL 서버와 같은 메이저 버전이거나 그보다 새로워야 합니다. 관리형 PostgreSQL의 스냅샷도 같은 역할을 합니다. 마이그레이션은 오브젝트 스토리지, Valkey, 시크릿을 전혀 바꾸지 않으므로, 마이그레이션 직전에 백업해야 할 것은 데이터베이스입니다. 새 릴리스가 한동안 서비스할 때까지 백업을 보관하세요.

### 2. 마이그레이션 적용

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db migrate
```

시작한 버전과, 끝나면 도달한 버전을 로그에 남깁니다.

```text
time=2026-11-20T09:41:02.118Z level=INFO msg=migrating from_version=20261006125036
time=2026-11-20T09:41:03.402Z level=INFO msg=migrated from_version=20261006125036 to_version=20261120093000
```

릴리스에 마이그레이션이 없으면 두 버전은 같으며, 그래도 0으로 종료합니다.

마이그레이션을 새 프로세스보다 먼저 실행하는 것은 프로세스가 시작할 때 스키마를 확인하지 않기 때문입니다. 이전 스키마에서 시작하면 정상으로 올라온 뒤, 릴리스가 추가한 테이블이나 열에 닿는 모든 요청에서 실패합니다.

### 3. 역할 최신화

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db roles
```

플래그 없이 실행하면 모든 역할이 비밀번호를 유지하고, 명령은 역할을 새 릴리스가 정의하는 상태로 맞추기만 합니다. 방금 마이그레이션이 만든 테이블에 대한 권한, 그리고 릴리스가 역할이 접근할 수 있는 범위에서 바꾼 그 밖의 것입니다. 역할마다 `publira_public: kept its password` 같은 줄을 하나씩 출력합니다. 건너뛰면 새 프로세스는 릴리스가 추가한 모든 테이블에서 권한 오류로 실패합니다.

릴리스가 역할을 추가하면, [역할 만들기](./2-installing.md#2-역할-만들기)에서처럼 그 역할의 `--<name>-password-file` 플래그로 비밀번호를 전달하세요. 전달하지 않으면 명령은 필요한 플래그를 알려 주며 종료하고 아무것도 만들지 않습니다.

### 4. 프로세스 교체

모든 프로세스를 새 릴리스의 이미지로, 릴리스 노트가 설정하라고 한 변수와 함께 다음 순서로 교체합니다.

1. **`email-renderer`**(실행하는 경우). 어느 릴리스의 워커든 렌더링할 템플릿을 찾을 수 있게 합니다.
2. **`publira worker`, `publira server`, `web-storefront`, `web-admin`**, 그리고 실행하는 경우 `web-platform`. 순서는 상관없고 원한다면 복제본을 하나씩 교체해도 됩니다. 오케스트레이터가 이들을 교체하는 동안에도 설치 환경은 계속 서비스합니다. 새 릴리스만 보내는 종류의 메일이나 알림은 새 워커의 복제본이 가져갈 때까지 아웃박스에서 기다립니다. 지금 실행 중인 릴리스의 복제본은 그런 항목을 한 번에 1분씩 미뤄 두므로, 그런 복제본이 마지막 하나까지 멈추면 항목은 1분 이내에 새 워커가 가져갈 수 있게 되고, 그 뒤에는 다른 항목처럼 전송됩니다. 워커는 시작할 때 자기 작업 큐의 마이그레이션을 적용하므로, 그 테이블에는 별도의 단계가 필요 없습니다.

`publira server --with-worker`를 실행하는 설치 환경도 복제본을 같은 방식으로, 원한다면 하나씩 교체합니다. 1단계에서 프로세스를 멈췄다면 모두 시작하세요.

### 5. 설치 환경 확인

- 모든 프로세스가 `GET /readyz`에 준비됨으로 응답합니다.
- `db version`이 릴리스의 최신 마이그레이션을 보고하고, dirty 상태가 아닙니다.

  ```bash
  docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<new version> db version
  ```

  ```text
  version 20261120093000
  dirty false
  ```

  버전은 새 태그의 `db/migrations/`에 있는 가장 새로운 파일 이름 앞부분의 타임스탬프입니다.

- 테넌트 콘솔에 로그인할 수 있고, 테넌트의 사이트가 열립니다.

## 마이그레이션이 실패했을 때

`db migrate`는 0이 아닌 값으로 종료하면서 PostgreSQL이 반환한 오류와 함께 `failed to migrate`를 로그에 남기고, `db version`은 dirty 상태를 보고합니다.

```text
version 20261120093000
dirty true
```

이때 데이터베이스의 상태는 다음과 같습니다.

- 실패한 마이그레이션 이전의 모든 마이그레이션은 적용되어 있으며, 적용된 채로 남습니다.
- PostgreSQL이 실패한 마이그레이션을 거부한 경우, 그 마이그레이션은 롤백됩니다. 마이그레이션 파일은 하나의 트랜잭션으로 실행되므로 그 안의 문은 하나도 남지 않습니다. 예외는 `CREATE INDEX CONCURRENTLY`로 인덱스를 만드는 마이그레이션으로, 이는 트랜잭션 밖에서 실행되므로 실패하면 그 이름의 유효하지 않은 인덱스를 남깁니다.
- 연결이 끊긴 경우에는 응답을 잃기 전에 실패한 마이그레이션이 커밋되었을 수도 있으며, `db migrate`는 어느 쪽인지 알 수 없습니다.
- 기록된 버전은 실패한 마이그레이션의 것이고 dirty로 표시되며, 이 표시가 지워질 때까지 `db migrate`는 다시 실행되지 않습니다.

실행 중이던 프로세스는 `db migrate`와 재시작 사이에 늘 그렇듯, 지금까지 적용된 마이그레이션 위에서 계속 실행됩니다. 그 위에서 새 릴리스의 프로세스를 시작하지 마세요.

### 원인을 해결한 뒤 다시 실행하기

로그를 보면 두 경우를 구분할 수 있습니다. PostgreSQL이 마이그레이션을 거부한 경우, `failed to migrate` 줄은 `(details: ERROR: canceling statement due to statement timeout (SQLSTATE 57014))`처럼 반환된 오류와 SQLSTATE로 끝납니다. 연결이 끊긴 경우에는 SQLSTATE 없이 네트워크 오류가 적힙니다.

디스크가 가득 찼거나 사용량이 많은 테이블을 기다리다 문이 시간 초과되는 것처럼, 마이그레이션 바깥의 원인으로 PostgreSQL이 마이그레이션을 거부했다면, 원인을 해결하고 기록을 실패한 마이그레이션의 바로 앞 마이그레이션으로 되돌린 뒤 `db migrate`를 다시 실행합니다.

1. 실패한 마이그레이션 바로 앞 마이그레이션의 버전을 찾습니다. 새 릴리스를 체크아웃한 디렉터리의 루트에서 다음을 실행하면 그 버전이 첫 줄에 출력됩니다.

   ```bash
   ls db/migrations | grep '\.up\.sql$' | grep -B1 '^20261120093000_'
   ```

   같은 목록은 GitHub에서 새 태그의 `db/migrations/` 아래에서도 볼 수 있습니다.

2. 실패한 마이그레이션이 인덱스를 `CONCURRENTLY`로 만드는 경우, 관리용 로그인으로 그 마이그레이션이 남긴 유효하지 않은 인덱스를 삭제합니다.

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <index name>;
   ```

3. 관리용 로그인으로 기록을 되돌립니다.

   ```sql
   UPDATE schema_migrations SET version = <previous version>, dirty = false;
   ```

4. `db migrate`를 다시 실행합니다. 실패한 마이그레이션부터 시작하며, 성공하면 [3단계](#3-역할-최신화)부터 이어 갑니다.

연결이 끊긴 경우에는 먼저 새 태그의 실패한 마이그레이션 `.up.sql` 파일을 읽고, 그 변경이 데이터베이스에 있는지 확인합니다. 마이그레이션은 하나의 트랜잭션으로 실행되므로, 변경은 전부 있거나 전혀 없습니다.

- **전혀 없음**: 마이그레이션은 롤백되었습니다. 위의 단계를 따르세요.
- **전부 있음**: 마이그레이션은 커밋되었습니다. 기록을 앞 마이그레이션이 아니라 실패한 마이그레이션 자체로 `UPDATE schema_migrations SET version = <failed version>, dirty = false;`로 설정하고, `db migrate`를 다시 실행해 그 뒤의 마이그레이션을 이어 갑니다.
- **판단할 수 없음**: 행만 바꾸고 확인할 흔적을 남기지 않는 마이그레이션처럼 판단할 수 없다면, 아래와 같이 실행하던 릴리스로 돌아가세요. 그런 마이그레이션을 두 번 실행하면 같은 행을 두 번 바꿀 수 있습니다.

### 실행하던 릴리스로 돌아가기

마이그레이션 자체에 문제가 있거나, 원인을 찾을 수 없거나, 적용되었는지 판단할 수 없을 때는 백업을 복원하고 실행하던 릴리스를 계속 실행합니다. 복원하면 백업 이후에 쓴 것은 모두 버려지므로, 업그레이드 중에도 프로세스가 계속 실행되었다면 그동안 쓴 것은 사라집니다. `db migrate`의 로그와 `db version`의 출력을 첨부해 [이슈](https://github.com/publira/publira/issues)로 실패를 보고해 주세요.

1. 프로세스를 멈춥니다. 프로세스가 연결을 잡고 있는 동안에는 데이터베이스를 삭제할 수 없습니다.
2. 데이터베이스를 삭제하고, 처음 만들 때와 같은 소유자와 설정으로 빈 데이터베이스를 다시 만듭니다.
3. 백업을 그 데이터베이스에 복원합니다.

   ```bash
   pg_restore --dbname="$PUBLIRA_DB_URL" publira-before-upgrade.dump
   ```

   역할은 데이터베이스가 아니라 PostgreSQL 서버에 속하므로 데이터베이스를 삭제해도 남아 있고, 백업에는 역할의 권한이 들어 있습니다.

4. 실행하던 릴리스의 프로세스를 시작합니다.

관리형 PostgreSQL의 스냅샷은 위의 단계 대신 제공업체가 설명하는 방법으로 복원합니다.

## Docker Compose 설치 환경의 경우

[Docker Compose](./3-docker-compose.md) 설치 환경은 위의 모든 단계를 `docker compose`로 실행합니다. 새 릴리스의 Compose 파일은 지금 설치 환경을 실행하는 디렉터리 옆의 별도 디렉터리에 둡니다. 1단계에서 그 디렉터리를 만든 뒤에는 모든 명령을 거기서 실행하세요. 프로젝트 이름이 고정되어 있으므로, `docker compose`는 어느 디렉터리에서든 같은 컨테이너와 볼륨에 접근합니다.

### 1. 새 릴리스 내려받기

지금 설치 환경을 실행하는 디렉터리가 들어 있는 디렉터리에서, `<current version>`과 `<new version>`을 두 릴리스의 버전(태그에서 `v`를 뺀 것)으로 바꿔 실행합니다.

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<new version>/publira-deploy-<new version>.tar.gz
tar -xzf publira-deploy-<new version>.tar.gz
diff publira-deploy-<current version>/.env.example publira-deploy-<new version>/.env.example
cp -p publira-deploy-<current version>/.env publira-deploy-<new version>/.env
cd publira-deploy-<new version>
```

diff는 새 릴리스가 Compose 파일에 추가했거나 더 이상 읽지 않는 변수를 모두 보여 줍니다. 새 변수는 `.env`에 추가하세요. 필수 변수가 비어 있으면 모든 `docker compose` 명령이 멈추고 그 변수의 이름을 알려 줍니다. 그다음 `.env`의 `PUBLIRA_IMAGE_TAG`를 새 버전으로 설정합니다. 이 값도 diff에 나타납니다. `cp -p`는 `.env`를 본인만 읽을 수 있는 상태로 유지하며, 이전 디렉터리에 남은 사본은 여전히 실행 중인 릴리스를 가리키므로 마이그레이션이 실패했을 때 돌아갈 방법이 됩니다.

릴리스 노트에 그 릴리스가 Compose 파일에서 서비스를 제거한다고 적혀 있으면, 그 서비스를 아직 가리키고 있는 이전 디렉터리에서 `docker compose stop <service>`로 멈추세요. 새 Compose 파일에는 그 서비스가 없으므로, 멈추지 않으면 [5단계](#5-새-릴리스-시작)에서 제거될 때까지 실행하던 릴리스의 서비스가 새 릴리스의 스키마에 대해 계속 실행됩니다.

체크아웃에서 실행하는 설치 환경은 대신 새 태그를 fetch해서 `infra/deploy/`에서 체크아웃하며, `diff` 대신 체크아웃 전에 `git diff <current tag> <new tag> -- .env.example`을 실행합니다. 그 `.env`는 추적되지 않으므로 그 자리에 그대로 남고, 릴리스가 제거하는 서비스는 체크아웃 전에 멈춥니다. 그런 설치 환경을 아카이브 방식으로 옮기려면, `publira-deploy-<current version>` 대신 그 `infra/deploy/`로 위의 단계를 진행하세요.

### 2. 이미지 받기

```bash
docker compose pull
docker compose pull publiractl
```

첫 번째 명령은 설치 환경이 실행하는 모든 프로세스의 이미지를 방금 설정한 버전으로 pull합니다. 두 번째 명령은 `publiractl`을 pull하는데, 계속 실행되는 프로세스가 아니어서 첫 번째 명령에서 빠지기 때문입니다. 빌드는 하지 않습니다.

직접 빌드한 이미지를 실행하는 설치 환경이라면, 대신 새 릴리스의 태그를 체크아웃해 자신의 변경을 반영한 이미지를 빌드하고 `PUBLIRA_IMAGE_REGISTRY`가 가리키는 곳에 push하세요. 호스트 자체에서 `task docker:verify:full`로 빌드한 이미지는 push할 필요가 없습니다.

### 3. 데이터베이스 백업

[프로세스를 멈추기로](#먼저-프로세스를-멈출지-결정하기) 했다면 먼저 멈춥니다. `web-platform`과 `email-renderer`를 실행한다면 그것도 지정하세요.

```bash
docker compose stop server web-storefront web-admin
```

그다음 백업을 받습니다.

```bash
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira-before-upgrade.dump
```

`-T`는 덤프가 터미널을 거치지 않게 합니다. 터미널을 거치면 덤프가 손상됩니다.

### 4. 마이그레이션 적용과 역할 최신화

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles
```

릴리스가 역할을 추가하면, 설치할 때처럼 `--<name>-password-file /run/secrets/<name>-db-password`로 비밀번호를 전달하고, `.env.example`의 diff에 나타난 변수를 `.env`에 설정하세요.

### 5. 새 릴리스 시작

```bash
docker compose up -d --remove-orphans
docker compose ps
```

`up -d`는 이미지나 설정이 바뀐 모든 컨테이너를 다시 만듭니다. 프록시는 이제 새 디렉터리의 `Caddyfile`을 마운트하므로 프록시도 포함됩니다. `--remove-orphans`는 새 릴리스의 Compose 파일에 더 이상 없는 서비스의 컨테이너를 제거합니다. 프록시가 받은 인증서는 `caddy-data` 볼륨에 남습니다.

체크아웃에서 실행하는 설치 환경은 `up -d` 뒤에 `docker compose restart proxy`도 실행합니다. 프록시는 `Caddyfile`을 단일 파일로 마운트하는데, `git checkout`은 그 파일을 같은 경로의 새 파일로 바꾸므로, 실행 중인 프록시는 실행하던 릴리스의 라우팅을 계속 읽기 때문입니다.

그다음 [5단계](#5-설치-환경-확인)에서처럼 설치 환경을 확인하며, `db version`은 `docker compose run --rm publiractl db version`으로 실행합니다. 확인이 끝나면 이전 디렉터리는 더 이상 필요 없습니다. 그 `.env`에는 설치 환경의 모든 시크릿이 들어 있으므로, 호스트에 두 번째 사본을 남기지 말고 디렉터리나 그 안의 `.env`를 삭제하세요.

### Compose에서 마이그레이션이 실패했을 때

[원인을 해결한 뒤 다시 실행하기](#원인을-해결한-뒤-다시-실행하기)의 SQL을 `postgres` 컨테이너의 `psql`을 통해 슈퍼유저로, 한 번에 한 문씩 실행합니다.

```bash
docker compose exec postgres psql -U postgres -d publira -c "UPDATE schema_migrations SET version = <previous version>, dirty = false"
```

대신 실행하던 릴리스로 돌아가려면 다음과 같이 합니다.

```bash
docker compose stop server web-storefront web-admin
docker compose exec postgres psql -U postgres -d postgres -c 'DROP DATABASE publira' -c 'CREATE DATABASE publira'
docker compose exec -T postgres pg_restore -U postgres -d publira < publira-before-upgrade.dump
cd ../publira-deploy-<current version>
docker compose up -d --remove-orphans
```

이전 디렉터리의 `.env`는 여전히 실행하던 릴리스를 가리키므로, `up -d`가 그 릴리스를 다시 시작하고 프록시도 이전 `Caddyfile`로 시작합니다. 체크아웃에서 실행하는 설치 환경은 `cd` 대신 `git checkout <current tag>`를 실행하고, `PUBLIRA_IMAGE_TAG`를 실행하던 릴리스로 되돌리며, `up -d` 뒤에 `docker compose restart proxy`를 실행합니다.

## 다음 단계

각 `db` 명령이 하는 일과 `db roles`의 모든 플래그는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)에, 릴리스 노트가 변수를 언급할 경우에 대비해 각 프로세스가 읽는 변수는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)에 있습니다.
