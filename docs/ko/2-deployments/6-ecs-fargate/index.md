---
title: AWS Fargate의 Amazon ECS
description: 파라미터와 태스크 정의부터 테넌트 콘솔에 처음 로그인하기까지, CloudFront와 Application Load Balancer 뒤에서 AWS Fargate의 Amazon ECS 서비스로 설치 환경을 실행합니다.
published: 2026-11-03
updated: 2026-11-05
source_updated: 2026-11-05
---

이 페이지는 관리형 서비스를 준비한 VPC에서 시작해 테넌트 콘솔에 처음 로그인하기까지 설치 환경을 만들어 갑니다. 모든 프로세스는 AWS Fargate의 Amazon ECS 서비스이며, 엣지는 Application Load Balancer 앞의 CloudFront입니다. 단계는 [설치](../2-installing.md)와 같습니다. 각 단계가 왜 필요한지, 각 시크릿이 무엇을 보호하는지, 각 데이터베이스 역할이 무엇에 접근할 수 있는지는 그 페이지가 설명하며, 엣지는 [엣지](../4-edge/index.md#엣지가-해야-하는-일)가 요구하는 방식으로 앞에 둡니다. 이 페이지는 ECS와 Fargate에 고유한 부분, 즉 각 구성 요소가 어떤 리소스가 되는지, 그리고 두 페이지의 각 요구 사항을 그 리소스로 어떻게 충족하는지를 다룹니다.

아래의 명령과 JSON은 환경에 맞게 고쳐 쓰는 예시이며, 유지 관리되는 세트가 아닙니다. 저장소는 CloudFormation 템플릿, CDK 앱, Terraform 모듈을 제공하지 않습니다. 예시는 AWS CLI 버전 2용으로 작성되었으며, 공개된 이미지 `ghcr.io/publira/<name>:<tag>`를 지정합니다. [시작하기 전에](../2-installing.md#시작하기-전에)에서 설명하는 대로 `<tag>` 자리에 설치하는 릴리스의 버전을 쓰고, `<account>`와 `<region>` 자리에 계정 ID와 리전을 쓰세요.

## ECS에서 실행되는 것

오래 실행되는 프로세스는 모두 Fargate 시작 유형의 개별 ECS 서비스이며, 무언가가 호출하는 프로세스는 모두 같은 이름으로 AWS Cloud Map에 등록됩니다.

| ECS 서비스 | 이미지와 명령 | 포트 | 호출하는 곳 | 태스크 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 로드 밸런서, 그리고 Cloud Map을 통한 웹 앱 | 개수 제한 없음 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`, 명령으로 `worker` | `8003`, 헬스 체크 전용 | 없음 | 개수 제한 없음 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 로드 밸런서, 그리고 Cloud Map을 통한 서버와 워커의 캐시 재검증 | 개수 제한 없음 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | `web-storefront`와 같습니다 | 개수 제한 없음 |
| `web-platform`, 실행하는 경우 | `ghcr.io/publira/web-platform:<tag>` | `4100` | `web-storefront`와 같습니다 | 개수 제한 없음 |
| `email-renderer`, 실행하는 경우 | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Cloud Map을 통한 워커 | 개수 제한 없음 |

워커는 태스크를 여러 개 실행해도 됩니다. 모든 예약 작업은 실행 중인 동안 유일하므로, 두 태스크가 같은 작업을 동시에 실행하는 일은 없습니다. 반복되는 작업도 모두 워커가 직접 예약하므로 설치 환경에는 EventBridge 스케줄이나 예약된 태스크가 필요하지 않습니다. 서버나 워커의 태스크는 각각 데이터베이스 로그인마다 풀을 하나씩 열기 때문에, 태스크를 늘리려면 더 많은 연결을 받아들이는 데이터베이스가 필요합니다. 계산 방법은 [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)에 있습니다.

`publira server`와 `publira worker`는 하나의 `publira server --with-worker`가 아니라 위의 두 서비스로 실행하세요. 이 플래그는 호스트 한 대에 설치하는 경우를 위한 것입니다. ECS에서는 두 프로세스를 따로 확장할 수 없게 되고, [개요](../1-overview.md#설치-환경이-실행하는-것)에서 설명하듯 워커의 데이터베이스 로그인을 로드 밸런서가 요청을 전달하는 프로세스에 두게 되며, ECS에 필요한 것은 아무것도 얻지 못합니다.

프로세스는 `publira-server.publira.internal`처럼 Cloud Map 서비스 검색이 부여하는 이름으로 서로를 호출하며, 이 이름은 실행 중인 각 태스크의 주소로 확인됩니다. 따라서 호출은 호출자 자신의 주소에서 태스크에 직접 도달합니다. ECS Service Connect를 쓰면 대신 각 호출이 받는 쪽 태스크의 프록시를 거쳐 `127.0.0.1`에서 전달되며, `publira server`는 웹 앱이 독자를 위해 보내는 모든 요청을 그 주소로 기록하게 됩니다.

`publiractl`은 계속 실행해 두지 않습니다. 설치하는 릴리스의 이미지로 `aws ecs run-task`로 시작하는 태스크로 실행하며, 명령이 끝나면 멈춥니다.

## 시작하기 전에

다음이 필요합니다.

- **AWS CLI 버전 2**: ECS, Cloud Map, Elastic Load Balancing, CloudFront, ACM, IAM 역할, Systems Manager 파라미터, EC2 보안 그룹, CloudWatch Logs를 관리할 권한이 있는 계정에 로그인되어 있어야 합니다.
- **VPC**: 태스크와 로드 밸런서를 위해 가용 영역 두 개 이상에 프라이빗 서브넷이 있어야 하며, 각 서브넷에는 CloudFront가 그곳에 만드는 네트워크 인터페이스를 위한 빈 주소가 하나 이상 있어야 합니다. 또한 인터넷 게이트웨이가 연결되어 있어야 합니다. 아무것도 그것을 통해 라우팅되지 않더라도, CloudFront는 VPC 오리진으로 접근하는 로드 밸런서가 있는 VPC에 이를 요구합니다. 태스크는 이미지를 가져오기 위한 GitHub Container Registry, Systems Manager와 CloudWatch Logs API, Amazon S3, 그리고 SMTP 서버에 접근할 수 있어야 합니다. 프라이빗 서브넷에 NAT 게이트웨이를 두거나, AWS 서비스용 VPC 엔드포인트와 이미지용 풀스루 캐시를 두세요.
- **설치 환경이 의존하는 서비스**: [서비스 준비](../2-installing.md#서비스-준비)에 나열된 대로 준비합니다.
  - **Amazon RDS for PostgreSQL 또는 Aurora PostgreSQL**: 데이터베이스를 초기 데이터베이스로 만듭니다. 마스터 사용자가 관리용 로그인입니다. 슈퍼유저는 아니지만 그 데이터베이스를 소유하고 역할을 만들 수 있으며, `publiractl db`에 필요한 것은 그것뿐입니다.
  - **Amazon ElastiCache for Valkey 또는 Redis OSS**: 클러스터 모드를 끄고, 전송 중 암호화를 켜고, AUTH 토큰을 둔 노드 기반 클러스터로 둡니다. Publira는 기본 엔드포인트에 단일 서버처럼 연결하므로, 클러스터 모드를 사용하는 클라이언트만 받아들이는 ElastiCache Serverless는 동작하지 않습니다.
  - **Amazon S3 버킷**: 비어 있어야 합니다. 프로세스는 아래의 태스크 역할로 버킷에 접근하므로, 액세스 키를 만들거나 저장하지 않습니다.
  - **Amazon SES** 또는 다른 SMTP 서버: SMTP 자격 증명과 발신용으로 확인된 주소가 필요합니다.
- **DNS**: 테넌트의 도메인과 그 콘솔 호스트(`admin.<domain>` 또는 `--admin-domain`으로 지정할 호스트)를 CloudFront 배포가 생기면 그쪽으로 가리키게 하고, ACM이 인증서 검증을 위해 요구하는 CNAME 레코드를 추가할 수 있어야 합니다.

아래의 명령은 다음 셸 변수를 사용합니다. 자신의 값으로 설정하세요.

```bash
REGION=ap-northeast-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
VPC=vpc-0123456789abcdef0
VPC_CIDR=10.0.0.0/16
SUBNETS=subnet-0123456789abcdef0,subnet-0fedcba9876543210
DB_SG=sg-0123456789abcdef0       # the RDS instance's or cluster's security group
VALKEY_SG=sg-0fedcba9876543210   # the ElastiCache cluster's security group

export AWS_REGION=$REGION
aws ecs create-cluster --cluster-name publira
aws logs create-log-group --log-group-name /publira
```

아래의 단계는 이 하나의 셸에서 실행하세요. 각 단계는 앞 단계에서 정의한 변수와 함수를 사용합니다. 아래의 모든 태스크 정의는 컨테이너의 출력을 `/publira` 로그 그룹에, 컨테이너마다 스트림 하나씩 보냅니다.

## 1. 시크릿 저장

[시크릿 생성](../2-installing.md#시크릿-생성)에 설치 환경에 필요한 모든 시크릿과 각각이 보호하는 대상이 나열되어 있습니다. 각각을 Systems Manager Parameter Store의 `/publira/` 아래에 `SecureString` 파라미터로 저장하세요. 태스크 정의는 `secrets`에서 파라미터를 지정하고, ECS는 컨테이너가 시작될 때 그 값을 환경 변수로 설정합니다. 따라서 재검증 토큰처럼 여러 프로세스가 공유하는 값은 한 번만 저장하고 각 프로세스에서 지정합니다. 연결 URL에는 역할 비밀번호가 들어 있으므로 이것도 파라미터이며, AUTH 토큰이 들어 있는 Valkey URL도 마찬가지입니다.

```bash
put() { aws ssm put-parameter --type SecureString --name "/publira/$1" --value "$2" > /dev/null; }

put secret-encryption-keys "k1:$(openssl rand -base64 32)"
put auth-jwt-secret "$(openssl rand -base64 32)"
put storefront-auth-secret "$(openssl rand -base64 32)"
put admin-auth-secret "$(openssl rand -base64 32)"
put revalidate-token "$(openssl rand -hex 32)"
put web-service-token "$(openssl rand -base64 32)"
put redis-url "rediss://:<AUTH token>@master.publira.abc123.apne1.cache.amazonaws.com:6379"

DB="publira.cluster-abc123.ap-northeast-1.rds.amazonaws.com:5432/publira?sslmode=require"
put db-url/master "postgres://<master user>:<master password>@$DB"
for role in public admin platform outbox ticker content-stats; do
  password="$(openssl rand -hex 32)"
  put "db-password/$role" "$password"
  put "db-url/$role" "postgres://publira_${role//-/_}:$password@$DB"
done
```

위의 값 대신 사용하는 ElastiCache 기본 엔드포인트와 RDS 엔드포인트를 쓰세요. `rediss://`는 선택 사항이 아닙니다. ElastiCache 클러스터는 전송 중 암호화가 켜져 있을 때만 AUTH 토큰을 받으며, `publira server`는 비밀번호가 들어 있는 `redis://` URL로는 시작을 거부합니다. 연결 URL은 비밀번호를 이스케이프하지 않고 담으므로, AUTH 토큰과 마스터 비밀번호에는 위의 16진수 출력처럼 URL에 안전한 문자를 쓰거나, 그 밖의 문자는 퍼센트 인코딩하세요. `sslmode=require`는 인증서를 검사하지 않고 연결을 암호화합니다. 인증서는 이미지가 신뢰하는 인증 기관이 아니라 RDS 인증 기관이 서명한 것이기 때문입니다.

| 파라미터 | 읽는 곳 | 변수 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`, `publira-worker`, `publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`, `admin-auth-secret` | `web-storefront`와 `web-admin`이 각각 하나씩 | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`, `publira-worker`, `web-storefront`, `web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`와 `web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`와 `web-storefront`; `web-storefront`와 `web-admin` | `PUBLIRA_REDIS_URL`; `PNCH_REDIS_URL` |
| `db-url/public`, `db-url/admin`, `db-url/platform` | `publira-server`, 그리고 `db-url/platform`은 `publiractl setup`도 | `PUBLIRA_PUBLIC_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`, `db-url/ticker`, `db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | `db` 태스크만. [관리용 로그인](../2-installing.md#서비스-준비)의 연결을 읽는 것은 `db` 명령뿐이므로, 계속 실행되는 어떤 것에도 전달하지 않습니다 | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles` 태스크 | 역할마다 `PUBLIRA_PUBLIC_DB_PASSWORD` 같은 변수 하나씩. [데이터베이스 역할 만들기](#데이터베이스-역할-만들기)에서 설명하듯 `db roles`가 `--<role>-password-env` 플래그로 읽습니다 |

파라미터는 백업이 아닙니다. 암호화 키는 자체 시크릿 저장소에도 보관하세요. 키를 잃어버리면 [시크릿 생성](../2-installing.md#시크릿-생성)에서 말하듯, 설치 환경이 저장한 모든 자격 증명을 다시 입력해야 합니다. ECS는 컨테이너가 시작될 때 값을 읽으므로, 변경한 파라미터는 다음 배포에서야 서비스에 반영됩니다. 대신 AWS Secrets Manager에 값을 보관한다면, 파라미터 이름 대신 `valueFrom`에 각 시크릿(또는 시크릿의 JSON 키)을 지정하고, 아래의 `ssm:GetParameters` 문 대신 그 시크릿에 대한 `secretsmanager:GetSecretValue`를 태스크 실행 역할에 부여하세요.

## 2. IAM 역할 만들기

모든 태스크에 두 역할을 사용합니다. 태스크 실행 역할은 ECS가 이미지를 가져오고, 로그를 쓰고, 파라미터를 읽는 데 쓰는 역할이며, 컨테이너는 이 역할을 가지지 않습니다. 태스크 역할은 프로세스가 S3로 보내는 요청에 서명하는 데 쓰는 역할입니다.

```bash
cat > ecs-tasks-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role --role-name publira-task-execution \
  --assume-role-policy-document file://ecs-tasks-trust.json
aws iam attach-role-policy --role-name publira-task-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name publira-task-execution --policy-name publira-parameters \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"ssm:GetParameters\",
      \"Resource\": \"arn:aws:ssm:$REGION:$ACCOUNT:parameter/publira/*\"
    }]
  }"

aws iam create-role --role-name publira-storage \
  --assume-role-policy-document file://ecs-tasks-trust.json
aws iam put-role-policy --role-name publira-storage --policy-name publira-images \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource": "arn:aws:s3:::publira-images/*"
      },
      {
        "Effect": "Allow",
        "Action": "s3:ListBucket",
        "Resource": "arn:aws:s3:::publira-images"
      }
    ]
  }'
```

`publira-images` 자리에 버킷 이름을 쓰세요. 파라미터는 Systems Manager의 AWS 관리형 키로 암호화되며, 이 키에는 권한 부여가 필요 없습니다. 자체 키로 암호화한 파라미터에는 그 키에 대한 `kms:Decrypt`도 필요합니다.

`publira-storage`는 `publira-server`, `publira-worker`, 그리고 `publiractl setup` 태스크의 태스크 역할입니다. 서버는 이미지를 업로드하고 읽으며, 워커는 더 이상 쓰이지 않는 이미지를 삭제하고, `setup`은 이 역할로 연결 테스트에 서명합니다. 각각의 AWS SDK는 태스크 역할이 있는 모든 태스크에 ECS가 설정하는 변수에서 역할의 자격 증명을 스스로 찾습니다. 따라서 [설치 환경 설정](#7-설치-환경-설정)은 [오브젝트 스토리지](../../3-operations/5-object-storage.md)에서 설명하듯 액세스 키 없이 버킷을 저장합니다. 웹 앱과 `db` 태스크에는 태스크 역할이 필요 없습니다.

## 3. 네트워크 경로 열기

설치 환경의 각 구성 요소에는 자신을 호출하는 것만 허용하는 보안 그룹을 둡니다. ECS는 태스크를 교체할 때마다 태스크의 주소를 바꾸므로, 모든 규칙은 주소가 아니라 호출자의 보안 그룹을 지정합니다.

```bash
sg() { aws ec2 create-security-group --vpc-id "$VPC" --group-name "$1" --description "$1" --query GroupId --output text; }
allow() { aws ec2 authorize-security-group-ingress --group-id "$1" --protocol tcp --port "$2" --source-group "$3" > /dev/null; }

ALB_SG=$(sg publira-alb)
SERVER_SG=$(sg publira-server)
WORKER_SG=$(sg publira-worker)
WEB_SG=$(sg publira-web)
PUBLIRACTL_SG=$(sg publiractl)

allow "$SERVER_SG" 8000 "$ALB_SG"
allow "$SERVER_SG" 8000 "$WEB_SG"
for port in 3000 4000; do
  allow "$WEB_SG" "$port" "$ALB_SG"
  allow "$WEB_SG" "$port" "$SERVER_SG"
  allow "$WEB_SG" "$port" "$WORKER_SG"
done
for caller in "$SERVER_SG" "$WORKER_SG" "$PUBLIRACTL_SG"; do
  allow "$DB_SG" 5432 "$caller"
done
for caller in "$SERVER_SG" "$WEB_SG"; do
  allow "$VALKEY_SG" 6379 "$caller"
done
```

| 보안 그룹 | 허용하는 포트 | 출발지 |
| --- | --- | --- |
| `publira-alb` | `443` | CloudFront만. [VPC 오리진](./1-cloudfront.md#vpc-오리진)에서 추가합니다 |
| `publira-server` | `8000` | 로드 밸런서, 그리고 API를 호출하는 웹 앱 |
| `publira-web` | `3000`, `4000` | 로드 밸런서, 그리고 캐시 재검증을 보내는 서버와 워커 |
| `publira-worker`, `publiractl` | 없음 | 호출하는 곳이 없습니다 |
| 데이터베이스의 보안 그룹 | `5432` | 서버, 워커, `publiractl` |
| Valkey 클러스터의 보안 그룹 | `6379` | 서버와 웹 앱 |

워커와 `publiractl`은 Valkey에, 웹 앱은 데이터베이스에 접근할 일이 없으므로 그 경로는 열지 않습니다. 모든 그룹은 외부로 연결할 수 있게 하는 기본 규칙을 유지합니다. 태스크는 이미지, AWS API, S3, SMTP를 위해 이 규칙이 필요합니다.

Cloud Map은 무언가가 호출하는 각 서비스에 VPC의 프라이빗 DNS 네임스페이스 아래 이름을 부여합니다.

```bash
aws servicediscovery create-private-dns-namespace --name publira.internal --vpc "$VPC"
NAMESPACE=$(aws servicediscovery list-namespaces \
  --query "Namespaces[?Name=='publira.internal'].Id" --output text)
for name in publira-server web-storefront web-admin; do
  aws servicediscovery create-service --name "$name" --namespace-id "$NAMESPACE" \
    --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
    --health-check-custom-config FailureThreshold=1 > /dev/null
done
registry() { aws servicediscovery list-services \
  --filters "Name=NAMESPACE_ID,Values=$NAMESPACE,Condition=EQ" \
  --query "Services[?Name=='$1'].Arn" --output text; }
```

네임스페이스가 만들어지기까지 잠시 걸립니다. ID가 응답될 때까지 `list-namespaces`를 다시 실행하세요. ECS는 태스크가 시작될 때 각 태스크의 주소를 서비스 이름 아래에 등록하고, 태스크가 멈추면 제거합니다.

## 4. 마이그레이션 적용과 데이터베이스 역할 만들기

`db` 명령은 릴리스의 `publiractl` 이미지로, 관리용 로그인의 연결을 사용해 일회성 태스크로 실행합니다. 모든 태스크를 같은 방법으로 시작하고 기다리므로, 이를 한 번 정의해 둡니다.

```bash
run_publiractl() {
  local task code
  task=$(aws ecs run-task --cluster publira --launch-type FARGATE --task-definition "$1" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$PUBLIRACTL_SG],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text) || return
  echo "$task"
  aws ecs wait tasks-stopped --cluster publira --tasks "$task" || return
  aws logs tail /publira --log-stream-name-prefix "$1/publiractl/${task##*/}"
  code=$(aws ecs describe-tasks --cluster publira --tasks "$task" \
    --query "tasks[0].containers[?name=='publiractl'].exitCode | [0]" --output text)
  echo "exit code: $code"
  [ "$code" = 0 ]
}
```

이 함수는 태스크의 ARN, 명령의 로그, 종료 코드를 출력하며, 코드가 `0`이 아니면 실패하므로 이를 실행하는 스크립트는 거기서 멈출 수 있습니다. `aws ecs wait tasks-stopped`는 태스크가 멈췄든 아니든 10분이 지나면 기다리기를 멈추며, 함수도 함께 실패합니다. 로그를 읽기 전에 출력된 ARN으로 다시 기다리세요. 이미지를 가져올 수 없었던 경우처럼 시작조차 하지 않은 태스크에는 종료 코드가 없으며, 함수는 이를 `None`으로 출력합니다. 그 이유는 `aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`이 알려 줍니다.

### 마이그레이션 적용

`publiractl-db-migrate.json`:

```json
{
  "family": "publiractl-db-migrate",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": ["db", "migrate"],
      "secrets": [
        { "name": "PUBLIRA_DB_URL", "valueFrom": "/publira/db-url/master" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-db-migrate"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-db-migrate.json
run_publiractl publiractl-db-migrate
```

`run-task`로 시작한 태스크는 한 번만 실행되며, 실패해도 ECS가 다시 시작하지 않습니다. 이는 실패한 마이그레이션에 필요한 동작입니다. 실패한 마이그레이션은 데이터베이스를 dirty 상태로 표시하며, 이는 [마이그레이션이 실패했을 때](../8-upgrading.md#마이그레이션이-실패했을-때)에 따라 직접 해결합니다. 그 복구 절차의 마지막 단계처럼 다시 실행할 때도 같은 `run_publiractl`을 사용합니다.

### 데이터베이스 역할 만들기

Fargate 태스크는 `db roles`가 비밀번호를 읽을 stdin도 터미널도 제공하지 않으며, ECS는 컨테이너에 시크릿을 파일이 아니라 환경 변수로 전달합니다. 그래서 태스크의 `secrets`가 역할 비밀번호마다 변수를 하나씩 설정하고, `db roles`는 `--<role>-password-env` 플래그로 각각을 읽습니다. 명령에는 변수의 이름만 들어가므로, 태스크 정의에도 프로세스 목록에도 비밀번호가 나타나지 않습니다.

`publiractl-db-roles.json`:

```json
{
  "family": "publiractl-db-roles",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": [
        "db",
        "roles",
        "--public-password-env",
        "PUBLIRA_PUBLIC_DB_PASSWORD",
        "--admin-password-env",
        "PUBLIRA_ADMIN_DB_PASSWORD",
        "--platform-password-env",
        "PUBLIRA_PLATFORM_DB_PASSWORD",
        "--outbox-password-env",
        "PUBLIRA_OUTBOX_DB_PASSWORD",
        "--ticker-password-env",
        "PUBLIRA_TICKER_DB_PASSWORD",
        "--content-stats-password-env",
        "PUBLIRA_CONTENT_STATS_DB_PASSWORD"
      ],
      "secrets": [
        { "name": "PUBLIRA_DB_URL", "valueFrom": "/publira/db-url/master" },
        {
          "name": "PUBLIRA_PUBLIC_DB_PASSWORD",
          "valueFrom": "/publira/db-password/public"
        },
        {
          "name": "PUBLIRA_ADMIN_DB_PASSWORD",
          "valueFrom": "/publira/db-password/admin"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_PASSWORD",
          "valueFrom": "/publira/db-password/platform"
        },
        {
          "name": "PUBLIRA_OUTBOX_DB_PASSWORD",
          "valueFrom": "/publira/db-password/outbox"
        },
        {
          "name": "PUBLIRA_TICKER_DB_PASSWORD",
          "valueFrom": "/publira/db-password/ticker"
        },
        {
          "name": "PUBLIRA_CONTENT_STATS_DB_PASSWORD",
          "valueFrom": "/publira/db-password/content-stats"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-db-roles"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-db-roles.json
run_publiractl publiractl-db-roles
```

로그에는 역할마다 한 줄씩 출력됩니다. 나중에 역할의 비밀번호를 교체할 때도 같은 태스크를 사용합니다. `aws ssm put-parameter --overwrite`로 새 비밀번호를 그 역할의 `db-password/` 파라미터와, 비밀번호가 들어 있는 `db-url/` 파라미터에 넣습니다(위의 `put`은 실수로 값을 바꾸지 않도록 이 옵션을 뺐습니다). 그런 다음 태스크를 다시 실행하고, 그 역할로 연결하는 서비스를 다시 배포해 태스크가 새 URL로 시작되게 합니다. `publira-server`가 URL을 가지고 있는 `publira_admin`의 경우는 다음과 같습니다.

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. 로드 밸런서 만들기

로드 밸런서는 각 호스트와 경로를 알맞은 서비스로 라우팅합니다. 로드 밸런서는 내부용이며 인터넷 주소가 없습니다. CloudFront는 [VPC 오리진](./1-cloudfront.md#vpc-오리진)에서 설정하는 대로 VPC 오리진으로서 로드 밸런서에 접근합니다. 그래도 로드 밸런서는 제공하는 모든 호스트의 인증서로 TLS를 종단합니다. CloudFront는 브라우저가 보낸 `Host`를 전달하고, 로드 밸런서로부터 그 이름의 인증서만 받아들이기 때문입니다. 또한 로드 밸런서는 요청이 HTTPS 리스너에 도착했을 때만 웹 앱에 요청이 HTTPS로 도착했다고 알려 주기 때문입니다.

테넌트마다 그 도메인과 콘솔 호스트를 지정한 인증서를 ACM에 하나씩 요청하고, ACM이 알려 주는 CNAME 레코드로 검증하세요. CloudFront는 `us-east-1`의 인증서만 받으므로, 로드 밸런서가 `us-east-1`에 있어 인증서 하나로 둘 다 쓸 수 있는 경우가 아니라면 그곳에도 요청합니다.

```bash
for region in "$REGION" us-east-1; do
  aws acm request-certificate --region "$region" \
    --domain-name comics.example.com --subject-alternative-names admin.comics.example.com \
    --validation-method DNS --query CertificateArn --output text
done
```

```bash
aws acm describe-certificate --region "$REGION" --certificate-arn <the certificate ARN> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
aws acm wait certificate-validated --region "$REGION" --certificate-arn <the certificate ARN>
```

첫 번째 명령이 출력하는 레코드를 각 이름의 영역에 추가하고, `us-east-1`의 인증서에 대해서도 같은 작업을 합니다. 그런 다음 로드 밸런서, 전달 대상 서비스마다 대상 그룹 하나, 그리고 어떤 규칙과도 일치하지 않는 요청에 `404`로 응답하는 HTTPS 리스너를 만듭니다.

```bash
ALB=$(aws elbv2 create-load-balancer --name publira --type application --scheme internal \
  --subnets ${SUBNETS//,/ } --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

target_group() { aws elbv2 create-target-group --name "$1" --protocol HTTP --port "$2" \
  --target-type ip --vpc-id "$VPC" --health-check-path /livez \
  --query 'TargetGroups[0].TargetGroupArn' --output text; }
SERVER_TG=$(target_group publira-server 8000)
STOREFRONT_TG=$(target_group web-storefront 3000)
ADMIN_TG=$(target_group web-admin 4000)

LISTENER=$(aws elbv2 create-listener --load-balancer-arn "$ALB" --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn=<the certificate ARN in the load balancer's Region> \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' \
  --query 'Listeners[0].ListenerArn' --output text)
aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$ALB" \
  --attributes Key=idle_timeout.timeout_seconds,Value=120 > /dev/null
```

리스너의 규칙은 [라우팅](../4-edge/index.md#라우팅)을 따릅니다. 규칙 하나는 조건마다 값을 최대 세 개, 모든 조건을 합쳐 최대 다섯 개까지 받으며, 로드 밸런서는 우선순위가 낮은 것부터 차례로 규칙을 시도합니다.

| 우선순위 | 호스트 | 경로 | 전달 대상 |
| --- | --- | --- | --- |
| `1000` | 모든 호스트 | `/images*`, `/rpc/publira.v1.*` | `publira-server` |
| `1100` | 모든 호스트 | `/rpc`, `/rpc/*` | 없음: 고정 `404` |
| `2000` ~ `2999` | 테넌트의 도메인 | 모든 경로 | `web-storefront` |
| `2000` ~ `2999` | 테넌트의 콘솔 호스트 | 모든 경로 | `web-admin` |

```bash
rule() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" --actions "Type=forward,TargetGroupArn=$3" > /dev/null; }
not_found() { aws elbv2 create-rule --listener-arn "$LISTENER" --priority "$1" \
  --conditions "$2" \
  --actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain}' > /dev/null; }
host_is() { printf '{"Field":"host-header","HostHeaderConfig":{"Values":["%s"]}}' "$1"; }
path_is() { printf '{"Field":"path-pattern","PathPatternConfig":{"Values":%s}}' "$1"; }

rule 1000 "[$(path_is '["/images*","/rpc/publira.v1.*"]')]" "$SERVER_TG"
not_found 1100 "[$(path_is '["/rpc","/rpc/*"]')]"
rule 2001 "[$(host_is comics.example.com)]" "$STOREFRONT_TG"
rule 2002 "[$(host_is admin.comics.example.com)]" "$ADMIN_TG"
```

`/rpc` 아래에서는 공개 API인 `publira.v1`만 전달합니다. 콘솔은 자체 API를 VPC를 통해 호출하므로, [공개 API만 엣지를 거친다](../4-edge/index.md#공개-api만-엣지를-거친다)에서 설명하듯 나머지에는 로드 밸런서가 직접 `404`로 응답합니다. 자체 시스템이 VPC 밖에서 API 키를 사용하는 테넌트에는 [키로 보낼 수 있는 읽기 요청](../4-edge/index.md#api-키로-보낼-수-있는-읽기-요청)의 전달도 필요합니다. 우선순위 `1100`보다 앞서는 규칙을 만들어 `publira-server`로 전달하되, 각 규칙에는 콘솔 호스트와 경로 세 개를 지정하세요. 세 개는 조건 하나가 받는 최대치입니다. 경로 패턴은 `*`가 임의의 문자를 나타내는 문자열로 일치시킵니다. 따라서 `/rpc/publira.v1.*`는 `v1` 뒤의 점까지 공개 API의 접두사를 지정하므로 `publira.v1beta` 같은 네임스페이스는 제외되며, `/rpc`와 `/rpc/*`를 두 값으로 나눈 것은 `/rpcabc`가 웹 앱으로 가도록 하기 위해서입니다. `1000`과 `1100`의 규칙은 호스트를 지정하지 않으므로 로드 밸런서가 받는 모든 호스트에 적용되며, 이는 라우팅이 모든 테넌트의 호스트에 요구하는 것입니다. 다른 어떤 규칙에도 없는 호스트는 그 밖의 모든 경로에서 `404`를 받습니다. 로드 밸런서는 경로와 `Host` 헤더를 브라우저가 보낸 그대로 전달합니다. 어느 쪽도 다시 쓰지 마세요.

로드 밸런서는 본문 크기를 제한하지 않으며, 요청이 계속 전송되는 한 시간이 얼마나 걸려도 허용합니다. 따라서 [엣지](../4-edge/index.md#페이지에서의-이미지-업로드)에서 설명하는 업로드와 웹훅은 그대로 통과합니다. 유휴 타임아웃은 어느 방향이든 다음 바이트를 기다리는 시간이며, 요청이 도착한 뒤 웹 앱의 응답을 기다리는 시간도 포함합니다. 변경하지 않으면 60초이며, 위의 명령은 이를 [배포](./1-cloudfront.md#배포)에서 설정하는 CloudFront의 대기 시간인 120초로 늘립니다.

## 6. 서비스 시작

각 서비스는 시크릿을 파라미터에서 받고, [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)에 나열된 나머지 변수는 태스크 정의에서 받습니다. 아래의 크기는 조정을 위한 출발점이며, `ARM64`는 `X86_64`로 해도 됩니다. 모든 이미지는 두 아키텍처용으로 공개됩니다.

`publira server`와 `publira worker`는 종료 지시를 받은 뒤 30초 안에 멈추므로, [복제본 멈추기](../7-scaling-out.md#복제본-멈추기)에서 설명하듯 컨테이너 정의는 ECS가 강제 종료하기 전까지 기본값 30초 대신 45초의 `stopTimeout`을 줍니다.

`publira-server.json`:

```json
{
  "family": "publira-server",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publira-server",
      "image": "ghcr.io/publira/publira:<tag>",
      "portMappings": [{ "containerPort": 8000 }],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" },
        {
          "name": "PUBLIRA_WEB_STOREFRONT_INTERNAL_URL",
          "value": "http://web-storefront.publira.internal:3000"
        },
        {
          "name": "PUBLIRA_WEB_ADMIN_INTERNAL_URL",
          "value": "http://web-admin.publira.internal:4000"
        },
        {
          "name": "PUBLIRA_TRUSTED_PROXIES",
          "value": "<see The client address>"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_AUTH_JWT_SECRET",
          "valueFrom": "/publira/auth-jwt-secret"
        },
        {
          "name": "PUBLIRA_WEB_SERVICE_TOKEN",
          "valueFrom": "/publira/web-service-token"
        },
        {
          "name": "PUBLIRA_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        { "name": "PUBLIRA_REDIS_URL", "valueFrom": "/publira/redis-url" },
        {
          "name": "PUBLIRA_PUBLIC_DB_URL",
          "valueFrom": "/publira/db-url/public"
        },
        {
          "name": "PUBLIRA_ADMIN_DB_URL",
          "valueFrom": "/publira/db-url/admin"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": "/publira/db-url/platform"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/usr/bin/bash",
          "-c",
          "exec 3<>/dev/tcp/127.0.0.1/8000 && printf 'GET /livez HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1\\.[01] 200' <&3"
        ],
        "startPeriod": 30
      },
      "stopTimeout": 45,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publira-server"
        }
      }
    }
  ]
}
```

`PUBLIRA_TRUSTED_PROXIES`의 값은 [클라이언트 주소](./1-cloudfront.md#클라이언트-주소)에 있습니다.

`publira-worker.json`은 같은 이미지를 명령 `worker`로 실행하며, 헬스 체크는 포트 `8003`을 검사합니다.

```json
{
  "family": "publira-worker",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publira-worker",
      "image": "ghcr.io/publira/publira:<tag>",
      "command": ["worker"],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" },
        {
          "name": "PUBLIRA_WEB_STOREFRONT_INTERNAL_URL",
          "value": "http://web-storefront.publira.internal:3000"
        },
        {
          "name": "PUBLIRA_WEB_ADMIN_INTERNAL_URL",
          "value": "http://web-admin.publira.internal:4000"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        {
          "name": "PUBLIRA_WORKER_DB_URL",
          "valueFrom": "/publira/db-url/outbox"
        },
        {
          "name": "PUBLIRA_TICKER_DB_URL",
          "valueFrom": "/publira/db-url/ticker"
        },
        {
          "name": "PUBLIRA_CONTENT_STATS_DB_URL",
          "valueFrom": "/publira/db-url/content-stats"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/usr/bin/bash",
          "-c",
          "exec 3<>/dev/tcp/127.0.0.1/8003 && printf 'GET /livez HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1\\.[01] 200' <&3"
        ],
        "startPeriod": 30
      },
      "stopTimeout": 45,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publira-worker"
        }
      }
    }
  ]
}
```

`web-storefront.json`도 같은 형태이지만 태스크 역할이 없으며, `publira server`를 Cloud Map 이름으로 호출합니다.

```json
{
  "family": "web-storefront",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "ARM64"
  },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "containerDefinitions": [
    {
      "name": "web-storefront",
      "image": "ghcr.io/publira/web-storefront:<tag>",
      "portMappings": [{ "containerPort": 3000 }],
      "environment": [
        {
          "name": "PUBLIRA_GRPC_URL",
          "value": "http://publira-server.publira.internal:8000/rpc"
        },
        {
          "name": "PUBLIRA_TRUSTED_PROXIES",
          "value": "<see The client address>"
        }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_AUTH_SECRET",
          "valueFrom": "/publira/storefront-auth-secret"
        },
        {
          "name": "PUBLIRA_REVALIDATE_TOKEN",
          "valueFrom": "/publira/revalidate-token"
        },
        { "name": "PNCH_REDIS_URL", "valueFrom": "/publira/redis-url" },
        { "name": "PUBLIRA_REDIS_URL", "valueFrom": "/publira/redis-url" }
      ],
      "healthCheck": {
        "command": [
          "CMD",
          "/nodejs/bin/node",
          "-e",
          "fetch('http://127.0.0.1:3000/livez').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
        ],
        "startPeriod": 30
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "web-storefront"
        }
      }
    }
  ]
}
```

`web-storefront`는 테넌트의 Google tag gateway에 전달할 독자의 주소를 찾기 위해 `publira server`와 같은 `PUBLIRA_TRUSTED_PROXIES`를 받습니다. `web-admin.json`은 다음을 바꾼 것 외에는 같습니다. `web-storefront`가 나오는 모든 곳을 `web-admin`으로, 포트를 헬스 체크에서도 `3000` 대신 `4000`으로, `PUBLIRA_AUTH_SECRET`을 `/publira/admin-auth-secret`으로 하고, `web-admin`이 읽지 않는 `PUBLIRA_TRUSTED_PROXIES`를 빼고, 시크릿 하나(`/publira/web-service-token`의 `PUBLIRA_WEB_SERVICE_TOKEN`)를 추가합니다.

네 개를 등록하고, 각각이 쓰는 보안 그룹, 대상 그룹, Cloud Map 이름으로 서비스를 하나씩 만듭니다.

```bash
for family in publira-server publira-worker web-storefront web-admin; do
  aws ecs register-task-definition --cli-input-json "file://$family.json" > /dev/null
done

service() {
  local name=$1 sg=$2 port=$3 tg=$4
  set -- --cluster publira --service-name "$name" --task-definition "$name" \
    --desired-count 2 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=DISABLED}"
  if [ -n "$tg" ]; then
    set -- "$@" --load-balancers "targetGroupArn=$tg,containerName=$name,containerPort=$port" \
      --service-registries "registryArn=$(registry "$name")" --health-check-grace-period-seconds 60
  fi
  aws ecs create-service "$@" > /dev/null
}
service publira-server "$SERVER_SG" 8000 "$SERVER_TG"
service publira-worker "$WORKER_SG"
service web-storefront "$WEB_SG" 3000 "$STOREFRONT_TG"
service web-admin "$WEB_SG" 4000 "$ADMIN_TG"

aws ecs wait services-stable --cluster publira \
  --services publira-server publira-worker web-storefront web-admin
```

`publira-worker`는 시작할 때 작업 큐의 테이블을 만들므로 별도의 태스크가 필요 없습니다. 안정 상태가 되지 않는 서비스는 태스크를 계속 중지하며, `aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`가 그 이유를 알려 줍니다. 헬스 체크에 실패한 태스크이거나 멈춘 태스크이며, 후자는 `/publira`의 로그에 원인이 나옵니다. 예를 들어 비밀번호가 연결 URL과 일치하지 않는 역할입니다.

### 헬스 체크

ECS 서비스는 헬스 체크에 실패한 태스크를 종류에 상관없이 교체하므로, 이 페이지의 모든 헬스 체크는 프로세스 자체가 응답을 멈췄을 때만 실패하는 `/livez`를 검사합니다. `/readyz`를 가리키게 하면 데이터베이스가 응답을 멈추는 순간 ECS가 서비스의 모든 태스크를 한꺼번에 교체하게 되며, 이는 [오케스트레이터에서 프로브하기](../../3-operations/11-monitoring.md#오케스트레이터에서-프로브하기)가 경고하는 상황입니다.

- **모든 서비스**는 태스크 정의에 헬스 체크가 있으며, ECS가 이를 태스크 안에서 실행합니다. 이미지에는 HTTP 클라이언트가 없으므로, 각 확인은 이미지에 있는 것을 사용합니다. `publira` 이미지에서는 `/dev/tcp`로 연결을 여는 `bash`를, 셸이 없는 웹 이미지에서는 `fetch`로 요청을 보내는 `node`를 사용합니다. 각 확인은 컨테이너 자신의 포트에서 `/livez`를 요청하고, `200`이면 통과합니다. ECS 헬스 체크의 기본값대로 30초마다 실행하고, 5초 뒤에 포기하며, 세 번 연속 실패하면 태스크를 비정상으로 표시합니다. `startPeriod`는 실패를 세기 전에 프로세스가 시작할 시간을 30초 줍니다. Cloud Map은 이 확인이 통과하면 태스크의 주소를 정상으로 표시하고, 실패하면 제거하므로, 서비스들이 서로를 호출하는 이름도 같은 확인을 따릅니다.
- **`publira-server`와 웹 앱**은 대상 그룹도 검사하며, `--health-check-path /livez`가 같은 경로를 가리키게 합니다. ECS는 태스크가 시작된 뒤 `--health-check-grace-period-seconds`만큼 기다린 다음 이 확인에 따라 조치하며, 로드 밸런서는 확인을 통과한 새 태스크에 요청을 보냅니다.

준비 상태도 볼 가치가 있지만, 헬스 체크가 아니라 서비스 밖에서 봅니다. 엣지가 구성되면 `https://<domain>/readyz`는 `web-storefront`의 준비 상태로 응답하며, 여기에는 `publira server`와 Valkey의 준비 상태가 포함됩니다. 워커의 `/readyz`에는 아무것도 접근하지 않습니다. 워커 자신의 로그인이 실패하면 그 로그인을 쓰는 작업이 실패하면서 로그에 나타납니다.

## 7. 설치 환경 설정

`publiractl setup`은 모든 값을 플래그로 준 태스크로 한 번 실행합니다. `run-task`로 시작한 태스크에는 질문할 터미널이 없습니다. `publira_platform`으로 연결하고 저장하는 값을 암호화 키로 봉인하므로 두 가지 모두 서버와 같은 파라미터를 읽으며, 버킷 연결 테스트를 위해 `publira-storage` 태스크 역할을 사용합니다. `db-url/master`는 주지 않습니다. `setup`은 관리용 로그인으로 연결하지 않습니다.

출력은 CloudWatch Logs로 가므로, 관리자의 비밀번호는 생성하게 하지 말고 직접 지정하세요. 생성된 비밀번호는 요약에 출력되지만, 변수로 준 비밀번호는 출력되지 않습니다. 이 비밀번호와 SMTP 비밀번호를 각각 별도의 파라미터로 저장하세요.

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

이들은 역할 비밀번호와 같은 방법으로, `--smtp-password-env`와 `--admin-password-env` 플래그가 지정하는 변수로서 `publiractl`에 전달됩니다. `publiractl-setup.json`:

```json
{
  "family": "publiractl-setup",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/publira-task-execution",
  "taskRoleArn": "arn:aws:iam::<account>:role/publira-storage",
  "containerDefinitions": [
    {
      "name": "publiractl",
      "image": "ghcr.io/publira/publiractl:<tag>",
      "command": [
        "setup",
        "--non-interactive",
        "--default-locale",
        "en",
        "--bucket",
        "publira-images",
        "--region",
        "<region>",
        "--host",
        "email-smtp.<region>.amazonaws.com",
        "--port",
        "587",
        "--encryption",
        "starttls",
        "--username",
        "<the SMTP user name>",
        "--smtp-password-env",
        "PUBLIRA_SETUP_SMTP_PASSWORD",
        "--from-address",
        "no-reply@example.com",
        "--tenant-name",
        "Example Comics",
        "--domain",
        "comics.example.com",
        "--admin-email",
        "owner@comics.example.com",
        "--admin-name",
        "Owner",
        "--admin-password-env",
        "PUBLIRA_SETUP_ADMIN_PASSWORD"
      ],
      "environment": [
        { "name": "PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "value": "k1" }
      ],
      "secrets": [
        {
          "name": "PUBLIRA_SECRET_ENCRYPTION_KEYS",
          "valueFrom": "/publira/secret-encryption-keys"
        },
        {
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": "/publira/db-url/platform"
        },
        {
          "name": "PUBLIRA_SETUP_SMTP_PASSWORD",
          "valueFrom": "/publira/setup/smtp-password"
        },
        {
          "name": "PUBLIRA_SETUP_ADMIN_PASSWORD",
          "valueFrom": "/publira/setup/admin-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/publira",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "publiractl-setup"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://publiractl-setup.json
run_publiractl publiractl-setup
```

`--access-key-id`도 시크릿 키도 없습니다. 버킷은 자체 키 없이 저장되며, 모든 프로세스는 태스크 역할로 서명합니다. 위의 SMTP 값은 Amazon SES의 것입니다. Amazon SES의 SMTP 자격 증명은 IAM 사용자의 액세스 키가 아니라, 액세스 키로부터 만든 사용자 이름과 비밀번호입니다. 다른 서버라면 그 서버의 호스트, 포트, 암호화 방식을 지정하세요. 모든 플래그와 선택 사항인 단계는 [`publiractl` 레퍼런스](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)에 나열되어 있습니다.

연결 테스트 실패 등으로 실행이 도중에 멈추면, 저장한 내용은 남아 있으며 원인을 고친 뒤 다시 실행하면 마무리됩니다.

관리자의 비밀번호는 `/publira/setup/admin-password` 파라미터입니다. `aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`로 출력할 수 있습니다. 관리자가 로그인해 비밀번호를 변경하고 나면 이 파라미터를 삭제하세요. 그 뒤로는 아무것도 이를 읽지 않습니다.

## 8. CloudFront를 앞에 두기

CloudFront는 독자가 연결하는 엣지입니다. 모든 테넌트 호스트의 TLS를 종단하고, 일반 HTTP를 HTTPS로 리디렉션하고, 호출자가 정해서는 안 되는 헤더를 제거하며, 그 밖의 모든 것을 로드 밸런서로 전달합니다. [ECS 앞의 CloudFront](./1-cloudfront.md)는 위의 단계에서 정의한 변수와 함수를 사용하므로 이 같은 셸에서 CloudFront를 설정하고, VPC 밖에서 이를 확인합니다. 그 확인이 통과하면 로그인하러 이 페이지로 돌아오세요.

## 9. 로그인

`https://admin.comics.example.com` 또는 `--admin-domain`으로 지정한 콘솔 호스트에서 테넌트 콘솔을 열고, 관리자의 이메일 주소와 비밀번호로 로그인합니다. 이후의 설치 환경은 [로그인](../2-installing.md#6-로그인)에서 설명하는 것과 같습니다.

## 이 섹션의 내용

- [ECS 앞의 CloudFront](./1-cloudfront.md): VPC 오리진, 헤더, 캐시 정책, 배포, 클라이언트 주소, VPC 밖에서 엣지 확인하기.
- [ECS에서의 운영](./2-operating.md): 테넌트 추가, 콘솔의 자격 증명을 테넌트의 도메인에서 떼어 두기, 업그레이드.

## 다음 단계

CloudFront와 로드 밸런서가 함께 해야 하는 일의 전체 내용은 [엣지](../4-edge/index.md)에, 설치 환경이 서비스를 시작한 뒤 지켜봐야 할 것은 [모니터링](../../3-operations/11-monitoring.md)에 있습니다. 각 프로세스가 읽는 변수는 [배포 레퍼런스](https://github.com/publira/publira/blob/main/infra/deploy/README.md)에 있으며, 선택 사항인 프로세스는 [선택 프로세스 켜기](../2-installing.md#선택-프로세스-켜기)에서 설명하는 대로, 각각 위와 같은 서비스로 켭니다. `web-platform`에는 대상 그룹, 그 호스트의 규칙, Cloud Map 이름을 두고 `publira-web`에서 포트 `4100`을 엽니다. `email-renderer`에는 Cloud Map 이름만 두고, `publira-worker`로부터 포트 `8080`을 허용하는 보안 그룹을 둡니다.
