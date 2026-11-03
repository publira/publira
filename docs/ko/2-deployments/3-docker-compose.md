---
title: Docker Compose
description: 모든 릴리스가 게시하는 Compose 파일로 설치 환경 전체를 한 대의 호스트에서 실행하는 방법을, 파일 다운로드부터 테넌트 콘솔에 처음 로그인하기까지 설명합니다.
published: 2026-11-03
source_updated: 2026-10-28
---

모든 릴리스는 설치 환경 전체를 한 대의 호스트에서 실행하는 Compose 파일을 게시합니다. 이 파일에는 Publira가 의존하는 서비스, 설치 환경의 프로세스, 그 앞에 놓이는 리버스 프록시가 이미 서로 연결된 상태로 들어 있습니다. 동작하는 설치 환경을 얻는 가장 빠른 방법이며, 이 페이지에서는 빈 호스트에서 시작해 테넌트 콘솔에 처음 로그인하기까지 안내합니다.

Compose 파일은 [설치](./2-installing.md)와 같은 단계를 실행합니다. 각 단계가 왜 필요한지, 각 시크릿이 무엇을 보호하는지, 각 데이터베이스 역할이 어디에 접근할 수 있는지는 그 페이지에서 설명합니다. 이 페이지에서는 Compose 파일에 고유한 내용, 즉 무엇을 실행하는지, 무엇을 설정하는지, 가동에 쓰는 명령을 다룹니다. Compose 파일이 읽는 환경 변수의 전체 목록은 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)에 있습니다.

## 파일이 실행하는 것

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)은 다음 서비스를 정의합니다.

