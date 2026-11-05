---
title: 웹 애플리케이션 방화벽
description: 설치 환경 앞의 웹 애플리케이션 방화벽이 더해 주는 것, 켤 관리형 규칙, 예외를 두지 않으면 규칙이 거부하는 Publira의 요청, 콘솔을 자체 네트워크로 제한하는 방법을 설명합니다.
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

엣지 앞의 웹 애플리케이션 방화벽(WAF)은 각 요청을 검사해, SQL 인젝션, 크로스 사이트 스크립팅, 경로 탐색, 흔히 쓰이는 소프트웨어의 알려진 취약점 탐색처럼 공격으로 보이는 요청을 직접 운영하는 어떤 것에도 닿기 전에 거부합니다. Publira는 안전을 위해 WAF에 의존하지 않습니다. WAF는 Publira 자체가 하는 확인 앞에 놓이는 층으로, 스캐너와, 업그레이드로 고치기 전의 취약점에 대한 공격도 막아 주며, 스태프가 알려진 네트워크에서 일하는 경우 콘솔을 인터넷에서 떼어 놓습니다.

클라우드 플랫폼의 설치 환경 앞에는 거의 항상 관리형 로드 밸런서나 CDN이 있으며, 그 WAF를 사용하면 됩니다. CloudFront나 Application Load Balancer의 AWS WAF, Google Cloud 로드 밸런서의 Cloud Armor, 또는 Cloudflare입니다. [요청 제한](./5-rate-limits.md)에서 설명하듯이, 같은 WAF로 클라이언트 하나가 보낼 수 있는 요청 수도 제한합니다.

## 관리형 규칙 켜기

각 WAF에는 공급업체가 흔한 공격에 대비해 유지 관리하는 규칙 세트가 있습니다. 다음을 켜세요.

