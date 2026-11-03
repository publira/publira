---
title: ECS 앞의 CloudFront
description: AWS Fargate의 Amazon ECS에 있는 설치 환경의 내부 Application Load Balancer 앞에 CloudFront를 두고, VPC 밖에서 확인합니다.
published: 2026-11-03
source_updated: 2026-10-22
---

이 페이지는 [AWS Fargate의 Amazon ECS](./index.md)의 8단계이며, 앞 단계와 같은 셸에서 실행합니다. 명령은 `VPC`, `VPC_CIDR`, `ALB`, `allow`처럼 앞 단계에서 정의한 변수와 함수를 사용합니다.

CloudFront는 독자가 연결하는 엣지입니다. [엣지가 해야 하는 일](../4-edge/index.md#엣지가-해야-하는-일)이 요구하는 대로, `us-east-1`의 인증서로 모든 테넌트 호스트의 TLS를 종단하고, 일반 HTTP를 HTTPS로 리디렉션하고, 호출자가 정해서는 안 되는 헤더를 제거하며, 그 밖의 모든 것을 로드 밸런서로 전달합니다.

## VPC 오리진

로드 밸런서는 내부용이므로, CloudFront는 VPC 오리진으로서 HTTPS로 로드 밸런서에 접근합니다.

```bash
aws cloudfront create-vpc-origin --vpc-origin-endpoint-config "{
  \"Name\": \"publira\",
  \"Arn\": \"$ALB\",
  \"HTTPPort\": 80,
  \"HTTPSPort\": 443,
  \"OriginProtocolPolicy\": \"https-only\",
  \"OriginSslProtocols\": { \"Quantity\": 1, \"Items\": [\"TLSv1.2\"] }
}" --query 'VpcOrigin.Id' --output text
```

`aws cloudfront get-vpc-origin --id <the VPC origin ID> --query VpcOrigin.Status`가 보여 주는 상태가 `Deployed`가 되면, CloudFront는 VPC에 `CloudFront-VPCOrigins-Service-SG`라는 보안 그룹을 만든 상태입니다. 이 그룹만 로드 밸런서에 접근할 수 있게 하세요.

```bash
CLOUDFRONT_SG=$(aws ec2 describe-security-groups \
  --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=CloudFront-VPCOrigins-Service-SG \
  --query 'SecurityGroups[0].GroupId' --output text)
allow "$ALB_SG" 443 "$CLOUDFRONT_SG"
```

이 그룹은 자신의 계정의 VPC 오리진에 속합니다. 로드 밸런서를 인터넷이 아니라 내부에 두는 이유가 이것입니다. 인터넷에 있는 로드 밸런서는 CloudFront의 관리형 접두사 목록 `com.amazonaws.global.cloudfront.origin-facing`을 허용하게 되는데, 이는 자신의 배포뿐 아니라 모든 CloudFront 배포가 연결하는 출발지입니다. 따라서 호출자가 자기 소유의 배포를 그 로드 밸런서로 향하게 하면, 아래의 함수를 거치지 않고, 원하는 `Forwarded`와 `X-Forwarded-Host`를 가지고 로드 밸런서에 도달합니다.

## 헤더

모든 뷰어 요청에 대한 CloudFront Function이, 다른 무엇보다 먼저 요청에서 트레이스 컨텍스트 헤더, `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-CountryRegion`을 제거하고, 마지막 헤더를 독자의 지역으로 설정합니다. `strip-request-headers.js`:

```js
function handler(event) {
  var headers = event.request.headers;
  delete headers.traceparent;
  delete headers.tracestate;
  delete headers.baggage;
  delete headers.forwarded;
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-countryregion"];
  var country = headers["cloudfront-viewer-country"];
  var region = headers["cloudfront-viewer-country-region"];
  if (country && region) {
    headers["x-forwarded-countryregion"] = {
      value: country.value + "-" + region.value,
    };
  }
  return event.request;
}
```

```bash
aws cloudfront create-function --name publira-strip-request-headers \
  --function-config Comment=publira,Runtime=cloudfront-js-2.0 \
  --function-code fileb://strip-request-headers.js --query ETag --output text
aws cloudfront publish-function --name publira-strip-request-headers --if-match <the ETag above>
```

`traceparent`, `tracestate`, `baggage`는 [트레이스 컨텍스트](../4-edge/index.md#트레이스-컨텍스트)가 요구하는 대로 제거합니다. CloudFront와 로드 밸런서는 호출자가 보낸 `Forwarded`와 `X-Forwarded-Host`를 그대로 전달하며, Publira는 [클라이언트 주소](../4-edge/index.md#클라이언트-주소)와 [요청이 보내진 호스트](../4-edge/index.md#요청이-보내진-호스트)에서 설명하듯 둘 다 읽습니다. CloudFront도 로드 밸런서도 이 헤더를 직접 쓰지 않으므로, 여기서 제거하면 웹 앱은 브라우저가 보낸 `Host`를 읽게 되고, 모든 프로세스에서 `PUBLIRA_FORWARDED_HEADER_ENABLED`를 기본값으로 둘 수 있습니다.

`X-Forwarded-CountryRegion`은 [독자의 지역](../4-edge/index.md#독자의-지역)에서 설명하듯 독자의 지역을 테넌트의 Google tag gateway에 전달합니다. CloudFront는 독자의 주소에서 지역을 조회해, 국가 코드인 `CloudFront-Viewer-Country`와, ISO 3166-2 코드에서 국가 다음에 오는 독자의 1단계 행정 구역 코드인 `CloudFront-Viewer-Country-Region`에 넣습니다. 함수는 이 둘을 `JP-13`처럼 헤더가 취하는 형식으로 합칩니다. 함수는 동작의 오리진 요청 정책이 이 두 헤더를 전달할 때만 이를 볼 수 있으며, 그래서 아래의 기본 동작은 `Managed-AllViewerAndCloudFrontHeaders-2022-06`을 사용합니다. CloudFront가 어떤 지역에도 배정하지 않은 요청은 호출자가 보낸 헤더를 포함해 이 헤더 없이 로드 밸런서에 도달합니다.

## 캐시 정책

`/images`를 제외한 모든 경로는 캐시하지 않고, 브라우저가 보낸 모든 헤더, 쿠키, 쿼리 문자열과 함께 전달합니다. 관리형 캐시 정책 `Managed-CachingDisabled`와 관리형 오리진 요청 정책 `Managed-AllViewerAndCloudFrontHeaders-2022-06`을 사용하며, 후자는 브라우저가 보낸 헤더에 CloudFront가 직접 쓰는 헤더(독자의 국가와 지역 포함)를 더합니다. 페이지는 독자의 세션 쿠키에 따라 달라지며, 웹 앱은 Valkey에 자체 캐시를 두고 서버와 워커의 재검증이 이를 최신으로 유지합니다. CloudFront에 사본을 두면 그 재검증이 닿지 않는 사본이 됩니다. 이 정책은 테넌트를 고르는 `Host` 헤더와, 모바일 앱이 요청에 서명하는 `Authorization` 헤더를 전달합니다.

`/images`는 캐시할 가치가 있습니다. `publira server`는 독자가 로그인하지 않고 볼 수 있는 이미지를 최대 1시간 동안 `public`으로, 독자의 자격 증명이 필요한 이미지를 `private`으로 표시하며, CloudFront는 후자를 저장하지 않습니다. 서버는 `Accept` 헤더로 형식을, 호스트로 테넌트를 고르고, 독자의 자격 증명을 `Authorization` 또는 쿼리 문자열에서 가져오므로, 이들은 모두 캐시된 사본을 찾는 키에 포함되어야 합니다.

```bash
aws cloudfront create-cache-policy --cache-policy-config '{
  "Name": "publira-images",
  "MinTTL": 0,
  "DefaultTTL": 0,
  "MaxTTL": 86400,
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "EnableAcceptEncodingGzip": false,
    "EnableAcceptEncodingBrotli": false,
    "HeadersConfig": {
      "HeaderBehavior": "whitelist",
      "Headers": { "Quantity": 3, "Items": ["Host", "Accept", "Authorization"] }
    },
    "CookiesConfig": { "CookieBehavior": "none" },
    "QueryStringsConfig": { "QueryStringBehavior": "all" }
  }
}' --query 'CachePolicy.Id' --output text
```

`MinTTL`이 `0`이므로 CloudFront는 `private`과 `no-store`를 포함해 모든 응답의 `Cache-Control`을 따르며, `DefaultTTL`이 `0`이므로 `Cache-Control`이 없는 응답은 저장하지 않습니다.

## 배포

배포 하나는 테넌트 하나, 즉 그 테넌트의 도메인과 콘솔 호스트를 둘 다 지정한 인증서와 함께 제공합니다. 배포 하나에는 인증서를 하나만 둘 수 있고 테넌트의 인증서는 그 테넌트 전용이므로, [테넌트 추가](./2-operating.md#테넌트-추가)에서 설명하듯 다음 테넌트에는 별도의 배포를 둡니다. `distribution.json`:

```json
{
  "CallerReference": "publira-comics-example-com",
  "Comment": "comics.example.com",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "Aliases": {
    "Quantity": 2,
    "Items": ["comics.example.com", "admin.comics.example.com"]
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "<the certificate ARN in us-east-1>",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "publira",
        "DomainName": "<the load balancer's DNS name>",
        "VpcOriginConfig": {
          "VpcOriginId": "<the VPC origin ID>",
          "OriginReadTimeout": 120,
          "OriginKeepaliveTimeout": 5
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "publira",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    },
    "Compress": true,
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "33f36d7e-f396-46d9-90e0-52428a34d9dc",
    "FunctionAssociations": {
      "Quantity": 1,
      "Items": [
        {
          "EventType": "viewer-request",
          "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
        }
      ]
    }
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "/images*",
        "TargetOriginId": "publira",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"],
          "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
        },
        "Compress": false,
        "CachePolicyId": "<the publira-images cache policy ID>",
        "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
        "FunctionAssociations": {
          "Quantity": 1,
          "Items": [
            {
              "EventType": "viewer-request",
              "FunctionARN": "arn:aws:cloudfront::<account>:function/publira-strip-request-headers"
            }
          ]
        }
      }
    ]
  }
}
```

```bash
aws cloudfront create-distribution --distribution-config file://distribution.json \
  --query 'Distribution.[Id,DomainName]' --output text
```

- **ID.** `4135ea2d-…`는 `Managed-CachingDisabled`, `33f36d7e-…`는 `Managed-AllViewerAndCloudFrontHeaders-2022-06`, `216adef6-…`는 `Managed-AllViewer`입니다. 로드 밸런서의 DNS 이름은 `aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName'`로 출력할 수 있습니다.
- **메서드.** 페이지는 폼을 POST하고 API는 `POST`로 호출되므로, 기본 동작은 모든 메서드를 허용합니다. `/images`는 읽기에만 응답합니다.
- **업로드 타임아웃.** CloudFront는 여기서 문제가 될 만한 본문 크기 제한을 두지 않으므로, 업로드와 웹훅은 그대로 통과합니다. `OriginReadTimeout`은 CloudFront가 로드 밸런서의 응답을 기다리는 시간으로, 설정하지 않으면 30초입니다. 120은 할당량을 늘리지 않고 설정할 수 있는 최댓값이며, 에피소드 한 편의 페이지가 모두 도착한 뒤 콘솔이 이를 저장할 시간을 남겨 줍니다.
- **함수**는 두 동작 모두에 연결합니다. 함수를 지정하지 않은 동작은 호출자의 헤더를 그대로 전달합니다.

배포가 완료되면 두 호스트 이름이 `d111111abcdef8.cloudfront.net` 같은 배포의 도메인 이름을 가리키게 하세요. 각각 `CNAME` 레코드를 두거나, 영역이 Route 53에 있다면 별칭 레코드를 둡니다.

## 클라이언트 주소

Publira는 [클라이언트 주소](../4-edge/index.md#클라이언트-주소)에서 설명하듯 모든 요청 뒤에 있는 독자의 주소를 기록하며, 엣지가 쓰는 `X-Forwarded-For` 헤더에서 이를 읽습니다. CloudFront는 호출자가 쓴 값에 덧붙여 독자의 주소를 이 헤더에 넣고, 로드 밸런서는 CloudFront가 연결해 온 주소를 덧붙입니다. 독자를 위해 API를 호출하는 웹 앱은 다시 로드 밸런서의 주소를 덧붙입니다. `publira server`는 이 주소들을 오른쪽부터 차례로 보며 신뢰하는 주소를 건너뛰므로, `PUBLIRA_TRUSTED_PROXIES`는 독자 다음의 모든 홉을 포함해야 합니다.

- **VPC의 범위**: 로드 밸런서와 웹 앱이 이 범위에서 연결합니다.
- **CloudFront의 오리진 대상 범위**: AWS가 서비스 `CLOUDFRONT_ORIGIN_FACING`으로 공개하며, CloudFront가 로드 밸런서에 접근하는 출발지 주소입니다.

```bash
TRUSTED_PROXIES="$VPC_CIDR,$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
  | jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(",")')"
echo "$TRUSTED_PROXIES"
```

`web-storefront`도 테넌트의 Google tag gateway에 전달할 독자의 주소를 찾기 위해 같은 주소들을 차례로 보므로, 같은 값을 받습니다. [서비스 시작](./index.md#6-서비스-시작)의 `publira-server.json`과 `web-storefront.json`에서 `<see The client address>` 자리에 이 값을 쓰고, 두 태스크 정의를 다시 등록한 다음, 그것으로 두 서비스를 배포하세요.

```bash
for family in publira-server web-storefront; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
  aws ecs update-service --cluster publira --service "$family" --task-definition "$family" > /dev/null
done
```

AWS는 이 범위를 때때로 변경하며, 변경할 때마다 `AmazonIpSpaceChanged` SNS 토픽으로 알립니다. 변수를 갱신하기 전까지, 새 범위를 거쳐 도착한 요청은 독자의 주소가 아니라 CloudFront의 주소로 기록됩니다. 그 범위 뒤의 모든 독자가 하나의 주소를 공유하게 되지만, 어떤 독자도 그 주소를 고를 수는 없습니다. 이보다 넓은 범위는 신뢰하지 마세요. 독자에게 닿는 범위를 신뢰하면 어떤 독자든 원하는 주소를 지정할 수 있게 됩니다.

## 엣지 확인

DNS 레코드가 응답하면 VPC 밖에서 라우팅을 확인합니다.

```bash
curl -sI https://comics.example.com/ | head -1
curl -s https://comics.example.com/readyz
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' \
  https://comics.example.com/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs
curl -sI http://comics.example.com/ | grep -i '^location'
```

첫 번째는 `web-storefront`에서 `200`으로 응답하고, 두 번째는 그 준비 상태로 응답하며, `publira server`와 Valkey에 도달하면 `"status":"ok"`가 됩니다. 세 번째는 `publira server`에 도달하며, 서버는 빈 요청을 `invalid_argument`로 거부합니다. 네 번째는 테넌트 콘솔의 API를 호출하며, 로드 밸런서는 이를 전달하지 않고 `404`로 응답합니다. 마지막은 `https://comics.example.com/`로의 CloudFront 리디렉션으로 응답합니다. 콘솔 호스트에서도 같은 명령을 실행하세요. 그곳에서도 콘솔의 API는 `404`로 응답합니다. 콘솔은 엣지가 아니라 VPC를 통해 API를 호출하기 때문입니다.

그런 다음 AWS Fargate의 Amazon ECS 페이지의 [로그인](./index.md#9-로그인)으로 돌아가세요.
