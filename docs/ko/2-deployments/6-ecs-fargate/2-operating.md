---
title: ECS에서의 운영
description: AWS Fargate의 Amazon ECS에서 실행되는 설치 환경에 테넌트를 추가하고, 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두고, 이미지와 공개 API를 분리해 제공하고, 업그레이드합니다.
published: 2026-11-03
source_updated: 2026-10-26
---

[AWS Fargate의 Amazon ECS](./index.md)와 [ECS 앞의 CloudFront](./1-cloudfront.md)로 서비스를 시작한 설치 환경에 이후 가하는 변경입니다. 명령은 그 페이지들에서 정의한 셸 변수와 함수를 사용합니다. 설치 환경을 구축한 셸이 아닌 다른 셸에서는 명령이 사용하는 것을 다시 정의하세요. [시작하기 전에](./index.md#시작하기-전에)의 변수, [마이그레이션 적용과 데이터베이스 역할 만들기](./index.md#4-마이그레이션-적용과-데이터베이스-역할-만들기)의 `run_publiractl` 함수, [네트워크 경로 열기](./index.md#3-네트워크-경로-열기)의 `SERVER_SG`, `NAMESPACE`, `registry` 함수, [로드 밸런서 만들기](./index.md#5-로드-밸런서-만들기)의 `target_group` 함수, [서비스 시작](./index.md#6-서비스-시작)의 `service` 함수, 그리고 `aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`가 출력하는 `LISTENER`입니다.

## 테넌트 추가

`publiractl tenant create`나 플랫폼 콘솔에서 만든 테넌트는 [테넌트 추가](../4-edge/index.md#테넌트-추가)에서 설명하듯 엣지에 호스트 이름 두 개가 필요합니다. ECS에서는 그 테넌트의 스태프가 콘솔을 열기 전에 다음을 합니다.

1. **인증서.** [로드 밸런서 만들기](./index.md#5-로드-밸런서-만들기)에서처럼, 로드 밸런서의 리전과 `us-east-1`에서 그 테넌트의 도메인과 콘솔 호스트를 지정한 인증서를 요청하고, 둘 다 검증합니다.
2. **로드 밸런서.** `aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`으로 첫 번째 인증서를 리스너에 추가하고, 규칙 두 개를 추가합니다. 그곳의 표처럼 도메인과 콘솔 호스트를 각각 `2000` 대역에 둡니다. 할당량을 늘리지 않는 한 로드 밸런서는 리스너의 기본 인증서 외에 인증서 25개와 규칙 100개를 받습니다. 규칙의 호스트 조건은 이름을 최대 세 개까지 받으므로, 규칙 하나를 최대 세 테넌트가 공유할 수 있습니다.
3. **CloudFront.** [배포](./1-cloudfront.md#배포)의 `distribution.json`으로 전용 배포를 만들고, `Aliases`에 두 이름을, `ViewerCertificate`에 `us-east-1` 인증서를 넣고, 고유한 `CallerReference`를 지정합니다. VPC 오리진, 함수, 캐시 정책은 첫 번째 배포가 사용하는 것을 그대로 씁니다.
4. **DNS.** 두 이름이 새 배포의 도메인 이름을 가리키게 합니다.

그 밖에는 아무것도 바뀌지 않습니다. 서비스, 파라미터, 보안 그룹은 모든 테넌트에 똑같이 쓰입니다.

## 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기

로드 밸런서는 이미 콘솔의 API를 인터넷에서 차단하지만, 로드 밸런서가 테넌트의 도메인을 전달하는 `publira-server`는 여전히 그 API를 제공하며, 이를 위해 데이터베이스 로그인과 웹 서비스 토큰을 가지고 있습니다. [공개 API만 엣지를 거친다](../4-edge/index.md#공개-api만-엣지를-거친다)에서 설명하듯 엣지 규칙과는 별개의 계층으로서, 이 세 가지를 독자가 도달하는 프로세스에서 모두 빼려면 `--role storefront`로 두 번째 서비스를 실행하고 테넌트의 도메인과 `web-storefront`를 그쪽으로 라우팅하세요. [역할별로 서버 나누기](../7-scaling-out.md#역할별로-서버-나누기)에서 설명하듯, 각 서비스가 고유한 태스크를 실행하므로 이 분할로 독자 트래픽을 콘솔과 따로 확장할 수도 있습니다.

태스크 정의는 [서비스 시작](./index.md#6-서비스-시작)의 `publira-server.json`에서 패밀리와 컨테이너의 이름을 `publira-storefront`로 하고, 명령을 `["server", "--role", "storefront"]`로 하고, 시크릿을 그 역할이 읽는 것(암호화 키, `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_REDIS_URL`, `PUBLIRA_PUBLIC_DB_URL`)만으로 한 것입니다. 이를 등록하고, 로드 밸런서뿐 아니라 `web-storefront`도 호출하므로 전용 대상 그룹과 Cloud Map 이름을 둡니다.

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

그런 다음 서버의 규칙보다 앞서는 규칙을 추가해 테넌트의 도메인을 이 서비스로 보냅니다.

| 우선순위 | 호스트 | 경로 | 전달 대상 |
| --- | --- | --- | --- |
| `900` ~ `999` | 테넌트의 도메인 | `/images*`, `/rpc/publira.v1.*` | `publira-storefront` |

규칙 하나가 받는 다섯 개의 값 중 두 경로를 빼면 호스트 이름 세 개를 넣을 여유가 남으므로, 이 대역의 규칙 하나는 최대 세 테넌트의 도메인을 제공합니다. 새 테넌트의 도메인은 이미 도메인을 지정한 규칙에 추가하거나, 대역에서 다음으로 비어 있는 우선순위로 전용 규칙을 둡니다.

대상 그룹을 로드 밸런서에 연결하는 것은 규칙이며, ECS는 대상 그룹이 연결되지 않은 서비스의 생성을 거부하므로 규칙을 서비스보다 먼저 만듭니다. 하지만 서비스의 태스크가 올라오기 전까지 새 대상 그룹은 응답할 것이 없으므로, 각 규칙은 여전히 `publira-server`로 전달하도록 하고 그 옆에 `publira-storefront`를 가중치 `0`으로 두어 만듭니다. 그런 다음 이미 웹 앱을 허용하고 있는 `publira-server` 보안 그룹으로 서비스를 만들고, 그 태스크가 정상이 되면 규칙이 이 서비스로만 전달하게 합니다.

```bash
RULE_900=$(aws elbv2 create-rule --listener-arn "$LISTENER" --priority 900 \
  --conditions "[$(host_is comics.example.com),$(path_is '["/images*","/rpc/publira.v1.*"]')]" \
  --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$SERVER_TG,Weight=1},{TargetGroupArn=$STOREFRONT_SERVER_TG,Weight=0}]}" \
  --query 'Rules[0].RuleArn' --output text)
service publira-storefront "$SERVER_SG" 8000 "$STOREFRONT_SERVER_TG"
aws ecs wait services-stable --cluster publira --services publira-storefront
aws elbv2 modify-rule --rule-arn "$RULE_900" \
  --actions "Type=forward,TargetGroupArn=$STOREFRONT_SERVER_TG" > /dev/null
```

`host_is`와 `path_is`는 [로드 밸런서 만들기](./index.md#5-로드-밸런서-만들기)의 함수이며, `SERVER_TG`는 그곳에서 만든 대상 그룹입니다. 다른 셸에서는 `aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`로 출력할 수 있습니다. 서비스가 실행된 뒤 대역에 추가하는 규칙은 그 페이지의 `rule` 함수로 `publira-storefront`에만 전달하게 합니다.

`web-storefront`는 공개 API만 호출하므로, 이것도 새 서비스를 가리키게 하세요. `web-storefront.json`에서 `PUBLIRA_GRPC_URL`을 `http://publira-storefront.publira.internal:8000/rpc`로 설정하고, 등록하고, `web-storefront` 서비스를 새 리비전으로 업데이트합니다. 콘솔 호스트, `web-admin`, `web-platform`은 [콘솔 서버에서 공개 API 빼기](#콘솔-서버에서-공개-api-빼기)에서 공개 API를 빼기 전까지, 모든 역할을 제공하는 `publira-server`에 계속 도달합니다.

어느 경우든 로드 밸런서는 모든 호스트에서 콘솔 API에 `404`로 응답하므로, 대신 테넌트의 도메인이 새 서비스에 도달하는지 확인합니다. `aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`가 태스크를 `healthy`로 나열하고, [엣지 확인](./1-cloudfront.md#엣지-확인)의 공개 API 호출이 테넌트의 도메인에서 여전히 `invalid_argument`로 응답하며, 이제 그 응답은 `publira-storefront`에서 옵니다.

### 콘솔 서버에서 공개 API 빼기

`web-admin`이 테넌트의 테마와 태그를 위해 공개 API를 호출하고 `1000`의 규칙이 콘솔 호스트의 공개 API를 `publira-server`로 전달하므로, `publira-server`는 여전히 공개 API를 제공하며 `publira_public`을 가지고 있습니다. 이 둘을 `publira-storefront`로 보내면, [역할별로 서버 나누기](../7-scaling-out.md#역할별로-서버-나누기)의 4단계에서 설명하듯 `publira-server`를 `--role admin,platform`으로 실행할 수 있습니다. `publira-server`가 공개 API 요청 처리를 멈출 때 그 요청을 보내는 곳이 남아 있지 않도록, 다음 순서로 변경하세요.

먼저 `web-admin`의 공개 API 호출이 스토어프런트 서비스를 가리키게 합니다. `web-admin.json`의 `environment`에, 계속 `publira-server`를 지정하는 `PUBLIRA_GRPC_URL`과 함께 다음 변수를 추가하고,

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

배포합니다.

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

이제 `web-admin`의 `/readyz`는 그 서비스도 `public-api`로 검사합니다.

다음으로 모든 호스트의 공개 API를 어떤 호스트에서든 응답하는 `publira-storefront`로 라우팅하고, 콘솔 화면에 표시되는 이미지는 `admin` 역할의 것이므로 콘솔 호스트의 `/images`는 `publira-server`에 둡니다. `1000`의 규칙 다음에 공개 API용 규칙을 추가한 다음, `1000`의 규칙에서 공개 API를 빼서 공개 API가 더 이상 `publira-server`에 도달하지 않게 합니다.

| 우선순위 | 호스트      | 경로                | 전달 대상            |
| -------- | ----------- | ------------------- | -------------------- |
| `1000`   | 모든 호스트 | `/images*`          | `publira-server`     |
| `1050`   | 모든 호스트 | `/rpc/publira.v1.*` | `publira-storefront` |

```bash
rule 1050 "[$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
RULE_1000=$(aws elbv2 describe-rules --listener-arn "$LISTENER" \
  --query "Rules[?Priority=='1000'].RuleArn" --output text)
aws elbv2 modify-rule --rule-arn "$RULE_1000" \
  --conditions "[$(path_is '["/images*"]')]" > /dev/null
```

`rule`과 `path_is`는 [로드 밸런서 만들기](./index.md#5-로드-밸런서-만들기)의 함수이며, `STOREFRONT_SERVER_TG`는 위에서 만든 대상 그룹입니다. 다른 셸에서는 `aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`로 출력할 수 있습니다. `900` 대역의 규칙은 공개 API를 포함해 테넌트의 도메인을 계속 `publira-storefront`로 전달합니다.

마지막으로 `publira-server.json`에서 컨테이너의 `command`를 `["server", "--role", "admin,platform"]`으로 하고, 프로세스가 더 이상 읽지 않는 `PUBLIRA_PUBLIC_DB_URL`을 `secrets`에서 빼고, 배포합니다.

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

테넌트 콘솔에 로그인하세요. 이전처럼 테넌트의 테마를 그리고 태그를 나열하며, 이제 이들은 `publira-storefront`에서 읽습니다. [엣지 확인](./1-cloudfront.md#엣지-확인)의 공개 API 호출을 콘솔 호스트인 `https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`로 보내도 여전히 `invalid_argument`로 응답합니다. 그곳에서 `404`가 나온다면 콘솔 호스트의 공개 API가 아직 `publira-server`에 도달하고 있다는 뜻입니다.

## 이미지와 공개 API를 따로 제공하기

[이미지와 공개 API를 따로 제공하기](../7-scaling-out.md#이미지와-공개-api를-따로-제공하기)에서 설명하듯, 테넌트의 이미지와 공개 API는 각각 전용 로드 밸런서를 거쳐 전용 호스트 이름으로 접근하게 할 수 있습니다. ECS에서는 이미지에 전용 서비스 앞에 두 번째 내부 로드 밸런서와 CloudFront 배포를 두고, 공개 API에는 기존 로드 밸런서에 `publira-storefront` 앞의 호스트 이름을 둡니다. 이는 `publira-storefront`를 만든 [콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기](#콘솔의-자격-증명을-테넌트의-도메인에서-떼어-두기)를 전제로 합니다. 아래의 이름은 예시로, 테넌트의 이미지 호스트는 `images.comics.example.com`, 공개 API의 호스트는 `api.example.com`입니다.

### 이미지

이미지의 트래픽이 API의 트래픽과 따로 확장되도록, 이미지를 전용 서비스에서 실행합니다. 태스크 정의는 `publira-storefront.json`에서 패밀리와 컨테이너의 이름을 `publira-images`로 한 것으로, `publira-images.json`에 둡니다. 둘은 같은 역할을 제공하고 같은 시크릿을 읽습니다. 이를 등록하고, 대상 그룹과 `service` 함수가 등록에 쓰는 Cloud Map 이름을 둡니다.

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

[로드 밸런서 만들기](./index.md#5-로드-밸런서-만들기)에서처럼, 로드 밸런서의 리전과 `us-east-1`에서 이미지 호스트를 지정한 인증서를 요청하고 검증합니다. 그런 다음 CloudFront의 VPC 오리진과 `publira-server` 보안 그룹을 이미 허용하고 있는 첫 번째 로드 밸런서의 보안 그룹으로 두 번째 내부 로드 밸런서를 만들고, 유일한 규칙이 `/images`를 새 서비스로 전달하고 그 밖의 모든 것에 `404`로 응답하는 HTTPS 리스너를 만듭니다.

```bash
IMAGES_ALB=$(aws elbv2 create-load-balancer --name publira-images --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
IMAGES_LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$IMAGES_ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the image hosts' certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 create-rule --listener-arn "$IMAGES_LISTENER" --priority 1000 \
  --conditions "[$(path_is '["/images*"]')]" \
  --actions "Type=forward,TargetGroupArn=$IMAGES_TG" > /dev/null
```

대상 그룹을 로드 밸런서에 연결하는 것은 규칙이며, ECS는 대상 그룹이 연결되지 않은 서비스를 거부하므로, 서비스는 이제서야 만듭니다.

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

[ECS 앞의 CloudFront](./1-cloudfront.md)에서 첫 번째 로드 밸런서 앞에 CloudFront를 둔 것과 같은 방법으로 이 로드 밸런서 앞에도 CloudFront를 둡니다. [VPC 오리진](./1-cloudfront.md#vpc-오리진)에서처럼 `$IMAGES_ALB`의 VPC 오리진을 만들고, [배포](./1-cloudfront.md#배포)의 `distribution.json`으로 배포를 만듭니다. `Aliases`에는 이미지 호스트를, `ViewerCertificate`에는 그 `us-east-1` 인증서를, `Origins`에는 새 로드 밸런서의 DNS 이름과 새 VPC 오리진의 ID를 넣고, 고유한 `CallerReference`를 지정합니다. 함수와 `publira-images` 캐시 정책은 첫 번째 배포가 사용하는 것을 그대로 쓰며, `/images*` 동작은 첫 번째 배포에서처럼 이미지를 캐시합니다. `publira-images.json`에는 [클라이언트 주소](./1-cloudfront.md#클라이언트-주소)의 `PUBLIRA_TRUSTED_PROXIES`가 들어 있으며, 이 값은 이 배포와 이 로드 밸런서도 포함합니다.

배포가 완료되면 각 이미지 호스트가 그 도메인 이름을 가리키게 하고, [이미지 호스트](../../3-operations/2-tenants.md#이미지-호스트)에서 설명하듯 플랫폼 콘솔의 **이미지 호스트** 또는 `publiractl tenant update --image-domain`으로 이미지 호스트를 테넌트에 지정합니다. 나중에 추가하는 테넌트는 `aws elbv2 add-listener-certificates`로 새 리스너에 추가하는 인증서와, 새 배포 또는 전용 배포의 `Aliases`에 이미지 호스트를 넣어야 합니다.

### 공개 API

기존 로드 밸런서에 공개 API 전용 호스트 이름을 둡니다. 두 리전에서 `api.example.com`의 인증서를 요청하고, 로드 밸런서의 리전에 있는 인증서를 리스너에 추가한 다음, 그 호스트의 공개 API를 `publira-storefront`로 전달하는 규칙을 `900` 대역에 추가합니다.

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

우선순위는 대역에서 아직 어떤 규칙도 쓰지 않은 것을 고르세요. 이 호스트의 그 밖의 모든 경로는 리스너의 `404`를 받습니다. 예외는 `/images`로, `1000`의 규칙이 모든 호스트에서 이를 `publira-server`로 보내지만, 이 호스트는 어떤 테넌트에도 속하지 않으므로 그곳에서도 `404`로 응답합니다. 그런 다음 `distribution.json`으로 이 호스트의 배포를 만들고, `Aliases`에 `api.example.com`을, `ViewerCertificate`에 그 `us-east-1` 인증서를 넣고, 고유한 `CallerReference`를 지정한 뒤, `api.example.com`이 배포의 도메인 이름을 가리키게 합니다.

웹 앱은 이미 두 로드 밸런서를 모두 거치지 않고 VPC를 통해 `publira-storefront`를 호출합니다. `web-storefront`는 `PUBLIRA_GRPC_URL`로, `web-admin`은 [콘솔 서버에서 공개 API 빼기](#콘솔-서버에서-공개-api-빼기)를 마친 뒤 `PUBLIRA_PUBLIC_GRPC_URL`로 호출합니다. VPC 밖에서 실행되는 웹 앱은 대신 `https://api.example.com/rpc`를 지정합니다. 테넌트에 이미지 호스트가 생기면, [앱이 연결할 주소](../../5-mobile-app/2-building.md#앱이-연결할-주소)에서 설명하듯 테넌트의 모바일 앱을 `PUBLIRA_BASE_URL=https://api.example.com`으로 빌드하세요. 테넌트의 도메인은 규칙을 그대로 유지하므로, 테넌트의 도메인으로 빌드한 앱도 계속 동작합니다.

### 분할 확인

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

첫 번째는 `404`로 응답합니다. 이미지 호스트는 이미지 외에는 아무것도 제공하지 않습니다. 두 번째는 `publira-storefront`에 도달하며, 서버는 빈 요청을 `invalid_argument`로 거부합니다. 세 번째도 `404`로 응답합니다. API의 호스트는 이미지를 제공하지 않습니다. 그런 다음 테넌트의 사이트를 열어 보세요. 이미지가 `https://images.comics.example.com/images/…`에서 로드됩니다.

## 업그레이드

[업그레이드](../8-upgrading.md)는 설치 환경을 새 릴리스로 올립니다. 백업, 새 릴리스의 `publiractl`로 마이그레이션과 역할 적용, 그다음 프로세스 순서입니다. 먼저 그 페이지와 릴리스 노트를 읽으세요. ECS에서는 그 단계가 다음과 같이 됩니다.

아래의 모든 단계는 설치 환경이 실행하는 모든 서비스를 대상으로 합니다. `web-platform`, `email-renderer`, `publira-storefront`, `publira-images`를 실행한다면 이를 더해 한 번 나열해 두세요.

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **서비스 중지**: [먼저 프로세스를 멈출지 결정하기](../8-upgrading.md#먼저-프로세스를-멈출지-결정하기)에서 판단한 결과 먼저 중지하기로 했다면, 각 서비스가 실행하던 태스크 수를 기록한 뒤 모든 서비스의 태스크 수를 0으로 설정합니다.

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **데이터베이스 백업**: [데이터베이스 백업](../8-upgrading.md#1-데이터베이스-백업)에서 설명하듯, RDS 인스턴스나 Aurora 클러스터의 스냅숏으로 하거나, 데이터베이스에 접근할 수 있는 호스트에서 `pg_dump`로 합니다.
3. **마이그레이션과 역할 적용**: `publiractl-db-migrate.json`과 `publiractl-db-roles.json`에서 `<tag>`를 새 릴리스로 바꾸고, 둘 다 등록한 다음, `run_publiractl`로 그 순서대로 실행합니다. 각각이 성공했을 때만 다음으로 진행합니다. 역할 태스크는 각 역할에 그 파라미터가 가진 비밀번호, 즉 이미 가진 비밀번호를 주므로 변경 없이 실행합니다. 역할을 추가하는 릴리스에서는 그 역할의 비밀번호를 담는 파라미터, 그것을 변수로 설정하는 `secrets` 항목, 그 변수를 지정하는 플래그가 필요합니다.
4. **새 릴리스 시작**: 모든 서비스의 태스크 정의에서 `<tag>`를 바꾸고, 릴리스 노트에 나온 변수를 추가하고, 등록한 다음, 각 서비스를 새 리비전으로 업데이트합니다. 1단계에서 서비스를 중지했다면, 그 단계에서 `COUNT`에 기록한 이전 태스크 수로도 되돌립니다.

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **설치 환경 확인**: [설치 환경 확인](../8-upgrading.md#5-설치-환경-확인)에서 설명하는 대로 합니다.

반대로 업그레이드 중에도 서비스를 계속 실행한다면, 4단계에서 [프로세스 교체](../8-upgrading.md#4-프로세스-교체)에 나온 순서로 서비스를 교체합니다. `email-renderer`를 실행한다면 먼저 업데이트하고, 그다음 `SERVICES`에 다른 서비스를 지정해 4단계의 루프를 실행합니다. ECS는 설치 환경이 서비스를 계속하는 동안 태스크를 몇 개씩 교체합니다.
