---
title: Fargate上のAmazon ECS
description: インストール環境をCloudFrontとApplication Load Balancerの背後で、AWS Fargate上のAmazon ECSサービスとして動かします。パラメーターとタスク定義から、テナント管理画面への最初のログインまでを扱います。
published: 2026-10-29
source_updated: 2026-10-23
---

このページでは、マネージドサービスをプロビジョニング済みのVPCから、テナント管理画面への最初のログインまで、インストール環境を構築します。すべてのプロセスはAWS Fargate上のAmazon ECSサービスとして動かし、エッジにはApplication Load Balancerの前に置いたCloudFrontを使います。手順は[インストール](../2-installing.md)と同じです。そちらでは、各手順がなぜ必要なのか、各シークレットが何を守るのか、各データベースロールが何にアクセスできるのかを説明しています。エッジは[エッジ](../4-edge/index.md#エッジが行うべきこと)が求めるとおりに前に置きます。このページで扱うのはECSとFargateに固有の部分、つまり各部分がどのリソースになるのか、そしてその2つのページの各要件をそれらのリソースでどう満たすのかです。

以下のコマンドとJSONは、環境に合わせて書き換えるための例であり、保守されている一式ではありません。リポジトリにはCloudFormationテンプレートも、CDKアプリも、Terraformモジュールも含まれていません。これらはAWS CLIバージョン2向けに書かれており、公開イメージ`ghcr.io/publira/<name>:<tag>`を指定しています。`<tag>`には、[始める前に](../2-installing.md#始める前に)の説明どおりインストールするリリースのバージョンを、`<account>`と`<region>`にはアカウントIDとリージョンを書いてください。

## ECSで動くもの

長時間動き続けるプロセスは、それぞれ独立したECSサービスとしてFargate起動タイプで動かします。何かから呼び出されるものは、すべて同じ名前でAWS Cloud Mapに登録します。

| ECSサービス | イメージとコマンド | ポート | 呼び出し元 | タスク数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | ロードバランサーと、Cloud Map経由のWebアプリ | 任意 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`（コマンドは`worker`） | `8003`（ヘルスチェック専用） | なし | 任意 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | ロードバランサーと、Cloud Map経由でサーバーとワーカーから届くキャッシュの再検証 | 任意 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | `web-storefront`と同じ | 任意 |
| `web-platform`（動かす場合） | `ghcr.io/publira/web-platform:<tag>` | `4100` | `web-storefront`と同じ | 任意 |
| `email-renderer`（動かす場合） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Cloud Map経由のワーカー | 任意 |

ワーカーは複数のタスクで動かしてもかまいません。どの定期ジョブも実行中は一意なので、2つのタスクが同じジョブを同時に実行することはないためです。また、ワーカーは繰り返し実行するジョブをすべて自分でスケジュールするため、インストール環境にEventBridgeのスケジュールやスケジュールされたタスクは必要ありません。サーバーとワーカーの各タスクはデータベースのログインごとにプールを開くため、タスクを増やすには、[コネクションプール](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)で算出しているとおり、より多くの接続を受け付けるデータベースが必要です。

`publira server`と`publira worker`は、1つの`publira server --with-worker`としてではなく、上の2つのサービスとして動かしてください。このフラグは1台のホストで動かすインストール環境のためのものです。ECSでこれを使うと、2つを別々にスケールできなくなり、[概要](../1-overview.md#インストール環境が動かすもの)で説明しているように、ワーカーのデータベースログインがロードバランサーの転送先のプロセスに入ってしまいます。そのうえ、ECSに必要なものは何も得られません。

プロセス同士は、Cloud Mapのサービスディスカバリーが付ける`publira-server.publira.internal`のような名前で互いを呼び出します。この名前は、実行中の各タスクのアドレスに解決されます。そのため呼び出しは、呼び出し元自身のアドレスからタスクに直接届きます。ECS Service Connectを使うと、各呼び出しは受け側のタスク内のプロキシを経由し、プロキシは呼び出しを`127.0.0.1`から渡します。すると`publira server`は、Webアプリが読者のために行うすべてのリクエストをそのアドレスで記録してしまいます。

`publiractl`は常駐させません。インストールするリリースのイメージから`aws ecs run-task`で起動するタスクとして動き、コマンドが終わると停止します。

## 始める前に

次のものが必要です。

- **AWS CLIバージョン2**。ECS、Cloud Map、Elastic Load Balancing、CloudFront、ACM、IAMロール、Systems Managerのパラメーター、EC2のセキュリティグループ、CloudWatch Logsを管理する権限を持つアカウントにログインしておきます。
- **VPC**。タスクとロードバランサー用に、少なくとも2つのアベイラビリティーゾーンにプライベートサブネットが必要です。各サブネットには、CloudFrontがそこに作成するネットワークインターフェイス用の空きアドレスが少なくとも1つ必要です。また、インターネットゲートウェイをアタッチしておきます。実際にはそこを経由する通信はありませんが、CloudFrontは、VPCオリジンとして到達するロードバランサーがあるVPCにこれを求めます。タスクは、イメージを取得するためのGitHub Container Registry、Systems ManagerとCloudWatch LogsのAPI、Amazon S3、SMTPサーバーに到達できる必要があります。プライベートサブネットにNATゲートウェイを用意するか、AWSのサービス用のVPCエンドポイントと、イメージ用のプルスルーキャッシュを用意してください。
- **インストール環境が依存するサービス**。[サービスをプロビジョニングする](../2-installing.md#サービスを用意する)の一覧どおりにプロビジョニングします。
  - **Amazon RDS for PostgreSQLまたはAurora PostgreSQL**。データベースは初期データベースとして作成しておきます。マスターユーザーが管理用ログインです。マスターユーザーはスーパーユーザーではありませんが、そのデータベースを所有し、ロールを作成できます。`publiractl db`に必要なのはそれだけです。
  - **Amazon ElastiCache for ValkeyまたはRedis OSS**。クラスターモードを無効にし、転送中の暗号化を有効にし、AUTHトークンを設定したノードベースのクラスターとして用意します。Publiraはそのプライマリエンドポイントに単一のサーバーとして接続します。そのため、クラスターモードに対応したクライアントしか受け付けないElastiCache Serverlessは使えません。
  - **Amazon S3バケット**。空のものを用意します。プロセスは後述のタスクロールでアクセスするため、アクセスキーを作成したり保存したりすることはありません。
  - **Amazon SES**、または別のSMTPサーバー。SMTPの認証情報と、送信元として検証済みのアドレスを用意します。
- テナントのドメインと、その管理画面のホスト（`admin.<domain>`、または`--admin-domain`で指定するホスト）の**DNS**。ディストリビューションを作成したら、CloudFrontに向けます。また、ACMが証明書の検証のために求めるCNAMEレコードを追加できる必要があります。

以下のコマンドでは次のシェル変数を使います。自分の環境に合わせて設定してください。

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

以下の手順はすべてこの1つのシェルで実行してください。各手順は、それより前の手順で定義した変数と関数を使います。以下のタスク定義はどれも、コンテナの出力を`/publira`ロググループに送り、コンテナごとに1つのストリームに書き込みます。

## 1. シークレットを保存する

[シークレットを生成する](../2-installing.md#シークレットを生成する)に、インストール環境に必要なすべてのシークレットと、それぞれが守るものが載っています。それぞれをSystems Manager Parameter Storeの`/publira/`の下に、`SecureString`パラメーターとして保存します。タスク定義は`secrets`でパラメーターを指定し、ECSはコンテナの起動時にその値を環境変数として設定します。そのため、再検証トークンのように複数のプロセスで共有する値は、一度だけ保存して、それぞれのプロセスから指定できます。接続URLにはロールのパスワードが含まれるのでパラメーターにします。AUTHトークンを含むValkeyのURLも同様です。

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

上のElastiCacheのプライマリエンドポイントとRDSのエンドポイントは、自分のものに書き換えてください。`rediss://`は省略できません。ElastiCacheクラスターは転送中の暗号化を有効にした場合にしかAUTHトークンを受け付けず、`publira server`はパスワードを含む`redis://`のURLでは起動を拒否します。接続URLはパスワードをエスケープせずに含むため、AUTHトークンとマスターパスワードには、上の16進数の出力のようにURLで安全な文字だけを使うか、それ以外の文字をパーセントエンコードしてください。`sslmode=require`は接続を暗号化しますが、証明書は検証しません。証明書は、イメージが信頼する認証局ではなく、RDSの認証局によって署名されているためです。

| パラメーター | 読み取るもの | 渡し方 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`、`publira-worker`、`publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`、`admin-auth-secret` | `web-storefront`と`web-admin`がそれぞれ1つずつ | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`、`publira-worker`、`web-storefront`、`web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`と`web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`／`web-storefront`と`web-admin` | `PUBLIRA_REDIS_URL`／`PNCH_REDIS_URL` |
| `db-url/public`、`db-url/admin`、`db-url/platform` | `publira-server`（`db-url/platform`は`publiractl setup`も） | `PUBLIRA_PUBLIC_DB_URL`、`PUBLIRA_ADMIN_DB_URL`、`PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`、`db-url/ticker`、`db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`、`PUBLIRA_TICKER_DB_URL`、`PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | `db`タスクのみ。[管理用ログイン](../2-installing.md#サービスを用意する)の接続を読むのは`db`コマンドだけなので、常駐するものには渡しません | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles`タスク | [データベースロールを作成する](#データベースロールを作成する)で説明しているとおり、ファイルとして |

パラメーターはバックアップではありません。暗号化キーは、自分のシークレットストアにも保管してください。キーを失うと、[シークレットを生成する](../2-installing.md#シークレットを生成する)で説明しているとおり、インストール環境が保存したすべての認証情報を入力し直すことになります。ECSは値をコンテナの起動時に読むため、変更したパラメーターがサービスに反映されるのは、そのサービスの次のデプロイからです。値をAWS Secrets Managerに保管する場合は、`valueFrom`にパラメーター名の代わりに各シークレット、またはシークレット内のJSONキーを指定し、下の`ssm:GetParameters`のステートメントの代わりに、それらのシークレットに対する`secretsmanager:GetSecretValue`をタスク実行ロールに付与してください。

## 2. IAMロールを作成する

すべてのタスクを2つのロールでまかないます。タスク実行ロールは、ECSがイメージの取得、ログの書き込み、パラメーターの読み取りに使うロールで、コンテナがこれを持つことはありません。タスクロールは、プロセスがS3へのリクエストに署名するのに使うロールです。

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

`publira-images`は、自分のバケットの名前に書き換えてください。パラメーターはSystems ManagerのAWSマネージドキーで暗号化されており、このキーには権限の付与は必要ありません。自分のキーで暗号化したパラメーターには、そのキーに対する`kms:Decrypt`も必要です。

`publira-storage`は、`publira-server`、`publira-worker`、`publiractl setup`タスクのタスクロールです。サーバーは画像をアップロードして読み取り、ワーカーは使われなくなった画像を削除し、`setup`は接続テストの署名にこのロールを使います。それぞれに含まれるAWS SDKは、タスクロールを持つすべてのタスクにECSが設定する変数から、ロールの認証情報を自分で見つけます。そのため[インストール環境をセットアップする](#7-インストール環境をセットアップする)では、[オブジェクトストレージ](../../3-operations/5-object-storage.md)で説明しているとおり、アクセスキーなしでバケットを保存します。Webアプリと`db`タスクには、タスクロールは必要ありません。

## 3. ネットワーク経路を開く

インストール環境の各部分にセキュリティグループを1つずつ用意し、それを呼び出すものだけを許可します。ECSがタスクを置き換えるたびにタスクのアドレスも変わるため、どのルールもアドレスではなく、呼び出し元のセキュリティグループを指定します。

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

| セキュリティグループ | 許可するポート | 許可する送信元 |
| --- | --- | --- |
| `publira-alb` | `443` | CloudFrontのみ（[VPCオリジン](./1-cloudfront.md#vpcオリジン)で追加した後） |
| `publira-server` | `8000` | ロードバランサーと、APIを呼び出すWebアプリ |
| `publira-web` | `3000`、`4000` | ロードバランサーと、キャッシュの再検証を送るサーバーとワーカー |
| `publira-worker`、`publiractl` | なし | 呼び出すものはありません |
| データベースのもの | `5432` | サーバー、ワーカー、`publiractl` |
| Valkeyクラスターのもの | `6379` | サーバーとWebアプリ |

ワーカーと`publiractl`はValkeyに、Webアプリはデータベースにアクセスする必要がないため、どちらの経路も開きません。どのグループも、外向きの接続を許可するデフォルトのルールはそのまま残します。タスクは、イメージ、AWSのAPI、S3、SMTPにアクセスするためにこのルールを必要とします。

Cloud Mapは、呼び出されるサービスそれぞれに、VPCのプライベートDNS名前空間の下で名前を付けます。

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

名前空間の作成には少し時間がかかります。IDが返ってくるまで、`list-namespaces`をもう一度実行してください。ECSは、タスクの起動時にそのアドレスをサービスの名前で登録し、タスクの停止時に削除します。

## 4. マイグレーションを適用し、データベースロールを作成する

`db`コマンドは、リリースの`publiractl`イメージから単発のタスクとして、管理用ログインの接続で実行します。どのコマンドも起動して終了を待つ方法は同じなので、一度だけ定義しておきます。

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

この関数は、タスクのARN、コマンドのログ、終了コードを出力し、そのコードが`0`でなければ失敗します。そのため、これを実行するスクリプトはそこで止められます。`aws ecs wait tasks-stopped`は、タスクが停止したかどうかにかかわらず10分で待つのをやめ、関数もそれに伴って失敗します。その場合は、ログを読む前に、出力されたARNでもう一度待ってください。イメージを取得できなかったタスクなど、一度も起動しなかったタスクには終了コードがなく、関数はそれを`None`と出力します。その理由は`aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`で確認できます。

### マイグレーションを適用する

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

`run-task`で起動したタスクは一度だけ実行され、失敗してもECSが再び起動することはありません。マイグレーションが失敗したときには、この動きが必要です。失敗したマイグレーションはデータベースをdirtyとしてマークし、それは[マイグレーションが失敗したとき](../8-upgrading.md#マイグレーションが失敗したとき)の手順で手作業で解決します。その復旧の最後の手順で行うように、もう一度実行するのも同じ`run_publiractl`です。

### データベースロールを作成する

Fargateのタスクには、`db roles`がパスワードを読み取るための標準入力も端末もありません。また、ECSはコンテナにシークレットをファイルではなく環境変数として渡します。そこで、タスクの`secrets`でロールのパスワードごとに変数を1つ設定し、`db roles`はそれぞれを`--<role>-password-env`フラグで読み取ります。コマンドに含まれるのは変数の名前だけなので、タスク定義にもプロセス一覧にもパスワードは現れません。

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

ログには、ロールごとに1行が出力されます。後でロールのパスワードをローテーションするのも、同じタスクで行います。新しいパスワードを、そのロールの`db-password/`パラメーターと、そのパスワードを含む`db-url/`パラメーターに`aws ssm put-parameter --overwrite`で書き込み（上の`put`は、誤って値を置き換えることがないよう、このオプションを付けていません）、タスクをもう一度実行します。そして、そのロールで接続するサービスを再デプロイし、そのタスクが新しいURLで起動するようにします。`publira-server`がURLを持つ`publira_admin`の場合は、次のとおりです。

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. ロードバランサーを作成する

ロードバランサーは、ホストとパスごとにリクエストを適切なサービスに振り分けます。ロードバランサーは内部向けで、インターネット上のアドレスを持ちません。CloudFrontは、[VPCオリジン](./1-cloudfront.md#vpcオリジン)で設定するとおり、VPCオリジンとしてこれに到達します。それでも、ロードバランサーは提供するすべてのホストの証明書でTLSを終端します。CloudFrontはブラウザーが送った`Host`を転送し、ロードバランサーからはその名前の証明書しか受け付けないためです。また、ロードバランサーがWebアプリに「リクエストはHTTPSで届いた」と伝えるのは、リクエストがHTTPSリスナーに届いた場合だけだからです。

テナントごとに、そのドメインと管理画面のホストを指定した証明書をACMで1つリクエストし、ACMが示すCNAMEレコードで検証します。CloudFrontは`us-east-1`の証明書しか受け付けないため、そこでもリクエストしてください。ただし、ロードバランサーが`us-east-1`にある場合は、1つの証明書で両方をまかなえます。

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

最初のコマンドが出力するレコードを各名前のゾーンに追加し、`us-east-1`の証明書についても同じことを行います。次に、ロードバランサーと、転送先のサービスごとのターゲットグループと、どのルールにも一致しないリクエストに`404`で応答するHTTPSリスナーを作成します。

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

リスナーのルールは[ルーティング](../4-edge/index.md#ルーティング)に従います。ルールは条件ごとに最大3つ、すべての条件を合わせて最大5つの値を取ります。ロードバランサーは、ルールを優先度の小さいものから順に試します。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `1000` | すべて | `/images*`、`/rpc/publira.v1.*` | `publira-server` |
| `1100` | すべて | `/rpc`、`/rpc/*` | なし：固定の`404` |
| `2000`〜`2999` | テナントのドメイン | すべて | `web-storefront` |
| `2000`〜`2999` | テナントの管理画面のホスト | すべて | `web-admin` |

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

`/rpc`の下で転送するのは、公開APIである`publira.v1`だけです。管理画面はそれぞれのAPIをVPC経由で呼び出すため、[公開APIだけがエッジを通る](../4-edge/index.md#エッジを通るのは公開apiだけ)で説明しているとおり、それ以外にはロードバランサー自身が`404`で応答します。パスパターンは文字列として照合され、`*`は任意の文字の並びを表します。そのため`/rpc/publira.v1.*`は、公開APIの接頭辞を`v1`の後のドットまで指定し、`publira.v1beta`のような名前空間を除外します。また、`/rpc`と`/rpc/*`を2つの値に分けているので、`/rpcabc`はWebアプリに届いたままになります。`1000`と`1100`のルールはホストを指定しないため、ロードバランサーが受け取るすべてのホストに適用されます。これは、ルーティングがすべてのテナントのホストに求めることです。他のどのルールにも含まれないホストは、それ以外のすべてのパスで`404`を受け取ります。ロードバランサーは、パスと`Host`ヘッダーをブラウザーが送ったとおりに渡します。どちらも書き換えないでください。

ロードバランサーはボディのサイズに上限を設けず、送信が続く限りリクエストに時間がかかっても待つため、[エッジ](../4-edge/index.md#ページからの画像のアップロード)で説明しているアップロードやWebhookはそのまま通ります。ロードバランサーのアイドルタイムアウトは、どちらの方向でも次のバイトを待つ時間で、リクエストが届いた後にWebアプリの応答を待つ時間も含みます。変更しなければ60秒です。上のコマンドでは、[ディストリビューション](./1-cloudfront.md#ディストリビューション)で設定するとおりCloudFrontが待つ120秒に合わせて、これを引き上げています。

## 6. サービスを起動する

各サービスは、シークレットをパラメーターから受け取り、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)に載っている残りの変数をタスク定義で受け取ります。以下のサイズは調整の出発点です。`ARM64`は`X86_64`にしてもかまいません。どのイメージも両方に向けて公開されています。

`publira server`と`publira worker`は、停止を指示されてから30秒以内に停止します。そのため、[コピーの停止](../7-scaling-out.md#コピーを停止する)で説明しているとおり、コンテナ定義ではECSが強制終了するまでの`stopTimeout`を45秒にしています。デフォルトは30秒です。

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

`PUBLIRA_TRUSTED_PROXIES`の値は、[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)で決めます。

`publira-worker.json`は、同じイメージを`worker`をコマンドとして動かし、ヘルスチェックではポート`8003`を確認します。

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

`web-storefront.json`も同じ形ですが、タスクロールはなく、`publira server`をCloud Mapの名前で呼び出します。

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
        { "name": "PNCH_REDIS_URL", "valueFrom": "/publira/redis-url" }
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

`web-storefront`は、テナントのGoogleタグゲートウェイに渡す読者のアドレスを求めるために、`publira server`と同じ`PUBLIRA_TRUSTED_PROXIES`を受け取ります。`web-admin.json`は、`web-storefront`が現れるすべての箇所を`web-admin`にし、ポートをヘルスチェックも含めて`3000`から`4000`にし、`PUBLIRA_AUTH_SECRET`を`/publira/admin-auth-secret`にし、`web-admin`が読まない`PUBLIRA_TRUSTED_PROXIES`を除き、シークレットを1つ、`/publira/web-service-token`からの`PUBLIRA_WEB_SERVICE_TOKEN`を加えたものです。

4つを登録し、それぞれが使うセキュリティグループ、ターゲットグループ、Cloud Mapの名前を指定して、それぞれのサービスを作成します。

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

`publira-worker`はジョブキューのテーブルを起動時に作成するため、そのための専用のタスクは必要ありません。安定しないサービスはタスクを停止し続けます。その理由は`aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`で確認できます。ヘルスチェックに失敗したタスクか、停止したタスクのどちらかです。停止したタスクの場合は、`/publira`にあるそのログに原因が出ています。たとえば、パスワードが接続URLと一致しないロールなどです。

### ヘルスチェック

ECSサービスは、ヘルスチェックの種類を問わず、それに失敗したタスクを置き換えます。そのため、このページのヘルスチェックはすべて、プロセス自体が応答しなくなったときにだけ失敗する`/livez`を確認します。`/readyz`を確認させると、データベースが応答しなくなった瞬間に、ECSがサービスのすべてのタスクを一斉に置き換えてしまいます。これは[オーケストレーターからのプローブ](../../3-operations/11-monitoring.md#オーケストレーターからの監視)で避けるよう警告していることです。

- **すべてのサービス**は、タスク定義にヘルスチェックを持ち、ECSがそれをタスクの中で実行します。イメージにはHTTPクライアントが含まれていないため、各チェックはそのイメージに含まれているものを使います。`publira`イメージでは`bash`の`/dev/tcp`で接続を開き、シェルのないWebのイメージでは`node`の`fetch`でリクエストを送ります。各チェックはコンテナ自身のポートで`/livez`を要求し、`200`が返れば成功です。チェックは30秒ごとに実行され、5秒でタイムアウトし、3回続けて失敗するとタスクをunhealthyとします。これらはECSのヘルスチェックのデフォルトです。`startPeriod`は、失敗を数え始める前にプロセスが起動するための30秒を与えます。Cloud Mapは、このチェックに合格したタスクのアドレスを正常とし、チェックに失敗するとそのアドレスを削除します。そのため、サービス同士が呼び合う名前も同じチェックに従います。
- **`publira-server`とWebアプリ**は、ターゲットグループからもプローブされます。ターゲットグループは`--health-check-path /livez`で同じパスを確認します。ECSは、タスクの起動後`--health-check-grace-period-seconds`が経過するまでこのチェックの結果に基づいて動作せず、ロードバランサーは、チェックに合格した新しいタスクにリクエストを送り始めます。

それでもレディネスは、ヘルスチェックとしてではなくサービスの外から確認する価値があります。エッジが動き始めれば、`https://<domain>/readyz`が`web-storefront`のレディネスを返します。これには`publira server`とValkeyのレディネスも含まれます。ワーカーの`/readyz`には何もアクセスしません。ワーカー独自のログインが失敗した場合は、それを使うジョブが失敗するのに伴って、ワーカーのログに現れます。

## 7. インストール環境をセットアップする

`publiractl setup`は、すべての値をフラグで渡すタスクとして一度だけ実行します。`run-task`で起動したタスクには、値を尋ねるための端末がないためです。このタスクは`publira_platform`として接続し、保存するものを暗号化キーで封印します。そのため、そのどちらについてもサーバーと同じパラメーターを読みます。また、バケットの接続テストには`publira-storage`タスクロールを使います。`db-url/master`は渡しません。`setup`が管理用ログインで接続することはありません。

出力はCloudWatch Logsに送られるため、管理者のパスワードは生成させずに指定してください。生成されたパスワードはサマリーに出力されますが、変数で渡したパスワードは出力されません。このパスワードとSMTPのパスワードを、それぞれ専用のパラメーターとして保存します。

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

これらは、ロールのパスワードと同じように、`--smtp-password-env`フラグと`--admin-password-env`フラグが指定する変数として`publiractl`に渡ります。`publiractl-setup.json`：

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

`--access-key-id`もシークレットキーもありません。バケットは独自のキーを持たずに保存され、各プロセスはタスクロールで署名します。上のSMTPの値はAmazon SESのものです。SESのSMTP認証情報は、IAMユーザーのアクセスキーではなく、それをもとに作成するユーザー名とパスワードです。別のサーバーを使う場合は、そのホスト、ポート、暗号化方式を指定してください。[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)に、すべてのフラグと、省略できる手順が載っています。

途中で止まった実行（たとえば接続テストの1つが失敗した場合）は、それまでに保存した内容を残します。原因を直してからもう一度実行すれば完了します。

管理者のパスワードは`/publira/setup/admin-password`パラメーターに入っています。`aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`で出力できます。管理者がログインしてパスワードを変更したら、このパラメーターは削除してください。それ以降、このパラメーターを読むものはありません。

## 8. CloudFrontを前に置く

CloudFrontは、読者が接続するエッジです。すべてのテナントのホストのTLSを終端し、平文のHTTPをHTTPSにリダイレクトし、呼び出し元に選ばせてはならないヘッダーを取り除き、それ以外のすべてをロードバランサーに転送します。[ECSの前に置くCloudFront](./1-cloudfront.md)でこれを設定し、VPCの外から確認します。上の手順で定義した変数と関数を使うため、この同じシェルで実行してください。確認がすべて通ったら、ログインするためにこのページに戻ってきてください。

## 9. ログインする

テナント管理画面を`https://admin.comics.example.com`、または`--admin-domain`で指定した管理画面のホストで開き、管理者のメールアドレスとパスワードでログインします。ここから先、インストール環境は[ログインする](../2-installing.md#6-ログインする)で説明しているものと同じです。

## このセクションの内容

- [ECSの前に置くCloudFront](./1-cloudfront.md)：VPCオリジン、ヘッダー、キャッシュポリシー、ディストリビューション、クライアントのアドレス、VPCの外からのエッジの確認。
- [ECSでの運用](./2-operating.md)：テナントの追加、管理画面の認証情報をテナントのドメインから切り離す方法、アップグレード。

## 次のステップ

CloudFrontとロードバランサーが協力して行わなければならないことのすべては[エッジ](../4-edge/index.md)に、インストール環境が稼働を始めた後に監視すべきことは[モニタリング](../../3-operations/11-monitoring.md)に書かれています。各プロセスが読む変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。オプションのプロセスは、[オプションのプロセスを有効にする](../2-installing.md#オプションのプロセスを有効にする)の説明どおり、それぞれ上と同じようなサービスとして有効にします。`web-platform`には、ターゲットグループ、そのホストのルール、Cloud Mapの名前、`publira-web`で開いたポート`4100`が必要です。`email-renderer`に必要なのは、Cloud Mapの名前と、`publira-worker`からのポート`8080`を許可するセキュリティグループだけです。
