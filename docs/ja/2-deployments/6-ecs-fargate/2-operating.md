---
title: Amazon ECSでの運用
description: Amazon ECS(Fargate)で動かすPubliraで、テナントを追加する方法、管理画面の認証情報をテナントのドメインから切り離す方法、画像と公開APIを分けて配信する方法、アップグレードの方法を説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-26
---

このページでは、[Amazon ECS(Fargate)](./index.md)と[CloudFrontを使った公開](./1-cloudfront.md)の手順で稼働を始めたPubliraに、あとから加える変更を説明します。コマンドはそれらのページで定義したシェル変数と関数を使います。Publiraを構築したときとは別のシェルで実行する場合は、コマンドが使う変数と関数を次のページから定義し直してください。

- [始める前に](./index.md#始める前に)の変数
- [マイグレーションを適用してデータベースロールを作成する](./index.md#4-マイグレーションを適用してデータベースロールを作成する)の`run_publiractl`関数
- [ネットワークの経路を開く](./index.md#3-ネットワークの経路を開く)の`SERVER_SG`と`NAMESPACE`、`registry`関数
- [ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)の`target_group`関数
- [サービスを起動する](./index.md#6-サービスを起動する)の`service`関数
- `LISTENER`。値は`aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`で表示できます

## テナントの追加

`publiractl tenant create`やプラットフォーム管理画面で作ったテナントは、[テナントを追加するとき](../4-edge/index.md#テナントを追加するとき)で説明しているとおり、2つのホスト名をリバースプロキシに設定する必要があります。ECSでは、テナントのスタッフが管理画面を開く前に次の作業をします。

1. テナントのドメインと管理画面のホストを含む証明書を、[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)と同じように、ロードバランサーのリージョンと`us-east-1`でリクエストし、両方を検証します。
2. ロードバランサーのリージョンの証明書を`aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`でリスナーに追加します。さらに、そのページの表に従って、テナントのドメインと管理画面のホストのルールを`2000`番台に1つずつ追加します。クォータを引き上げない限り、1つのロードバランサーに追加できる証明書はリスナーの既定の証明書のほかに25個、ルールは100個までです。ルールのホスト条件には名前を3つまで書けるので、1つのルールを3つのテナントまで共有できます。
3. [ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`をもとに、そのテナント専用のCloudFrontディストリビューションを作ります。`Aliases`にはテナントの2つのホスト名を、`ViewerCertificate`には`us-east-1`の証明書を書き、`CallerReference`には新しい値を使います。VPCオリジン、関数、キャッシュポリシーは最初のディストリビューションと同じものを使います。
4. 両方のホスト名をDNSで新しいディストリビューションのドメイン名に向けます。

ほかに変えるものはありません。サービス、パラメーター、セキュリティグループはすべてのテナントで共通です。

## 管理画面の認証情報をテナントのドメインから切り離す

管理画面のAPIは、ロードバランサーの設定によってすでにインターネットから呼び出せなくなっています。それでも、ロードバランサーがテナントのドメインのリクエストを転送する`publira-server`は管理画面のAPIを提供しており、そのためのデータベースのログインとWebサービストークンを持っています。管理画面のAPI、そのログイン、Webサービストークンの3つを読者のリクエストが届くプロセスから外すには、`--role storefront`を付けた2つ目のサービスを動かし、テナントのドメインと`web-storefront`をそちらに振り分けます。[リバースプロキシを通すのは公開APIだけ](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しているとおり、これはリバースプロキシのルールとは別の守りになります。それぞれのサービスが自分のタスクで動くので、読者のトラフィックを管理画面と切り離してスケールできるようにもなります。これは[サーバーをロールごとに分ける](../7-scaling-out.md#サーバーをロールごとに分ける)で説明しています。

タスク定義は、[サービスを起動する](./index.md#6-サービスを起動する)の`publira-server.json`をもとに作ります。ファミリーとコンテナの名前を`publira-storefront`に、コマンドを`["server", "--role", "storefront"]`にし、シークレットはこのロールが読むものだけにします。暗号化キー、`PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_REVALIDATE_TOKEN`、`PUBLIRA_REDIS_URL`、`PUBLIRA_PUBLIC_DB_URL`の5つです。このサービスはロードバランサーだけでなく`web-storefront`からも呼び出されるので、タスク定義を登録したら、専用のターゲットグループとCloud Mapの名前も用意します。

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

次に、テナントのドメインをこのサービスに送るルールを、サーバーのルールより優先して評価される位置に追加します。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `900`から`999` | テナントのドメイン | `/images*`、`/rpc/publira.v1.*` | `publira-storefront` |

1つのルールに書ける値は5つで、そのうち2つをパスに使うので、ホスト名には3つしか使えません。そのため、この番台のルール1つが受け持てるテナントのドメインは3つまでです。新しいテナントのドメインは、まだ空きのあるルールに加えるか、この番台で次に空いている優先度に専用のルールを作って追加します。

ターゲットグループをロードバランサーに関連付けるのはルールです。ECSはルールのないターゲットグループを使うサービスを作れないので、ルールをサービスより先に作ります。ただし、サービスのタスクが起動するまで、新しいターゲットグループには応答できるものがありません。そこで、各ルールは転送先を`publira-server`のままにし、重み`0`の`publira-storefront`を並べて作ります。続いて、Webアプリからの接続をすでに許可している`publira-server`のセキュリティグループでサービスを作ります。タスクが正常になったら、ルールの転送先を`publira-storefront`だけにします。

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

`host_is`と`path_is`は[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)で定義した関数で、`SERVER_TG`はそこで作ったターゲットグループです。別のシェルでは`aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`で表示できます。サービスが動き始めてからこの番台に追加するルールは、同じページの`rule`関数で、`publira-storefront`だけに転送するように作ります。

`web-storefront`が呼び出すのは公開APIだけなので、`web-storefront`の接続先も新しいサービスにします。`web-storefront.json`の`PUBLIRA_GRPC_URL`を`http://publira-storefront.publira.internal:8000/rpc`にして登録し、`web-storefront`サービスを新しいリビジョンに更新してください。管理画面のホスト、`web-admin`、`web-platform`は、すべてのロールを提供する`publira-server`に引き続き接続します。この状態は、[管理画面用のサーバーから公開APIを外す](#管理画面用のサーバーから公開apiを外す)で`publira-server`から公開APIを外すまで続きます。

ロードバランサーは、この変更の前も後も、すべてのホストで管理画面のAPIに`404`を返します。そこで、テナントのドメインのリクエストが新しいサービスに届いていることを別の方法で確かめます。`aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`でタスクが`healthy`と表示されることと、[VPCの外からの確認](./1-cloudfront.md#vpcの外からの確認)の公開APIの呼び出しがテナントのドメインで引き続き`invalid_argument`を返すことを確かめてください。この応答は、今度は`publira-storefront`が返しています。

### 管理画面用のサーバーから公開APIを外す

ここまでの状態では、`publira-server`はまだ公開APIを提供し、`publira_public`のログインを持っています。`web-admin`がテナントのテーマとタグを取得するために公開APIを呼び出していることと、優先度`1000`のルールが管理画面のホストの公開APIを`publira-server`に転送していることが理由です。この両方を`publira-storefront`に送れば、[サーバーをロールごとに分ける](../7-scaling-out.md#サーバーをロールごとに分ける)の手順4のとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIを提供しなくなった時点で、公開APIのリクエストを送ってくるものが残っていないように、次の順に変更してください。

まず、`web-admin`が公開APIを呼び出す先を`publira-storefront`サービスにします。`web-admin.json`の`environment`に次の変数を追加します。同じ場所にある`PUBLIRA_GRPC_URL`は`publira-server`を指したままにします。

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

追加したらデプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

これで`web-admin`の`/readyz`は、`publira-storefront`サービスも`public-api`として確かめるようになります。

次に、すべてのホストの公開APIを`publira-storefront`に転送します。`publira-storefront`はどのホストの公開APIにも応答します。管理画面のページに表示する画像は`admin`ロールが提供するので、管理画面のホストの`/images`は`publira-server`に残します。優先度`1000`のルールのあとに公開APIのルールを追加してから、`1000`のルールから公開APIを外し、公開APIのリクエストが`publira-server`に届かないようにします。

| 優先度 | ホスト | パス                | 転送先               |
| ------ | ------ | ------------------- | -------------------- |
| `1000` | すべて | `/images*`          | `publira-server`     |
| `1050` | すべて | `/rpc/publira.v1.*` | `publira-storefront` |

```bash
rule 1050 "[$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
RULE_1000=$(aws elbv2 describe-rules --listener-arn "$LISTENER" \
  --query "Rules[?Priority=='1000'].RuleArn" --output text)
aws elbv2 modify-rule --rule-arn "$RULE_1000" \
  --conditions "[$(path_is '["/images*"]')]" > /dev/null
```

`rule`と`path_is`は[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)で定義した関数で、`STOREFRONT_SERVER_TG`は上で作ったターゲットグループです。別のシェルでは`aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`で表示できます。`900`番台のルールは、公開APIを含め、テナントのドメインのリクエストを引き続き`publira-storefront`に転送します。

最後に、`publira-server.json`のコンテナの`command`を`["server", "--role", "admin,platform"]`にします。このプロセスは`PUBLIRA_PUBLIC_DB_URL`を読まなくなるので、`secrets`から削除してデプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

テナント管理画面にログインしてください。テナントのテーマが表示され、タグもこれまでどおり一覧に出ます。どちらも今度は`publira-storefront`から読み込んでいます。[VPCの外からの確認](./1-cloudfront.md#vpcの外からの確認)の公開APIの呼び出しを管理画面のホストの`https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`に送ると、引き続き`invalid_argument`が返ります。`404`が返る場合は、管理画面のホストの公開APIがまだ`publira-server`に届いています。

## 画像と公開APIを分けて配信する

[画像と公開APIを別々に提供する](../7-scaling-out.md#画像と公開apiを別々に提供する)で説明しているとおり、テナントの画像と公開APIは、それぞれ専用のホスト名で、専用のロードバランサーを通して配信できます。ECSでは、画像を専用のサービスで動かし、その前に2つ目の内部ロードバランサーとCloudFrontディストリビューションを置きます。公開APIには既存のロードバランサーでホスト名を割り当て、`publira-storefront`に転送します。この手順は、`publira-storefront`を作る[管理画面の認証情報をテナントのドメインから切り離す](#管理画面の認証情報をテナントのドメインから切り離す)が済んでいることを前提にしています。以下では、テナントの画像ホストを`images.comics.example.com`、公開APIのホストを`api.example.com`とします。

### 画像

画像のトラフィックをAPIとは別にスケールできるように、画像は専用のサービスで配信します。タスク定義は、`publira-storefront.json`のファミリーとコンテナの名前を`publira-images`にしたもので、`publira-images.json`として保存します。2つのサービスは同じロールを提供し、同じシークレットを読みます。タスク定義を登録し、ターゲットグループとCloud Mapの名前を用意します。Cloud Mapの名前は、`service`関数がサービスを登録するときに使います。

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

画像ホストを含む証明書を、[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)と同じように、ロードバランサーのリージョンと`us-east-1`でリクエストし、検証します。次に、1つ目のロードバランサーと同じセキュリティグループで2つ目の内部ロードバランサーを作ります。CloudFrontのVPCオリジンからこのセキュリティグループへの接続も、このセキュリティグループから`publira-server`のセキュリティグループへの接続も、すでに許可されています。HTTPSリスナーには、`/images`を新しいサービスに転送するルールを1つだけ置き、それ以外には`404`を返します。

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

ターゲットグループをロードバランサーに関連付けるのはルールで、ECSはルールのないターゲットグループを使うサービスを作れません。そのため、サービスはここで初めて作ります。

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

このロードバランサーの前にも、[CloudFrontを使った公開](./1-cloudfront.md)で1つ目のロードバランサーの前に置いたのと同じようにCloudFrontを置きます。[VPCオリジン](./1-cloudfront.md#vpcオリジン)と同じ手順で`$IMAGES_ALB`のVPCオリジンを作り、[ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`をもとにディストリビューションを作ります。`Aliases`には画像ホストを、`ViewerCertificate`には画像ホストの`us-east-1`の証明書を、`Origins`には新しいロードバランサーのDNS名と新しいVPCオリジンのIDを書き、`CallerReference`には新しい値を使います。関数と`publira-images`のキャッシュポリシーは最初のディストリビューションと同じもので、`/images*`のビヘイビアも同じように画像をキャッシュします。`publira-images.json`には[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)で求めた`PUBLIRA_TRUSTED_PROXIES`が入っており、この値はこのディストリビューションとロードバランサーにも当てはまります。

ディストリビューションのデプロイが終わったら、各画像ホストをそのドメイン名に向けます。そのうえで、[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しているとおり、プラットフォーム管理画面の**画像ホスト**か`publiractl tenant update --image-domain`で、テナントに画像ホストを設定します。あとから追加したテナントの画像ホストは、`aws elbv2 add-listener-certificates`で新しいリスナーに追加する証明書に含め、新しいディストリビューションか、そのテナント専用のディストリビューションの`Aliases`にも加えます。

### 公開API

公開APIには、既存のロードバランサーで専用のホスト名を割り当てます。`api.example.com`の証明書を両方のリージョンでリクエストし、ロードバランサーのリージョンの証明書をリスナーに追加します。そのうえで、このホストの公開APIを`publira-storefront`に転送するルールを`900`番台に追加します。

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

優先度には、この番台でまだどのルールも使っていない値を選んでください。このホストのほかのパスには、リスナーが`404`を返します。ただし`/images`だけは、優先度`1000`のルールがどのホストでも`publira-server`に転送します。このホストはどのテナントのものでもないので、`publira-server`もやはり`404`を返します。次に、`distribution.json`をもとにこのホストのディストリビューションを作ります。`Aliases`には`api.example.com`を、`ViewerCertificate`には`us-east-1`の証明書を書き、`CallerReference`には新しい値を使います。最後に、`api.example.com`をディストリビューションのドメイン名に向けます。

WebアプリはすでにVPC内で`publira-storefront`を呼び出しているので、どちらのロードバランサーも通りません。`web-storefront`は`PUBLIRA_GRPC_URL`で、`web-admin`は[管理画面用のサーバーから公開APIを外す](#管理画面用のサーバーから公開apiを外す)が済んでいれば`PUBLIRA_PUBLIC_GRPC_URL`で呼び出します。VPCの外で動かすWebアプリには、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、テナントに画像ホストを設定してから`PUBLIRA_BASE_URL=https://api.example.com`でビルドします。詳しくは[アプリの接続先](../../5-mobile-app/2-building.md#アプリの接続先)で説明しています。テナントのドメインのルールはそのまま残るので、テナントのドメインを接続先にしてビルドしたアプリもそのまま動きます。

### 分けた後の確認

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

1つ目は`404`を返します。画像ホストが配信するのは画像だけだからです。2つ目は`publira-storefront`に届き、空のリクエストが`invalid_argument`で拒否されます。3つ目も`404`を返します。APIのホストは画像を配信しないからです。最後にテナントのサイトを開き、画像が`https://images.comics.example.com/images/…`から読み込まれることを確かめてください。

## アップグレード

[アップグレード](../8-upgrading.md)では、Publiraを新しいリリースにする流れを説明しています。バックアップを取り、新しいリリースの`publiractl`でマイグレーションとロールを適用してから、プロセスを置き換えます。まずそのページとリリースノートを読んでください。ECSでの手順は次のようになります。

以下の手順は、どれも動かしているすべてのサービスを対象にします。対象のサービスを最初に変数にまとめておきます。`web-platform`、`email-renderer`、`publira-storefront`、`publira-images`を動かしている場合は、それらも加えてください。

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. 先にプロセスを止めると決めた場合は、サービスを止めます。止めるかどうかの判断は[先にプロセスを停止するかどうかを決める](../8-upgrading.md#先にプロセスを停止するかどうかを決める)を参考にしてください。各サービスのタスク数を控えてから、すべてのサービスのタスク数を0にします。

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. データベースをバックアップします。[データベースをバックアップする](../8-upgrading.md#1-データベースをバックアップする)で説明しているとおり、RDSインスタンスかAuroraクラスターのスナップショットを取るか、データベースに接続できるホストから`pg_dump`を実行します。
3. マイグレーションとロールを適用します。`publiractl-db-migrate.json`と`publiractl-db-roles.json`の`<tag>`を新しいリリースに変えて両方を登録し、この順に`run_publiractl`で実行します。次に進むのは、それぞれが成功してからです。ロールのタスクは、パラメーターに保存したパスワードを各ロールに設定します。各ロールがすでに持っているパスワードと同じなので、タスクは変えずに実行できます。ロールを追加するリリースでは、そのロールのパスワードを入れるパラメーター、それを環境変数として渡す`secrets`のエントリー、その変数を指定するフラグを足す必要があります。
4. 新しいリリースを起動します。すべてのサービスのタスク定義で`<tag>`を変え、リリースノートが挙げる変数を追加して登録します。各サービスを新しいリビジョンに更新し、手順1でサービスを止めた場合は、そのとき`COUNT`に控えた元のタスク数にも戻します。

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. [動作を確認する](../8-upgrading.md#5-動作を確認する)の説明どおりにPubliraの動作を確かめます。

アップグレードの間もサービスを動かし続ける場合は、手順4で[プロセスを入れ替える](../8-upgrading.md#4-プロセスを入れ替える)の順にサービスを置き換えます。`email-renderer`を動かしているならそれを先に更新し、そのあと`SERVICES`にほかのサービスを入れて手順4のループを実行します。ECSは数タスクずつ置き換えるので、その間もPubliraはリクエストに応え続けます。
