---
title: Amazon ECSでの運用
description: Amazon ECS(Fargate)で動かすPubliraで、テナントの追加、管理画面の認証情報をテナントのドメインから切り離す設定、画像と公開APIの分離、アップグレードを行う方法を説明します。
published: 2026-10-29
source_updated: 2026-10-26
---

このページでは、[Amazon ECS(Fargate)](./index.md)と[CloudFrontを使った公開](./1-cloudfront.md)の手順で運用を始めたPubliraに加える変更を説明します。コマンドでは、それらのページで定義したシェル変数と関数を使います。Publiraを構築したときとは別のシェルで実行する場合は、コマンドが使う変数と関数を定義し直してください。定義し直すものは次のとおりです。

- [始める前に](./index.md#始める前に)の変数
- [マイグレーションの適用とデータベースロールの作成](./index.md#4-マイグレーションを適用してデータベースロールを作成する)の`run_publiractl`関数
- [ネットワークの経路を開く手順](./index.md#3-ネットワークの経路を開く)の`SERVER_SG`、`NAMESPACE`、`registry`関数
- [ロードバランサーの作成](./index.md#5-ロードバランサーを作成する)の`target_group`関数
- [サービスの起動](./index.md#6-サービスを起動する)の`service`関数
- `LISTENER`。値は`aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`で表示できます。

## テナントの追加

`publiractl tenant create`やプラットフォーム管理画面で作成したテナントには、2つのホスト名をCloudFrontとロードバランサーに設定する必要があります。必要な設定は[テナントを追加する場合](../4-edge/index.md#テナントを追加するとき)で説明しています。ECSでは、テナントのスタッフが管理画面を開く前に次の作業をします。

1. **証明書**。[ロードバランサーの作成](./index.md#5-ロードバランサーを作成する)と同じように、テナントのドメインと管理画面のホスト名を含む証明書を、ロードバランサーのリージョンと`us-east-1`でリクエストし、両方を検証します。
2. **ロードバランサー**。1つ目の証明書を`aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`でリスナーに追加し、ルールを2つ追加します。そのページの表のとおり、テナントのドメインと管理画面のホスト名に、それぞれ`2000`番台のルールを作ります。クォータを引き上げない限り、1つのロードバランサーに追加できる証明書はリスナーの既定の証明書のほかに25個まで、ルールは100個までです。ルールのホスト条件には名前を3つまで指定できるので、1つのルールを最大3つのテナントで共有できます。
3. **CloudFront**。[ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`をもとに、そのテナント専用のディストリビューションを作成します。`Aliases`にはテナントの2つのホスト名を、`ViewerCertificate`には`us-east-1`の証明書を指定し、`CallerReference`も新しい値にします。VPCオリジン、関数、キャッシュポリシーは最初のディストリビューションと同じものを使います。
4. **DNS**。両方のホスト名を新しいディストリビューションのドメイン名に向けます。

ほかに変更するものはありません。サービス、パラメーター、セキュリティグループは、どのテナントにも同じものを使います。

## 管理画面の認証情報をテナントのドメインから切り離す

ロードバランサーの設定により、管理画面のAPIはすでにインターネットからは呼び出せません。ただ、テナントのドメインへのリクエストの転送先である`publira-server`は今も管理画面のAPIを提供しており、そのために管理画面用のデータベースのログインとWebサービストークンを持っています。管理画面のAPI、そのログイン、Webサービストークンの3つを、読者のリクエストが届くプロセスから取り除くには、`--role storefront`を付けた2つ目のサービスを動かし、テナントのドメインと`web-storefront`をそちらに振り分けます。[公開APIだけを外部に通す理由](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しているとおり、これはロードバランサーのルールとは別の防御層になります。また、サービスごとに専用のタスクで動くので、読者のトラフィックを管理画面とは別にスケールできるようにもなります。この点は[ロールごとにサーバーを分ける方法](../7-scaling-out.md#サーバーをロールごとに分ける)で説明しています。

タスク定義は、[サービスの起動](./index.md#6-サービスを起動する)の`publira-server.json`をもとに作ります。ファミリーとコンテナの名前を`publira-storefront`にし、コマンドを`["server", "--role", "storefront"]`にします。シークレットは、このロールが読むものだけにします。暗号化キー、`PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_REVALIDATE_TOKEN`、`PUBLIRA_REDIS_URL`、`PUBLIRA_PUBLIC_DB_URL`です。タスク定義を登録し、専用のターゲットグループとCloud Mapの名前を用意します。このサービスはロードバランサーだけでなく`web-storefront`からも呼び出されるためです。

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

次に、テナントのドメインをこのサービスに送るルールを、サーバーのルールより優先度を高くして追加します。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `900`から`999` | テナントのドメイン | `/images*`、`/rpc/publira.v1.*` | `publira-storefront` |

1つのルールに指定できる値は5つまでで、そのうち2つをパスに使うので、ホスト名に使えるのは3つです。つまり、この番台のルール1つで扱えるテナントのドメインは最大3つです。新しいテナントのドメインは、まだホスト名を追加できるルールに加えるか、この番台で次に空いている優先度に専用のルールを作ります。

ターゲットグループは、ルールによってロードバランサーに関連付けられます。ECSは、ロードバランサーに関連付けられていないターゲットグループを指定したサービスを作成できないので、ルールはサービスより先に作ります。ただし、サービスのタスクが起動するまで、新しいターゲットグループには応答できるタスクがありません。そこで、各ルールは転送先を`publira-server`のままにし、重み`0`の`publira-storefront`を並べて作成します。次に、Webアプリからの接続をすでに許可している`publira-server`のセキュリティグループでサービスを作成します。タスクが正常になったら、ルールの転送先を`publira-storefront`だけにします。

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

`host_is`と`path_is`は[ロードバランサーの作成](./index.md#5-ロードバランサーを作成する)で定義した関数で、`SERVER_TG`はそこで作成したターゲットグループです。別のシェルでは、`aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`で表示できます。サービスが動き始めた後でこの番台に追加するルールは、そのページの`rule`関数を使い、最初から`publira-storefront`だけに転送します。

`web-storefront`は公開APIしか呼び出さないので、`web-storefront`も新しいサービスに向けます。`web-storefront.json`の`PUBLIRA_GRPC_URL`を`http://publira-storefront.publira.internal:8000/rpc`にして登録し、`web-storefront`サービスを新しいリビジョンに更新してください。管理画面のホスト名、`web-admin`、`web-platform`は、すべてのロールを提供する`publira-server`に引き続き接続します。[管理画面用のサーバーから公開APIを外す](#管理画面用のサーバーから公開apiを外す)手順で`publira-server`から公開APIを外すまでは、この状態のままです。

ロードバランサーは、この変更の前も後も、すべてのホストで管理画面のAPIに`404`を返します。そのため、テナントのドメインへのリクエストが新しいサービスに届いていることは別の方法で確認します。`aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`でタスクが`healthy`と表示されること、そして[VPCの外からの確認](./1-cloudfront.md#vpcの外からの確認)にある公開APIの呼び出しが、テナントのドメインで引き続き`invalid_argument`を返すことを確認してください。この応答は今度は`publira-storefront`から返ります。

### 管理画面用のサーバーから公開APIを外す

この時点でも`publira-server`は公開APIを提供し、`publira_public`のログインを持っています。理由は2つあります。`web-admin`がテナントのテーマとタグを取得するために公開APIを呼び出していることと、優先度`1000`のルールが管理画面のホスト名の公開APIを`publira-server`に転送していることです。この両方を`publira-storefront`に送れば、[ロールごとにサーバーを分ける方法](../7-scaling-out.md#サーバーをロールごとに分ける)の手順4のとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIの提供をやめたときに公開APIのリクエストを送るものが残っていないように、変更は次の順に行います。

まず、`web-admin`が呼び出す公開APIの接続先を`publira-storefront`サービスにします。`web-admin.json`の`environment`に次の変数を追加します。同じ場所にある`PUBLIRA_GRPC_URL`は`publira-server`を指したままにします。

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

続けて、デプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

これで、`web-admin`の`/readyz`は`publira-storefront`サービスも`public-api`として確認するようになります。

次に、すべてのホストの公開APIを`publira-storefront`に転送します。`publira-storefront`はどのホストでも公開APIに応答します。管理画面のホスト名の`/images`は`publira-server`に残します。管理画面のページに表示される画像は`admin`ロールが提供するものだからです。優先度`1000`のルールの後に公開API用のルールを追加し、そのうえで`1000`のルールから公開APIを外して、公開APIのリクエストが`publira-server`に届かないようにします。

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

`rule`と`path_is`は[ロードバランサーの作成](./index.md#5-ロードバランサーを作成する)で定義した関数で、`STOREFRONT_SERVER_TG`は上で作成したターゲットグループです。別のシェルでは、`aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`で表示できます。`900`番台のルールは、公開APIも含めて、テナントのドメインへのリクエストを引き続き`publira-storefront`に転送します。

最後に、`publira-server.json`のコンテナの`command`を`["server", "--role", "admin,platform"]`にします。プロセスが`PUBLIRA_PUBLIC_DB_URL`を読まなくなるので、`secrets`からこの変数を削除し、デプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

テナント管理画面にログインしてください。テナントのテーマが表示され、タグもこれまでどおり一覧に出ます。どちらも今度は`publira-storefront`から読み込まれています。[VPCの外からの確認](./1-cloudfront.md#vpcの外からの確認)にある公開APIの呼び出しを、管理画面のホスト名の`https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`に送ると、引き続き`invalid_argument`が返ります。ここで`404`が返る場合は、管理画面のホスト名の公開APIがまだ`publira-server`に転送されています。

## 画像と公開APIを分けて配信する

[画像と公開APIを分けて配信する方法](../7-scaling-out.md#画像と公開apiを別々に提供する)で説明しているとおり、テナントの画像と公開APIには、それぞれ専用のホスト名と専用のロードバランサーを使えます。ECSでは、画像用に専用のサービスを動かし、その前に2つ目の内部ロードバランサーとCloudFrontディストリビューションを置きます。公開APIには既存のロードバランサーにホスト名を追加し、`publira-storefront`に転送します。この手順は、`publira-storefront`を作成した[管理画面の認証情報をテナントのドメインから切り離す](#管理画面の認証情報をテナントのドメインから切り離す)手順が済んでいることを前提にしています。以下の名前は例です。テナントの画像ホストは`images.comics.example.com`、公開APIのホストは`api.example.com`とします。

### 画像

画像のトラフィックをAPIとは別にスケールできるように、画像は専用のサービスで配信します。タスク定義は`publira-storefront.json`をもとに、ファミリーとコンテナの名前を`publira-images`にして、`publira-images.json`に保存します。2つのサービスは同じロールを提供し、同じシークレットを読みます。タスク定義を登録し、ターゲットグループと、`service`関数がサービスの登録に使うCloud Mapの名前を用意します。

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

[ロードバランサーの作成](./index.md#5-ロードバランサーを作成する)と同じように、画像ホストを含む証明書をロードバランサーのリージョンと`us-east-1`でリクエストし、検証します。次に、1つ目のロードバランサーと同じセキュリティグループで2つ目の内部ロードバランサーを作成します。このセキュリティグループには、CloudFrontのVPCオリジンからの接続がすでに許可されており、`publira-server`のセキュリティグループもこのセキュリティグループからの接続をすでに許可しています。さらにHTTPSリスナーを作成し、`/images`を新しいサービスに転送するルールを1つだけ置きます。それ以外のリクエストには`404`を返します。

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

ターゲットグループは、ルールによってロードバランサーに関連付けられます。ECSは、ロードバランサーに関連付けられていないターゲットグループを指定したサービスを作成できないので、サービスはこの時点で初めて作成します。

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

[CloudFrontを使った公開](./1-cloudfront.md)で1つ目のロードバランサーの前にCloudFrontを置いたのと同じように、このロードバランサーの前にもCloudFrontを置きます。[VPCオリジン](./1-cloudfront.md#vpcオリジン)と同じ手順で`$IMAGES_ALB`のVPCオリジンを作成し、[ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`をもとにディストリビューションを作成します。`Aliases`には画像ホストを、`ViewerCertificate`には画像ホストの`us-east-1`の証明書を、`Origins`には新しいロードバランサーのDNS名と新しいVPCオリジンのIDを指定し、`CallerReference`も新しい値にします。関数と`publira-images`キャッシュポリシーは最初のディストリビューションと同じものを使います。`/images*`のビヘイビアも、最初のディストリビューションと同じように画像をキャッシュします。`publira-images.json`には[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)で求めた`PUBLIRA_TRUSTED_PROXIES`が入っており、この値はこのディストリビューションとこのロードバランサーも含んでいます。

ディストリビューションのデプロイが終わったら、各画像ホストをそのドメイン名に向けます。そのうえで、[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しているとおり、プラットフォーム管理画面の**画像ホスト**か`publiractl tenant update --image-domain`で、テナントに画像ホストを設定します。後から追加したテナントの画像ホストは、`aws elbv2 add-listener-certificates`で新しいリスナーに追加する証明書に含めます。新しいディストリビューションか、そのテナント専用のディストリビューションの`Aliases`にも追加してください。

### 公開API

公開APIには、既存のロードバランサーで専用のホスト名を割り当てます。`api.example.com`の証明書を両方のリージョンでリクエストし、ロードバランサーのリージョンの証明書をリスナーに追加します。そのうえで、このホストの公開APIを`publira-storefront`に転送するルールを`900`番台に追加します。

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

優先度は、この番台でまだどのルールも使っていないものを選んでください。このホストのほかのパスには、リスナーが`404`を返します。例外は`/images`で、優先度`1000`のルールがすべてのホストで`publira-server`に転送します。ただし、このホストはどのテナントのものでもないので、`publira-server`も`404`を返します。次に、`distribution.json`をもとにこのホスト用のディストリビューションを作成します。`Aliases`には`api.example.com`を、`ViewerCertificate`には`us-east-1`の証明書を指定し、`CallerReference`も新しい値にします。最後に、`api.example.com`をディストリビューションのドメイン名に向けます。

WebアプリはすでにVPC内で`publira-storefront`を呼び出しており、どちらのロードバランサーも経由しません。`web-storefront`は`PUBLIRA_GRPC_URL`で呼び出し、`web-admin`は[管理画面用のサーバーから公開APIを外す](#管理画面用のサーバーから公開apiを外す)手順が済んでいれば`PUBLIRA_PUBLIC_GRPC_URL`で呼び出します。VPCの外で動かすWebアプリには、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、テナントに画像ホストを設定した後で、`PUBLIRA_BASE_URL=https://api.example.com`を指定してビルドします。詳しくは[アプリの接続先](../../5-mobile-app/2-building.md#アプリの接続先)で説明しています。テナントのドメインのルールはそのまま残るので、テナントのドメインを接続先にしてビルドしたアプリも引き続き動きます。

### 分けた後の確認

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

1つ目は`404`を返します。画像ホストは画像以外を配信しないためです。2つ目は`publira-storefront`に届き、空のリクエストが`invalid_argument`で拒否されます。3つ目も`404`を返します。APIのホストは画像を配信しないためです。最後にテナントのサイトを開き、画像が`https://images.comics.example.com/images/…`から読み込まれることを確認してください。

## アップグレード

[アップグレード](../8-upgrading.md)では、Publiraを新しいリリースにする手順を説明しています。バックアップを取り、新しいリリースの`publiractl`でマイグレーションとロールを適用してから、プロセスを置き換える流れです。先にそのページと、リリースノートを読んでください。ECSでは、手順は次のようになります。

以下の手順はどれも、動かしているすべてのサービスを対象にします。対象のサービスを最初に変数にまとめておきます。`web-platform`、`email-renderer`、`publira-storefront`、`publira-images`を動かしている場合は、それらも加えてください。

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **サービスを停止する**。先にプロセスを停止すると決めた場合に行います。判断の基準は[先にプロセスを停止するかどうか](../8-upgrading.md#先にプロセスを停止するかどうかを決める)にあります。各サービスのタスク数を控えたうえで、すべてのサービスのタスク数を0にします。

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **データベースをバックアップする**。[データベースのバックアップ](../8-upgrading.md#1-データベースをバックアップする)で説明しているとおり、RDSインスタンスかAuroraクラスターのスナップショットを取るか、データベースに接続できるホストから`pg_dump`を実行します。
3. **マイグレーションとロールを適用する**。`publiractl-db-migrate.json`と`publiractl-db-roles.json`の`<tag>`を新しいリリースに変更して両方を登録し、この順に`run_publiractl`で実行します。次に進むのは、それぞれが成功した場合だけです。ロールのタスクは、パラメーターに保存されたパスワードを各ロールに設定します。これは各ロールがすでに持っているパスワードなので、タスクは変更せずに実行できます。ロールを追加するリリースでは、そのロールのパスワード用のパラメーター、その値を環境変数に設定する`secrets`のエントリー、その変数を指定するフラグが必要です。
4. **新しいリリースを起動する**。すべてのサービスのタスク定義で`<tag>`を変更し、リリースノートに書かれている変数を追加して登録します。各サービスを新しいリビジョンに更新し、手順1でサービスを停止した場合は、その手順で`COUNT`に控えた元のタスク数にも戻します。

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **動作を確認する**。[アップグレード後の確認](../8-upgrading.md#5-動作を確認する)の説明どおりに確認します。

アップグレード中もサービスを動かし続ける場合は、手順4で[プロセスを置き換える手順](../8-upgrading.md#4-プロセスを入れ替える)に書かれた順にサービスを置き換えます。`email-renderer`を動かしている場合は最初に更新し、そのあと`SERVICES`にほかのサービスを指定して手順4のループを実行します。ECSは数タスクずつ置き換えるので、その間もPubliraはリクエストに応答し続けます。
