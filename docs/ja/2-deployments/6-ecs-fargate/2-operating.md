---
title: ECSでの運用
description: Fargate上のAmazon ECSで動くインストール環境で、テナントを追加し、管理画面の認証情報をテナントのドメインから切り離し、画像と公開APIを別々に提供し、アップグレードします。
published: 2026-10-29
source_updated: 2026-10-26
---

ここでは、[Fargate上のAmazon ECS](./index.md)と[ECSの前に置くCloudFront](./1-cloudfront.md)で稼働を始めたインストール環境に加える変更を説明します。コマンドでは、それらのページで定義したシェル変数と関数を使います。インストール環境を構築したシェルとは別のシェルでは、コマンドが使うものを定義し直してください。[始める前に](./index.md#始める前に)の変数、[マイグレーションを適用し、データベースロールを作成する](./index.md#4-マイグレーションを適用しデータベースロールを作成する)の`run_publiractl`関数、[ネットワーク経路を開く](./index.md#3-ネットワーク経路を開く)の`SERVER_SG`と`NAMESPACE`と`registry`関数、[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)の`target_group`関数、[サービスを起動する](./index.md#6-サービスを起動する)の`service`関数、そして`LISTENER`です。その値は`aws elbv2 describe-listeners --load-balancer-arn <the load balancer ARN> --query 'Listeners[0].ListenerArn' --output text`で出力できます。

## テナントの追加

`publiractl tenant create`やプラットフォーム管理画面で作成したテナントには、[テナントの追加](../4-edge/index.md#テナントを追加する)で説明しているとおり、エッジにその2つのホスト名が必要です。ECSでは、そのテナントのスタッフが管理画面を開く前に、次のことを行います。

1. **証明書。** そのテナントのドメインと管理画面のホストを指定した証明書を、[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)と同じように、ロードバランサーのリージョンと`us-east-1`でリクエストし、両方を検証します。
2. **ロードバランサー。** 1つ目の証明書を`aws elbv2 add-listener-certificates --listener-arn "$LISTENER" --certificates CertificateArn=<its ARN>`でリスナーに追加し、ルールを2つ追加します。そこの表のとおり、そのドメイン用と管理画面のホスト用に、`2000`の帯で1つずつです。ロードバランサーは、クォータを引き上げない限り、リスナーのデフォルトの証明書のほかに25個の証明書と、100個のルールを持てます。ルールのホスト条件は最大3つの名前を取るため、1つのルールを最大3つのテナントで共有できます。
3. **CloudFront。** [ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`から、そのテナント専用のディストリビューションを作成します。`Aliases`にはその2つの名前を、`ViewerCertificate`には`us-east-1`の証明書を指定し、`CallerReference`も専用のものにします。VPCオリジン、関数、キャッシュポリシーは、最初のディストリビューションと同じものを使います。
4. **DNS。** 両方の名前を、新しいディストリビューションのドメイン名に向けます。

それ以外は何も変わりません。サービス、パラメーター、セキュリティグループは、すべてのテナントに同じように使われます。

## 管理画面の認証情報をテナントのドメインから切り離す

ロードバランサーは、すでに管理画面のAPIをインターネットから遮断しています。しかし、ロードバランサーがテナントのドメインを転送する先の`publira-server`は、依然として管理画面のAPIを提供しており、そのためにデータベースのログインとWebサービストークンを持っています。[公開APIだけがエッジを通る](../4-edge/index.md#エッジを通るのは公開apiだけ)で説明しているように、エッジのルールとは別の層として、この3つすべてを読者が到達するプロセスから取り除くには、`--role storefront`で2つ目のサービスを動かし、テナントのドメインと`web-storefront`をそこに振り分けます。[役割ごとにサーバーを分ける](../7-scaling-out.md#ロールごとにサーバーを分ける)で説明しているとおり、各サービスは独自のタスクを動かすため、この分割によって、読者のトラフィックを管理画面とは別にスケールすることもできます。

そのタスク定義は、[サービスを起動する](./index.md#6-サービスを起動する)の`publira-server.json`をもとに、ファミリーとコンテナの名前を`publira-storefront`にし、コマンドを`["server", "--role", "storefront"]`にして、シークレットをその役割が読むものだけにしたものです。読むのは、暗号化キー、`PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_REVALIDATE_TOKEN`、`PUBLIRA_REDIS_URL`、`PUBLIRA_PUBLIC_DB_URL`です。これを登録し、専用のターゲットグループとCloud Mapの名前を与えます。ロードバランサーだけでなく、`web-storefront`もこのサービスを呼び出すためです。

```bash
aws ecs register-task-definition --cli-input-json file://publira-storefront.json > /dev/null
STOREFRONT_SERVER_TG=$(target_group publira-storefront 8000)
aws servicediscovery create-service --name publira-storefront --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

次に、サーバーのルールより前にルールを追加し、テナントのドメインをこのサービスに送ります。

| 優先度 | ホスト | パス | 転送先 |
| --- | --- | --- | --- |
| `900`〜`999` | テナントのドメイン | `/images*`、`/rpc/publira.v1.*` | `publira-storefront` |

2つのパスを指定すると、ルールが取る5つの値のうちホスト名に使えるのは3つになります。そのため、この帯のルール1つで提供できるのは、最大3つのテナントのドメインです。新しいテナントのドメインは、ドメインを1つ指定しているルールに追加するか、この帯で次に空いている優先度に専用のルールを作成してください。

ターゲットグループをロードバランサーに結び付けるのはルールであり、ECSはルールのないターゲットグループを使うサービスの作成を拒否します。そのため、ルールはサービスより先に作成します。ただし、サービスのタスクが起動するまで、新しいターゲットグループには応答するものが何もありません。そこで、各ルールはまだ`publira-server`に転送するように作成し、その横に重み`0`で`publira-storefront`を置きます。次に、Webアプリをすでに許可している`publira-server`のセキュリティグループでサービスを作成し、そのタスクが正常になったら、ルールの転送先をこのサービスだけにします。

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

`host_is`と`path_is`は[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)の関数で、`SERVER_TG`はそこで作成したターゲットグループです。別のシェルでは、`aws elbv2 describe-target-groups --names publira-server --query 'TargetGroups[0].TargetGroupArn' --output text`で出力できます。サービスが動き始めた後でこの帯に追加するルールは、そのページの`rule`関数で、`publira-storefront`だけに転送するように作成します。

`web-storefront`は公開APIしか呼び出さないため、これも新しいサービスに向けます。`web-storefront.json`の`PUBLIRA_GRPC_URL`を`http://publira-storefront.publira.internal:8000/rpc`にし、登録して、`web-storefront`サービスを新しいリビジョンに更新します。管理画面のホスト、`web-admin`、`web-platform`は、[公開APIを管理画面のサーバーから外す](#公開apiを管理画面のサーバーから外す)で公開APIを外すまで、すべての役割を提供する`publira-server`に引き続きアクセスします。

どちらにしても、ロードバランサーは管理画面のAPIにはすべてのホストで`404`を返します。そこで、テナントのドメインが新しいサービスに届いていることを確認します。`aws elbv2 describe-target-health --target-group-arn "$STOREFRONT_SERVER_TG"`でそのタスクが`healthy`と表示され、[エッジを確認する](./1-cloudfront.md#エッジを確認する)の公開APIの呼び出しが、テナントのドメインで引き続き`invalid_argument`を返すことを確認してください。この応答は、今度は`publira-storefront`から返ってきます。

### 公開APIを管理画面のサーバーから外す

`publira-server`は、依然として公開APIを提供し、`publira_public`を持っています。`web-admin`がテナントのテーマとタグのために公開APIを呼び出し、`1000`のルールが管理画面のホストの公開APIをそこに転送しているためです。この両方を`publira-storefront`に送れば、[役割ごとにサーバーを分ける](../7-scaling-out.md#ロールごとにサーバーを分ける)の手順4で説明しているとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIの提供をやめた時点で、公開APIのリクエストをそこに送るものが何も残らないように、次の順序で変更してください。

まず、`web-admin`の公開APIの呼び出しをストアフロント用のサービスに向けます。`web-admin.json`の`environment`に、`PUBLIRA_GRPC_URL`の横に次の変数を追加します。こちらは引き続き`publira-server`を指定します。

```json
{
  "name": "PUBLIRA_PUBLIC_GRPC_URL",
  "value": "http://publira-storefront.publira.internal:8000/rpc"
}
```

そしてデプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://web-admin.json > /dev/null
aws ecs update-service --cluster publira --service web-admin --task-definition web-admin > /dev/null
```

これで、このアプリの`/readyz`は、そのサービスも`public-api`として確認するようになります。

次に、すべてのホストの公開APIを、どのホストでも公開APIに応答する`publira-storefront`に振り分け、管理画面のホストの`/images`は`publira-server`に残します。管理画面のページが表示する画像は`admin`の役割のものだからです。`1000`のルールの後に公開API用のルールを追加し、その後でそのルールから公開APIを外して、公開APIが`publira-server`に届かないようにします。

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

`rule`と`path_is`は[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)の関数で、`STOREFRONT_SERVER_TG`は上で作成したターゲットグループです。別のシェルでは、`aws elbv2 describe-target-groups --names publira-storefront --query 'TargetGroups[0].TargetGroupArn' --output text`で出力できます。`900`の帯のルールは、公開APIも含めて、引き続きテナントのドメインを`publira-storefront`に転送します。

最後に、`publira-server.json`のコンテナの`command`を`["server", "--role", "admin,platform"]`にし、プロセスがもう読まない`PUBLIRA_PUBLIC_DB_URL`を`secrets`から削除して、デプロイします。

```bash
aws ecs register-task-definition --cli-input-json file://publira-server.json > /dev/null
aws ecs update-service --cluster publira --service publira-server --task-definition publira-server > /dev/null
```

テナント管理画面にログインしてください。テナントのテーマが表示され、タグも以前と同じように一覧表示されます。これらは今度は`publira-storefront`から読み込まれています。[エッジを確認する](./1-cloudfront.md#エッジを確認する)の公開APIの呼び出しを管理画面のホスト（`https://admin.comics.example.com/rpc/publira.v1.TenantService/GetTenant`）に送っても、引き続き`invalid_argument`が返ります。ここで`404`が返る場合は、管理画面のホストの公開APIがまだ`publira-server`に届いています。

## 画像と公開APIを別々に提供する

[画像と公開APIを別々に提供する](../7-scaling-out.md#画像と公開apiを分けて提供する)で説明しているとおり、テナントの画像と公開APIには、それぞれ専用のロードバランサーを経由して、専用のホスト名でアクセスできるようにできます。ECSでは、画像には2つ目の内部向けロードバランサーと、画像専用のサービスの前に置くCloudFrontディストリビューションを、公開APIには既存のロードバランサー上で`publira-storefront`の前に置くホスト名を用意します。これは、`publira-storefront`を作成した[管理画面の認証情報をテナントのドメインから切り離す](#管理画面の認証情報をテナントのドメインから切り離す)を前提にしています。以下の名前は例で、テナントの画像のホストを`images.comics.example.com`、公開APIのホストを`api.example.com`としています。

### 画像

画像のトラフィックをAPIとは別にスケールできるように、画像は専用のサービスで動かします。そのタスク定義は、`publira-storefront.json`をもとにファミリーとコンテナの名前を`publira-images`にしたもので、`publira-images.json`に書きます。この2つは同じ役割を提供し、同じシークレットを読みます。これを登録し、ターゲットグループと、`service`関数が登録に使うCloud Mapの名前を与えます。

```bash
aws ecs register-task-definition --cli-input-json file://publira-images.json > /dev/null
IMAGES_TG=$(target_group publira-images 8000)
aws servicediscovery create-service --name publira-images --namespace-id "$NAMESPACE" \
  --dns-config 'RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]' \
  --health-check-custom-config FailureThreshold=1 > /dev/null
```

画像のホストを指定した証明書を、[ロードバランサーを作成する](./index.md#5-ロードバランサーを作成する)と同じように、ロードバランサーのリージョンと`us-east-1`でリクエストし、検証します。次に、1つ目のロードバランサーのセキュリティグループ（CloudFrontのVPCオリジンと`publira-server`のセキュリティグループをすでに許可しています）を使って2つ目の内部向けロードバランサーを作成し、HTTPSリスナーを作成します。このリスナーには、`/images`を新しいサービスに転送し、それ以外のすべてに`404`で応答するルールを1つだけ置きます。

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

ターゲットグループをロードバランサーに結び付けるのはルールであり、ECSはルールのないターゲットグループを使うサービスを拒否するため、サービスはここで初めて作成します。

```bash
service publira-images "$SERVER_SG" 8000 "$IMAGES_TG"
```

[ECSの前に置くCloudFront](./1-cloudfront.md)で1つ目のロードバランサーの前にCloudFrontを置いたのと同じように、このロードバランサーの前にもCloudFrontを置きます。[VPCオリジン](./1-cloudfront.md#vpcオリジン)と同じように`$IMAGES_ALB`用のVPCオリジンを作成し、[ディストリビューション](./1-cloudfront.md#ディストリビューション)の`distribution.json`からディストリビューションを作成します。`Aliases`には画像のホストを、`ViewerCertificate`にはその`us-east-1`の証明書を、`Origins`には新しいロードバランサーのDNS名と新しいVPCオリジンのIDを指定し、`CallerReference`も専用のものにします。関数と`publira-images`キャッシュポリシーは最初のディストリビューションと同じものを使い、その`/images*`ビヘイビアは、最初のディストリビューションと同じように画像をキャッシュします。`publira-images.json`には[クライアントのアドレス](./1-cloudfront.md#クライアントのアドレス)の`PUBLIRA_TRUSTED_PROXIES`が含まれており、これはこのディストリビューションとこのロードバランサーもカバーしています。

ディストリビューションのデプロイが終わったら、各画像のホストをそのドメイン名に向け、[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しているとおり、プラットフォーム管理画面の**画像ホスト**、または`publiractl tenant update --image-domain`で、テナントに画像のホストを設定します。後から追加するテナントには、その画像のホストを、`aws elbv2 add-listener-certificates`で新しいリスナーに追加した証明書と、新しいディストリビューション（またはそのテナント専用のディストリビューション）の`Aliases`に含める必要があります。

### 公開API

既存のロードバランサー上で、公開APIに専用のホスト名を与えます。`api.example.com`の証明書を両方のリージョンでリクエストし、ロードバランサーのリージョンのものをそのリスナーに追加して、`900`の帯に、そのホストの公開APIを`publira-storefront`に転送するルールを追加します。

```bash
aws elbv2 add-listener-certificates --listener-arn "$LISTENER" \
  --certificates CertificateArn=<the API host's certificate ARN in the load balancer's Region>
rule 950 "[$(host_is api.example.com),$(path_is '["/rpc/publira.v1.*"]')]" "$STOREFRONT_SERVER_TG"
```

優先度には、この帯でまだどのルールも使っていないものを選んでください。このホストのそれ以外のパスはすべてリスナーの`404`を受け取ります。例外は`/images`で、これは`1000`のルールがすべてのホストで`publira-server`に送りますが、このホストはどのテナントのものでもないため、そこでも`404`が返ります。次に、`distribution.json`から、このホスト用のディストリビューションを作成します。`Aliases`には`api.example.com`を、`ViewerCertificate`にはその`us-east-1`の証明書を指定し、`CallerReference`も専用のものにします。そして`api.example.com`を、そのディストリビューションのドメイン名に向けます。

Webアプリは、すでにVPC経由で`publira-storefront`を呼び出しています。`web-storefront`は`PUBLIRA_GRPC_URL`で、`web-admin`は[公開APIを管理画面のサーバーから外す](#公開apiを管理画面のサーバーから外す)を済ませていれば`PUBLIRA_PUBLIC_GRPC_URL`で呼び出し、どちらのロードバランサーも経由しません。VPCの外で動くWebアプリは、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、テナントに画像のホストを設定した後、[アプリの接続先アドレス](../../5-mobile-app/2-building.md#アプリの接続先のアドレス)で説明しているとおり、`PUBLIRA_BASE_URL=https://api.example.com`でビルドします。テナントのドメインのルールはそのまま残すため、テナントのドメインに向けてビルドしたアプリも引き続き動きます。

### 分割を確認する

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

1つ目は`404`を返します。画像のホストは画像以外のものを提供しないためです。2つ目は`publira-storefront`に届き、空のリクエストを`invalid_argument`で拒否します。3つ目も`404`を返します。APIのホストは画像を提供しないためです。最後に、テナントのサイトを開いてください。画像は`https://images.comics.example.com/images/…`から読み込まれます。

## アップグレード

[アップグレード](../8-upgrading.md)では、インストール環境を新しいリリースに上げる手順を説明しています。バックアップ、新しいリリースの`publiractl`によるマイグレーションとロールの適用、そしてプロセスの入れ替えです。まずそのページと、リリースノートを読んでください。ECSでは、その手順は次のようになります。

以下のどの手順も、インストール環境が動かしているすべてのサービスに対して行います。一度だけ一覧にしておきます。`web-platform`、`email-renderer`、`publira-storefront`、`publira-images`を動かしている場合は、それらも追加してください。

```bash
SERVICES="publira-server publira-worker web-storefront web-admin"
```

1. **サービスを停止します。** [先にプロセスを停止するかどうかを決める](../8-upgrading.md#先にプロセスを停止するかどうかを決める)で検討した結果、先に停止すると決めた場合に行います。それぞれのサービスが動かしていたタスクの数を記録してから、すべてのサービスのタスク数を0にします。

   ```bash
   declare -A COUNT
   for name in $SERVICES; do
     COUNT[$name]=$(aws ecs describe-services --cluster publira --services "$name" \
       --query 'services[0].desiredCount' --output text)
     aws ecs update-service --cluster publira --service "$name" --desired-count 0 > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

2. **データベースをバックアップします。** [データベースをバックアップする](../8-upgrading.md#1-データベースをバックアップする)で説明しているとおり、RDSインスタンスまたはAuroraクラスターのスナップショットを取るか、データベースに到達できるホストから`pg_dump`を実行します。
3. **マイグレーションとロールを適用します。** `publiractl-db-migrate.json`と`publiractl-db-roles.json`の`<tag>`を新しいリリースに変更し、両方を登録して、この順に`run_publiractl`で実行します。それぞれが成功した場合にだけ先に進みます。ロールのタスクは、各ロールにそのパラメーターが持つパスワード、つまりすでに設定されているパスワードを設定するため、変更なしで実行できます。ロールを追加するリリースでは、そのロールのパスワード用のパラメーター、それを変数として設定する`secrets`のエントリ、その変数を指定するフラグが必要です。
4. **新しいリリースを起動します。** すべてのサービスのタスク定義の`<tag>`を変更し、リリースノートに書かれた変数を追加して登録し、各サービスを新しいリビジョンに更新します。手順1で停止した場合は、同時に、その手順で`COUNT`に記録した、以前に動かしていたタスクの数に戻します。

   ```bash
   for name in $SERVICES; do
     aws ecs register-task-definition --cli-input-json "file://$name.json" > /dev/null
     aws ecs update-service --cluster publira --service "$name" --task-definition "$name" \
       ${COUNT[$name]:+--desired-count ${COUNT[$name]}} > /dev/null
   done
   aws ecs wait services-stable --cluster publira --services $SERVICES
   ```

5. **インストール環境を確認します。** [インストール環境を確認する](../8-upgrading.md#5-インストール環境を確認する)で説明しているとおりに確認します。

アップグレードの間もサービスを動かし続ける場合は、手順4で、[プロセスを入れ替える](../8-upgrading.md#4-プロセスを置き換える)に書かれた順序でサービスを入れ替えます。`email-renderer`を動かしている場合はそれを最初に更新し、次に`SERVICES`に残りのサービスを指定して手順4のループを実行します。ECSは、インストール環境がサービスを提供し続けている間に、少数のタスクずつ入れ替えます。
