---
title: 배포
description: Publira 설치 환경이 어떻게 구성되고 어떻게 서비스에 투입되는지 설명합니다.
published: 2026-11-03
source_updated: 2026-10-22
---

이 문서는 Publira를 배포하는 운영자를 위한 것입니다. 설치 환경이 무엇을 실행하고 무엇에 의존하는지 설명합니다. 그 구성 요소를 어떻게 호스팅할지, 즉 Compose 파일, Kubernetes 클러스터, systemd 유닛 묶음 중 무엇을 쓸지는 여러분이 선택합니다.

## 이 섹션의 내용

- [개요](./1-overview.md): 설치 환경이 실행하는 프로세스, 그 프로세스가 의존하는 서비스, 추가할 수 있는 프로세스.
- [설치](./2-installing.md): 의존하는 서비스 준비부터 테넌트 콘솔에 처음 로그인하기까지, 빈 설치 환경을 서비스에 투입하는 방법.
- [Docker Compose](./3-docker-compose.md): 저장소의 Compose 파일로 설치 환경 전체를 한 대의 호스트에서 실행하는 방법.
- [엣지](./4-edge/index.md): 설치 환경 앞에 놓이는 로드 밸런서, 프록시, CDN이 해야 하는 일과 테넌트를 추가할 때 엣지에서 변경할 내용.
  - [샘플 구성](./4-edge/1-sample-configurations.md): 이를 수행하는 저장소의 Traefik, nginx, Caddy 샘플 구성과 이를 설치 환경에 맞게 고치는 방법.
- [Kubernetes](./5-kubernetes/index.md): Secret, Job, Deployment부터 첫 로그인까지, Kubernetes 클러스터에서 설치 환경을 실행하는 방법.
  - [Kubernetes의 엣지](./5-kubernetes/1-edge.md): Service 앞에 Gateway나 Ingress를 두고 cert-manager로 인증서를 발급하는 방법.
  - [Kubernetes에서의 운영](./5-kubernetes/2-operating.md): 테넌트 추가, 콘솔의 자격 증명을 테넌트 도메인에서 분리하기, 메트릭, 업그레이드.
- [AWS Fargate의 Amazon ECS](./6-ecs-fargate/index.md): 파라미터, 일회성 태스크, Application Load Balancer 뒤의 서비스부터 첫 로그인까지, 설치 환경을 Fargate의 ECS 서비스로 실행하는 방법.
  - [ECS 앞의 CloudFront](./6-ecs-fargate/1-cloudfront.md): 로드 밸런서 앞에 CloudFront를 VPC 오리진으로 두는 방법.
  - [ECS에서의 운영](./6-ecs-fargate/2-operating.md): 테넌트 추가, 콘솔의 자격 증명을 테넌트 도메인에서 분리하기, 업그레이드.
- [스케일 아웃](./7-scaling-out.md): 각 프로세스를 여러 개 실행하는 방법, 응답하는 트래픽에 따라 `publira server`를 나누는 방법, 그리고 복제본들이 공유하는 것.
- [업그레이드](./8-upgrading.md): 가동 중인 설치 환경을 새 릴리스로 올리는 방법과 마이그레이션이 실패했을 때 할 일.
- [백업과 복원](./9-backup-and-restore.md): 설치 환경이 보관하는 것, 그 백업 방법, 빈 서비스 위에 되살리는 방법.
- [릴리스](./10-releases.md): `0.x` 버전 번호가 알려 주는 것, 마이너 릴리스와 패치 릴리스가 바꿀 수 있는 것, 수정을 받는 릴리스.

Publira가 무엇인지 아직 읽지 않았다면 [시작하기](../1-getting-started.md)부터 읽으세요.
