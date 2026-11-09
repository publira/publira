---
title: Fargate上的Amazon ECS
description: 在CloudFront和Application Load Balancer之后，以AWS Fargate上的Amazon ECS服务运行安装实例，从其参数和任务定义，一直到首次登录租户控制台。
published: 2026-11-03
updated: 2026-11-09
source_updated: 2026-11-09
---

本页将安装实例从一个已准备好托管服务的VPC，一直带到首次登录租户控制台；其中每个进程都是AWS Fargate上的一个Amazon ECS服务，边缘则是位于Application Load Balancer前方的CloudFront。它执行的步骤与[安装](../2-installing.md)相同，那一页解释了每个步骤存在的原因、每个密钥保护什么，以及每个数据库角色能访问什么；本页还按照[边缘](../4-edge/index.md#边缘必须做什么)的要求在前方部署边缘。本页只讲ECS和Fargate特有的部分：每个部分对应哪些资源，以及如何用这些资源满足上述两页的每项要求。

下面的命令和JSON是需要按自己环境调整的示例，而不是维护中的一套配置：仓库不提供CloudFormation模板、CDK应用或Terraform模块。它们是为AWS CLI第2版编写的，使用已发布的镜像`ghcr.io/publira/<name>:<tag>`；请按照[开始之前](../2-installing.md#开始之前)的说明，把`<tag>`替换为您要安装的版本号，并把`<account>`和`<region>`替换为您的账户ID和区域。

## ECS上运行的内容

每个长期运行的进程都是一个单独的ECS服务，使用Fargate启动类型；凡是会被其他组件调用的进程，都以同样的名称注册到AWS Cloud Map中：

| ECS服务 | 镜像和命令 | 端口 | 访问方 | 任务数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 负载均衡器，以及经由Cloud Map的Web应用 | 任意数量 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`，命令为`worker` | `8003`，仅用于健康检查 | 无 | 任意数量 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 负载均衡器，以及服务器和worker进程经由Cloud Map发起的缓存重新验证 | 任意数量 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | 与`web-storefront`相同 | 任意数量 |
| `web-platform`（如果运行） | `ghcr.io/publira/web-platform:<tag>` | `4100` | 与`web-storefront`相同 | 任意数量 |
| `email-renderer`（如果运行） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | 经由Cloud Map的worker进程 | 任意数量 |

worker进程可以运行多个任务，因为每个定时任务在一次运行进行期间都是唯一的，所以两个任务绝不会同时运行同一个定时任务。所有周期性任务也都由它自己调度，因此安装实例不需要EventBridge计划或计划任务。服务器或worker进程的每个任务都会为每个数据库登录各开一个连接池，所以任务越多，数据库就需要接受越多的连接，具体计算见[Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

请将`publira server`和`publira worker`作为上面的两个服务运行，而不是合并为一个`publira server --with-worker`。该标志是为单台主机上的安装实例准备的：在ECS上，它会放弃分别扩缩两者的能力，并像[概览](../1-overview.md#安装实例运行什么)所说的那样，把worker进程的数据库登录放进负载均衡器转发请求的那个进程里，却换不来ECS需要的任何好处。

各进程通过Cloud Map服务发现赋予它们的名称（例如`publira-server.publira.internal`）相互调用，这些名称会解析为每个运行中任务的地址。因此，调用会从调用方自己的地址直接到达任务。如果使用ECS Service Connect，每次调用都会经过接收方任务中的代理，由代理从`127.0.0.1`转交，这样`publira server`就会以该地址记录Web应用代读者发出的每个请求。

`publiractl`不需要常驻运行。它以您用`aws ecs run-task`启动的任务形式运行，使用您所安装版本的镜像，并在命令结束时停止。

## 开始之前

您需要：

- **AWS CLI第2版**，已登录到有权限管理ECS、Cloud Map、Elastic Load Balancing、CloudFront、ACM、IAM角色、Systems Manager参数、EC2安全组和CloudWatch Logs的账户。
- **一个VPC**：其中有至少位于两个可用区的私有子网供任务和负载均衡器使用，每个子网中至少有一个空闲地址，供CloudFront在那里创建的网络接口使用；并且挂接了互联网网关——当CloudFront以VPC源站的方式访问VPC中的负载均衡器时，要求该VPC挂接互联网网关，尽管没有任何流量经过它路由。任务必须能访问GitHub Container Registry以拉取镜像，还要能访问Systems Manager和CloudWatch Logs的API、Amazon S3以及您的SMTP服务器：请为私有子网提供NAT网关，或者为AWS服务提供VPC端点，并为镜像提供pull through缓存。
- **安装实例依赖的服务**，按照[准备服务](../2-installing.md#准备服务)所列准备好：
  - **Amazon RDS for PostgreSQL或Aurora PostgreSQL**，以该数据库作为初始数据库创建。主用户就是管理登录：它不是超级用户，但拥有该数据库并可创建角色，这正是`publiractl db`所需要的全部权限。
  - **Amazon ElastiCache for Valkey或Redis OSS**，作为基于节点的集群，禁用集群模式，开启传输中加密，并设置AUTH令牌。Publira会把它的主端点当作单个服务器来连接，所以只接受使用集群模式通信的客户端的ElastiCache Serverless无法使用。
  - **一个Amazon S3存储桶**，必须为空。各进程通过下文的任务角色访问它，所以不需要创建或保存访问密钥。
  - **Amazon SES**或其他SMTP服务器，并准备好SMTP凭据和已验证的发件地址。
- **DNS**：租户的域名及其控制台主机名（`admin.<domain>`，或您将通过`--admin-domain`指定的主机名），在CloudFront分配创建后指向它；并且能够添加ACM为验证证书而要求的CNAME记录。

下面的命令使用这些shell变量；请设置为您自己的值：

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

请在同一个shell中运行下面的各个步骤：每个步骤都会用到之前步骤定义的变量和函数。下面的每个任务定义都把容器的输出发送到`/publira`日志组，每个容器一个日志流。

## 1. 保存密钥

[生成密钥](../2-installing.md#生成密钥)列出了安装实例需要的每个密钥及其保护的内容。把每个密钥作为`SecureString`参数保存在Systems Manager Parameter Store的`/publira/`下：任务定义在其`secrets`中指定参数，ECS在容器启动时把参数值设置为环境变量，所以多个进程共用的值（例如重新验证令牌）只需保存一次，再由各进程分别引用。连接URL中带有角色密码，所以它们也作为参数保存；带有AUTH令牌的Valkey URL同样如此：

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

请把上面的端点替换为您的ElastiCache主端点和RDS端点。`rediss://`不是可选的：ElastiCache集群只有在开启传输中加密时才接受AUTH令牌，而`publira server`会拒绝以带有密码的`redis://` URL启动。连接URL中的密码不经转义，所以请让AUTH令牌和主密码只使用URL安全的字符（就像上面的十六进制输出那样），否则请对其他字符进行百分号编码。`sslmode=require`会加密连接，但不检查证书，因为该证书由RDS证书颁发机构签名，而不是由镜像信任的颁发机构签名。

| 参数 | 读取方 | 作为 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`、`publira-worker`和`publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`、`admin-auth-secret` | `web-storefront`和`web-admin`，各用一个 | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`、`publira-worker`、`web-storefront`和`web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`和`web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`、`publira-worker`和`web-storefront`；`web-storefront`和`web-admin` | `PUBLIRA_REDIS_URL`；`PNCH_REDIS_URL` |
| `db-url/public`、`db-url/admin`、`db-url/platform` | `publira-server`，以及读取`db-url/platform`的`publiractl setup` | `PUBLIRA_PUBLIC_DB_URL`、`PUBLIRA_ADMIN_DB_URL`、`PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`、`db-url/ticker`、`db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`、`PUBLIRA_TICKER_DB_URL`、`PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | 只有`db`任务：只有`db`命令会读取[管理登录](../2-installing.md#准备服务)的连接，所以不会交给任何常驻进程 | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles`任务 | 每个角色一个变量，例如`PUBLIRA_PUBLIC_DB_PASSWORD`，`db roles`通过其`--<role>-password-env`标志读取，如[创建数据库角色](#创建数据库角色)所述 |

这些参数并不是备份。请同时把加密密钥保存在您自己的密钥存储中：一旦丢失，安装实例保存的所有凭据都必须重新输入，如[生成密钥](../2-installing.md#生成密钥)所述。ECS在容器启动时读取值，所以修改后的参数要到服务的下一次部署才会生效。如果改为把这些值保存在AWS Secrets Manager中，请在`valueFrom`中用各个密钥（或其中某个JSON键）代替参数名，并授予任务执行角色对这些密钥的`secretsmanager:GetSecretValue`权限，以代替下文的`ssm:GetParameters`语句。

## 2. 创建IAM角色

所有任务共用两个角色。任务执行角色是ECS用来拉取镜像、写入日志和读取参数的角色；容器永远不会持有它。任务角色是各进程用来对发往S3的请求进行签名的角色：

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

请把`publira-images`替换为您的存储桶名称。参数使用Systems Manager的AWS托管密钥加密，不需要额外授权；用您自己的密钥加密的参数，还需要对该密钥的`kms:Decrypt`权限。

`publira-storage`是`publira-server`、`publira-worker`和`publiractl setup`任务的任务角色：服务器上传和读取图片，worker进程删除不再使用的图片，`setup`则用它对连接测试进行签名。各自内部的AWS SDK会自行从ECS在每个带有任务角色的任务中设置的变量里找到该角色的凭据，所以[设置安装实例](#7-设置安装实例)保存存储桶时不需要访问密钥，如[对象存储](../../3-operations/5-object-storage.md)所述。Web应用和`db`任务不需要任务角色。

## 3. 开通网络路径

安装实例的每个部分都有一个安全组，只允许调用它的组件访问。ECS每次替换任务时都会更换任务的地址，所以每条规则都指定调用方的安全组，而不是地址：

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
for caller in "$SERVER_SG" "$WORKER_SG" "$WEB_SG"; do
  allow "$VALKEY_SG" 6379 "$caller"
done
```

| 安全组 | 允许的端口 | 来源 |
| --- | --- | --- |
| `publira-alb` | `443` | 只有CloudFront，在[VPC源站](./1-cloudfront.md#vpc源站)添加它之后 |
| `publira-server` | `8000` | 负载均衡器，以及调用API的Web应用 |
| `publira-web` | `3000`、`4000` | 负载均衡器，以及发送缓存重新验证的服务器和worker进程 |
| `publira-worker`、`publiractl` | 无 | 没有任何组件调用它们 |
| 数据库的安全组 | `5432` | 服务器、worker进程和`publiractl` |
| Valkey集群的安全组 | `6379` | 服务器、worker进程和Web应用 |

`publiractl`不访问Valkey，Web应用不访问数据库，所以这两条路径都不开通。每个安全组都保留允许向外连接的默认规则，任务需要它来拉取镜像，以及访问AWS API、S3和SMTP。

Cloud Map在VPC的私有DNS命名空间下，为每个会被调用的服务提供一个名称：

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

命名空间的创建需要一点时间；请重复运行`list-namespaces`，直到它返回ID。ECS会在每个任务启动时把其地址注册到所属服务的名称下，并在任务停止时移除。

## 4. 应用迁移并创建数据库角色

`db`命令以一次性任务的形式运行，使用该版本的`publiractl`镜像，并通过管理登录的连接执行。每个任务的启动和等待方式都相同，所以先定义一次：

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

它会打印任务的ARN、命令的日志及其退出码，并且除非退出码为`0`，否则返回失败，所以运行它的脚本可以在那里停止。无论任务是否已经停止，`aws ecs wait tasks-stopped`都会在十分钟后放弃等待，该函数也随之失败；此时请用它打印的ARN再次等待，然后再读取日志。从未启动的任务（例如无法拉取镜像的任务）没有退出码，该函数会将其打印为`None`，而`aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`会给出原因。

### 应用迁移

`publiractl-db-migrate.json`：

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

用`run-task`启动的任务只运行一次，失败时ECS也不会重新启动它，这正是失败的迁移所需要的：失败的迁移会把数据库标记为dirty，需要按照[迁移失败时](../8-upgrading.md#迁移失败时)的说明手动解决。要再次运行它（就像该恢复过程的最后一步那样），同样使用`run_publiractl`。

### 创建数据库角色

Fargate任务不为`db roles`提供可读取密码的标准输入或终端，而ECS是以环境变量而不是文件的形式把密钥交给容器的。因此，任务的`secrets`为每个角色密码设置一个变量，`db roles`通过其`--<role>-password-env`标志读取每个变量。命令中只出现变量名，所以任务定义和进程列表中都不会出现密码。

`publiractl-db-roles.json`：

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

日志中每个角色占一行。以后轮换角色密码也使用同一个任务：用`aws ssm put-parameter --overwrite`把新密码写入该角色的`db-password/`参数，以及带有该密码的`db-url/`参数（上面的`put`特意不带这个选项，以免意外覆盖值），再次运行该任务，然后重新部署以该角色连接的服务，让它的任务以新的URL启动。以URL由`publira-server`持有的`publira_admin`为例：

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. 创建负载均衡器

负载均衡器把每个主机名和路径路由到正确的服务。它是内部负载均衡器，没有互联网地址：CloudFront以VPC源站的方式访问它，如[VPC源站](./1-cloudfront.md#vpc源站)中的设置。它仍然要用其所服务的每个主机名的证书终止TLS，原因有二：CloudFront会转发浏览器发送的`Host`，然后只接受负载均衡器出示的该名称的证书；而且只有当请求到达HTTPS监听器时，负载均衡器才会告诉Web应用该请求是通过HTTPS到达的。

在ACM中为每个租户申请一个证书，包含其域名和控制台主机名，并用ACM给出的CNAME记录进行验证。CloudFront只接受`us-east-1`中的证书，所以除非负载均衡器就在`us-east-1`（此时一个证书即可两用），否则也要在那里申请：

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

把第一条命令打印的记录添加到每个名称所在的区域，并对`us-east-1`中的证书执行同样的操作。然后创建负载均衡器、为它转发到的每个服务创建一个目标组，再创建一个HTTPS监听器，对没有规则匹配的请求返回`404`：

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

监听器的规则遵循[路由](../4-edge/index.md#路由)。一条规则的每个条件最多取三个值，所有条件合计最多五个值；负载均衡器按优先级顺序尝试规则，数值最小的优先：

| 优先级 | 主机名 | 路径 | 转发到 |
| --- | --- | --- | --- |
| `1000` | 任意 | `/images*`、`/rpc/publira.v1.*` | `publira-server` |
| `1100` | 任意 | `/rpc`、`/rpc/*` | 无：固定返回`404` |
| `2000`至`2999` | 租户的域名 | 任意 | `web-storefront` |
| `2000`至`2999` | 租户的控制台主机名 | 任意 | `web-admin` |

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

在`/rpc`之下，只转发公开API `publira.v1`：控制台通过VPC调用它们自己的API，所以负载均衡器对其余请求自行返回`404`，原因见[只有公开API经过边缘](../4-edge/index.md#只有公开api经过边缘)。路径模式按字符串匹配，`*`代表任意字符，所以`/rpc/publira.v1.*`表示一直到`v1`之后点号为止的公开API前缀，从而排除`publira.v1beta`这样的命名空间；而`/rpc`和`/rpc/*`是两个值，这样`/rpcabc`仍然归Web应用处理。优先级`1000`和`1100`的规则不指定主机名，所以适用于负载均衡器接收的每个主机名，这正是路由对每个租户主机名的要求；不在其他任何规则中的主机名，其他所有路径都会得到`404`。负载均衡器按浏览器发送时的原样传递路径和`Host`请求头；不要对两者做任何改写。

负载均衡器不限制请求体的大小，只要请求持续发送就允许它一直进行，所以[边缘](../4-edge/index.md#从页面上传图片)所述的上传和webhook可以原样通过。它的空闲超时是在任一方向上等待下一个字节的时间，包括请求到达后等待Web应用应答的时间：默认为60秒，上面的命令把它提高到CloudFront等待的120秒，即[分配](./1-cloudfront.md#分配)中设置的值。

## 6. 启动服务

每个服务从参数中获得自己的密钥，[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出的其余变量则写在它的任务定义中。下面的规格只是需要调整的起点，`ARM64`也可以改为`X86_64`：每个镜像都针对两者发布。

`publira server`和`publira worker`在收到停止指示后30秒内停止，所以它们的容器定义在ECS强制终止之前给它们45秒的`stopTimeout`，而默认值是30秒，如[停止副本](../7-scaling-out.md#停止副本)所述。

`publira-server.json`：

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

`PUBLIRA_TRUSTED_PROXIES`的值见[客户端地址](./1-cloudfront.md#客户端地址)。

`publira-worker.json`以`worker`为命令运行同一个镜像，其健康检查探测端口`8003`：

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
        { "name": "PUBLIRA_REDIS_URL", "valueFrom": "/publira/redis-url" },
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

`web-storefront.json`的结构相同，但没有任务角色，并通过Cloud Map名称调用`publira server`：

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

`web-storefront`使用与`publira server`相同的`PUBLIRA_TRUSTED_PROXIES`，以找出它传给租户的Google tag gateway的读者地址。`web-admin.json`与之相同，只是：把所有出现`web-storefront`的地方都换成`web-admin`；端口用`4000`代替`3000`，健康检查中也是如此；`PUBLIRA_AUTH_SECRET`使用`/publira/admin-auth-secret`；没有`PUBLIRA_TRUSTED_PROXIES`，因为`web-admin`不读取它；另外多一个密钥，即来自`/publira/web-service-token`的`PUBLIRA_WEB_SERVICE_TOKEN`。

注册这四个任务定义，并为每个创建一个服务，指定各自使用的安全组、目标组和Cloud Map名称：

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

`publira-worker`在启动时会创建其任务队列的表，所以不需要单独的任务。没有达到稳定状态的服务会不断停止任务，`aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`会说明原因：健康检查失败的任务，或者已停止的任务——后者在`/publira`中的日志会给出原因，例如某个角色的密码与其连接URL不一致。

### 健康检查

无论是哪种健康检查，ECS服务都会替换未通过检查的任务，所以本页的每个健康检查都探测`/livez`，它只在进程本身停止应答时才会失败。如果指向`/readyz`，那么数据库一旦停止应答，ECS就会同时替换某个服务的所有任务，这正是[从编排系统探测](../../3-operations/11-monitoring.md#从编排系统探测)所警告的情况。

- **每个服务**的任务定义中都有健康检查，由ECS在任务内部运行。镜像中没有HTTP客户端，所以每个检查都使用其镜像中已有的工具：`publira`镜像中用`bash`，由其`/dev/tcp`打开连接；Web镜像中没有shell，则用`node`，由其`fetch`发出请求。每个检查都向容器自己的端口请求`/livez`，收到`200`即为通过。它每30秒运行一次，5秒后放弃，连续三次失败后把任务标记为不健康，这些都是ECS健康检查的默认值；`startPeriod`给进程30秒的启动时间，在此期间的失败不计入。Cloud Map在该检查通过后把任务的地址标记为健康，检查失败时将其移除，所以服务之间相互调用所用的名称也遵循同一个检查。
- **`publira-server`和Web应用**还会由其目标组进行探测，`--health-check-path /livez`让目标组探测同一个路径。任务启动后，ECS会等待`--health-check-grace-period-seconds`再根据该检查采取行动，检查通过后负载均衡器开始向新任务发送请求。

就绪状态仍然值得关注，只是要从服务外部查看，而不是作为健康检查：边缘部署完成后，`https://<domain>/readyz`会返回`web-storefront`的就绪状态，其中包括`publira server`和Valkey的就绪状态。worker进程的`/readyz`不会被任何组件访问；如果它自己的某个登录失败，会体现在它的日志中，因为使用该登录的任务会失败。

## 7. 设置安装实例

`publiractl setup`只运行一次，以任务的形式运行，并用标志给出每个值：用`run-task`启动的任务没有可供询问的终端。它以`publira_platform`身份连接，并用加密密钥封存所保存的内容，所以这两方面它读取的参数与服务器相同；它还使用`publira-storage`任务角色进行存储桶的连接测试。它不会得到`db-url/master`：`setup`从不以管理登录连接。

它打印的内容会进入CloudWatch Logs，所以请为管理员指定密码，而不是让它生成：生成的密码会打印在摘要中，而通过变量给出的密码不会。把它和SMTP密码分别保存为单独的参数：

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

它们与角色密码一样，以`publiractl`的`--smtp-password-env`和`--admin-password-env`标志所指定的变量传给它。`publiractl-setup.json`：

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

这里没有`--access-key-id`，也没有秘密访问密钥：存储桶保存时不带自己的密钥，每个进程都用其任务角色签名。上面的SMTP值是Amazon SES的值，SES的SMTP凭据不是IAM用户的访问密钥，而是由访问密钥生成的用户名和密码；如果使用其他服务器，请给出它的主机、端口和加密方式。[`publiractl`参考](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)列出了每个标志以及可选的步骤。

如果运行中途停止（例如连接测试失败），已保存的内容会保留，排除原因后再次运行即可完成。

管理员的密码就是`/publira/setup/admin-password`参数：`aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`会打印它。管理员登录并修改密码后，请删除该参数：之后不再有任何组件读取它。

## 8. 在前方部署CloudFront

CloudFront是读者连接的边缘：它为每个租户的主机名终止TLS，把普通HTTP重定向到HTTPS，移除调用方不得自行指定的请求头，并把其余所有内容转发给负载均衡器。[ECS前方的CloudFront](./1-cloudfront.md)在同一个shell中完成其设置（因为它会用到上面各步骤定义的变量和函数），并从VPC外部进行检查。这些检查通过后，回到这里登录。

## 9. 登录

打开租户控制台`https://admin.comics.example.com`（或您通过`--admin-domain`指定的控制台主机名），用管理员的电子邮件地址和密码登录。此后的安装实例与[登录](../2-installing.md#6-登录)所述的相同。

## 本节内容

- [ECS前方的CloudFront](./1-cloudfront.md)：VPC源站、请求头、缓存策略、分配、客户端地址，以及从VPC外部检查边缘。
- [在ECS上运维](./2-operating.md)：添加租户、让控制台的凭据远离租户的域名，以及升级。

## 后续步骤

[边缘](../4-edge/index.md)完整说明了CloudFront和负载均衡器必须共同完成的事情，[监控](../../3-operations/11-monitoring.md)说明了安装实例开始提供服务后要关注什么。每个进程读取的变量见[部署参考](https://github.com/publira/publira/blob/main/infra/deploy/README.md)；可选进程按照[启用可选进程](../2-installing.md#启用可选进程)的说明开启，每个都像上面那样作为一个服务运行：`web-platform`需要一个目标组、其主机名的规则、一个Cloud Map名称，并在`publira-web`中开放端口`4100`；`email-renderer`只需要一个Cloud Map名称，以及一个允许来自`publira-worker`的端口`8080`的安全组。
