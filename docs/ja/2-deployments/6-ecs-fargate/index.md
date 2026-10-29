---
title: Amazon ECS(Fargate)
description: CloudFrontとApplication Load Balancerを前段に置いてPubliraをAWS Fargate上のAmazon ECSサービスとして動かす手順を、パラメーターとタスク定義の用意からテナント管理画面への最初のログインまで説明します。
published: 2026-10-29
source_updated: 2026-10-23
---

このページでは、マネージドサービスを用意したVPCから始めて、テナント管理画面に初めてログインするまでの手順を説明します。プロセスはすべてAWS Fargate上のAmazon ECSサービスとして動かし、読者からのリクエストはCloudFrontで受けてApplication Load Balancerに転送します。手順そのものは[インストール](../2-installing.md)と同じです。各手順が必要な理由や、シークレットごとに何を守っているか、データベースロールごとにどこへアクセスできるかはそちらで説明しています。CloudFrontとロードバランサーは[リバースプロキシの設定](../4-edge/index.md#リバースプロキシで必要な設定)の要件どおりに構成します。このページで扱うのはECSとFargateに固有の部分です。Publiraの各部分をどのAWSリソースにするのか、2つのページの要件をそれらのリソースでどう満たすのかを説明します。

以下のコマンドとJSONは、環境に合わせて書き換えて使う例です。保守された一式ではなく、CloudFormationテンプレートやCDKアプリ、Terraformモジュールもリポジトリには含まれていません。コマンドはAWS CLIバージョン2向けで、イメージには公開イメージの`ghcr.io/publira/<name>:<tag>`を指定しています。`<tag>`は[始める前に](../2-installing.md#始める前に)の説明どおりインストールするリリースのバージョンに、`<account>`と`<region>`は自分のアカウントIDとリージョンに置き換えてください。

## ECSで動かすもの

常時動かすプロセスは、それぞれ独立したECSサービスとしてFargate起動タイプで動かします。ほかから呼び出されるサービスは、サービスと同じ名前でAWS Cloud Mapにも登録します。

| ECSサービス | イメージとコマンド | ポート | 呼び出し元 | タスク数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | ロードバランサーと、Cloud Map経由で呼び出すWebアプリ | 任意 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`(コマンドは`worker`) | `8003`(ヘルスチェック専用) | なし | 任意 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | ロードバランサーと、Cloud Map経由でキャッシュの再検証を送るサーバーとワーカー | 任意 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | `web-storefront`と同じ | 任意 |
| `web-platform`(動かす場合) | `ghcr.io/publira/web-platform:<tag>` | `4100` | `web-storefront`と同じ | 任意 |
| `email-renderer`(動かす場合) | `ghcr.io/publira/email-renderer:<tag>` | `8080` | Cloud Map経由で呼び出すワーカー | 任意 |

ワーカーは複数のタスクで動かしてかまいません。定期ジョブは実行中に同じジョブが重複しない仕組みになっているので、2つのタスクが同じジョブを同時に実行することはありません。繰り返し実行するジョブのスケジュールもワーカー自身が管理するため、EventBridgeのスケジュールやスケジュールされたタスクは必要ありません。サーバーとワーカーのタスクは、データベースのログインごとに接続プールを開きます。タスクを増やすほど多くの接続を受け付けるデータベースが必要になります。必要な接続数の計算は[接続プール](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)にあります。

`publira server`と`publira worker`は、1つの`publira server --with-worker`にまとめず、上の表のとおり2つのサービスとして動かしてください。このフラグは1台のホストで動かす構成のためのものです。ECSで使うと、サーバーとワーカーを別々にスケールできなくなります。さらに、ロードバランサーが転送する先のプロセスがワーカー用のデータベースログインを持つことになります。この点は[構成の概要](../1-overview.md#publiraで動かすプロセス)で説明しています。ECSでこのフラグを使う利点はありません。

プロセス同士は、Cloud Mapのサービス検出が付ける`publira-server.publira.internal`のような名前で互いを呼び出します。この名前は動いている各タスクのアドレスに解決されるので、呼び出しは呼び出し元のアドレスのまま直接タスクに届きます。ECS Service Connectを使うと、呼び出しは受け側のタスク内のプロキシを経由し、`127.0.0.1`から渡されます。その場合、Webアプリが読者に代わって送るリクエストはすべて、そのアドレスからのものとして`publira server`に記録されてしまいます。

`publiractl`は常駐させません。インストールするリリースのイメージから`aws ecs run-task`で起動するタスクとして実行し、コマンドが終わるとタスクも停止します。

## 始める前に

次のものが必要です。

- **AWS CLIバージョン2**。ECS、Cloud Map、Elastic Load Balancing、CloudFront、ACM、IAMロール、Systems Managerのパラメーター、EC2のセキュリティグループ、CloudWatch Logsを管理する権限のあるアカウントにログインしておきます。
- **VPC**。タスクとロードバランサー用に、2つ以上のアベイラビリティーゾーンにプライベートサブネットを用意します。CloudFrontが各サブネットにネットワークインターフェースを作るので、それぞれに空きアドレスが1つ以上必要です。インターネットゲートウェイもアタッチしておきます。通信がそこを通ることはありませんが、CloudFrontがVPCオリジンとしてロードバランサーに接続する場合、そのVPCにはインターネットゲートウェイが必要です。タスクは、イメージを取得するためにGitHub Container Registryに接続できる必要があり、Systems ManagerとCloudWatch LogsのAPI、Amazon S3、SMTPサーバーにも接続します。プライベートサブネットにNATゲートウェイを用意するか、AWSのサービス用のVPCエンドポイントとイメージ用のプルスルーキャッシュを用意してください。
- **Publiraが依存するサービス**。[サービスを用意する](../2-installing.md#サービスを用意する)の一覧どおりに用意します。
  - **Amazon RDS for PostgreSQLまたはAurora PostgreSQL**。Publiraのデータベースは初期データベースとして作成しておきます。管理用ログインにはマスターユーザーを使います。マスターユーザーはスーパーユーザーではありませんが、そのデータベースを所有し、ロールを作成できます。`publiractl db`に必要な権限はそれだけです。
  - **Amazon ElastiCache for ValkeyまたはRedis OSS**。クラスターモードを無効にしたノードベースのクラスターとして作成し、転送中の暗号化を有効にしてAUTHトークンを設定します。Publiraはプライマリエンドポイントに単一のサーバーとして接続します。ElastiCache Serverlessはクラスターモードに対応したクライアントしか受け付けないので使えません。
  - **Amazon S3のバケット**。空のバケットを用意します。プロセスは後述のタスクロールでバケットにアクセスするので、アクセスキーを作成したり保存したりする必要はありません。
  - **Amazon SESまたはほかのSMTPサーバー**。SMTPの認証情報と、送信元として検証済みのアドレスを用意します。
- **DNS**。テナントのドメインと、管理画面のホスト名のDNSです。管理画面のホスト名は`admin.<domain>`か、`--admin-domain`で指定するホスト名です。どちらもディストリビューションを作成した後でCloudFrontに向けます。また、ACMが証明書の検証のために求めるCNAMEレコードを追加できる必要があります。

以下のコマンドでは次のシェル変数を使います。値は自分の環境に合わせてください。

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

以降の手順はすべてこの1つのシェルで実行してください。各手順は、それより前の手順で定義した変数と関数を使います。このページのタスク定義はどれも、コンテナの出力を`/publira`ロググループに送り、コンテナごとに1つのストリームを作ります。

## 1. シークレットを保存する

Publiraに必要なシークレットと、それぞれが守るものは[シークレットを生成する](../2-installing.md#シークレットを生成する)に一覧があります。どのシークレットも、Systems Manager Parameter Storeの`/publira/`の下に`SecureString`パラメーターとして保存します。タスク定義の`secrets`にパラメーターを指定すると、コンテナの起動時にECSがその値を環境変数に設定します。そのため、再検証トークンのように複数のプロセスが使う値も保存は1回で済み、各プロセスのタスク定義から同じパラメーターを指定できます。接続URLにはロールのパスワードが入るので、これもパラメーターにします。AUTHトークンが入るValkeyのURLも同じです。

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

上のエンドポイントは、自分のElastiCacheのプライマリエンドポイントとRDSのエンドポイントに置き換えてください。`rediss://`は省略できません。ElastiCacheのクラスターは転送中の暗号化を有効にしたときしかAUTHトークンを受け付けず、`publira server`はパスワードを含む`redis://`のURLでは起動しないためです。接続URLにはパスワードがエスケープされずにそのまま入ります。AUTHトークンとマスターパスワードには、上の16進数の出力のようにURLでそのまま使える文字だけを使うか、それ以外の文字をパーセントエンコードしてください。`sslmode=require`は接続を暗号化しますが、証明書は検証しません。RDSの証明書はRDSの認証局が署名したもので、イメージが信頼する認証局のものではないためです。

| パラメーター | 読み取るプロセス | 設定される環境変数 |
| --- | --- | --- |
| `secret-encryption-keys` | `publira-server`、`publira-worker`、`publiractl setup` | `PUBLIRA_SECRET_ENCRYPTION_KEYS` |
| `auth-jwt-secret` | `publira-server` | `PUBLIRA_AUTH_JWT_SECRET` |
| `storefront-auth-secret`、`admin-auth-secret` | `web-storefront`と`web-admin`がそれぞれ1つずつ | `PUBLIRA_AUTH_SECRET` |
| `revalidate-token` | `publira-server`、`publira-worker`、`web-storefront`、`web-admin` | `PUBLIRA_REVALIDATE_TOKEN` |
| `web-service-token` | `publira-server`と`web-admin` | `PUBLIRA_WEB_SERVICE_TOKEN` |
| `redis-url` | `publira-server`と、`web-storefront`および`web-admin` | `publira-server`は`PUBLIRA_REDIS_URL`、Webアプリは`PNCH_REDIS_URL` |
| `db-url/public`、`db-url/admin`、`db-url/platform` | `publira-server`(`db-url/platform`は`publiractl setup`も読みます) | `PUBLIRA_PUBLIC_DB_URL`、`PUBLIRA_ADMIN_DB_URL`、`PUBLIRA_PLATFORM_DB_URL` |
| `db-url/outbox`、`db-url/ticker`、`db-url/content-stats` | `publira-worker` | `PUBLIRA_WORKER_DB_URL`、`PUBLIRA_TICKER_DB_URL`、`PUBLIRA_CONTENT_STATS_DB_URL` |
| `db-url/master` | `db`タスクだけです。[管理用ログイン](../2-installing.md#サービスを用意する)の接続を読むのは`db`コマンドだけなので、常駐するプロセスには渡しません | `PUBLIRA_DB_URL` |
| `db-password/*` | `db roles`タスク | ファイル。[データベースロールを作成する](#データベースロールを作成する)で説明します |

パラメーターはバックアップの代わりにはなりません。暗号化キーは自分のシークレットストアにも保管してください。[シークレットを生成する](../2-installing.md#シークレットを生成する)で説明しているとおり、キーを失うとPubliraに保存した認証情報をすべて入力し直すことになります。ECSはコンテナの起動時に値を読むので、パラメーターを変更しても、サービスに反映されるのは次のデプロイからです。値をAWS Secrets Managerに保管する場合は、`valueFrom`にパラメーター名ではなくシークレットかシークレット内のJSONキーを指定します。タスク実行ロールには、後述の`ssm:GetParameters`のステートメントの代わりに、それらのシークレットに対する`secretsmanager:GetSecretValue`を許可してください。

## 2. IAMロールを作成する

すべてのタスクで2つのロールを使います。タスク実行ロールは、ECSがイメージの取得、ログの書き込み、パラメーターの読み取りに使うロールです。コンテナにこのロールが渡ることはありません。タスクロールは、プロセスがS3へのリクエストに署名するためのロールです。

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

`publira-images`は自分のバケット名に置き換えてください。パラメーターはSystems ManagerのAWSマネージドキーで暗号化されるので、キーへの権限付与は不要です。自分で作成したキーで暗号化したパラメーターには、そのキーに対する`kms:Decrypt`も必要です。

`publira-storage`は、`publira-server`、`publira-worker`、`publiractl setup`タスクのタスクロールです。サーバーは画像のアップロードと読み取りに、ワーカーは使われなくなった画像の削除に、`setup`は接続テストの署名にこのロールを使います。タスクロールを持つタスクにはECSが環境変数を設定し、各プロセスのAWS SDKはその変数からロールの認証情報を自動で取得します。そのため[初期設定](#7-初期設定)では、[オブジェクトストレージ](../../3-operations/5-object-storage.md)で説明しているとおり、アクセスキーなしでバケットを保存します。Webアプリと`db`タスクにはタスクロールは要りません。

## 3. ネットワークの経路を開く

Publiraの部分ごとにセキュリティグループを作り、それを呼び出す相手からの通信だけを許可します。ECSがタスクを置き換えるたびにタスクのアドレスも変わるので、ルールにはアドレスではなく呼び出し元のセキュリティグループを指定します。

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
| `publira-alb` | `443` | CloudFrontのみ。[VPCオリジン](./1-cloudfront.md#vpcオリジン)の手順で追加します |
| `publira-server` | `8000` | ロードバランサーと、APIを呼び出すWebアプリ |
| `publira-web` | `3000`、`4000` | ロードバランサーと、キャッシュの再検証を送るサーバーとワーカー |
| `publira-worker`、`publiractl` | なし | 呼び出し元はありません |
| データベースのセキュリティグループ | `5432` | サーバー、ワーカー、`publiractl` |
| Valkeyクラスターのセキュリティグループ | `6379` | サーバーとWebアプリ |

ワーカーと`publiractl`はValkeyを使わず、Webアプリはデータベースを使わないので、それぞれの経路は開きません。どのセキュリティグループにも、外向きの接続を許可する既定のルールは残しておきます。タスクはこのルールで、イメージの取得、AWSのAPI、S3、SMTPに接続します。

ほかから呼び出されるサービスには、Cloud MapでVPCのプライベートDNS名前空間の名前を付けます。

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

名前空間の作成には少し時間がかかります。IDが返ってくるまで`list-namespaces`を実行し直してください。ECSは、タスクの起動時にそのタスクのアドレスをサービス名で登録し、タスクの停止時に削除します。

## 4. マイグレーションを適用してデータベースロールを作成する

`db`コマンドは、リリースの`publiractl`イメージから1回限りのタスクとして、管理用ログインの接続で実行します。どのコマンドも起動と完了待ちの方法は同じなので、1つの関数にまとめておきます。

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

この関数は、タスクのARN、コマンドのログ、終了コードを表示し、終了コードが`0`以外なら失敗します。そのため、この関数を使うスクリプトはそこで止められます。`aws ecs wait tasks-stopped`は、タスクが停止したかどうかに関係なく10分で待つのをやめ、そのときは関数も失敗します。その場合は、表示されたARNでもう一度待ってからログを読んでください。イメージを取得できなかった場合など、起動しなかったタスクには終了コードがなく、関数は`None`と表示します。起動しなかった理由は`aws ecs describe-tasks --cluster publira --tasks <its ARN> --query 'tasks[0].stoppedReason'`で確認できます。

### マイグレーションを適用する

`publiractl-db-migrate.json`を次の内容で作成します。

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

`run-task`で起動したタスクは1回だけ実行され、失敗してもECSが再実行することはありません。失敗したマイグレーションにはこの動作が必要です。マイグレーションが失敗するとデータベースにはdirtyの印が残り、[マイグレーションが失敗したとき](../8-upgrading.md#マイグレーションが失敗したとき)の手順で手作業で解消しなければならないためです。その手順の最後に行う再実行も、同じ`run_publiractl`で行います。

### データベースロールを作成する

Fargateのタスクには、`db roles`がパスワードを読み取るための標準入力も端末もありません。また、ECSはシークレットをファイルではなく環境変数としてコンテナに渡します。そこで、タスクの`secrets`でロールのパスワードごとに環境変数を1つ設定し、`db roles`には`--<role>-password-env`フラグでそれぞれを読み取らせます。コマンドに書くのは変数名だけなので、パスワードがタスク定義やプロセス一覧に現れることはありません。

`publiractl-db-roles.json`を次の内容で作成します。

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

ログにはロールごとに1行が出力されます。後でロールのパスワードをローテーションするときも、このタスクを使います。新しいパスワードを、`db-password/`のパラメーターと、そのパスワードを含む`db-url/`のパラメーターに`aws ssm put-parameter --overwrite`で書き込みます。上の`put`に`--overwrite`を付けていないのは、誤って値を上書きしないようにするためです。次にこのタスクをもう一度実行し、そのロールで接続するサービスを再デプロイして、新しいURLでタスクを起動させます。`publira-server`が接続URLを持つ`publira_admin`の場合は次のとおりです。

```bash
run_publiractl publiractl-db-roles
aws ecs update-service --cluster publira --service publira-server --force-new-deployment
```

## 5. ロードバランサーを作成する

ロードバランサーは、ホストとパスに応じてリクエストを適切なサービスに振り分けます。ロードバランサーは内部向けとして作成し、インターネット上のアドレスは持たせません。CloudFrontは、[VPCオリジン](./1-cloudfront.md#vpcオリジン)の手順で設定するVPCオリジンとしてロードバランサーに接続します。それでもロードバランサーでは、受け付けるすべてのホストの証明書でTLSを終端します。理由は2つあります。1つは、CloudFrontがブラウザーの送った`Host`をそのまま転送し、ロードバランサーからはその名前の証明書しか受け付けないことです。もう1つは、ロードバランサーがWebアプリにリクエストがHTTPSで届いたと伝えるのが、HTTPSリスナーで受けたときだけであることです。

ACMでテナントごとに証明書を1つリクエストします。証明書にはテナントのドメインと管理画面のホスト名を含め、ACMが示すCNAMEレコードで検証します。CloudFrontが使えるのは`us-east-1`の証明書だけなので、ロードバランサーが`us-east-1`にない場合は`us-east-1`でもリクエストします。ロードバランサーが`us-east-1`にあれば、1つの証明書を両方で使えます。

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

1つ目のコマンドが表示するレコードを、それぞれの名前のゾーンに追加します。`us-east-1`の証明書でも同じことを行います。次に、ロードバランサーと、転送先のサービスごとのターゲットグループ、HTTPSリスナーを作成します。リスナーは、どのルールにも一致しないリクエストに`404`を返します。

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

リスナーのルールは[ルーティング](../4-edge/index.md#ルーティング)の要件に従って作ります。1つのルールに指定できる値は、条件ごとに3つまで、条件全体で5つまでです。ロードバランサーはルールを優先度の小さい順に評価します。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `1000` | すべて | `/images*`、`/rpc/publira.v1.*` | `publira-server` |
| `1100` | すべて | `/rpc`、`/rpc/*` | なし(固定の`404`を返す) |
| `2000`から`2999` | テナントのドメイン | すべて | `web-storefront` |
| `2000`から`2999` | テナントの管理画面のホスト名 | すべて | `web-admin` |

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

`/rpc`の下で転送するのは公開API(`publira.v1`)だけです。管理画面はそれぞれのAPIをVPC内で呼び出すので、それ以外のパスにはロードバランサー自身が`404`を返します。その理由は[公開APIだけを外部に通す](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しています。パスパターンは文字列として照合され、`*`は任意の文字列を表します。`/rpc/publira.v1.*`は公開APIのプレフィックスを`v1`の後のドットまで指定しているので、`publira.v1beta`のような名前空間は一致しません。`/rpc`と`/rpc/*`を2つの値に分けているのは、`/rpcabc`をWebアプリに転送するためです。優先度`1000`と`1100`のルールはホストを指定していないので、ロードバランサーが受け付けるすべてのホストに適用されます。すべてのテナントのホストにこのルールを適用することは、ルーティングの要件です。ほかのどのルールにもないホストには、それ以外のすべてのパスで`404`が返ります。ロードバランサーはパスと`Host`ヘッダーをブラウザーが送ったとおりに転送します。どちらも書き換えないでください。

ロードバランサーはリクエストボディのサイズを制限せず、送信が続いている限りリクエストにどれだけ時間がかかってもかまいません。そのため、[リバースプロキシの設定](../4-edge/index.md#ページからの画像のアップロード)で説明しているアップロードやWebhookはそのまま通ります。アイドルタイムアウトは、送受信のどちらでも次の1バイトを待つ時間で、リクエストが届いた後にWebアプリの応答を待つ時間も含みます。既定値は60秒です。上のコマンドでは、これをCloudFrontが待つ120秒まで引き上げています。CloudFrontの待ち時間は[ディストリビューション](./1-cloudfront.md#ディストリビューション)で設定します。

## 6. サービスを起動する

各サービスは、シークレットをパラメーターから受け取ります。それ以外の変数は、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にあるものをタスク定義に書きます。以下のサイズは調整の出発点です。`ARM64`は`X86_64`にしてもかまいません。イメージはすべて両方のアーキテクチャ向けに公開されています。

`publira server`と`publira worker`は、停止を指示されてから30秒以内に停止します。そこでコンテナ定義では、ECSが強制終了するまでの`stopTimeout`を、既定の30秒ではなく45秒にしています。詳しくは[コピーを停止する](../7-scaling-out.md#インスタンスを停止する)で説明しています。

`publira-server.json`を次の内容で作成します。

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

`PUBLIRA_TRUSTED_PROXIES`に設定する値は[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)で説明します。

`publira-worker.json`では、同じイメージを`worker`コマンドで動かし、ヘルスチェックではポート`8003`を確認します。

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

`web-storefront`は`publira server`と同じ`PUBLIRA_TRUSTED_PROXIES`を受け取ります。テナントのGoogleタグゲートウェイに渡す読者のアドレスを、この値をもとに判断します。`web-admin.json`は、次の点を除いて`web-storefront.json`と同じです。

- `web-storefront`と書かれている箇所はすべて`web-admin`にします。
- ポートは`3000`ではなく`4000`です。ヘルスチェックのポートも同じく変えます。
- `PUBLIRA_AUTH_SECRET`には`/publira/admin-auth-secret`を指定します。
- `web-admin`は`PUBLIRA_TRUSTED_PROXIES`を読まないので、指定しません。
- シークレットを1つ追加し、`PUBLIRA_WEB_SERVICE_TOKEN`に`/publira/web-service-token`を指定します。

4つのタスク定義を登録し、それぞれのセキュリティグループ、ターゲットグループ、Cloud Mapの名前を指定してサービスを作成します。

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

`publira-worker`はジョブキューのテーブルを起動時に作成するので、そのための専用のタスクは要りません。安定しないサービスはタスクの停止を繰り返します。その理由は`aws ecs describe-services --cluster publira --services <name> --query 'services[0].events[:5]'`で確認できます。ヘルスチェックに失敗したタスクか、停止したタスクが表示されます。停止したタスクの場合は、`/publira`のログに原因が出ています。たとえば、ロールのパスワードが接続URLのものと一致していない場合です。

### ヘルスチェック

ECSのサービスは、ヘルスチェックの種類にかかわらず、ヘルスチェックに失敗したタスクを置き換えます。そのため、このページのヘルスチェックはすべて`/livez`を確認します。`/livez`が失敗するのは、プロセス自体が応答しなくなったときだけです。`/readyz`を確認させると、データベースが応答しなくなった途端に、ECSがサービスのタスクをすべて一斉に置き換えてしまいます。[オーケストレーターからの監視](../../3-operations/11-monitoring.md#オーケストレーターからのプローブ)で避けるよう注意しているのはこの状況です。

- **すべてのサービス**で、タスク定義にヘルスチェックを書きます。このチェックはECSがタスクの中で実行します。イメージにはHTTPクライアントが入っていないので、それぞれのイメージに入っているものを使います。`publira`イメージでは`bash`の`/dev/tcp`で接続を開き、シェルのないWebアプリのイメージでは`node`の`fetch`でリクエストを送ります。どのチェックもコンテナ自身のポートの`/livez`にリクエストし、`200`が返れば成功です。チェックはECSのヘルスチェックの既定値どおり、30秒ごとに実行され、5秒で打ち切られ、3回続けて失敗するとタスクが異常と判定されます。`startPeriod`を指定しているので、起動から30秒間は失敗として数えません。Cloud Mapは、このチェックに成功したタスクのアドレスを正常として扱い、チェックに失敗すると削除します。そのため、サービス同士が呼び出しに使う名前も同じチェックの結果に従います。
- **`publira-server`とWebアプリ**は、ターゲットグループからも確認されます。`--health-check-path /livez`で同じパスを指定しています。ECSは、タスクの起動から`--health-check-grace-period-seconds`が過ぎるまで、このチェックの結果に応じた処理をしません。チェックに成功すると、ロードバランサーは新しいタスクにリクエストを送り始めます。

レディネスも見ておく価値はあります。ただし、ヘルスチェックとしてではなく、サービスの外から確認します。CloudFrontを設定した後は、`https://<domain>/readyz`が`web-storefront`のレディネスを返します。これには`publira server`とValkeyのレディネスも含まれます。ワーカーの`/readyz`にはどこからもアクセスしません。ワーカー専用のログインで接続できなくなると、そのログインを使うジョブが失敗し、ワーカーのログにその失敗が出ます。

## 7. 初期設定

`publiractl setup`は、すべての値をフラグで指定したタスクとして1回だけ実行します。`run-task`で起動したタスクには、値を尋ねるための端末がないためです。`setup`は`publira_platform`として接続し、保存する値を暗号化キーで暗号化します。そのため、接続URLと暗号化キーはどちらもサーバーと同じパラメーターから読みます。バケットの接続テストには`publira-storage`タスクロールを使います。`setup`は管理用ログインで接続しないので、`db-url/master`は渡しません。

`setup`の出力はCloudWatch Logsに送られます。管理者のパスワードは生成させずに指定してください。生成されたパスワードは最後の概要に表示されますが、変数で渡したパスワードは表示されません。管理者のパスワードとSMTPのパスワードは、それぞれ専用のパラメーターに保存します。

```bash
put setup/smtp-password '<the SMTP password>'
put setup/admin-password "$(openssl rand -base64 18)"
```

どちらの値も、ロールのパスワードと同じく環境変数として`publiractl`に渡し、変数名を`--smtp-password-env`フラグと`--admin-password-env`フラグで指定します。`publiractl-setup.json`を次の内容で作成します。

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

`--access-key-id`もシークレットキーも指定しません。バケットには専用のキーを保存せず、各プロセスがタスクロールで署名します。上のSMTPの値はAmazon SESのものです。SESのSMTP認証情報は、IAMユーザーのアクセスキーそのものではなく、アクセスキーから作るユーザー名とパスワードです。ほかのSMTPサーバーを使う場合は、そのサーバーのホスト、ポート、暗号化方式を指定してください。すべてのフラグと省略できる手順は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。

接続テストの失敗などで途中で止まっても、それまでに保存した内容は残ります。原因を解決してからもう一度実行すれば完了します。

管理者のパスワードは`/publira/setup/admin-password`パラメーターに入っており、`aws ssm get-parameter --with-decryption --name /publira/setup/admin-password --query Parameter.Value --output text`で表示できます。管理者がログインしてパスワードを変更したら、このパラメーターは削除してください。それ以降に読み取るものはありません。

## 8. CloudFrontを前段に置く

読者が接続する先はCloudFrontです。CloudFrontは、すべてのテナントのホストでTLSを終端し、HTTPをHTTPSにリダイレクトし、呼び出し元に指定させてはならないヘッダーを取り除いたうえで、それ以外をすべてロードバランサーに転送します。設定手順は[CloudFrontを使った公開](./1-cloudfront.md)にあり、VPCの外からの確認もそのページで行います。上の手順で定義した変数と関数を使うので、同じシェルで続けてください。確認がすべて通ったら、ログインのためにこのページに戻ってきてください。

## 9. ログインする

`https://admin.comics.example.com`でテナント管理画面を開きます。`--admin-domain`で管理画面のホスト名を指定した場合は、そのホスト名で開きます。管理者のメールアドレスとパスワードでログインしてください。ここから先は、[インストールのログインの手順](../2-installing.md#6-ログインする)で説明している状態と同じです。

## このセクションのページ

- [CloudFrontを使った公開](./1-cloudfront.md)では、VPCオリジン、ヘッダー、キャッシュポリシー、ディストリビューション、クライアントのアドレスの設定と、VPCの外からの確認を説明します。
- [Amazon ECSでの運用](./2-operating.md)では、テナントの追加、管理画面の認証情報をテナントのドメインに渡さないための設定、アップグレードを説明します。

## 次のステップ

CloudFrontとロードバランサーが合わせて満たすべき要件は、[リバースプロキシの設定](../4-edge/index.md)にすべて書かれています。Publiraが稼働し始めた後に監視する項目は[監視](../../3-operations/11-monitoring.md)にあります。各プロセスが読む変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。オプションのプロセスは[オプションのプロセスを有効にする](../2-installing.md#追加のプロセスを有効にする)の説明どおりに有効にし、それぞれ上と同じようにサービスとして動かします。`web-platform`には、ターゲットグループ、そのホストのルール、Cloud Mapの名前を用意し、`publira-web`でポート`4100`を開きます。`email-renderer`にはCloud Mapの名前だけを用意し、`publira-worker`からのポート`8080`を許可するセキュリティグループを付けます。
