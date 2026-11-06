---
title: 샘플 구성
description: 엣지가 해야 하는 일을 수행하는 저장소의 Traefik, nginx, Caddy 샘플 구성과, 이를 설치 환경에 맞게 고치는 방법을 설명합니다.
published: 2026-11-03
updated: 2026-11-06
source_updated: 2026-11-06
---

저장소에는 [엣지가 해야 하는 일](./index.md#엣지가-해야-하는-일)의 요구 사항대로 요청을 라우팅하고 헤더, 본문, 타임아웃을 처리하는 리버스 프록시의 샘플 구성이 세 가지 들어 있습니다. Traefik, nginx, Caddy용이 각각 하나씩입니다. 요구 사항 중 하나는 샘플을 실행하는 설치 환경의 몫으로 남습니다. 바로 TLS 리스너로, Traefik과 nginx 샘플은 이를 여러분이 추가하도록 남겨 두며, Caddy 샘플은 HTTPS로 제공할 호스트 이름이 주어지면 직접 추가합니다. 이 샘플들은 예시일 뿐 엣지의 정의가 아닙니다. [Docker Compose](../3-docker-compose.md) 설치 환경은 Caddy 샘플을 실행하며, 직접 프록시를 운영하는 설치 환경은 어느 샘플에서든 시작할 수 있습니다. 관리형 로드 밸런서, Ingress, Gateway로 구성한 엣지는 그 요구 사항을 따르면 되며 샘플은 필요하지 않습니다. [Kubernetes의 엣지](../5-kubernetes/1-edge.md)에서는 이를 충족하는 Gateway와 Ingress를, [ECS 앞의 CloudFront](../6-ecs-fargate/1-cloudfront.md)에서는 Application Load Balancer 앞의 CloudFront를 소개합니다.

| 프록시 | 파일 | 백엔드 주소를 쓰는 곳 | 인증서를 직접 발급받는지 |
| --- | --- | --- | --- |
| Traefik | [`infra/proxy/traefik/`](https://github.com/publira/publira/tree/main/infra/proxy/traefik) | `dynamic/services.yaml` | 예. 추가한 ACME 리졸버로 발급받습니다 |
| nginx | [`infra/proxy/nginx/`](https://github.com/publira/publira/tree/main/infra/proxy/nginx) | `upstreams.conf` | 아니요 |
| Caddy | [`infra/proxy/caddy/Caddyfile`](https://github.com/publira/publira/blob/main/infra/proxy/caddy/Caddyfile) | `PUBLIRA_UPSTREAM_*` 환경 변수 | 예. `PUBLIRA_EDGE_TLS_HOSTS`에 있는 호스트 이름의 인증서를 발급받습니다 |

실행하는 샘플의 파일은 설치하는 릴리스에서 가져오세요. 세 샘플이 공유하는 내용은 [라우팅 계약](https://github.com/publira/publira/blob/main/infra/proxy/README.md)에 규칙별로 나와 있습니다.

## 각 샘플이 하는 일

- **라우팅.** 각 샘플은 [호스트 목록](#호스트-목록)에서 설명하는 방식으로 주어진 네 목록의 호스트 이름을 라우팅하고, 각 호스트에 [라우팅](./index.md#라우팅)의 경로 규칙을 적용하며, 나머지 `/rpc`에는 자체적으로 404를 응답합니다. 테넌트의 이미지 호스트에서는 `/images`만 전달하고, [테넌트의 이미지 호스트](./index.md#테넌트의-이미지-호스트)가 맡겨 둔 대로 그 밖의 모든 경로에 자체적으로 404를 응답합니다. 어느 목록에도 없는 호스트는 아무 데도 도달하지 않습니다. 샘플은 그 호스트의 모든 경로에 자체적으로 404를 응답합니다. 이는 샘플이 정한 방식일 뿐 Publira가 요구하는 것이 아닙니다.
- **클라이언트 주소.** Traefik은 `X-Forwarded-For`를 설정하고, `strip-forwarded` 미들웨어로 `Forwarded`를 제거합니다. nginx와 Caddy는 `Forwarded`를 클라이언트 주소만으로 설정하고 `X-Forwarded-For`를 제거합니다. 어느 샘플 뒤에서든 `PUBLIRA_FORWARDED_HEADER_ENABLED`는 활성화된 채로 두세요.
- **호스트.** 모든 샘플은 `Host`를 그대로 전달하고, `X-Forwarded-Host`와 `X-Forwarded-Proto`는 호출자의 값을 전달하지 않고 직접 설정합니다. 단, 신뢰하는 [앞단의 홉](#프록시-앞의-홉)이 있는 경우는 예외입니다.
- **트레이스 컨텍스트.** 모든 샘플이 세 헤더를 제거합니다. Traefik은 `strip-trace-context` 미들웨어로 제거하며, 모든 엔트리 포인트에 `strip-forwarded`와 함께 이 미들웨어가 필요합니다.
- **독자의 지역.** 어느 샘플도 직접 지역을 조회하지 않으므로, 각 샘플은 모든 요청에서 `X-Forwarded-CountryRegion`을 제거합니다. 단, 신뢰하는 [앞단의 홉](#프록시-앞의-홉)에서 온 요청은 예외로, 그 값을 전달합니다. Traefik은 `web-storefront-trusted-hop`을 제외한 모든 라우터에 `strip-country-region` 미들웨어를 두어 이를 처리하므로, 라우터를 추가할 때도 이 미들웨어가 필요합니다.
- **업로드와 웹훅.** Traefik과 Caddy는 직접 추가하지 않는 한 본문 크기를 제한하지 않습니다. nginx는 기본적으로 1 MB를 넘는 본문을 거부하며, 샘플은 콘솔 호스트의 `/api/v1/episode-pages`와 `/api/v1/series-import`에서 이를 `256m`으로, 그 밖의 `/api/v1/` 아래에서 `33m`으로, 페이지 경로에서 `11m`으로 올립니다. Traefik은 따로 지정하지 않으면 60초 안에 전체가 도착하지 않은 요청을 끊으며, 이 설정은 경로별이 아니라 엔트리 포인트별이므로 샘플은 `transport.respondingTimeouts.readTimeout`으로 `web` 엔트리 포인트의 모든 요청에 300초를 줍니다. nginx는 본문 전체가 아니라 본문의 두 읽기 사이를 최대 60초까지 기다리고, Caddy는 시간을 전혀 제한하지 않으므로, 두 샘플 모두 이를 변경하지 않습니다.
- **요청 빈도.** Traefik과 nginx 샘플은 [요청 제한](../../3-operations/12-security/5-rate-limits.md)에서 설명하는 대로, 한 클라이언트가 테넌트의 도메인과 이미지 호스트의 공개 API, 검색, 이미지로 보낼 수 있는 요청 수를 제한하고, 제한을 넘은 요청에는 자체적으로 `429`를 응답합니다. 허용량은 [라우팅 계약](https://github.com/publira/publira/blob/main/infra/proxy/README.md#request-rates)에 나와 있습니다. nginx는 이를 `default.conf.template`의 `limit_req_zone` 줄에 두고, Traefik은 `dynamic/routes.yaml`에서 허용량마다 하나의 `rateLimit` 미들웨어를 사이트 호스트와 이미지 호스트의 라우터에 두므로, 이 호스트들에 라우터를 추가할 때도 이 미들웨어가 필요합니다. Caddy 샘플에는 `rate_limit` 블록이 주석 처리된 채 들어 있습니다. 이 블록에는 [`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit) 모듈이 필요한데, `caddy` 이미지에는 이 모듈이 없어 이 블록이 있는 Caddyfile을 거부합니다. 블록을 사용하려면 `xcaddy build --with github.com/mholt/caddy-ratelimit`로 빌드한 것처럼 이 모듈을 포함해 빌드한 Caddy를 실행하고 주석을 해제하세요. [Docker Compose](../3-docker-compose.md) 설치 환경은 `caddy` 이미지를 실행하므로 그 엣지는 아무것도 제한하지 않습니다.
- **TLS.** [샘플에서 TLS 종단하기](#샘플에서-tls-종단하기)에서 설명하는 대로, 모든 샘플은 TLS 리스너를 추가하거나 Caddy에 HTTPS로 제공할 호스트 이름을 주기 전까지 일반 HTTP로 대기합니다.

샘플을 고칠 때는 이 모든 것을 유지하고, 추가하는 엔트리 포인트나 `server` 블록에도 같은 헤더, 제한, 타임아웃을 적용하세요.

## 백엔드 주소

각 샘플은 백엔드 주소를 라우팅과 분리해 두며, 커밋된 주소는 개발용 컨테이너를 가리키므로 가장 먼저 바꿔야 합니다.

| 백엔드 | 주소 |
| --- | --- |
| `web-storefront` | `web-storefront`. 대기하는 포트로 |
| `web-admin` | `web-admin`. 대기하는 포트로 |
| `web-platform` | 실행하는 경우 `web-platform`. 대기하는 포트로 |
| `api` | `publira server`. `PUBLIRA_PUBLIC_API_ADDR`로 다른 포트를 지정하지 않으면 포트 `8000` |

## 호스트 목록

호스트 이름은 프록시의 환경에서 가져오므로, 이를 위해 라우팅 파일을 수정할 필요는 없습니다. 각 환경 변수에는 포트 없이 공백으로 구분한 호스트 이름이 들어가며, 하나의 호스트는 그중 하나에 속합니다.

| 환경 변수 | 담는 것 | 프로세스 |
| --- | --- | --- |
| `PUBLIRA_EDGE_SITE_HOSTS` | 모든 테넌트의 도메인 | `web-storefront` |
| `PUBLIRA_EDGE_ADMIN_HOSTS` | 모든 테넌트의 콘솔 호스트 | `web-admin` |
| `PUBLIRA_EDGE_PLATFORM_HOSTS` | 플랫폼 콘솔의 호스트 | `web-platform` |
| `PUBLIRA_EDGE_IMAGE_HOSTS` | 모든 테넌트의 이미지 호스트 | `publira server`. `/images`만 |

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com manga.example.org
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com studio.manga.example.org
PUBLIRA_EDGE_PLATFORM_HOSTS=platform.example.com
PUBLIRA_EDGE_IMAGE_HOSTS=images.comics.example.com
```

각 샘플은 이 값을 각자의 방식으로 읽습니다.

- **Traefik**은 `dynamic/routes.yaml`을 템플릿으로 렌더링하므로, 환경 변수는 Traefik 프로세스의 환경에 넣습니다.
- **nginx**는 공식 nginx 이미지를 통해 이 값을 받으며, 이 이미지는 컨테이너가 시작될 때 값을 `default.conf.template`에 채워 넣습니다. `nginx` 디렉터리는 `/etc/nginx/conf.d`가 아니라 `/etc/nginx/templates`에 마운트하세요. 이미지가 결과를 자체 `conf.d/default.conf`에 덮어씁니다. 이 이미지를 쓰지 않는다면 파일의 첫 주석에 적힌 대로 `envsubst`로 직접 렌더링하세요.
- **Caddy**는 Caddyfile을 읽을 때 값을 치환합니다.

플랫폼 콘솔을 실행하지 않는 설치 환경은 `PUBLIRA_EDGE_PLATFORM_HOSTS`를 비워 두고, 백엔드 주소에서 `web-platform`의 주소를 빼도 됩니다. `PUBLIRA_EDGE_IMAGE_HOSTS`는 이미지 호스트를 가진 테넌트가 없는 동안, 그리고 이미지 호스트가 이 프록시가 아니라 전용 로드 밸런서를 거쳐 `publira server`에 도달하는 경우 비워 둡니다. 어느 경우든 라우팅 블록을 제거하지는 않습니다. 모든 샘플은 목록이 비어 있어도 유효합니다.

각 샘플은 프록시가 시작될 때 목록을 한 번만 읽습니다. [테넌트를 추가](./index.md#테넌트-추가)할 때는 그 도메인을 `PUBLIRA_EDGE_SITE_HOSTS`에, 콘솔 호스트를 `PUBLIRA_EDGE_ADMIN_HOSTS`에, 이미지 호스트를 지정했다면 그것을 `PUBLIRA_EDGE_IMAGE_HOSTS`에 추가하고, 새 환경으로 프록시를 다시 시작하세요. 리로드로는 이전 목록이 유지됩니다. nginx나 Caddy에 파일만으로 추가한 인증서는 리로드가 필요합니다. `nginx -s reload`나 `caddy reload --config /etc/caddy/Caddyfile`을 실행하며, 둘 다 진행 중인 연결을 끊지 않습니다. 인증서를 직접 발급받는 Caddy는 `PUBLIRA_EDGE_TLS_HOSTS`에 추가된 이름으로 다시 시작할 때 그 인증서를 요청하고, ACME 리졸버를 둔 Traefik은 라우팅에 이름이 지정되면 요청합니다.

[Docker Compose](../3-docker-compose.md) 설치 환경에서는 목록이 `.env`에 있으며, `docker compose up -d proxy`가 그 목록으로 프록시를 다시 만들고, 프록시는 새 이름의 인증서를 발급받습니다.

## 프록시 앞의 홉

로드 밸런서, CDN, TLS 종단 장치가 샘플에 접속하면 프록시의 상대방은 그 홉이 됩니다. 배포된 그대로의 샘플에서는 이때 모든 요청이 그 홉의 주소로 기록됩니다. 감사 로그에는 모든 사람이 같은 주소로 표시되고, Publira와 샘플이 클라이언트 주소별로 적용하는 제한을 모든 독자가 공유하게 됩니다.

독자 자신의 주소를 기록하려면 다음이 필요합니다.

- **홉이 `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`를 직접 설정합니다.** 호출자의 값을 전달하거나 거기에 덧붙이지 않고, 각각 홉에 접속한 주소, 브라우저가 요청한 호스트, 브라우저가 사용한 스킴으로 설정합니다. Traefik은 홉에서 온 세 헤더를 모두 신뢰하고 웹 앱은 `X-Forwarded-Host`로 테넌트를 찾으므로, Traefik 앞에서 `X-Forwarded-For`만 설정하는 홉이 있으면 호출자가 테넌트를 고를 수 있게 됩니다. Caddy는 앞에 신뢰하는 프록시가 없으면 기본적으로 세 헤더를 모두 설정합니다.
- **프록시는 그 홉의 주소만 신뢰하고**, 클라이언트 주소를 홉의 헤더에서 가져옵니다. Traefik과 nginx 샘플에는 이 설정이 문서용 범위 `192.0.2.0/24`를 지정한 채 주석 처리되어 있습니다. 주석을 해제하고 범위를 홉의 주소로 바꾸세요. Caddy 샘플은 이를 환경에서 읽습니다.
  - Traefik: `traefik.yaml`의 `web` 엔트리 포인트, 또는 홉이 접속하는 엔트리 포인트의 `forwardedHeaders.trustedIPs`. 그리고 같은 주소를 Traefik 프로세스 환경의 `PUBLIRA_EDGE_TRUSTED_PROXIES`에 공백으로 구분해 지정합니다. `dynamic/routes.yaml`이 이를 읽어 홉의 지역을 전달하고, 홉이 지정한 주소로 각 독자를 셉니다.
  - nginx: `default.conf.template`의 앞부분에 있는 `set_real_ip_from`과 그 아래의 `real_ip_header`, `real_ip_recursive`. 주소나 범위마다 `set_real_ip_from` 줄을 하나씩 두고, 같은 주소를 그 아래의 `geo` 블록에도 한 줄에 하나씩 ` 1;`로 끝나게 적습니다.
  - Caddy: Caddy 프로세스 환경의 `PUBLIRA_EDGE_TRUSTED_PROXIES`. 주소를 공백으로 구분하며, Caddyfile 전역 옵션의 `trusted_proxies static`이 이를 읽습니다.
  - Docker Compose 설치 환경: [앞에 CDN이나 로드 밸런서를 두는 경우](../3-docker-compose.md#앞에-cdn이나-로드-밸런서를-두는-경우)에서 설명하는 대로 `.env`의 `PUBLIRA_EDGE_TRUSTED_PROXIES`.

그러면 모든 샘플은 홉이 지정한 `X-Forwarded-Proto`를 전달합니다. 독자는 HTTPS를 사용했지만 홉은 일반 HTTP로 프록시에 접속하기 때문입니다. 또한 홉이 지정한 `X-Forwarded-CountryRegion`도 전달하므로, 독자의 지역을 아는 홉은 프록시를 거쳐 [Google tag gateway](./index.md#독자의-지역)에 이를 넘겨줍니다. 이런 홉은 호출자가 보낸 값을 대체해 이 헤더를 직접 설정하며, 지역을 모르는 홉은 이 헤더를 제거합니다. 프록시는 신뢰하는 홉이 보내는 것이면 무엇이든 전달하기 때문입니다. nginx와 Caddy는 홉의 `X-Forwarded-For`에서 신뢰하는 주소가 아닌 가장 오른쪽 주소를 가져와 그 주소만 `Forwarded`로 전달하고, `X-Forwarded-Host`는 계속 직접 설정하므로, 그 앞의 홉은 `PUBLIRA_TRUSTED_PROXIES`에 등록할 필요가 없습니다. Traefik은 홉의 `X-Forwarded-For`에 홉 자신의 주소를 덧붙여 전달하므로, `publira server`가 그 주소를 건너뛰어 홉이 지정한 주소에 이르는 것은 `publira server`도 그 홉을 신뢰할 때뿐입니다. 사설 네트워크의 홉은 기본적으로 신뢰하며, CDN처럼 공인 주소를 가진 홉은 `PUBLIRA_TRUSTED_PROXIES`에 그 범위를 나열하면 신뢰합니다. 그 밖의 주소에서 온 요청은 이 설정이 없을 때와 똑같이 처리됩니다.

홉 자신의 주소만 신뢰하세요. 독자에게도 닿는 범위를 신뢰하면 그 독자 누구나 원하는 주소를 지정할 수 있습니다.

## 샘플에서 TLS 종단하기

아래의 변경은 각 샘플에 TLS 리스너를 추가하고, 일반 HTTP를 리디렉션으로 HTTPS로 보냅니다. Caddy와 Traefik은 주어진 모든 이름의 인증서를 Let's Encrypt나 다른 ACME 인증 기관에서 발급받고, 만료 전에 갱신할 수 있습니다. 인증 기관은 그 이름의 포트 80이나 443으로 프록시에 접속해야 하므로, DNS 레코드를 먼저 만들고 두 포트를 인터넷에 열어 두어야 합니다. certbot 같은 별도의 ACME 클라이언트, 자체 인증 기관, 인증서 서비스 등 다른 곳에서 발급받은 인증서는 프록시가 읽는 파일로 저장합니다. 이때 갱신은 그 도구의 몫이며, 프록시는 갱신된 파일을 불러와야 합니다.

[Docker Compose](../3-docker-compose.md) 설치 환경은 ACME 연락처가 설정되면 아래와 같이 Caddy 샘플로 나열된 모든 호스트의 TLS를 종단합니다.

### Caddy

Caddy 프로세스의 환경에서 `PUBLIRA_EDGE_TLS_HOSTS`를 네 목록에 있는 모든 호스트 이름으로 공백으로 구분해 설정하고, `PUBLIRA_EDGE_ACME_EMAIL`을 인증 기관에 계정을 등록할 연락처 주소로 설정합니다. 그러면 Caddy는 각 이름의 인증서를 발급받아 갱신하고, 포트 443에서 제공하며, 그 이름들에 대한 일반 HTTP를 HTTPS로 리디렉션합니다.

```text
PUBLIRA_EDGE_TLS_HOSTS=comics.example.com admin.comics.example.com platform.example.com images.comics.example.com
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

Caddy는 인증서를 `/data` 아래에 보관하므로, 이 디렉터리에는 컨테이너보다 오래 남는 볼륨을 지정하세요. 빈 상태로 시작하는 볼륨이면 Caddy가 모든 인증서를 다시 요청합니다. 어느 목록에도 없는 호스트는 인증서를 받지 못하므로 TLS 핸드셰이크가 실패하며, 일반 HTTP로는 샘플이 여전히 자체 404를 응답합니다.

다른 곳에서 발급받은 인증서를 쓰려면 사이트 블록의 주소인 `:80 {$PUBLIRA_EDGE_TLS_HOSTS}`를 호스트 이름으로 바꾸고, 블록 안에 `tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem`을 추가하세요. Caddy는 직접 발급받는 대신 이 파일들을 사용하며, 일반 HTTP로도 대기하는 블록에서는 이 파일들을 거부합니다. Caddy는 이 파일들을 컨테이너 안에서 읽으므로, 파일이 있는 디렉터리를 `/etc/caddy/tls`에 읽기 전용으로 마운트하세요. Docker Compose 설치 환경에서는 `proxy` 서비스의 `volumes`에 `- <directory>:/etc/caddy/tls:ro`를 추가하고, `docker compose up -d proxy`를 실행해 마운트한 상태로 프록시를 다시 만듭니다. 포트 80에 사이트가 하나도 남지 않으면 Caddy는 목록에 있든 없든 모든 호스트의 일반 HTTP를 HTTPS로 리디렉션하므로, 어느 목록에도 없는 호스트는 샘플의 404 대신 이 리디렉션을 받은 뒤 TLS 핸드셰이크에 실패합니다.

### nginx

`default.conf.template`의 다섯 `server` 블록 각각에서 `listen 80`을 `listen 443 ssl`로 바꾸되, 어느 목록에도 없는 호스트에 응답하는 첫 번째 블록의 `default_server`는 유지합니다. 그런 다음 같은 파일 끝에 인증서와, 일반 HTTP를 리디렉션하는 서버를 추가합니다.

```nginx
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;

server {
    listen 80 default_server;
    return 308 https://$host$request_uri;
}
```

여기에 적은 인증서는 모든 `server` 블록에 사용되므로, 프록시가 제공하는 모든 호스트를 담고 있어야 합니다. 대신 테넌트마다 인증서를 하나씩 두려면 각 인증서와 키 쌍의 디렉터리 이름을 호스트로 정하고, 브라우저가 요청한 이름에 따라 nginx가 고르게 하세요.

```nginx
ssl_certificate     /etc/nginx/tls/$ssl_server_name/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/$ssl_server_name/privkey.pem;
```

그러면 nginx는 새 연결마다 그 쌍을 읽으므로, 새 인증서나 갱신된 인증서가 리로드 없이 적용됩니다. 다만 이 파일들은 마스터가 아니라 워커 프로세스가 읽으므로, 키는 root뿐 아니라 워커가 실행되는 사용자(공식 이미지에서는 `nginx`)도 읽을 수 있어야 합니다. root만 읽을 수 있는 키는 그 호스트로의 모든 연결을 실패하게 합니다.

nginx는 인증서를 직접 발급받지 않습니다. ACME 클라이언트가 nginx를 거쳐 HTTP 챌린지에 응답한다면, 포트 80 서버에서 리디렉션보다 앞서 `/.well-known/acme-challenge/`를 제공하세요.

### Traefik

`traefik.yaml`에서 `web` 엔트리 포인트를 `websecure`로 보내고, 샘플에 주석 처리된 채 들어 있는 `websecure` 엔트리 포인트를 활성화합니다.

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      middlewares:
        - strip-trace-context@file
        - strip-forwarded@file
      tls: {}
    transport:
      respondingTimeouts:
        readTimeout: 300s
```

`websecure`에는 `web`과 같은 두 미들웨어와 같은 300초가 지정되어 있습니다. 타임아웃이 없으면 HTTPS를 통한 업로드가 1분 뒤에 끊깁니다.

`dynamic/routes.yaml`에서 모든 라우터의 `entryPoints: [web]`을 `entryPoints: [websecure]`로 바꿉니다. 라우터는 자신이 지정한 엔트리 포인트에서만 응답하므로, `web`에 남겨 둔 라우터에는 HTTPS로 도달할 수 없습니다.

Traefik이 인증서를 발급받게 하려면 `traefik.yaml`에 리졸버를 추가하고, 그 `storage` 파일을 컨테이너보다 오래 남는 볼륨에 두세요.

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

라우터는 규칙에 나열된 모든 호스트를 지정하므로, Traefik은 라우터를 보고 어떤 이름을 요청할지 알 수 있습니다. 위의 `websecure` 엔트리 포인트에서 `tls: {}`를 리졸버로 바꾸면, 그 엔트리 포인트의 모든 라우터가 자기 호스트의 인증서를 발급받습니다.

```yaml
tls:
  certResolver: letsencrypt
```

다른 곳에서 발급받은 인증서를 쓰려면 리졸버를 빼고, `dynamic` 디렉터리의 새 파일(예: `dynamic/tls.yaml`)에 파일 목록을 적으세요. Traefik은 각 인증서를 그 인증서에 담긴 이름에 대해 제공합니다.

```yaml
tls:
  certificates:
    - certFile: /etc/traefik/tls/comics.example.com/fullchain.pem
      keyFile: /etc/traefik/tls/comics.example.com/privkey.pem
```

Traefik은 `dynamic` 디렉터리를 감시하므로, 새 인증서 항목 추가처럼 그곳의 파일을 변경하면 재시작 없이 적용됩니다. `traefik.yaml`을 변경하면 재시작이 필요합니다. 다만 Traefik은 인증서 파일이 제자리에서 교체된 것을 알아채지 못하므로, 갱신할 때마다 `touch dynamic/tls.yaml`처럼 `dynamic/`의 파일을 갱신하세요. 그렇지 않으면 만료될 때까지 이전 인증서를 계속 제공합니다.

## 다음 단계

엣지가 HTTPS를 제공하게 되면 콘솔 호스트에서 [테넌트 콘솔에 로그인](../2-installing.md#6-로그인)합니다. 샘플들이 공유하는 규칙, 그 순서, 그리고 저장소가 모든 샘플을 그 규칙에 비추어 검사하는 방법은 [라우팅 계약](https://github.com/publira/publira/blob/main/infra/proxy/README.md)에 나와 있습니다.