| WAF | 규칙 세트 |
| --- | --- |
| AWS WAF | CloudFront 배포나 로드 밸런서의 웹 ACL에서 [핵심 규칙 세트](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)(`AWSManagedRulesCommonRuleSet`), 알려진 잘못된 입력(`AWSManagedRulesKnownBadInputsRuleSet`), [SQL 데이터베이스](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html) 규칙 그룹(`AWSManagedRulesSQLiRuleSet`) |
| Google Cloud Armor | 로드 밸런서 백엔드 서비스의 보안 정책에서 OWASP Core Rule Set 4.22의 [사전 구성된 WAF 규칙](https://cloud.google.com/armor/docs/waf-rules). 최소한 `sqli-v422-stable`, `xss-v422-stable`, `lfi-v422-stable`, `rfi-v422-stable`, `rce-v422-stable`, `protocolattack-v422-stable`, `scannerdetection-v422-stable`. 오탐이 가장 적은 민감도 1에서 시작하고, 로그가 깨끗해지면 높이세요 |
| Cloudflare | Pro 이상에서는 [Cloudflare Managed Ruleset과 Cloudflare OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/), Free에서는 Cloudflare Free Managed Ruleset |

독자나 제공업체의 정당한 요청을 거부하는 규칙은 장애만큼이나 확실하게 설치 환경을 망가뜨립니다. 따라서 각 규칙은 먼저 거부하지 않고 기록만 하게 하세요. AWS WAF에서는 동작을 Count로 재정의하고, Cloud Armor에서는 미리보기 모드로 둡니다. 실제 트래픽에서 무엇이 거부되었을지 확인하고, 걸린 것에 대해 아래의 예외를 둔 다음에야 거부하게 하세요.

## 관리형 규칙이 거부하는 요청

규칙 세트는 일반적인 웹 애플리케이션을 위해 작성되었으며, Publira가 제공하는 것 중 일부는 그렇지 않습니다.

| 요청 | 담고 있는 것 | 거부하는 것 | 할 일 |
| --- | --- | --- | --- |
| 업로드: 콘솔 호스트의 `/api/v1/episode-pages`, 그 밖의 `/api/v1/`, 이미지를 업로드하는 페이지, 공개 API로 보내는 독자의 아이콘 | [테넌트 콘솔에서의 업로드](../../2-deployments/4-edge/index.md#테넌트-콘솔에서의-업로드)와 [페이지에서의 이미지 업로드](../../2-deployments/4-edge/index.md#페이지에서의-이미지-업로드)에서 설명하는, 각각 최대 256 MiB, 33 MiB, 11 MiB, 15 MiB의 본문 | 8 KB를 넘는 모든 본문을 거부하는 AWS WAF의 `SizeRestrictions_BODY` | 그 규칙을 Count로 설정하세요. 중요한 것은 엣지 자체의 본문 크기 제한입니다 |
| `/api/v1/webhook/` 아래의 웹훅 | 결제 제공자의 이벤트, 또는 HTML과 첨부 파일을 포함한 독자의 메일 답장 전체 | 메일의 HTML과 텍스트가 걸리는 크로스 사이트 스크립팅, SQL 인젝션, 파일 포함에 대한 본문 규칙 | 이 경로에서는 관리형 규칙을 건너뛰세요. Publira는 각 제공업체가 본문에 붙이는 서명을 확인하므로 위조된 요청은 규칙 없이도 거부되며, [웹훅](../../2-deployments/4-edge/index.md#웹훅)에서 설명하듯이 거부된 요청은 다시 시도되다가 결국 사라집니다 |
| 독자와 스태프가 작성하는 것: 댓글, 문의 메시지, 그리고 콘솔 호스트에서는 페이지, 공지, 답변 | 제목에 왜 `<b>`가 보이는지 묻는 독자처럼 코드를 인용할 수 있는 텍스트 | 크로스 사이트 스크립팅과 SQL 인젝션에 대한 본문 규칙 | 규칙은 유지하세요. 로그에서 그런 텍스트가 거부되는 것이 보이면, 거부하는 규칙의 민감도를 낮추거나, 로그인한 스태프만 작성하는 콘솔 호스트에서만 그 규칙을 건너뛰세요 |

모바일 앱은 공개 API에 바이너리 Protocol Buffers(`application/proto`)로 요청을 보내며, 그 텍스트 필드는 독자가 입력한 바이트 그대로 WAF에 도달하므로, 본문 규칙은 양식을 읽듯이 이를 읽습니다.

WAF는 본문의 앞부분만 검사합니다. AWS WAF에서는 기본적으로 Application Load Balancer에서 8 KB, CloudFront에서 16 KB, Cloud Armor에서는 최대 64 KB, Cloudflare에서는 Free 요금제에서 1 MB, Enterprise에서 128 KB입니다. 그 범위를 넘는 본문에 대한 AWS WAF의 처리는 제한 안의 부분을 검사하는 Continue로 두세요. 차단하는 규칙에서 Match로 두면 모든 업로드가 거부됩니다.

## 콘솔을 자체 네트워크로 제한하기

콘솔 호스트는 스태프와 운영자에게만 제공됩니다. 독자, 모바일 앱, 모든 웹훅은 테넌트의 사이트에 도달하며, 콘솔 호스트에는 도달하지 않습니다. 스태프가 사무실이나 VPN처럼 알려진 네트워크에서 일한다면, AWS WAF의 IP 세트, Cloud Armor의 출발지 주소 일치 규칙, Cloudflare의 사용자 지정 규칙으로 그 주소만 콘솔 호스트에 허용하세요. 그러면 콘솔의 로그인 페이지가 인터넷에서 떨어집니다. 다른 곳에서 초대나 비밀번호 재설정을 여는 스태프도 거부되므로, 콘솔이 허용하는 네트워크를 사용하도록 안내하세요. 콘솔 호스트에서 [API 키로 보낼 수 있는 읽기 요청](../../2-deployments/4-edge/index.md#api-키로-보낼-수-있는-읽기-요청)을 보내는 테넌트 자체 시스템도 거부되므로, 그 주소를 추가하거나 이 규칙에서 해당 경로를 제외하세요.

## 봇 챌린지

경로 앞에 두는 봇 챌린지나 로그인 프롬프트는 응답할 수 없는 모든 클라이언트를 거부하는 WAF 기능이며, 모바일 앱도 웹훅 제공업체도 응답할 수 없습니다. 공개 API, 이미지, 웹훅에는 둘 다 두지 마세요.

## 직접 운영하는 프록시

[샘플 구성](../../2-deployments/4-edge/1-sample-configurations.md)에는 WAF가 포함되어 있지 않습니다. OWASP Core Rule Set과 함께 쓰는 ModSecurity나 Coraza처럼 직접 운영하는 프록시용 WAF 모듈에도 위와 같은 예외가 필요합니다.
