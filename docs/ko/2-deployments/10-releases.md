---
title: 릴리스
description: 버전 번호가 알려 주는 것, 각 종류의 릴리스가 바꿀 수 있는 것, 0.x가 다른 점, 나란히 실행할 수 있는 릴리스, 수정을 받는 릴리스, 그리고 릴리스가 게시하는 것을 검증하는 방법을 설명합니다.
published: 2026-11-03
updated: 2026-11-08
source_updated: 2026-11-08
---

Publira는 `vMAJOR.MINOR.PATCH`라는 이름의 리포지토리 태그로 릴리스되며, `v0.1.0`부터 시작합니다. 각 릴리스는 릴리스 노트와 함께 리포지토리의 [Releases](https://github.com/publira/publira/releases) 페이지에 게시되고, 이미지는 릴리스의 버전, 즉 태그에서 `v`를 뺀 것으로만 push되며 다른 태그는 붙지 않습니다. `v0.1.0`은 `ghcr.io/publira/<name>:0.1.0`으로 pull합니다. `latest`도 `0.1`도 없으므로, 설치 환경은 실행하는 버전을 직접 바꿀 때만 새 릴리스로 옮겨 갑니다. 릴리스에는 [Docker Compose](./3-docker-compose.md) 설치 환경도 `publira-deploy-<version>.tar.gz`로 함께 들어 있습니다. 태그 시점의 리포지토리에 있는 그대로의 Compose 파일, 릴리스의 이미지를 지정하는 `.env.example`, 프록시의 `Caddyfile`입니다. 이미지와 이 아카이브에는 이를 게시하는 워크플로가 서명하며, 확인하는 방법은 [릴리스 검증](#릴리스-검증)에서 설명합니다. 이 페이지에서는 업그레이드하기 전에 릴리스의 번호가 무엇을 알려 주는지, 어떤 릴리스를 나란히 실행할 수 있는지, 어떤 릴리스가 수정을 받는지, pull하는 것을 어떻게 검증하는지 설명합니다.

## 번호가 알려 주는 것

- **메이저 릴리스**(예: `v2.0.0`)에는 [설치 환경을 깨뜨리는 변경](#설치-환경을-깨뜨리는-변경)이 모두 들어갑니다. 업그레이드하기 전에 노트를 읽으세요.
- **마이너 릴리스**(예: `v2.1.0`)는 기능을 추가하며, `db migrate`가 적용하는 마이그레이션이 들어 있을 수 있지만 그 밖에 운영자에게 요구하는 것은 없습니다.
- **패치 릴리스**(예: `v2.1.1`)는 해당 마이너 릴리스를 수정하며, 이미지 교체 이외에 운영자에게 요구하는 것은 없습니다.
- **접미사가 붙은 태그**(예: `v2.0.0-rc.1`)는 프리릴리스이며, Releases 페이지에도 프리릴리스로 표시됩니다. 정식으로 나오기 전에 릴리스를 시험해 보기 위한 것으로, 수정을 받지 않습니다. 독자에게 서비스하는 설치 환경에서는 정식 릴리스를 실행하세요.

`1.0.0` 이전의 릴리스는 이 번호를 다르게 매기며, [1.0.0 이전](#100-이전)에서 설명합니다.

## 설치 환경을 깨뜨리는 변경

모든 업그레이드에서 실행하는 단계 이상을 운영자에게 요구하는 변경은 메이저 릴리스에 들어갑니다.

- 환경 변수: 프로세스가 필요로 하는 변수의 추가, 이름 변경, 더 이상 읽지 않음
- 데이터베이스 역할: 역할의 추가, 또는 역할이 접근할 수 있는 범위의 변경
- [엣지가 해야 하는 일](./4-edge/index.md#엣지가-해야-하는-일)
- 설치 환경이 이전에는 실행하지 않던 프로세스나 서비스
- 오래 걸리거나 사용량이 많은 테이블을 잠그는 마이그레이션
- 검색 인덱스. 이 경우 인덱스를 다시 빌드해야 합니다

프록시의 [샘플 구성](./4-edge/1-sample-configurations.md)에 대한 변경은 그것만으로는 여기에 해당하지 않습니다. 샘플 구성은 자신의 엣지에 맞게 고쳐 쓰는 출발점이며, Docker Compose 설치 환경은 릴리스와 함께 `Caddyfile`을 받습니다.

이런 변경은 모두 릴리스 노트의 첫머리에 있는 **Upgrade notes**에 적히며, 해당하는 것이 없으면 노트에 없다고 적힙니다. 각 변경에 어떻게 대응하는지는 [릴리스 노트 읽기](./8-upgrading.md#릴리스-노트-읽기)에서 설명합니다.

노트에 무엇이 적혀 있든, 이런 릴리스로의 업그레이드는 [업그레이드](./8-upgrading.md)에서 설명하는 대로 진행합니다. 마이그레이션과 역할이 먼저이고, 그다음이 프로세스입니다.

## 나란히 실행되는 두 릴리스

번호와 관계없이 모든 릴리스는 바로 이전 릴리스와 함께 동작합니다. 프리릴리스는 예외입니다.

- 두 릴리스의 웹 앱과 `publira server`는 어느 방향으로든 서로를 호출합니다.
- 이전 릴리스의 프로세스는 이후 릴리스의 `db migrate`와 `db roles`가 남긴 스키마와 역할 위에서 계속 동작합니다. 릴리스는 이전 릴리스가 더 이상 읽지 않게 된 뒤에야 테이블, 열, 권한을 삭제하거나 이름을 바꿉니다.

그래서 다음 릴리스로의 업그레이드는 프로세스를 복제본 하나씩 교체하면서 설치 환경의 서비스를 유지할 수 있고, 새 릴리스가 추가하는 기능은 모든 프로세스가 새 릴리스를 실행하면 동작합니다. 이 보장은 한 릴리스까지만입니다. 더 멀리 떨어진 릴리스 사이에서는 업그레이드하기 전에 프로세스를 멈추거나, 한 릴리스씩 업그레이드하세요.

## 패치 릴리스

패치 릴리스에는 수정만 들어가며, 이미지 교체만으로 적용할 수 있는 범위로 제한됩니다. 마이그레이션, 환경 변수의 추가, 이름 변경, 더 이상 읽지 않음, 데이터베이스 역할, 엣지가 해야 하는 일의 변경, 설치 환경이 이전에는 실행하지 않던 프로세스나 서비스, 검색 인덱스의 재빌드는 모두 들어가지 않습니다. 이 중 하나라도 필요한 수정은 대신 다음 마이너 릴리스로 릴리스됩니다.

따라서 패치 릴리스의 Upgrade notes는 운영자에게 아무것도 요구하지 않습니다. 그래도 패치 릴리스로의 업그레이드는 백업부터 프로세스 교체까지 [업그레이드](./8-upgrading.md)에서 설명하는 대로 진행하세요. 스키마가 바뀌지 않으면 그 단계에 드는 수고는 적고, 만에 하나 패치 릴리스에 들어가서는 안 될 변경이 들어 있더라도 백업이 되돌아갈 방법이 됩니다.

## 1.0.0 이전

메이저 번호가 `0`인 동안에는 마이너 번호가 메이저 번호의 역할을 합니다. 설치 환경을 깨뜨리는 변경은 `v0.2.0` 같은 마이너 릴리스에 들어가고, 새 기능과 추가만 하는 마이그레이션을 포함한 그 밖의 모든 것은 `v0.2.1` 같은 패치 릴리스에 들어갑니다.

따라서 `0.x` 패치 릴리스에는 마이그레이션이 들어 있을 수 있으며, 그 프로세스는 마이그레이션이 추가한 것을 읽을 수 있어서 그것이 없는 스키마에서는 실패합니다. 이미지 교체만으로는 충분하지 않습니다. [업그레이드](./8-upgrading.md)에서 설명하는 대로 프로세스를 교체하기 전에 `db migrate`와 `db roles`를 실행하세요.

## 수정을 받는 릴리스

수정은 보안 수정을 포함해 최신 마이너 릴리스만 받으며, 그 마이너 릴리스의 패치 릴리스로 릴리스됩니다. 마이너 릴리스가 게시되면 그 이전 마이너 릴리스는 더 이상 수정을 받지 않으므로, 이전 마이너 릴리스의 설치 환경은 최신 릴리스로 업그레이드해서 수정을 받습니다.

취약점은 공개 이슈가 아니라 리포지토리의 Security 탭에 있는 [Report a vulnerability](https://github.com/publira/publira/security/advisories/new)에서 비공개로 신고해 주세요.

## 릴리스 건너뛰기

어느 릴리스에서든 그보다 이후의 어느 릴리스로든 한 번에 업그레이드할 수 있습니다. `db migrate`가 그 사이 모든 릴리스의 마이그레이션을 한 번의 실행으로 적용하므로, 스키마에 대해서는 운영자가 할 일이 없습니다.

`db migrate`가 적용하지 않는 것은 릴리스 노트가 요구하는 작업이므로, 지금 실행 중인 릴리스 다음부터 업그레이드할 릴리스까지 모든 릴리스의 노트를 읽으세요. 그중 무언가가 적혀 있는 것은 메이저 릴리스뿐이며, `1.0.0` 이전에는 마이너 릴리스입니다. 그 Upgrade notes는 모두 합쳐서 적용합니다. 추가된 모든 변수를 설정하고, 그 사이에 추가된 모든 역할의 비밀번호를 `db roles`에 전달하고, 엣지가 해야 하는 일의 모든 변경을 자신의 엣지에 반영하세요. 또 그 사이의 릴리스가 지금 실행 중인 릴리스가 아직 읽는 것을 폐지했을 수도 있으므로, 릴리스를 건너뛰기 전에 [프로세스를 멈추세요](./8-upgrading.md#먼저-프로세스를-멈출지-결정하기).

## 릴리스 검증

릴리스의 모든 이미지와 Docker Compose 설치 환경에는 리포지토리의 워크플로가 게시할 때 만든, 키를 쓰지 않는 [Sigstore](https://www.sigstore.dev/) 서명이 있습니다. 서명에는 그 워크플로와 릴리스의 태그가 기록되므로 가져오거나 신뢰할 키가 없으며, 다른 곳에서 빌드한 이미지나 아카이브는 검증에 실패합니다. 검증에는 [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)이 필요합니다. 검증은 필수가 아니며, `docker pull`과 Compose 설치 환경은 검증하지 않아도 지금처럼 동작합니다.

### 이미지

실행하는 각 이미지를 이미지를 push하는 워크플로에 대해 검증하세요. `<version>`은 릴리스의 버전으로, `v0.1.0`이라면 `0.1.0`입니다.

```bash
cosign verify ghcr.io/publira/publira:<version> \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-images.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

이 명령은 수행한 검사를 나열한 다음 서명의 내용을 JSON으로 출력하며, 그중 `docker-manifest-digest`가 서명이 다루는 이미지의 다이제스트입니다. 해당 태그에서 해당 워크플로가 만든 서명이 없는 이미지라면 실패합니다. `publiractl`, `web-storefront`, `web-admin`에도 반복하고, `web-platform`과 `email-renderer`를 실행한다면 그것들에도 반복하세요. 태그는 다시 push될 수 있으므로, 검증한 것을 그대로 실행하려면 태그 대신 그 다이제스트로 `ghcr.io/publira/publira@sha256:<digest>`처럼 이미지를 지정하세요.

### 증명에 담긴 내용

각 이미지에는 플랫폼마다 두 가지 증명(attestation)이 있으며, 둘 다 BuildKit이 이미지를 빌드하면서 기록합니다.

- **SBOM**은 SPDX 형식으로, 이미지에 들어 있는 운영 체제 패키지, Node.js 패키지, Go 모듈을 담습니다.
- **SLSA provenance**는 이미지를 빌드한 커밋과 워크플로 실행, 빌드에 쓴 Dockerfile과 그 인수, 출발점이 된 베이스 이미지의 다이제스트를 담습니다.

증명은 이미지의 플랫폼 목록 안에, 설명하는 플랫폼 옆에 저장됩니다. 그래서 목록에는 `linux/amd64`와 `linux/arm64` 옆에 각각 `unknown/unknown` 항목이 보입니다. `docker pull`과 컨테이너 런타임은 이 항목을 건너뜁니다. 서명은 목록을 다루고 목록은 각 증명을 다이제스트로 가리키므로, `cosign verify`가 출력한 다이제스트를 통해 읽으세요.

```bash
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .Provenance}}'
```

둘 다 `linux/amd64`와 `linux/arm64`에 대한 항목이 하나씩 있는 JSON 객체를 출력합니다.

### Compose 설치 환경

릴리스에는 아카이브 옆에 그 서명이 `publira-deploy-<version>.tar.gz.sigstore.json`으로 들어 있으며, 릴리스를 게시하는 워크플로가 만든 것입니다. 둘 다 내려받고, 압축을 풀기 전에 아카이브를 검증하세요.

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz.sigstore.json
cosign verify-blob publira-deploy-<version>.tar.gz \
  --bundle publira-deploy-<version>.tar.gz.sigstore.json \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-notes.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

성공하면 `Verified OK`를 출력하며, 워크플로가 서명한 아카이브와 한 바이트라도 다르면 실패합니다. 아카이브는 이미지를 태그로 지정하므로, [이미지](#이미지)에서 설명한 대로 이미지도 검증하세요.

## 다음 단계

[업그레이드](./8-upgrading.md)에서는 실행 중인 설치 환경을 어떤 종류의 새 릴리스로든 올리는 방법과, 마이그레이션이 실패했을 때 할 일을 설명합니다.