| 서비스 | 내용 | 호스트에 보관하는 것 |
| --- | --- | --- |
| `postgres` | 설치 환경이 저장하는 모든 것을 보관하는 PostgreSQL | `postgres-data` 볼륨 |
| `valkey` | 이미지 변환 캐시, 요청 제한 카운터, 웹 앱의 캐시를 보관하는 Valkey | 없음. 다시 시작할 때마다 빈 상태로 시작합니다 |
| `rustfs` | 업로드된 모든 이미지를 보관하는 S3 호환 오브젝트 스토리지 [RustFS](https://github.com/rustfs/rustfs) | `rustfs-data` 볼륨 |
| `proxy` | 저장소 자체의 라우팅을 갖춘 리버스 프록시 Caddy. 호스트 이름의 인증서를 발급받고 갱신합니다 | 인증서를 보관하는 `caddy-data` 볼륨 |
| `server` | [개요](./1-overview.md#설치-환경이-실행하는-것)에서 설명한 `publira server --with-worker`로, `publira server`와 `publira worker`를 하나의 프로세스로 실행합니다 | 없음 |
| `web-storefront`, `web-admin` | 공개 사이트와 테넌트 콘솔 | 없음 |
| `web-platform`, `email-renderer` | 켰을 때만 실행되는 선택 프로세스 | 없음 |
| `publiractl` | 명령줄 도구. 상시 실행되지 않으며 `docker compose run --rm publiractl <command>`로 실행합니다 | 없음 |
| `setup` | 설치 환경의 데이터베이스 비밀번호와 RustFS 버킷이 이미 지정된 `publiractl setup`. 상시 실행되지 않으며 `docker compose run --rm setup`으로 실행합니다 | 없음 |

서버와 워커를 하나의 프로세스로 실행하므로 호스트가 실행하는 컨테이너가 하나 줄어듭니다. 둘을 따로 확장하고 싶거나, 워커의 데이터베이스 로그인을 프록시가 요청을 전달하는 프로세스에서 떼어 두고 싶다면, 즉 둘 중 하나라도 설치 환경에 중요하다면 두 프로세스로 나누어 실행하세요. 두 프로세스가 각각 읽는 환경 변수는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)에 나와 있습니다.

프록시는 호스트의 모든 인터페이스에 포트 80과 443을 공개하며, 인터넷에서 접근할 수 있는 유일한 서비스입니다. 나열한 호스트 이름에 대해 HTTPS를 제공하고, 일반 HTTP는 HTTPS로 리디렉션합니다. 다른 서비스는 모두 서로 간에만 접근할 수 있습니다.

서비스는 두 개의 Docker 네트워크에 나뉘어 있습니다. `edge`에는 프록시와 프록시가 요청을 전달하는 `server`와 웹 앱이 있습니다. `default`에는 프록시를 제외한 모든 서비스가 있습니다. 따라서 프록시는 데이터베이스에도 Valkey에도 접근할 수 없으며, 프록시에 결함이 있더라도 그것이 둘 중 어느 쪽으로 들어가는 통로가 되지 않습니다.

프로젝트 이름은 `publira-deploy`로 고정되어 있으므로, 어느 디렉터리에서 어떤 명령을 실행하든 볼륨 이름이 유지되며, 한 대의 호스트는 하나의 설치 환경을 실행합니다.

## 시작하기 전에

다음이 필요합니다.

- **Docker Engine과 Compose 플러그인(`docker compose`)이 설치된 호스트**. 이미지가 게시되는 두 플랫폼인 `linux/amd64` 또는 `linux/arm64`여야 합니다. 그 밖의 플랫폼에서는 첫 이미지 가져오기가 `no matching manifest`로 실패하므로, [이미지](#이미지)에서 설명하는 대로 그 플랫폼용으로 빌드한 이미지를 실행해야 합니다.
- **설치하는 릴리스**. [Releases](https://github.com/publira/publira/releases) 페이지의 해당 릴리스에 `publira-deploy-<version>.tar.gz`로 첨부되어 있으며, [Compose 파일 다운로드](#compose-파일-다운로드)에서 가져옵니다. 호스트에는 저장소의 다른 파일이 필요하지 않습니다.
- **호스트에서 `ghcr.io`로의 접근**. 모든 릴리스가 여기에 이미지를 게시합니다. `docker compose`는 명령에 이미지가 처음 필요할 때 로그인 없이 가져오므로, 호스트에서 아무것도 빌드하지 않습니다.
- **SMTP 서버**. `publiractl setup`이 묻는 호스트, 포트, 암호화 방식, 메일 발신 주소, 그리고 로그인에 쓸 사용자 이름과 비밀번호가 필요합니다. 자격 증명 없이 중계하는 서버라면 사용자 이름과 비밀번호는 필요하지 않습니다.
- 테넌트의 도메인과 콘솔 호스트(`admin.<domain>` 또는 `--admin-domain`으로 지정할 호스트)의 **DNS**. 둘 다 이 호스트를 가리켜야 합니다.
- **인터넷에 열린 포트 80과 443**. 호스트에서 다른 무엇도 이 포트에서 대기하고 있으면 안 됩니다. 프록시가 두 포트 모두에서 응답하며, 인증 기관은 각 호스트 이름의 인증서를 발급하기 전에 두 포트 중 하나로 그 호스트 이름을 확인합니다.

## Compose 파일 다운로드

설치하는 릴리스의 아카이브를 다운로드합니다. `<version>`은 릴리스의 버전, 즉 태그에서 `v`를 뺀 것으로, `v0.1.0`이라면 `0.1.0`입니다. 그런 다음 압축을 풀고 풀린 디렉터리로 이동합니다.

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

이 디렉터리에는 `compose.yaml`, `.env.example`, 프록시의 `Caddyfile`, 그리고 환경 변수의 전체 목록이 담긴 `README.md`가 있습니다. 이 페이지의 모든 명령은 이 디렉터리에서 실행합니다.

코드를 변경한다면 대신 저장소를 릴리스의 태그로 체크아웃해 `infra/deploy/`에서 설치 환경을 실행하세요. 그곳에도 같은 파일이 있지만 `Caddyfile`은 `infra/proxy/`를 가리키는 링크이므로, `infra/deploy/`만 복사해 내지 말고 체크아웃 전체를 유지하세요.

## `.env` 작성

파일이 필요로 하는 값은 모두 그 옆의 `.env` 파일에서 가져옵니다. `publiractl env generate`는 파일이 읽는 모든 환경 변수를 각각 주석과 함께 나열한 `.env.example`을 바탕으로 `.env`를 작성하며, 모든 시크릿에 고유한 값을 채워 넣습니다. 설치하는 릴리스의 `publiractl` 이미지로 실행하세요. `<version>`은 [Compose 파일 다운로드](#compose-파일-다운로드)에서와 같이 릴리스의 버전입니다.

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

`Wrote .env with 17 secrets generated.`만 출력됩니다. 이미지가 여러분의 사용자로 실행되므로 파일의 소유자는 여러분이 되며, 파일은 여러분만 읽을 수 있도록 만들어집니다. 기존 `.env`는 설치 환경의 데이터를 봉인한 키를 담고 있을 수 있으므로, 이 명령은 기존 `.env`를 덮어쓰지 않습니다. 이 단계는 `docker compose run`으로 실행할 수 없습니다. 다음 세 절에서 설정하는 값이 `.env`에 없는 동안에는 `docker compose run`이 멈추기 때문입니다.

`.env`에는 암호화 키를 포함해 설치 환경의 모든 시크릿이 들어 있으므로, 사본을 호스트가 아닌 곳에 보관하세요.

직접 설정해야 하는 값이 세 개 남아 있습니다. 두 개의 호스트 목록 `PUBLIRA_EDGE_SITE_HOSTS`와 `PUBLIRA_EDGE_ADMIN_HOSTS`, 그리고 HTTPS를 켜는 `PUBLIRA_EDGE_ACME_EMAIL`입니다. 체크아웃에서 실행한다면 `PUBLIRA_IMAGE_TAG`가 네 번째 값입니다.

### 이미지

`PUBLIRA_IMAGE_REGISTRY`와 `PUBLIRA_IMAGE_TAG`는 이미지를 `<registry>/<name>:<tag>` 형태로 지정합니다. 예시의 레지스트리 `ghcr.io/publira`는 모든 릴리스가 이미지를 게시하는 곳이므로 그대로 두세요. 태그는 이미 다운로드한 릴리스의 버전으로 되어 있습니다. 예를 들어 `v0.1.0`의 아카이브라면 `0.1.0`입니다.

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

이 값도 그대로 두세요. 모든 이미지가 이 하나의 태그로 실행되며, 이 태그는 `.env` 옆의 파일과 일치해야 합니다. `publiractl`은 자기 릴리스의 마이그레이션을 담고 있고, 프로세스는 자기 릴리스의 스키마를 기대하며, 프록시는 옆에 있는 `Caddyfile`의 라우팅을 실행하기 때문입니다. 체크아웃에서는 `.env.example`의 태그가 비어 있으므로, 체크아웃한 릴리스의 버전을 설정하세요.

코드를 변경하거나 호스트가 `linux/amd64`도 `linux/arm64`도 아니라면, 대신 [이미지 빌드 안내](https://github.com/publira/publira/blob/main/infra/docker/README.md)에 따라 직접 이미지를 빌드하고 두 환경 변수를 이미지가 있는 곳으로 설정하세요. 이미지를 푸시하는 레지스트리의 주소(예: `registry.example.com/publira`)와 직접 정한 태그를 지정하거나, 호스트에서 `task docker:verify:full`로 빌드한 이미지라면 `publira`와 `local`을 지정합니다.

### HTTPS와 테넌트 URL 스킴

`PUBLIRA_EDGE_ACME_EMAIL`은 HTTPS를 켭니다. 여러분의 주소로 설정하세요. 프록시는 이 주소로 인증 기관에 계정을 등록합니다.

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

그러면 프록시는 호스트 목록에 있는 모든 호스트 이름의 인증서를 [Let's Encrypt](https://letsencrypt.org/)에서, Let's Encrypt가 실패하면 ZeroSSL에서 발급받고, 만료 전에 각 인증서를 갱신하며, 포트 443에서 HTTPS를 제공하고 포트 80의 일반 HTTP를 HTTPS로 리디렉션합니다. 이 값을 비워 두면 프록시는 일반 HTTP만 제공하며, 그렇게 해야 하는 것은 [한 대의 컴퓨터에서 시험해 보기](#한-대의-컴퓨터에서-시험해-보기)와 [앞에 CDN이나 로드 밸런서를 두는 경우](#앞에-cdn이나-로드-밸런서를-두는-경우)뿐입니다.

`PUBLIRA_EDGE_HTTP_PORT`와 `PUBLIRA_EDGE_HTTPS_PORT`는 프록시가 공개하는 포트로, `80`과 `443`입니다. 프록시가 인증서를 발급받는 동안에는 그대로 두세요. 인증 기관은 이 포트로만 프록시에 접속합니다.

브라우저가 HTTPS로 설치 환경에 접속한다면 `PUBLIRA_TENANT_URL_SCHEME`은 비워 두세요. 이는 Publira가 메일과 `setup` 요약에서 만드는 링크의 스킴입니다. [한 대의 컴퓨터에서 시험해 보기](#한-대의-컴퓨터에서-시험해-보기)처럼 브라우저가 실제로 HTTP로 설치 환경을 여는 경우에만 `http`로 설정하세요.

### 호스트 이름

`PUBLIRA_EDGE_SITE_HOSTS`와 `PUBLIRA_EDGE_ADMIN_HOSTS`는 프록시가 테넌트 사이트와 테넌트 콘솔로 라우팅하는 호스트 이름입니다. 테넌트의 도메인(예: `comics.example.com`)과 콘솔 호스트(`--admin-domain`으로 다른 호스트를 지정하지 않는다면 `admin.comics.example.com`)를 지정합니다. 이름에는 포트를 쓰지 마세요. 각 환경 변수는 공백으로 구분한 여러 이름을 테넌트마다 하나씩 받으며, 어느 쪽에도 없는 호스트에는 프록시가 자체적으로 404를 응답합니다.

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`는 플랫폼 콘솔용이며, 플랫폼 콘솔을 실행하지 않으면 비워 둡니다. `PUBLIRA_EDGE_IMAGE_HOSTS`에는 [이미지 호스트](../3-operations/2-tenants.md#이미지-호스트)에서 설명하는 대로 이미지 호스트를 지정한 테넌트마다 그 이미지 호스트를 넣으며, 지정하기 전까지는 비워 둡니다. 프록시는 이 호스트에서 `/images`만 전달합니다. `PUBLIRA_EDGE_ACME_EMAIL`을 설정하면 프록시는 네 환경 변수에 있는 모든 이름의 인증서를 발급받습니다.

### 시크릿

`env generate`가 다음 값을 채워 넣었으며, 각각 다른 어떤 설치 환경과도 공유하지 않는 새 값입니다.

| 환경 변수 | 생성된 값 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32바이트 난수의 hex |
| `PUBLIRA_PUBLIC_DB_PASSWORD`, `PUBLIRA_ADMIN_DB_PASSWORD`, `PUBLIRA_PLATFORM_DB_PASSWORD`, `PUBLIRA_OUTBOX_DB_PASSWORD`, `PUBLIRA_TICKER_DB_PASSWORD`, `PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32바이트 난수의 hex. 각각 하나씩 |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`과 32바이트 난수의 base64 |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`. 위 키 앞에 붙은 ID |
| `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`, `PUBLIRA_WEB_ADMIN_AUTH_SECRET`, `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`, `PUBLIRA_WEB_SERVICE_TOKEN` | 32바이트 난수의 base64. 각각 하나씩 |
| `PUBLIRA_REVALIDATE_TOKEN` | 32바이트 난수의 hex |
| `PUBLIRA_RUSTFS_ACCESS_KEY`, `PUBLIRA_RUSTFS_SECRET_KEY` | 32바이트 난수의 hex. 각각 하나씩 |

이 값들은 그대로 두세요. 데이터베이스 비밀번호는 이스케이프되지 않은 채 연결 URL에 들어가므로 hex로 되어 있으며, 대신 직접 설정하는 값도 URL에 안전한 문자만 사용해야 합니다. 첫 번째 값은 PostgreSQL 슈퍼유저의 비밀번호로, 이 사용자로 접속하는 것은 `publiractl setup`과 `publiractl db` 명령뿐입니다. 나머지 여섯 개는 `setup`이 프로세스가 접속에 쓰는 역할에 부여하는 비밀번호입니다. RustFS의 두 값은 오브젝트 스토리지 자체의 자격 증명입니다. RustFS는 이 자격 증명으로 시작하며, `setup`은 이를 Publira가 버킷에 접근할 때 쓰는 자격 증명으로 저장합니다. 나머지가 무엇을 보호하는지는 [시크릿 생성](./2-installing.md#시크릿-생성)에 나와 있습니다.

### `docker compose`를 멈추게 하는 것

`PUBLIRA_IMAGE_TAG`와 두 호스트 목록은 필수이며, `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`을 제외한 모든 시크릿도 필수입니다. 이 중 하나라도 비어 있으면 `run`을 포함한 모든 `docker compose` 명령이 아무것도 시작하기 전에 멈추고, 누락된 각 환경 변수의 이름을 그 변수를 읽는 서비스마다 한 번씩 출력합니다.

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`은 비어 있어도 `docker compose`를 멈추지 않습니다. 대신 프록시가 일반 HTTP를 제공합니다. 파일의 나머지 값도 비워 둘 수 있습니다. `PUBLIRA_TENANT_URL_SCHEME`, `COMPOSE_PROFILES`, `PUBLIRA_EDGE_PLATFORM_HOSTS`, `PUBLIRA_EDGE_IMAGE_HOSTS`, [앞에 CDN이나 로드 밸런서를 두는 경우](#앞에-cdn이나-로드-밸런서를-두는-경우)에만 채우는 `PUBLIRA_EDGE_TRUSTED_PROXIES`, 그리고 선택 프로세스를 켤 때 다음 절에서 채우는 선택 프로세스의 환경 변수입니다.

`docker compose`를 실행하는 셸에서 export한 환경 변수는 `.env`의 같은 변수보다 우선합니다. `.env`에 쓴 값이 무시되는 것 같다면 셸 환경에 `PUBLIRA_*` 환경 변수가 있는지 확인하세요.

## 선택 프로세스 고르기

선택 프로세스는 `COMPOSE_PROFILES`에 쉼표로 구분된 목록으로 지정했을 때 실행됩니다. 각 프로세스에는 `.env`에서 아래 표에 나온 환경 변수도 설정해야 합니다.

| 프로필 | 추가되는 것 | `.env`에 추가로 설정할 것 |
| --- | --- | --- |
| `email-renderer` | 모든 메일의 HTML 파트 | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | 플랫폼 콘솔 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`, 운영자가 플랫폼 콘솔을 여는 주소(예: `https://platform.example.com`)로 설정한 `PUBLIRA_PLATFORM_APP_URL`, 그 주소의 호스트 이름(예: `platform.example.com`)으로 설정한 `PUBLIRA_EDGE_PLATFORM_HOSTS`. 세션 키 `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`은 `env generate`가 이미 채워 넣었습니다 |

예를 들어 둘 다 실행하려면 다음과 같이 설정합니다.

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`은 해당 프로필이 실행될 때만 의미가 있으므로 비어 있어도 `docker compose`가 멈추지 않지만, 이 값이 없으면 어떤 운영자도 플랫폼 콘솔에 로그인할 수 없으므로 `env generate`가 쓴 값을 그대로 두세요. 플랫폼 콘솔의 호스트 이름도 이 호스트를 가리키는 DNS가 필요하며, `PUBLIRA_EDGE_ACME_EMAIL`을 설정했다면 프록시가 다른 인증서와 함께 그 인증서도 발급받습니다.

이 프로세스들은 지금 골라도 되고 나중에 골라도 됩니다. 이미 실행 중인 설치 환경에서 하나를 켜려면 `COMPOSE_PROFILES`에 추가하고, 그 환경 변수를 설정한 다음 `docker compose up -d`를 다시 실행하세요. 새 프로세스가 시작되고 환경 변수가 바뀐 프로세스가 다시 시작됩니다. 각 프로세스가 실행된 뒤 하는 일은 [선택 프로세스 켜기](./2-installing.md#선택-프로세스-켜기)에서 설명합니다.

## 설치 환경 가동

각 단계를 압축을 푼 디렉터리에서 이 순서대로 실행합니다.

### 1. 설치 환경 설정

```bash
docker compose run --rm setup
```

첫 명령은 필요한 이미지를 가져오고, PostgreSQL과 RustFS를 시작한 뒤 둘 다 응답할 때까지 기다립니다. 그런 다음 `setup`은 빈 데이터베이스에서 시작해 관리자가 로그인할 수 있는 테넌트까지 설치 환경을 한 단계씩 만들며, 각 단계가 끝날 때마다 출력합니다.

1. 마이그레이션을 적용하고, `.env`의 비밀번호로 여섯 개의 데이터베이스 역할을 만듭니다. Compose 파일은 비밀번호를 파일로 전달하므로 비밀번호가 명령줄에 나타나지 않습니다.
2. RustFS에 `publira`라는 이름의 버킷을 만들고, 테스트를 통과하면 `.env`의 RustFS 자격 증명과 함께 저장합니다.
3. 나머지는 모두 터미널에서 묻습니다. 플랫폼의 기본 로케일, 시간대, 통화, SMTP 설정, Web Push 설정 여부, 테넌트의 이름과 도메인, 첫 관리자입니다. 각 단계는 [설치 환경 설정](./2-installing.md#4-설치-환경-설정)에서 설명합니다.

테넌트 사이트 도메인을 물으면 `PUBLIRA_EDGE_SITE_HOSTS`에 나열한 도메인(예: `comics.example.com`)을 입력하세요. 테넌트 콘솔 도메인을 물으면, `PUBLIRA_EDGE_ADMIN_HOSTS`에 `admin.<domain>`을 나열했다면 비워 두고, 그렇지 않다면 나열한 이름을 입력하세요.

마지막의 요약에는 테넌트 사이트와 테넌트 콘솔이 표시되고, `setup`이 관리자의 비밀번호를 생성한 경우에는 그 비밀번호가 출력됩니다. 비밀번호가 표시되는 곳은 여기뿐이므로 터미널을 닫기 전에 보관해 두세요.

연결 테스트가 실패하거나 Ctrl+C를 눌러 실행이 중간에 멈추면 같은 명령을 다시 실행하세요. 끝난 단계는 그대로 유지하고 나머지만 묻습니다. 설정이 끝난 설치 환경에서 실행하면 아무것도 바뀌지 않습니다.

단, 테스트 메시지가 거부된 경우는 예외입니다. `setup`은 테스트를 보내기 전에 SMTP 설정을 저장하므로, 다음 실행에서는 그 설정을 유지한 채 테스트를 보내지 않습니다. 잘못된 설정이 있다면 먼저 `docker compose run --rm publiractl smtp set`으로 고치세요. 이 명령은 [변경](../3-operations/6-email.md#변경)에서 설명하는 대로, 저장된 모든 설정을 주어진 플래그로 바꿉니다. 설정이 올바르고 SMTP 서버에 접속할 수 없었을 뿐이라면 설정은 그대로 두세요. `docker compose run --rm publiractl smtp test --to operator@example.com`으로 테스트를 보내고, 발송되면 `docker compose run --rm setup`을 다시 실행해 SMTP 이후의 단계를 마무리합니다.

### 2. 설치 환경 시작

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`는 먼저 `server`를 시작하고, `server`가 준비 완료로 응답하고 Valkey가 정상이 되면 웹 앱을, `web-storefront`와 `web-admin`이 준비 완료로 응답하면 프록시를 시작하며, 모든 것이 시작되면 반환됩니다. `docker compose ps`는 설치 환경의 모든 서비스를 실행 중으로 표시하고, `server`, 웹 앱, `email-renderer`는 `healthy`로도 표시합니다. `publiractl`과 `setup`은 명령 하나를 위해서만 실행되므로 목록에 나오지 않습니다. 어떤 것도 `web-platform`과 `email-renderer`를 기다리지 않으므로, 두 서비스 모두 명령이 반환된 뒤 몇 초 동안은 `health: starting`으로 표시될 수 있습니다. 계속 다시 시작되는 프로세스나 `unhealthy`가 된 프로세스의 원인은 `docker compose logs <service>`에 나옵니다.

`server`가 시작하자마자 종료되거나 시작 후 1분 30초가 지나도 준비가 되지 않으면, `docker compose up -d`는 `publira-deploy-server-1`이 unhealthy이거나 종료되었다는 `dependency failed to start` 오류와 함께 멈추고, 웹 앱과 프록시는 시작하지 않습니다. 원인은 `docker compose logs server`에 나옵니다. `setup`이 만들지 않은 역할이나 비밀번호가 `.env`와 일치하지 않는 역할은 시도한 로그인과 함께 `failed to initialize db`로 기록됩니다. 실행은 되지만 준비가 되지 않은 `server`는 [헬스 체크](../3-operations/11-monitoring.md#헬스-체크)에서 설명하는 대로, 실패한 검사를 `readiness check failed` 줄로 기록합니다. 원인을 고친 다음 `docker compose up -d`를 다시 실행하세요.

`PUBLIRA_EDGE_ACME_EMAIL`을 설정했다면 프록시는 시작하면서 인증서를 요청하고, `docker compose logs proxy`에 호스트 이름마다 한 번씩 `certificate obtained successfully`가 출력됩니다. 인증서를 받지 못한 이름은 인증 기관이 밝힌 이유와 함께 `could not get certificate from issuer`로 기록됩니다. 가장 흔한 원인은 DNS가 아직 이 호스트를 가리키지 않거나 포트가 인터넷에 닫혀 있는 것입니다. 프록시가 스스로 계속 재시도하므로 원인만 고치면 됩니다.

### 3. 로그인

`setup` 요약에 출력된 테넌트 콘솔 URL, 즉 `https://admin.<domain>` 또는 지정한 콘솔 호스트를 열고, 관리자의 이메일 주소와 비밀번호로 로그인합니다. 테넌트 콘솔은 `setup`이 만든 테넌트로 열리며, 테넌트의 공개 사이트는 `https://<domain>`에서 응답합니다.

플랫폼 콘솔을 켰다면 `PUBLIRA_PLATFORM_APP_URL`을 열고 설정 화면에서 첫 운영자를 만드세요. 플랫폼 콘솔의 계정은 테넌트 관리자의 계정과 별개입니다.

## 한 대의 컴퓨터에서 시험해 보기

DNS나 인증서 없이 자신의 컴퓨터에서 설치 환경을 시험해 보려면 `.localhost` 아래의 호스트 이름을 사용하세요. Chromium 기반 브라우저와 Firefox는 모든 `.localhost` 이름을 컴퓨터 자신으로 보내고, 일반 HTTP여도 안전한 것으로 취급하므로 로그인할 때 설정되는 세션 쿠키를 유지합니다. 다른 호스트 이름에서 일반 HTTP를 쓰면 로그인은 성공한 것처럼 보이지만, 다음 페이지를 열면 로그인 화면으로 돌아갑니다.

1. `.env`에 `PUBLIRA_TENANT_URL_SCHEME=http`를 설정하고 `.localhost` 이름을 나열합니다. `PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`와 `PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`, 그리고 플랫폼 콘솔을 실행한다면 `PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`입니다. `PUBLIRA_EDGE_ACME_EMAIL`은 비워 두세요. 어떤 인증 기관도 `.localhost` 이름에 접속할 수 없으므로 프록시는 일반 HTTP를 제공합니다.
2. 위의 1단계와 2단계를 따르고, `setup`에 테넌트 도메인으로 `comics.localhost`를 입력합니다.
3. `http://admin.comics.localhost`를 열어 로그인합니다.

테넌트 사이트는 `http://comics.localhost`에서 응답하며, `PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`로 플랫폼 콘솔을 켰다면 플랫폼 콘솔은 그 주소에서 응답합니다.

프록시는 일반 HTTP를 제공하는 동안에도 포트 443을 공개하므로, 컴퓨터에서 이미 무언가가 두 포트 중 하나에서 대기하고 있으면 `docker compose up`이 프록시를 시작하지 못합니다. 포트 443이라면 `PUBLIRA_EDGE_HTTPS_PORT`를 `8443` 같은 다른 빈 포트로 설정하세요. 시험 환경에서는 이 포트를 쓰지 않으므로 다른 것은 바뀌지 않습니다. 포트 80이라면 `PUBLIRA_EDGE_HTTP_PORT`를 `8080` 같은 다른 포트로 설정하고, 위의 모든 주소에 그 포트를 덧붙이세요. 그러면 `setup`에 입력하는 테넌트 도메인은 `comics.localhost:8080`이 되고, 콘솔은 `http://admin.comics.localhost:8080`에서 열립니다. 브라우저가 80이나 443이 아닌 포트로 설치 환경에 접속할 때는 항상 포트가 도메인의 일부가 되지만, 프록시가 나열하는 이름에는 포함되지 않습니다.

이 방법은 시험용으로만 사용하세요. 브라우저와 호스트 사이에서 오가는 것은 아무것도 암호화되지 않으며, 프록시는 컴퓨터 자신뿐 아니라 컴퓨터의 모든 인터페이스에서 응답합니다.

## 앞에 CDN이나 로드 밸런서를 두는 경우

플랫폼의 CDN이나 로드 밸런서가 대신 설치 환경의 TLS를 종단한다면, `PUBLIRA_EDGE_ACME_EMAIL`을 비워 두고 브라우저가 보낸 `Host` 헤더를 유지한 채 프록시의 포트 80으로 전달하게 하세요. 프록시는 이 헤더로 테넌트 사이트, 테넌트 콘솔, 플랫폼 콘솔 중 어디로 보낼지 정하고, Publira는 이 헤더로 테넌트를 정합니다. 홉이 HTTPS로 프록시에 접속한다면, 인증 기관이 각 호스트 이름의 포트 80이나 443으로 여전히 프록시에 접속할 수 있는 한 이 값을 설정한 채로 두어도 됩니다.

이때 프록시는 모든 요청을 홉의 주소로 기록하므로, 감사 로그에는 모든 사람이 같은 주소로 표시되고, Publira가 클라이언트 주소별로 적용하는 제한을 모든 독자가 공유하게 됩니다. 대신 독자의 주소를 기록하려면, 홉이 `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`를 직접 설정하게 하고, `.env`의 `PUBLIRA_EDGE_TRUSTED_PROXIES`에 홉이 접속해 오는 주소나 CIDR 범위를 공백으로 구분해 설정하세요. 이 범위는 홉의 제공업체가 공개합니다. 그런 다음 `docker compose up -d proxy`를 실행해 이 설정으로 프록시를 다시 만듭니다. 홉을 신뢰한다는 것이 무엇을 뜻하는지는 [프록시 앞의 홉](./4-edge/1-sample-configurations.md#프록시-앞의-홉)에서 설명합니다.

프록시는 신뢰하는 홉이 보내는 `X-Forwarded-CountryRegion`도 전달합니다. 이 헤더는 [독자의 지역](./4-edge/index.md#독자의-지역)에서 설명하는 대로 독자의 지역을 테넌트의 Google tag gateway에 전달합니다. 독자의 지역을 조회하는 홉이라면 이 헤더를 설정하게 하고, 조회하지 않는 홉이라면 이 헤더를 제거하게 해서, 독자가 원하는 지역을 마음대로 지정할 수 없게 하세요.

## 한 대의 호스트로는 얻을 수 없는 것

Compose 파일은 완전한 설치 환경이지만, 모든 구성 요소가 한 대의 컴퓨터에 있습니다.

- **이중화가 없습니다.** 각 프로세스는 하나씩만 실행됩니다. Docker는 종료된 프로세스를 다시 시작하고, 호스트가 재부팅되면 설치 환경 전체를 다시 시작하지만, 호스트가 중단된 동안에는 모든 테넌트의 사이트도 중단됩니다.
- **데이터베이스와 이미지가 하나의 디스크를 공유합니다.** PostgreSQL과 RustFS는 호스트 자체 디스크의 `publira-deploy_postgres-data`와 `publira-deploy_rustfs-data` 볼륨에 데이터를 보관합니다. 디스크가 고장 나면 둘 다 잃게 되므로 둘 다 백업하고 `.env`도 함께 백업하세요. `.env`의 암호화 키가 없으면 SMTP 비밀번호를 비롯해 설치 환경이 저장한 모든 자격 증명을 읽을 수 없습니다. Valkey에는 백업이 필요한 것이 없으며, `publira-deploy_caddy-data` 볼륨도 마찬가지입니다. 이 볼륨이 비어 있으면 프록시가 인증서를 다시 발급받습니다. 명령은 [백업과 복원](./9-backup-and-restore.md#docker-compose-설치-환경의-경우)에 있습니다.
- **`docker compose down -v`는 데이터를 삭제합니다.** `-v`는 볼륨을 삭제하며, 그와 함께 모든 행과 모든 이미지가 삭제됩니다. 데이터를 유지한 채 설치 환경을 멈추려면 `-v`를 빼세요.

설치 환경이 한 대의 호스트로 감당할 수 없을 만큼 커지면, 같은 프로세스를 다른 곳에 있는 관리형 PostgreSQL과 S3 호환 오브젝트 스토리지에 연결해 실행합니다. 그런 설치 환경을 단계별로 가동하는 방법은 [설치](./2-installing.md)에서, 어느 프로세스를 더 실행해야 하고 무엇을 공유해야 하는지는 [스케일 아웃](./7-scaling-out.md)에서 설명합니다.

## 다음 단계

테넌트를 추가할 때는 그 도메인과 콘솔 호스트를 `.env`의 호스트 목록에 추가하고 `docker compose up -d proxy`를 실행하세요. 프록시가 두 이름을 라우팅하고, `PUBLIRA_EDGE_ACME_EMAIL`을 설정했다면 두 이름의 인증서를 발급받습니다. DNS부터 시작하는 순서는 [테넌트 추가](./4-edge/index.md#테넌트-추가)에 나와 있습니다.

이후 릴리스가 나올 때마다 [업그레이드](./8-upgrading.md#docker-compose-설치-환경의-경우)에 따라 설치 환경을 올립니다. 릴리스 다운로드, 백업, 마이그레이션, 새 이미지로 다시 시작하는 과정을 다룹니다.

Compose 파일이 읽는 환경 변수의 전체 목록과 저장소가 이 파일에 대해 실행하는 검사는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)에 있습니다.
