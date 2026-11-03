---
title: 在AWS Fargate上執行Amazon ECS
description: 將安裝實例作為AWS Fargate上的Amazon ECS服務，在CloudFront與Application Load Balancer之後執行，從參數與任務定義，一直到第一次登入租戶主控台。
published: 2026-11-03
source_updated: 2026-10-31
---

本頁從一個已準備好代管服務的VPC開始，帶著安裝實例一路走到第一次登入租戶主控台；其中每個處理程序都是AWS Fargate上的一個Amazon ECS服務，並以位於Application Load Balancer前方的CloudFront作為邊緣。它執行的步驟與[安裝](../2-installing.md)相同；每個步驟為何存在、每個密鑰保護什麼、每個資料庫角色能存取什麼，都在該頁說明。邊緣則依[邊緣](../4-edge/index.md#邊緣必須做的事)的要求設置於前方。本頁涵蓋ECS與Fargate特有的部分：每個部分會成為哪些資源，以及如何用這些資源滿足上述兩頁的每項要求。

以下的指令與JSON是供您調整使用的範例，並非持續維護的一套設定：儲存庫不提供CloudFormation範本、CDK應用程式或Terraform模組。它們是為AWS CLI第2版撰寫的，並指定已發布的映像檔`ghcr.io/publira/<name>:<tag>`；請依[開始之前](../2-installing.md#開始之前)的說明，把`<tag>`換成您要安裝的版本號，並把`<account>`與`<region>`換成您的帳戶ID與區域。

## 在ECS上執行的內容

每個長時間執行的處理程序都是一個獨立的ECS服務，使用Fargate啟動類型；而每個會被呼叫的處理程序，都以相同名稱註冊在AWS Cloud Map中：

| ECS服務 | 映像檔與指令 | 連接埠 | 存取者 | 任務數 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | 負載平衡器，以及經由Cloud Map存取的Web應用程式 | 任意數量 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`，指令為`worker` | `8003`，僅供健康檢查使用 | 無 | 任意數量 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | 負載平衡器，以及伺服器與worker經由Cloud Map進行的快取重新驗證 | 任意數量 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | 同`web-storefront` | 任意數量 |
| `web-platform`（若有執行） | `ghcr.io/publira/web-platform:<tag>` | `4100` | 同`web-storefront` | 任意數量 |
| `email-renderer`（若有執行） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | worker，經由Cloud Map | 任意數量 |

worker可以執行多個任務，因為每個排程工作在執行期間都是唯一的，兩個任務不會同時執行同一個工作。worker也會自行排定所有週期性工作，因此安裝實例不需要EventBridge排程或排程任務。伺服器或worker的每個任務都會為每個資料庫登入開啟一個連線池，所以任務越多，資料庫就必須接受越多連線，計算方式見[Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)。

請將`publira server`與`publira worker`分別以上述兩個服務執行，而不是合併為一個`publira server --with-worker`。該旗標是供單一主機上的安裝實例使用的：在ECS上使用它，等於放棄分開擴充兩者，並且讓worker的資料庫登入出現在負載平衡器轉送請求的處理程序中（如[概觀](../1-overview.md#安裝實例執行的部分)所述），卻換不到任何ECS需要的東西。

各處理程序以Cloud Map服務探索所給予的名稱（例如`publira-server.publira.internal`）互相呼叫，這些名稱會解析為每個執行中任務的位址。因此，呼叫會從呼叫端自己的位址直接抵達任務。若改用ECS Service Connect，每個呼叫都會經過接收端任務中的代理，再由代理從`127.0.0.1`轉交，如此一來，`publira server`就會把Web應用程式代替讀者發出的每個請求，都以該位址記錄下來。

`publiractl`不會持續執行。它是以`aws ecs run-task`啟動的任務，從您要安裝之版本的映像檔執行，並在指令結束時停止。

## 開始之前

您需要：

- **AWS CLI第2版**，以具有管理ECS、Cloud Map、Elastic Load Balancing、CloudFront、ACM、IAM角色、Systems Manager參數、EC2安全群組與CloudWatch Logs權限的帳戶登入。
- **一個VPC**，在至少兩個可用區域中有供任務與負載平衡器使用的私有子網路，每個子網路中至少要有一個可用位址，供CloudFront在那裡建立的網路介面使用；VPC還要連接網際網路閘道，因為CloudFront要求以VPC來源存取其負載平衡器的VPC必須有網際網路閘道，即使沒有任何流量經由它路由。任務必須能連線到GitHub Container Registry以拉取映像檔，並能連線到Systems Manager與CloudWatch Logs的API、Amazon S3以及您的SMTP伺服器：請為私有子網路提供NAT閘道，或是為AWS服務提供VPC端點，並為映像檔提供pull-through快取。
- **安裝實例所依賴的服務**，依[佈建服務](../2-installing.md#佈建服務)所列準備：
  - **Amazon RDS for PostgreSQL或Aurora PostgreSQL**，並以該資料庫作為其初始資料庫建立。主要使用者就是管理登入：它不是超級使用者，但擁有該資料庫且可建立角色，這正是`publiractl db`所需要的全部權限。
  - **Amazon ElastiCache for Valkey或Redis OSS**，以停用叢集模式、啟用傳輸中加密並設有AUTH權杖的節點型叢集建立。Publira會把其主要端點當作單一伺服器來連線，因此只接受使用叢集模式之用戶端的ElastiCache Serverless無法使用。
  - **一個Amazon S3儲存貯體**，必須是空的。處理程序以下方的任務角色存取它，因此不需要建立或保存任何存取金鑰。
  - **Amazon SES**或其他SMTP伺服器，並備妥SMTP認證資訊，以及一個已驗證、用於寄件的地址。
- **DNS**：租戶的網域，以及其主控台主機（`admin.<domain>`，或您將以`--admin-domain`指定的主機），在CloudFront的分佈建立後將它們指向CloudFront；另外還要能加入ACM為驗證憑證所要求的CNAME記錄。

以下指令使用這些shell變數；請將它們設為您自己的值：

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

請在同一個shell中執行以下步驟：每個步驟都會使用前面步驟所定義的變數與函式。以下每個任務定義都會把其容器的輸出傳送到`/publira`日誌群組，每個容器一個串流。

## 1. 儲存密鑰

[產生密鑰](../2-installing.md#產生密鑰)列出了安裝實例所需的每個密鑰，以及每個密鑰保護的內容。請把每個密鑰以`SecureString`參數的形式，儲存在Systems Manager Parameter Store的`/publira/`之下：任務定義會在其`secrets`中指定參數，ECS則在容器啟動時把值設為環境變數，因此由多個處理程序共用的值（例如重新驗證權杖）只需儲存一次，再由各處理程序分別指定。連線URL中含有角色的密碼，因此它們也是參數；含有AUTH權杖的Valkey URL也是如此：

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

請把上方的值換成您的ElastiCache主要端點與RDS端點。`rediss://`不可省略：ElastiCache叢集只有在啟用傳輸中加密時才接受AUTH權杖，而`publira server`會拒絕以含有密碼的`redis://` URL啟動。連線URL中的密碼不經跳脫，因此請讓AUTH權杖與主要密碼只使用URL安全的字元（如上方的十六進位輸出），或對其他字元進行百分比編碼。`sslmode=require`會加密連線，但不檢查憑證，因為該憑證是由RDS憑證授權單位簽署，而非映像檔所信任的憑證授權單位。

| 參數 | 讀取者 | 作為 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`、`publira-worker`與`publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`、`admin-auth-secret` | `web-storefront`與`web-admin`，各用一個 | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`、`publira-worker`、`web-storefront`與`web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`與`web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`與`web-storefront`；`web-storefront`與`web-admin` | `PUBLIRA_REDIS_URL`；`PNCH_REDIS_URL` |
| `db-url/public`、`db-url/admin`、`db-url/platform` | `publira-server`，以及讀取`db-url/platform`的`publiractl setup` | `PUBLIRA_PUBLIC_DB_URL`、`PUBLIRA_ADMIN_DB_URL`、`PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`、`db-url/ticker`、`db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`、`PUBLIRA_TICKER_DB_URL`、`PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | 只有`db`系列的任務：只有`db`系列指令會讀取[管理登入](../2-installing.md#佈建服務)的連線，因此任何持續執行的處理程序都不會拿到它 | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles`的任務 | 每個角色一個變數，例如`PUBLIRA_PUBLIC_DB_PASSWORD`，由`db roles`以其`--<role>-password-env`旗標讀取，如[建立資料庫角色](#建立資料庫角色)所述 |

這些參數並不是備份。請同時把加密金鑰保存在您自己的密鑰儲存庫中：一旦遺失，安裝實例所儲存的每項認證資訊都必須重新輸入，如[產生密鑰](../2-installing.md#產生密鑰)所述。ECS在容器啟動時讀取值，因此變更後的參數要到服務下一次部署時才會生效。若您改把值保存在AWS Secrets Manager中，請在`valueFrom`中以各個密鑰（或其中的某個JSON鍵）取代參數名稱，並以對這些密鑰授予任務執行角色`secretsmanager:GetSecretValue`，取代下方的`ssm:GetParameters`陳述式。

## 2. 建立IAM角色

所有任務共用兩個角色。任務執行角色是ECS用來拉取映像檔、寫入日誌與讀取參數的角色；容器本身從不持有它。任務角色則是處理程序用來簽署其S3請求的角色：

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

請把`publira-images`換成您的儲存貯體名稱。這些參數以Systems Manager的AWS受管金鑰加密，不需要另外授權；若參數是以您自己的金鑰加密，則還需要該金鑰的`kms:Decrypt`權限。

`publira-storage`是`publira-server`、`publira-worker`以及`publiractl setup`任務的任務角色：伺服器上傳與讀取圖片，worker刪除不再被使用的圖片，`setup`則以它簽署連線測試。每個處理程序中的AWS SDK都會自行從ECS為每個具有任務角色的任務所設定的變數中找到該角色的認證資訊，因此[設定安裝實例](#7-設定安裝實例)儲存儲存貯體時不需要存取金鑰，如[物件儲存](../../3-operations/5-object-storage.md)所述。Web應用程式與`db`系列的任務不需要任務角色。

## 3. 開通網路路徑

安裝實例的每個部分都有一個安全群組，只允許會呼叫它的對象連入。ECS每次替換任務時都會更換任務的位址，因此每條規則都指定呼叫端的安全群組，而不是位址：

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

| 安全群組 | 允許 | 來源 |
| --- | --- | --- |
| `publira-alb` | `443` | 只有CloudFront，於[VPC來源](./1-cloudfront.md#vpc來源)加入後生效 |
| `publira-server` | `8000` | 負載平衡器，以及呼叫API的Web應用程式 |
| `publira-web` | `3000`、`4000` | 負載平衡器，以及傳送快取重新驗證的伺服器與worker |
| `publira-worker`、`publiractl` | 無 | 沒有任何東西呼叫它們 |
| 資料庫的安全群組 | `5432` | 伺服器、worker與`publiractl` |
| Valkey叢集的安全群組 | `6379` | 伺服器與Web應用程式 |

worker與`publiractl`不會存取Valkey中的任何東西，Web應用程式也不會存取資料庫中的任何東西，因此這兩條路徑都不開通。每個群組都保留允許向外連線的預設規則，任務需要它來存取映像檔、AWS API、S3與SMTP。

Cloud Map會在VPC的私有DNS命名空間下，為每個會被呼叫的服務提供一個名稱：

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

命名空間需要一點時間建立；請重複執行`list-namespaces`，直到它回傳ID為止。ECS會在任務啟動時，把每個任務的位址註冊在其服務的名稱之下，並在任務停止時移除。

## 4. 套用遷移並建立資料庫角色

`db`系列指令以一次性任務的形式，從該版本的`publiractl`映像檔執行，並使用管理登入的連線。每個任務的啟動與等待方式都相同，因此先定義一次：

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

它會印出任務的ARN、指令的日誌及其結束代碼，並且只要該代碼不是`0`就會失敗，因此執行它的腳本可以在那裡停下。無論任務是否已停止，`aws ecs wait tasks-stopped`都會在十分鐘後放棄等待，函式也會隨之失敗；請以它印出的ARN再次等待，然後再讀取日誌。從未啟動的任務（例如無法拉取映像檔的任務）沒有結束代碼，函式會將其印為`None`，而`aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`會說明原因。

### 套用遷移

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

以`run-task`啟動的任務只會執行一次，失敗時ECS不會再次啟動它，而這正是失敗的遷移所需要的：失敗的遷移會讓資料庫被標記為dirty，這需要依[遷移失敗時](../8-upgrading.md#遷移失敗時)的說明手動處理。若要再次執行它（如該處理程序的最後一步所做的），同樣使用`run_publiractl`即可。

### 建立資料庫角色

Fargate任務既不提供stdin也不提供終端機讓`db roles`讀取密碼，而ECS是以環境變數而非檔案的形式把密鑰交給容器。因此，任務的`secrets`為每個角色密碼設定一個變數，`db roles`則以其`--<role>-password-env`旗標讀取每一個。指令中只有變數的名稱，因此任務定義與處理程序清單中都不會出現任何密碼。

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

日誌中每個角色會有一行。之後輪替角色密碼也是用這個任務：以`aws ssm put-parameter --overwrite`把新密碼放進其`db-password/`參數，以及含有該密碼的`db-url/`參數（上方的`put`刻意不帶這個選項，以免意外取代值），再次執行任務，然後重新部署以該角色連線的服務，讓其任務以新的URL啟動。以`publira-server`所持有其URL的`publira_admin`為例：

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. 建立負載平衡器

負載平衡器會把每個主機與路徑路由到正確的服務。它是內部負載平衡器，在網際網路上沒有位址：CloudFront以VPC來源的形式存取它，設定方式見[VPC來源](./1-cloudfront.md#vpc來源)。它仍然以涵蓋其所服務之每個主機的憑證終止TLS，原因有二：CloudFront會轉送瀏覽器送出的`Host`，並只接受負載平衡器出示該名稱的憑證；而且只有在請求抵達HTTPS listener時，負載平衡器才會告訴Web應用程式該請求是經由HTTPS抵達的。

請在ACM中為每個租戶申請一張憑證，指定其網域與主控台主機，並以ACM提供的CNAME記錄進行驗證。CloudFront只接受`us-east-1`的憑證，因此除非負載平衡器位於`us-east-1`（此時一張憑證即可同時供兩者使用），否則也要在那裡申請：

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

把第一個指令印出的記錄加入每個名稱所屬的區域，並對`us-east-1`的憑證做同樣的事。接著建立負載平衡器、為其轉送目標的每個服務建立一個目標群組，以及一個HTTPS listener，對不符合任何規則的請求回應`404`：

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

listener的規則依循[路由](../4-edge/index.md#路由)。每條規則的每個條件最多可有三個值，所有條件合計最多五個；負載平衡器會依規則的優先順序由低至高嘗試：

| 優先順序 | 主機 | 路徑 | 轉送至 |
| --- | --- | --- | --- |
| `1000` | 任意 | `/images*`、`/rpc/publira.v1.*` | `publira-server` |
| `1100` | 任意 | `/rpc`、`/rpc/*` | 無：固定回應`404` |
| `2000`至`2999` | 租戶的網域 | 任意 | `web-storefront` |
| `2000`至`2999` | 租戶的主控台主機 | 任意 | `web-admin` |

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

在`/rpc`之下，只有公開API `publira.v1`會被轉送：主控台透過VPC呼叫它們自己的API，因此負載平衡器會自行以`404`回應其餘請求，原因見[只有公開API經過邊緣](../4-edge/index.md#只有公開api經過邊緣)。路徑模式是以字串比對，`*`代表任意字元，因此`/rpc/publira.v1.*`表示直到`v1`之後句點為止的公開API前綴，這樣就能排除`publira.v1beta`之類的命名空間；而`/rpc`與`/rpc/*`是兩個值，這樣`/rpcabc`就會留給Web應用程式。`1000`與`1100`的規則沒有指定主機，因此會套用於負載平衡器收到的每個主機，這正是「路由」對每個租戶主機的要求；不在其他任何規則中的主機，其他所有路徑都會得到`404`。負載平衡器會以瀏覽器送出時的原樣傳遞路徑與`Host`標頭；請不要改寫其中任何一者。

負載平衡器不限制請求本文的大小，而且只要請求持續傳送就允許它花費任意長的時間，因此[邊緣](../4-edge/index.md#從頁面上傳圖片)所述的上傳與webhook都能原樣通過。它的閒置逾時是它在任一方向等待下一個位元組的時間，包括請求抵達後等待Web應用程式回應的時間：未變更時為60秒，上方的指令將其提高到CloudFront等待的120秒，這是[分佈](./1-cloudfront.md#分佈)所設定的值。

## 6. 啟動服務

每個服務都從參數取得其密鑰，[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)列出的其餘變數則寫在其任務定義中。以下的規格只是起點，請自行調整；`ARM64`也可以改為`X86_64`：每個映像檔都針對兩者發布。

`publira server`與`publira worker`在收到停止指示後30秒內就會停止，因此它們的容器定義在ECS強制終止前給予45秒的`stopTimeout`（預設為30秒），如[停止副本](../7-scaling-out.md#停止副本)所述。

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

`PUBLIRA_TRUSTED_PROXIES`的值見[用戶端位址](./1-cloudfront.md#用戶端位址)。

`publira-worker.json`以`worker`作為指令執行相同的映像檔，其健康檢查探測`8003`連接埠：

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

`web-storefront.json`採用相同的結構，但沒有任務角色，並以Cloud Map名稱呼叫`publira server`：

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

`web-storefront`採用與`publira server`相同的`PUBLIRA_TRUSTED_PROXIES`，用來找出它要傳給租戶Google代碼閘道的讀者位址。`web-admin.json`與此相同，只是把所有出現`web-storefront`之處換成`web-admin`，連接埠（包括健康檢查中的連接埠）以`4000`取代`3000`，`PUBLIRA_AUTH_SECRET`使用`/publira/admin-auth-secret`，沒有`PUBLIRA_TRUSTED_PROXIES`（`web-admin`不會讀取它），並多一個密鑰：來自`/publira/web-service-token`的`PUBLIRA_WEB_SERVICE_TOKEN`。

註冊這四個任務定義，並為每一個建立服務，附上各自使用的安全群組、目標群組與Cloud Map名稱：

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

`publira-worker`啟動時會建立其工作佇列的資料表，因此不需要專屬的任務。無法穩定的服務會不斷停止任務，而`aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`會說明原因：可能是健康檢查失敗的任務，或是已停止的任務，後者在`/publira`中的日誌會指出原因，例如密碼與連線URL不相符的角色。

### 健康檢查

無論是哪一種健康檢查，ECS服務都會替換未通過的任務，因此本頁的每個健康檢查都探測`/livez`，它只有在處理程序本身停止回應時才會失敗。若將健康檢查指向`/readyz`，資料庫一停止回應，ECS就會同時替換服務的所有任務，這正是[從協調器探測](../../3-operations/11-monitoring.md#從協調器探測)所警告的情況。

- **每個服務**的任務定義中都有一個健康檢查，由ECS在任務內執行。映像檔中沒有HTTP用戶端，因此每個檢查都使用其映像檔中現有的工具：`publira`映像檔使用`bash`，以其`/dev/tcp`開啟連線；沒有shell的Web映像檔則使用`node`，以其`fetch`發出請求。每個檢查都向容器自己的連接埠請求`/livez`，收到`200`即通過。它每30秒執行一次，5秒後放棄，連續失敗三次就把任務標記為不健康，這些都是ECS健康檢查的預設值；`startPeriod`給處理程序30秒的啟動時間，在此期間的失敗不計入。Cloud Map會在該檢查通過後將任務的位址標記為健康，並在檢查失敗時移除它，因此各服務互相呼叫所用的名稱也會依循同一個檢查。
- **`publira-server`與Web應用程式**也會由其目標群組探測，`--health-check-path /livez`讓它指向相同的路徑。ECS會在任務啟動後等待`--health-check-grace-period-seconds`，才依據該檢查採取行動；檢查通過後，負載平衡器就會開始把請求傳送給新的任務。

就緒狀態仍然值得觀察，但應從服務外部觀察，而不是作為健康檢查：邊緣啟用後，`https://<domain>/readyz`會回應`web-storefront`的就緒狀態，其中包含`publira server`與Valkey的就緒狀態。worker的`/readyz`沒有任何東西存取；它自己的某個登入若失敗，會在使用該登入的工作失敗時出現在其日誌中。

## 7. 設定安裝實例

`publiractl setup`只執行一次，作為以旗標提供每個值的任務執行：以`run-task`啟動的任務沒有可供詢問的終端機。它以`publira_platform`身分連線，並以加密金鑰密封它所儲存的內容，因此它讀取的參數與伺服器在這兩方面讀取的相同；此外，它使用`publira-storage`任務角色進行儲存貯體的連線測試。它不會拿到`db-url/master`：`setup`從不以管理登入連線。

它所輸出的內容會進入CloudWatch Logs，因此請為管理員提供密碼，而不是讓系統產生：產生的密碼會印在摘要中，而透過變數提供的密碼不會。請把它與SMTP密碼分別儲存為專屬的參數：

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

它們以與角色密碼相同的方式傳給`publiractl`，也就是作為其`--smtp-password-env`與`--admin-password-env`旗標所指定的變數。`publiractl-setup.json`：

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

這裡沒有`--access-key-id`，也沒有秘密金鑰：儲存貯體在儲存時不帶自己的金鑰，每個處理程序都以其任務角色簽署。上方的SMTP值是Amazon SES的值，其SMTP認證資訊不是IAM使用者的存取金鑰，而是由存取金鑰產生的使用者名稱與密碼；若使用其他伺服器，請提供其主機、連接埠與加密方式。[`publiractl`參考文件](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)列出了每個旗標，以及哪些步驟是選用的。

在中途停止的執行（例如連線測試失敗）會保留已儲存的內容，在排除原因後再次執行即可完成。

管理員的密碼就是`/publira/setup/admin-password`參數：`aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`會印出它。管理員登入並變更密碼後，請刪除該參數：之後不會再有任何東西讀取它。

## 8. 在前方設置CloudFront

CloudFront是讀者所連線的邊緣：它為每個租戶的主機終止TLS、把純HTTP重新導向至HTTPS、移除呼叫端不得自行指定的標頭，並把其他所有內容轉送到負載平衡器。[ECS前方的CloudFront](./1-cloudfront.md)說明如何設置它，並從VPC外部檢查它；由於會用到上述步驟所定義的變數與函式，請在同一個shell中進行。待這些檢查通過後，再回到這裡登入。

## 9. 登入

開啟位於`https://admin.comics.example.com`（或您以`--admin-domain`指定的主控台主機）的租戶主控台，並以管理員的電子郵件地址與密碼登入。從這裡開始，安裝實例就與[登入](../2-installing.md#6-登入)所描述的相同。

## 本節內容

- [ECS前方的CloudFront](./1-cloudfront.md)：VPC來源、標頭、快取政策、分佈、用戶端位址，以及從VPC外部檢查邊緣。
- [在ECS上營運](./2-operating.md)：新增租戶、讓主控台的認證資訊遠離租戶的網域，以及升級。

## 後續步驟

[邊緣](../4-edge/index.md)完整說明了CloudFront與負載平衡器必須共同做到的事，[監控](../../3-operations/11-monitoring.md)則說明安裝實例開始提供服務後要觀察什麼。每個處理程序讀取的變數列在[部署參考文件](https://github.com/publira/publira/blob/main/infra/deploy/README.md)中，選用的處理程序則依[啟用選用處理程序](../2-installing.md#啟用選用處理程序)的說明啟用，各自是與上述相同的服務：`web-platform`需要一個目標群組、其主機的規則、一個Cloud Map名稱，並在`publira-web`中開放`4100`連接埠；`email-renderer`則只需要一個Cloud Map名稱，以及一個允許來自`publira-worker`之`8080`連接埠連線的安全群組。
