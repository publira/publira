---
title: Amazon ECS(Fargate)
description: CloudFrontとApplication Load Balancerの背後で、PubliraをAWS Fargate上のAmazon ECSサービスとして動かす手順を、パラメーターとタスク定義の用意からテナント管理画面への最初のログインまで説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-31
---

このページでは、マネージドサービスを用意したVPCから始めて、テナント管理画面に初めてログインするまでを説明します。プロセスはすべてAWS Fargate上のAmazon ECSサービスとして動かし、CloudFrontとApplication Load Balancerをリバースプロキシにします。手順は[インストール](../2-installing.md)と同じです。各手順がなぜ必要か、シークレットがそれぞれ何を守るか、データベースロールがそれぞれどこまで触れられるかは、そちらで説明しています。リバースプロキシは[リバースプロキシで必要な設定](../4-edge/index.md#リバースプロキシで必要な設定)の要件どおりに置きます。このページで扱うのはECSとFargateに固有のことで、Publiraの各部分をどのAWSリソースにするか、2つのページの要件をそのリソースでどう満たすかです。

以下のコマンドとJSONは、環境に合わせて書き換えて使う例であり、保守している一式ではありません。リポジトリにはCloudFormationのテンプレートもCDKのアプリもTerraformのモジュールもありません。コマンドはAWS CLIバージョン2向けで、イメージには公開イメージの`ghcr.io/publira/<name>:<tag>`を指定しています。`<tag>`は[始める前に](../2-installing.md#始める前に)で説明しているとおりインストールするリリースのバージョンに、`<account>`と`<region>`は自分のアカウントIDとリージョンに置き換えてください。

## ECSで動かすもの

常駐するプロセスは、それぞれを独立したECSサービスとしてFargate起動タイプで動かします。ほかから呼び出されるサービスは、同じ名前でAWS Cloud Mapにも登録します。

| ECSサービス | イメージとコマンド | ポート | 呼び出し元 | タスク数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | ロードバランサーと、Cloud Map経由のWebアプリ | 任意 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`。コマンドは`worker` | `8003`。ヘルスチェック専用 | なし | 任意 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | ロードバランサーと、Cloud Map経由でキャッシュの再検証を送るサーバーとワーカー | 任意 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | `web-storefront`と同じ | 任意 |
| `web-platform`(動かす場合) | `ghcr.io/publira/web-platform:<tag>` | `4100` | `web-storefront`と同じ | 任意 |
| `email-renderer`(動かす場合) | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Cloud Map経由のワーカー | 任意 |

ワーカーは複数のタスクで動かせます。定期ジョブは実行中のものと同じジョブを重ねて実行しない仕組みなので、2つのタスクが同じジョブを同時に実行することはありません。繰り返し実行するジョブのスケジュールもワーカーが自分で管理するので、EventBridgeのスケジュールやスケジュールされたタスクは要りません。サーバーとワーカーのタスクはデータベースのログインごとに接続プールを開くので、タスクを増やすと、データベースもそれだけ多くの接続を受け付ける必要があります。必要な接続数の計算は[接続プール](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)にあります。

`publira server`と`publira worker`は、1つの`publira server --with-worker`にまとめず、上の表のとおり2つのサービスとして動かしてください。このフラグは1台のホストで動かす構成のためのものです。[構成の概要](../1-overview.md#publiraで動かすプロセス)で説明しているとおり、ECSで使うとサーバーとワーカーを別々にスケールできなくなり、ロードバランサーの転送先のプロセスがワーカーのデータベースログインを持つことになります。それでいてECSで得られるものは何もありません。

プロセス同士は、`publira-server.publira.internal`のように、Cloud Mapのサービス検出が付ける名前で呼び合います。この名前は動いている各タスクのアドレスに解決されるので、呼び出しは呼び出し元のアドレスのまま直接タスクに届きます。ECS Service Connectを使うと、呼び出しは受け側のタスクにあるプロキシを通り、`127.0.0.1`から渡されます。すると`publira server`は、Webアプリが読者に代わって送るリクエストをすべてこのアドレスで記録してしまいます。

`publiractl`は常駐させません。インストールするリリースのイメージから`aws ecs run-task`でタスクとして起動し、コマンドが終わるとタスクも止まります。

## 始める前に

次のものを用意してください。

### AWS CLI

AWS CLIバージョン2を用意し、ECS、Cloud Map、Elastic Load Balancing、CloudFront、ACM、IAMロール、Systems Managerのパラメーター、EC2のセキュリティグループ、CloudWatch Logsを管理できる権限でアカウントにログインしておきます。

### VPC

タスクとロードバランサーを置くプライベートサブネットを、2つ以上のアベイラビリティーゾーンに用意します。CloudFrontが各サブネットにネットワークインターフェースを作るので、どのサブネットにも空きアドレスが1つ以上必要です。インターネットゲートウェイもアタッチしておきます。通信がそこを通ることはありませんが、CloudFrontがVPCオリジンとしてロードバランサーに接続するには、そのVPCにインターネットゲートウェイが必要です。

タスクは、イメージを取得するためのGitHub Container Registry、Systems ManagerとCloudWatch LogsのAPI、Amazon S3、SMTPサーバーに接続できなければなりません。プライベートサブネットにNATゲートウェイを用意するか、AWSのサービスにはVPCエンドポイントを、イメージにはプルスルーキャッシュを用意してください。

### Publiraが依存するサービス

[サービスを用意する](../2-installing.md#サービスを用意する)の一覧に従って、次のサービスを用意します。

#### Amazon RDS for PostgreSQLかAurora PostgreSQL

Publiraのデータベースは初期データベースとして作っておきます。管理用ログインにはマスターユーザーを使います。マスターユーザーはスーパーユーザーではありませんが、そのデータベースを所有していて、ロールも作れます。`publiractl db`に必要なのはそれだけです。

#### Amazon ElastiCache for ValkeyかRedis OSS

クラスターモードを無効にしたノードベースのクラスターとして作り、転送中の暗号化を有効にしてAUTHトークンを設定します。Publiraはプライマリエンドポイントに単一のサーバーとして接続します。ElastiCache Serverlessはクラスターモードで通信するクライアントしか受け付けないので使えません。

#### Amazon S3のバケット

空のバケットを用意します。プロセスは後述のタスクロールでバケットにアクセスするので、アクセスキーを作ったり保存したりする必要はありません。

#### Amazon SESかほかのSMTPサーバー

SMTPの認証情報と、送信元として検証済みのアドレスを用意します。

### DNS

テナントのドメインと管理画面のホストのDNSを用意します。管理画面のホストは`admin.<domain>`か、`--admin-domain`で指定するホストです。どちらもCloudFrontのディストリビューションを作ってからそこに向けます。ACMが証明書の検証のために求めるCNAMEレコードも追加できるようにしておいてください。

### シェル変数

以下のコマンドは次のシェル変数を使います。値は自分の環境に合わせてください。

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

以降の手順は、すべてこの1つのシェルで実行してください。各手順は、それより前の手順で定義した変数と関数を使います。このページのタスク定義はどれもコンテナの出力を`/publira`ロググループに送り、コンテナごとに1つのストリームを作ります。

## 1. シークレットを保存する

Publiraに必要なシークレットと、それぞれが守るものは[シークレットを生成する](../2-installing.md#シークレットを生成する)に一覧があります。どのシークレットも、Systems Manager Parameter Storeの`/publira/`の下に`SecureString`パラメーターとして保存します。タスク定義の`secrets`にパラメーターを書くと、コンテナの起動時にECSがその値を環境変数に設定します。そのため、再検証トークンのように複数のプロセスが使う値も一度保存すれば済み、各プロセスのタスク定義から同じパラメーターを指定できます。接続URLにはロールのパスワードが入るので、これもパラメーターにします。AUTHトークンが入るValkeyのURLも同じです。

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

上のエンドポイントは、自分のElastiCacheのプライマリエンドポイントとRDSのエンドポイントに置き換えてください。`rediss://`は省略できません。ElastiCacheのクラスターは転送中の暗号化を有効にしたときしかAUTHトークンを受け付けず、`publira server`はパスワードを含む`redis://`のURLでは起動しないからです。接続URLにはパスワードがエスケープされずにそのまま入ります。AUTHトークンとマスターパスワードには、上の16進数の出力のようにURLでそのまま使える文字だけを使うか、それ以外の文字をパーセントエンコードしてください。`sslmode=require`は接続を暗号化しますが、証明書は検証しません。RDSの証明書に署名しているのはRDSの認証局で、イメージが信頼する認証局ではないからです。

| パラメーター | 読むもの | 環境変数 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`、`publira-worker`、`publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`、`admin-auth-secret` | `web-storefront`と`web-admin`が1つずつ | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`、`publira-worker`、`web-storefront`、`web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`と`web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`と、`web-storefront`と`web-admin` | `publira-server`は`PUBLIRA_REDIS_URL`、Webアプリは`PNCH_REDIS_URL` |
| `db-url/public`、`db-url/admin`、`db-url/platform` | `publira-server`。`db-url/platform`は`publiractl setup`も読みます | `PUBLIRA_PUBLIC_DB_URL`、`PUBLIRA_ADMIN_DB_URL`、`PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`、`db-url/ticker`、`db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`、`PUBLIRA_TICKER_DB_URL`、`PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | `db`タスクだけです。[管理用ログイン](../2-installing.md#サービスを用意する)の接続を読むのは`db`コマンドだけなので、常駐するプロセスには渡しません | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles`タスク | `PUBLIRA_PUBLIC_DB_PASSWORD`のように、ロールごとに1つの環境変数です。`db roles`はこれを`--<role>-password-env`フラグで読みます。[データベースロールを作成する](#データベースロールを作成する)で説明します |

パラメーターはバックアップの代わりにはなりません。暗号化キーは自分のシークレットストアにも保管してください。[シークレットを生成する](../2-installing.md#シークレットを生成する)で説明しているとおり、キーを失うと、Publiraに保存した認証情報をすべて入力し直すことになります。ECSが値を読むのはコンテナの起動時なので、パラメーターを変えてもサービスに反映されるのは次のデプロイからです。値をAWS Secrets Managerに保管する場合は、`valueFrom`にパラメーター名ではなく、シークレットかシークレット内のJSONキーを指定します。タスク実行ロールには、後述の`ssm:GetParameters`のステートメントの代わりに、それらのシークレットに対する`secretsmanager:GetSecretValue`を許可してください。

## 2. IAMロールを作成する

すべてのタスクで2つのロールを使います。タスク実行ロールは、ECSがイメージの取得、ログの書き込み、パラメーターの読み取りに使うロールで、コンテナに渡ることはありません。タスクロールは、プロセスがS3へのリクエストに署名するためのロールです。

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

`publira-images`は自分のバケットの名前に置き換えてください。パラメーターはSystems ManagerのAWSマネージドキーで暗号化されるので、キーの権限を付与する必要はありません。自分で作ったキーで暗号化したパラメーターには、そのキーに対する`kms:Decrypt`も必要です。

`publira-storage`は、`publira-server`、`publira-worker`、`publiractl setup`タスクのタスクロールです。サーバーは画像のアップロードと読み取りに、ワーカーは使われなくなった画像の削除に、`setup`は接続テストの署名にこのロールを使います。タスクロールを持つタスクにはECSが環境変数を設定し、各プロセスのAWS SDKはそこからロールの認証情報を自分で見つけます。そのため、[初期設定](#7-初期設定)では、[オブジェクトストレージ](../../3-operations/5-object-storage.md)で説明しているとおりアクセスキーなしでバケットを保存します。Webアプリと`db`タスクにはタスクロールは要りません。

## 3. ネットワークの経路を開く

Publiraの部分ごとにセキュリティグループを作り、その部分を呼び出す相手からの通信だけを許可します。ECSはタスクを置き換えるたびにタスクのアドレスも変えるので、ルールにはアドレスではなく呼び出し元のセキュリティグループを指定します。

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

| セキュリティグループ | 許可するポート | 許可する接続元 |
| --- | --- | --- |
| `publira-alb` | `443` | CloudFrontだけ。[VPCオリジン](./1-cloudfront.md#vpcオリジン)の手順で追加します |
| `publira-server` | `8000` | ロードバランサーと、APIを呼び出すWebアプリ |
| `publira-web` | `3000`、`4000` | ロードバランサーと、キャッシュの再検証を送るサーバーとワーカー |
| `publira-worker`、`publiractl` | なし | 呼び出すものはありません |
| データベースのセキュリティグループ | `5432` | サーバー、ワーカー、`publiractl` |
| Valkeyクラスターのセキュリティグループ | `6379` | サーバーとWebアプリ |

ワーカーと`publiractl`はValkeyを、Webアプリはデータベースを使わないので、それらの経路は開きません。どのセキュリティグループでも、外向きの接続を許可する既定のルールは残しておきます。タスクがイメージの取得、AWSのAPI、S3、SMTPに接続するのに必要です。

ほかから呼び出されるサービスには、Cloud Mapで、VPCのプライベートDNS名前空間の名前を付けます。

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

名前空間ができるまで少し時間がかかります。IDが返ってくるまで`list-namespaces`を実行し直してください。ECSは、タスクの起動時にそのアドレスをサービスの名前で登録し、タスクの停止時に削除します。

## 4. マイグレーションを適用してデータベースロールを作成する

`db`コマンドは、リリースの`publiractl`イメージから単発のタスクとして、管理用ログインの接続で実行します。どのコマンドも起動と完了待ちのやり方は同じなので、関数にまとめておきます。

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

この関数は、タスクのARN、コマンドのログ、終了コードを表示し、終了コードが`0`でなければ失敗します。そのため、この関数を使うスクリプトはそこで止められます。`aws ecs wait tasks-stopped`はタスクが止まったかどうかにかかわらず10分で待つのをやめ、そのときは関数も失敗します。表示されたARNでもう一度待ってから、ログを読んでください。イメージを取得できなかったタスクのように、起動しなかったタスクには終了コードがなく、関数は`None`と表示します。起動しなかった理由は`aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`でわかります。

### マイグレーションを適用する

次の内容で`publiractl-db-migrate.json`を作ります。

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

`run-task`で起動したタスクは1回だけ実行され、失敗してもECSが再実行することはありません。失敗したマイグレーションにはこの振る舞いが必要です。マイグレーションが失敗するとデータベースにdirtyの印が残り、[マイグレーションが失敗したとき](../8-upgrading.md#マイグレーションが失敗したとき)の手順で手作業で解消する必要があるからです。その手順の最後に行う再実行も、同じ`run_publiractl`で行います。

### データベースロールを作成する

Fargateのタスクには、`db roles`がパスワードを読み取るための標準入力も端末もありません。また、ECSはシークレットをファイルではなく環境変数としてコンテナに渡します。そこで、タスクの`secrets`でロールのパスワードを1つずつ環境変数に設定し、`db roles`には`--<role>-password-env`フラグでそれぞれを読ませます。コマンドに書くのは変数の名前だけなので、パスワードがタスク定義やプロセスの一覧に現れることはありません。

次の内容で`publiractl-db-roles.json`を作ります。

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

ログにはロールごとに1行が出ます。あとでロールのパスワードをローテーションするときも、このタスクを使います。新しいパスワードを`db-password/`のパラメーターと、それを含む`db-url/`のパラメーターに`aws ssm put-parameter --overwrite`で書き込みます。上の`put`が`--overwrite`を付けていないのは、誤って値を上書きしないためです。続けてこのタスクをもう一度実行し、そのロールで接続するサービスをデプロイし直して、新しいURLでタスクを起動させます。`publira-server`が接続URLを持つ`publira_admin`なら次のようにします。

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. ロードバランサーを作成する

ロードバランサーは、ホストとパスに応じてリクエストを適切なサービスに振り分けます。ロードバランサーは内部向けで、インターネット上のアドレスを持ちません。CloudFrontは、[VPCオリジン](./1-cloudfront.md#vpcオリジン)で設定するVPCオリジンとしてロードバランサーに接続します。それでもロードバランサーでは、受け付けるすべてのホストの証明書でTLSを終端します。CloudFrontはブラウザーが送った`Host`をそのまま転送し、ロードバランサーからはその名前の証明書しか受け付けないからです。また、ロードバランサーがWebアプリに、リクエストがHTTPSで届いたと伝えるのは、HTTPSリスナーで受けたときだけだからです。

ACMで、テナントごとに証明書を1つリクエストします。証明書にはテナントのドメインと管理画面のホストを含め、ACMが示すCNAMEレコードで検証します。CloudFrontが使えるのは`us-east-1`の証明書だけなので、ロードバランサーが`us-east-1`以外にあれば`us-east-1`でもリクエストします。ロードバランサーが`us-east-1`にあれば、1つの証明書を両方で使えます。

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

1つ目のコマンドが表示するレコードを、それぞれの名前のゾーンに追加します。`us-east-1`の証明書でも同じことをします。次に、ロードバランサー、転送先のサービスごとのターゲットグループ、HTTPSリスナーを作ります。リスナーは、どのルールにも一致しないリクエストに`404`を返します。

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

リスナーのルールは[ルーティング](../4-edge/index.md#ルーティング)の要件どおりに作ります。1つのルールに書ける値は、条件ごとに3つ、条件全体で5つまでです。ロードバランサーは優先度の小さいルールから順に評価します。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `1000` | すべて | `/images*`、`/rpc/publira.v1.*` | `publira-server` |
| `1100` | すべて | `/rpc`、`/rpc/*` | なし。固定の`404`を返します |
| `2000`から`2999` | テナントのドメイン | すべて | `web-storefront` |
| `2000`から`2999` | テナントの管理画面のホスト | すべて | `web-admin` |

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

`/rpc`の下で転送するのは公開APIの`publira.v1`だけです。管理画面はそれぞれのAPIをVPC内で呼び出すので、ほかのパスにはロードバランサーが自分で`404`を返します。理由は[リバースプロキシを通すのは公開APIだけ](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しています。パスパターンは文字列として照合し、`*`は任意の文字の並びを表します。`/rpc/publira.v1.*`は公開APIのプレフィックスを`v1`のあとのドットまで指定しているので、`publira.v1beta`のような名前空間は一致しません。`/rpc`と`/rpc/*`を2つの値に分けているのは、`/rpcabc`をWebアプリに渡すためです。優先度`1000`と`1100`のルールはホストを指定していないので、ロードバランサーが受け付けるすべてのホストに当てはまります。これはルーティングの要件が、すべてのテナントのホストに求めていることです。ほかのどのルールにもないホストには、それ以外のすべてのパスで`404`が返ります。ロードバランサーはパスと`Host`ヘッダーをブラウザーが送ったとおりに転送します。どちらも書き換えないでください。

ロードバランサーはボディのサイズを制限せず、送信が続いている限り、リクエストにどれだけ時間がかかっても待ちます。そのため、[ページからの画像のアップロード](../4-edge/index.md#ページからの画像のアップロード)など、リバースプロキシの設定で説明しているアップロードやWebhookはそのまま通ります。アイドルタイムアウトは、送受信のどちらでも次の1バイトを待つ時間で、リクエストが届いたあとWebアプリの応答を待つ時間もこれに含まれます。既定値は60秒ですが、上のコマンドでは、CloudFrontが待つ時間と同じ120秒に引き上げています。CloudFrontが待つ時間は[ディストリビューション](./1-cloudfront.md#ディストリビューション)で設定します。

## 6. サービスを起動する

各サービスは、シークレットをパラメーターから受け取ります。そのほかの環境変数は、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にあるものをタスク定義に書きます。以下のサイズは調整のための出発点です。イメージはどれも両方のアーキテクチャ向けに公開しているので、`ARM64`は`X86_64`に変えても構いません。

`publira server`と`publira worker`は、停止を指示されてから30秒以内に止まります。そのため、コンテナ定義ではECSが強制終了するまでの`stopTimeout`を、既定の30秒ではなく45秒にしています。詳しくは[インスタンスを停止する](../7-scaling-out.md#インスタンスを停止する)で説明しています。

次の内容で`publira-server.json`を作ります。

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

`PUBLIRA_TRUSTED_PROXIES`の値は[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)で求めます。

`publira-worker.json`は同じイメージを`worker`コマンドで動かし、ヘルスチェックではポート`8003`を確かめます。

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

`web-storefront.json`も同じ形です。タスクロールはなく、`publira server`をCloud Mapの名前で呼び出します。

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

`web-storefront`も`publira server`と同じ`PUBLIRA_TRUSTED_PROXIES`を受け取り、テナントのGoogleタグゲートウェイに渡す読者のアドレスを、この値を使って求めます。`web-admin.json`は、次の点を除いて`web-storefront.json`と同じです。

- `web-storefront`と書かれている箇所は、すべて`web-admin`にします。
- ポートは`3000`ではなく`4000`です。ヘルスチェックのポートも変えます。
- `PUBLIRA_AUTH_SECRET`には`/publira/admin-auth-secret`を指定します。
- `web-admin`は`PUBLIRA_TRUSTED_PROXIES`を読まないので、指定しません。
- シークレットを1つ追加し、`PUBLIRA_WEB_SERVICE_TOKEN`に`/publira/web-service-token`を指定します。

4つのタスク定義を登録し、それぞれのセキュリティグループ、ターゲットグループ、Cloud Mapの名前を指定してサービスを作ります。

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

`publira-worker`はジョブキューのテーブルを起動時に作るので、そのためのタスクは要りません。安定しないサービスはタスクの停止を繰り返します。理由は`aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`でわかり、ヘルスチェックに失敗したタスクか、止まったタスクが表示されます。止まったタスクなら、`/publira`のログに原因が出ています。ロールのパスワードが接続URLのものと一致していない、といった原因です。

### ヘルスチェック

ECSのサービスは、種類にかかわらずヘルスチェックに失敗したタスクを置き換えます。そのため、このページのヘルスチェックはどれも`/livez`を確かめます。`/livez`が失敗するのは、プロセス自体が応答しなくなったときだけです。`/readyz`を確かめさせると、データベースが応答しなくなった途端に、ECSがサービスのタスクをすべて一斉に置き換えてしまいます。[オーケストレーターからのプローブ](../../3-operations/11-monitoring.md#オーケストレーターからのプローブ)で避けるよう注意しているのが、まさにこの状況です。

レディネスも確かめる価値はありますが、ヘルスチェックとしてではなく、サービスの外から確かめます。リバースプロキシを設定したあとは、`https://<domain>/readyz`が`web-storefront`のレディネスを返し、そこには`publira server`とValkeyのレディネスも含まれます。ワーカーの`/readyz`にアクセスするものはありません。ワーカー専用のログインで接続できなくなると、そのログインを使うジョブが失敗し、その失敗がワーカーのログに出ます。

#### タスク定義のヘルスチェック

どのサービスも、タスク定義にヘルスチェックを書きます。このチェックはECSがタスクの中で実行します。イメージにはHTTPクライアントが入っていないので、それぞれのイメージに入っているものを使います。`publira`イメージでは`bash`の`/dev/tcp`で接続を開き、シェルのないWebアプリのイメージでは`node`の`fetch`でリクエストを送ります。どのチェックもコンテナ自身のポートの`/livez`にリクエストし、`200`が返れば成功です。ECSのヘルスチェックの既定値どおり、チェックは30秒ごとに実行して5秒で打ち切り、3回続けて失敗するとタスクを異常とみなします。`startPeriod`を指定しているので、起動から30秒間の失敗は数えません。Cloud Mapは、このチェックに成功したタスクのアドレスを正常として扱い、失敗すると削除します。そのため、サービス同士が呼び合う名前も同じチェックの結果に従います。

#### ターゲットグループのヘルスチェック

`publira-server`とWebアプリは、ターゲットグループからも確かめます。`--health-check-path /livez`で同じパスを指定しています。ECSはタスクの起動から`--health-check-grace-period-seconds`が過ぎるまで、このチェックの結果に応じた処理をしません。チェックに成功すると、ロードバランサーは新しいタスクにリクエストを送り始めます。

## 7. 初期設定

`publiractl setup`は、すべての値をフラグで指定したタスクとして1回だけ実行します。`run-task`で起動したタスクには、値を尋ねるための端末がないからです。`setup`は`publira_platform`として接続し、保存する値を暗号化キーで暗号化するので、どちらもサーバーと同じパラメーターから読みます。バケットの接続テストには`publira-storage`タスクロールを使います。`setup`は管理用ログインで接続することはないので、`db-url/master`は渡しません。

`setup`の出力はCloudWatch Logsに送られます。そのため、管理者のパスワードは生成させずに指定してください。生成されたパスワードは最後の概要に表示されますが、変数で渡したパスワードは表示されません。管理者のパスワードとSMTPのパスワードは、それぞれ専用のパラメーターに保存します。

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

どちらも、ロールのパスワードと同じように環境変数として`publiractl`に渡し、その変数名を`--smtp-password-env`フラグと`--admin-password-env`フラグで指定します。次の内容で`publiractl-setup.json`を作ります。

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

`--access-key-id`もシークレットキーも指定しません。バケットには専用のキーを保存せず、各プロセスがタスクロールで署名します。上のSMTPの値はAmazon SESのものです。SESのSMTP認証情報は、IAMユーザーのアクセスキーそのものではなく、アクセスキーから作るユーザー名とパスワードです。ほかのSMTPサーバーを使う場合は、そのサーバーのホスト、ポート、暗号化方式を指定してください。すべてのフラグと、省略できる手順は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。

接続テストの失敗などで途中で止まっても、それまでに保存した内容は残ります。原因を取り除いてからもう一度実行すれば完了します。

管理者のパスワードは`/publira/setup/admin-password`パラメーターに入っていて、`aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`で表示できます。管理者がログインしてパスワードを変えたら、このパラメーターは削除してください。それ以降に読むものはありません。

## 8. CloudFrontを前段に置く

読者が接続する先はCloudFrontです。CloudFrontはすべてのテナントのホストのTLSを終端し、HTTPのリクエストをHTTPSにリダイレクトします。さらに、呼び出し元に値を決めさせてはいけないヘッダーを取り除き、残りはすべてロードバランサーに転送します。設定の手順と、VPCの外からの確認は[CloudFrontを使った公開](./1-cloudfront.md)で説明しています。上の手順で定義した変数と関数を使うので、同じシェルで続けてください。確認がすべて通ったら、このページに戻ってログインします。

## 9. ログインする

`https://admin.comics.example.com`か、`--admin-domain`で指定した管理画面のホストでテナント管理画面を開き、管理者のメールアドレスとパスワードでログインします。ここから先は、インストールの[ログインする](../2-installing.md#6-ログインする)で説明している状態と同じです。

## このセクションのページ

- [CloudFrontを使った公開](./1-cloudfront.md)は、VPCオリジン、ヘッダー、キャッシュポリシー、ディストリビューション、クライアントのアドレスの設定と、VPCの外からの確認を説明します。
- [Amazon ECSでの運用](./2-operating.md)は、テナントの追加、管理画面の認証情報をテナントのドメインから切り離す設定、アップグレードを説明します。

## 次のステップ

CloudFrontとロードバランサーが合わせて満たすべき要件は、[リバースプロキシの設定](../4-edge/index.md)にすべて書いてあります。稼働を始めたあとに見ておくものは[監視](../../3-operations/11-monitoring.md)で説明しています。各プロセスが読む環境変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。追加のプロセスは[追加のプロセスを有効にする](../2-installing.md#追加のプロセスを有効にする)の説明どおりに有効にし、それぞれ上と同じようにサービスとして動かします。`web-platform`にはターゲットグループ、そのホストのルール、Cloud Mapの名前を用意し、`publira-web`でポート`4100`を開きます。`email-renderer`にはCloud Mapの名前だけを用意し、`publira-worker`からのポート`8080`を許可するセキュリティグループを付けます。
