---
title: Kubernetesでの運用
description: Kubernetesクラスターで動かしているPubliraについて、テナントの追加、テナントのドメインから管理画面の認証情報を切り離す方法、画像と公開APIの分離、メトリクスの公開、アップグレードを説明します。
published: 2026-10-29
source_updated: 2026-10-25
---

ここでは、[Kubernetes](./index.md)の手順で運用を始めたPubliraに加える変更を説明します。どの変更も、そのページと[Kubernetesでのリバースプロキシの設定](./1-edge.md)で作成したリソースを変更します。

## テナントを追加する

`publiractl tenant create`やプラットフォーム管理画面でテナントを作成したら、[テナントを追加する](../4-edge/index.md#テナントを追加するとき)で説明しているとおり、そのテナントの2つのホスト名をリバースプロキシに追加する必要があります。クラスターでは次のようにします。

- **Gatewayを使う場合**。GatewayにHTTPSリスナーを2つ追加します。テナントのドメイン用と管理画面のホスト用で、それぞれに別のSecret名を指定します。各リスナーの名前は、対応するWebアプリのHTTPRouteの`parentRefs`に追加します。証明書は2つとも、Gatewayのアノテーションによってcert-managerが発行します。1つのGatewayに置けるリスナーは最大64個なので、`http`リスナーのほかに収容できるテナントは31までです。それ以降のテナントは、別のGatewayとそのGateway用のHTTPRouteに置いてください。
- **Ingressを使う場合**。ドメインを`web-storefront`のIngressの`tls`エントリーとルールに、管理画面のホストを`web-admin`のIngressの`tls`エントリーとルールに追加します。両方のホスト名を`api-not-found`の`tls`エントリーとルールにも追加します。[Ingressを使う場合](./1-edge.md#ingressを使う場合)のYAMLアンカー(`&storefront-paths`、`&admin-paths`、`&not-found-paths`)を使うと、新しいルールで`paths: *storefront-paths`のようにパスを再利用できます。`tls`エントリーを変更すると、cert-managerが新しい名前の証明書を発行します。

cert-managerのチャレンジが届くように、変更を適用する前に、両方の名前をリバースプロキシのアドレスに向けておいてください。

## テナントのドメインから管理画面の認証情報を切り離す

管理画面のAPIは、リバースプロキシによってインターネットから遮断されています。しかし、テナントのドメインへのリクエストの転送先である`publira-server`は管理画面のAPIも提供しているので、そのためのデータベースのログインとWebサービストークンを持っています。管理画面のAPI、そのデータベースのログイン、Webサービストークンの3つを、読者からのリクエストを処理するプロセスから取り除くには、`--role storefront`を付けた2つ目のDeploymentを動かし、テナントのドメインと`web-storefront`の接続先をそちらに切り替えます。[リバースプロキシを通すのは公開APIだけ](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しているとおり、これはリバースプロキシのルールとは別の防御層になります。Deploymentごとにレプリカ数を設定できるので、[ロールごとにサーバーを分ける](../7-scaling-out.md#サーバーをロールごとに分ける)で説明しているとおり、読者のトラフィックを管理画面とは別にスケールすることもできます。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-storefront
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-storefront
          image: ghcr.io/publira/publira:<tag>
          args: ["server", "--role", "storefront"]
          lifecycle:
            preStop:
              sleep:
                seconds: 5
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-storefront
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
            - name: PUBLIRA_TRUSTED_PROXIES
              value: 10.244.0.0/16
          livenessProbe:
            httpGet:
              path: /livez
              port: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            timeoutSeconds: 8
---
apiVersion: v1
kind: Service
metadata:
  name: publira-storefront
spec:
  selector:
    app.kubernetes.io/name: publira-storefront
  ports:
    - name: http
      port: 8000
      targetPort: http
```

このDeploymentのSecretには、このDeploymentで`publira server`が読む値だけを入れます。Webサービストークンと、`publira_public`以外の接続URLは入れません。[ほかのSecretを作成した](./index.md#1-secretを作成する)ときのシェルには値がまだ残っているので、同じシェルで作成します。

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

次に、`web-storefront`のHTTPRouteまたはIngressで、テナントのドメインの`/images`と、`/rpc`の下の公開APIだけ、バックエンドを`publira-server`から`publira-storefront`に変更します。`web-storefront`も公開APIしか呼び出さないので、接続先を`publira-storefront`にします。`web-storefront`のDeploymentで、`PUBLIRA_GRPC_URL`を`http://publira-storefront:8000/rpc`に設定してください。管理画面のホストのルート、`web-admin`、`web-platform`は、[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)で公開APIを外すまで、すべてのロールを提供する`publira-server`を引き続き呼び出します。

分割の前後を問わず、リバースプロキシはどのホストでも管理画面のAPIに`404`を返します。そのため確認は、クラスターの中から2つのServiceを直接呼び出して行います。

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`はこのAPIを提供していないので、`404`を返します。`publira-server`は`400`を返します。このAPIを提供していて、空のリクエストを拒否するからです。

### 管理画面のサーバーから公開APIを外す

`publira-server`はまだ公開APIを提供していて、`publira_public`の接続も持っています。`web-admin`がテナントのテーマとタグを取得するために公開APIを呼び出し、管理画面のホストのルートも公開APIを`publira-server`に転送しているからです。この2つを`publira-storefront`に向ければ、[ロールごとにサーバーを分ける](../7-scaling-out.md#サーバーをロールごとに分ける)の手順4で説明しているとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIの提供をやめた時点で、まだ公開APIのリクエストを送ってくるものが残らないように、次の順序で変更してください。

まず、`web-admin`の公開APIの呼び出し先を、ストアフロントのServiceに向けます。`web-admin`のDeploymentの`env`に次の変数を`PUBLIRA_GRPC_URL`と並べて追加し、適用します。`PUBLIRA_GRPC_URL`は`publira-server`のままにします。

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

これで、`web-admin`の`/readyz`は、このServiceも`public-api`として確認するようになります。

次に、管理画面のホストの公開APIを`publira-storefront`にルーティングします。`publira-storefront`は、どのホストへのリクエストにも応答します。`/images`は`publira-server`のままにします。管理画面のページに表示する画像は、`admin`ロールが提供するからです。`web-admin`のHTTPRouteで、最初のルールを次の2つに分けます。

```yaml
- matches:
    - path: { type: PathPrefix, value: /images }
  filters: &strip-request-headers
    - type: RequestHeaderModifier
      requestHeaderModifier:
        remove:
          - traceparent
          - tracestate
          - baggage
          - forwarded
          - x-forwarded-host
          - x-forwarded-countryregion
  backendRefs:
    - name: publira-server
      port: 8000
- matches:
    - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
  filters: *strip-request-headers
  backendRefs:
    - name: publira-storefront
      port: 8000
```

Ingressを使う場合は、代わりに`web-admin`のIngressで、`/rpc/publira.v1.`のパスのバックエンドを`publira-storefront`に変更します。

最後に、`publira-server.yaml`で`publira-server`のコンテナに`args: ["server", "--role", "admin,platform"]`を指定します。ほかにこのSecretから`PUBLIRA_PUBLIC_DB_URL`を読むものはないので、Secretから削除します。そのうえで、Deploymentを適用します。

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

`publira-server`が公開APIを提供しなくなったことを確認します。次の呼び出しは、以前は`400`を返していましたが、`404`を返すようになります。

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

テナント管理画面にログインします。テナントのテーマもタグの一覧も以前と同じように表示され、これらは`publira-storefront`から読み込まれています。

## 画像と公開APIを別に提供する

[画像と公開APIを分けて提供する](../7-scaling-out.md#画像と公開apiを別々に提供する)で説明しているとおり、テナントの画像と公開APIは、それぞれ専用のロードバランサーを経由する専用のホスト名で提供できます。Gatewayを使うクラスターでは、Gatewayごとに別のロードバランサーになります。そこで、画像には専用のDeploymentとその前段の2つ目のGatewayを用意し、公開APIには既存のGatewayに`publira-storefront`へ転送するホスト名を追加します。この手順は、`publira-storefront`を作成する[テナントのドメインから管理画面の認証情報を切り離す](#テナントのドメインから管理画面の認証情報を切り離す)の手順を済ませていることが前提です。以下の名前は例です。テナントの画像ホストを`images.comics.example.com`、公開APIのホストを`api.example.com`とします。

### 画像

画像のトラフィックをAPIとは別にスケールできるように、画像は専用のDeploymentで動かします。`publira-storefront`のDeploymentとServiceを`publira-images.yaml`にコピーし、名前、ラベル、セレクター、コンテナ名の`publira-storefront`を`publira-images`に変更します。`secretRef: {name: publira-storefront}`は変更しません。2つは同じロールを提供し、同じSecretを読むからです。そのうえで適用します。

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

画像ホスト用に専用のGatewayを用意し、画像ホストごとにHTTPSリスナーを置きます。HTTPRouteは、そのホストへの`/images`だけを`publira-images`に転送します。どのルールにも一致しないパスには、Gateway自身が`404`を返します。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: <your class>
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: images-comics-example-com
      protocol: HTTPS
      port: 443
      hostname: images.comics.example.com
      tls:
        certificateRefs:
          - name: images-comics-example-com-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images
spec:
  parentRefs:
    - name: publira-images
      sectionName: images-comics-example-com
  rules:
    - matches:
        - path: { type: PathPrefix, value: /images }
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-images
          port: 8000
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: images-https-redirect
spec:
  parentRefs:
    - name: publira-images
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

フィルターは、[Gatewayを使う場合](./1-edge.md#gatewayを使う場合)で説明しているとおり、ほかのルートと同じヘッダーを削除します。画像ホストのACMEチャレンジには、新しいGatewayの`http`リスナーでcert-managerが応答します。そのため、`letsencrypt`発行者のソルバーの`parentRefs`に、[証明書](./1-edge.md#証明書)で指定したものと並べて新しいGatewayを追加します。

```yaml
parentRefs:
  - name: publira
    namespace: publira
    kind: Gateway
    sectionName: http
  - name: publira-images
    namespace: publira
    kind: Gateway
    sectionName: http
```

各画像ホストを新しいGatewayのアドレスに向け、証明書が発行されるのを待ちます。そのうえで、[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しているとおり、プラットフォーム管理画面の**画像ホスト**か`publiractl tenant update --image-domain`で、画像ホストをテナントに割り当てます。後からテナントを追加したときは、その画像ホスト用のリスナーを`publira-images`に追加し、リスナーの名前を`images`のHTTPRouteの`parentRefs`に追加します。

### 公開API

公開APIには、`publira`のGatewayに専用のホスト名を用意し、そのホストへの公開APIだけを`publira-storefront`に転送するHTTPRouteを作成します。まず、Gatewayの`listeners`に次のリスナーを追加します。

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

続けて、次のルートを適用します。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: public-api
spec:
  parentRefs:
    - name: publira
      sectionName: api-example-com
  rules:
    - matches:
        - path: { type: RegularExpression, value: '/rpc/publira\.v1\..*' }
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove:
              - traceparent
              - tracestate
              - baggage
              - forwarded
              - x-forwarded-host
              - x-forwarded-countryregion
      backendRefs:
        - name: publira-storefront
          port: 8000
```

Webアプリはすでにクラスター内のネットワークで`publira-storefront`を呼び出しているので、ロードバランサーを経由しません。`web-storefront`は`PUBLIRA_GRPC_URL`で、`web-admin`は[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)を済ませていれば`PUBLIRA_PUBLIC_GRPC_URL`で呼び出しています。クラスターの外で動かすWebアプリでは、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、テナントに画像ホストを割り当てた後で、`PUBLIRA_BASE_URL=https://api.example.com`を指定してビルドします。詳しくは[アプリの接続先のアドレス](../../5-mobile-app/2-building.md#アプリの接続先)で説明しています。テナントのドメインのルートは変更しないので、テナントのドメインを接続先にしてビルドしたアプリも引き続き動作します。

### Ingressを使う場合

同じクラスのIngressは、すべてコントローラーのServiceを経由します。このServiceが1つのロードバランサーです。画像ホストには、独自のクラスを持つ2つ目のコントローラーを、[Ingressを使う場合](./1-edge.md#ingressを使う場合)の値でインストールして用意します。既存のコントローラーに置いたままにしてもかまいません。[テナントの画像ホスト](../4-edge/index.md#テナントの画像ホスト)でも、それは認められています。どちらの場合も、1つのIngressで画像ホストをルーティングします。ほかのパスはどのルールにも指定されていないので、Traefikが自分で`404`を返します。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: publira-images
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [images.comics.example.com]
      secretName: images-comics-example-com-tls
  rules:
    - host: images.comics.example.com
      http:
        paths:
          - path: /images
            pathType: Prefix
            backend:
              { service: { name: publira-images, port: { number: 8000 } } }
```

公開APIのホストも、既存のコントローラーに同じ形のIngressを1つ追加して用意します。ホストは`api.example.com`、パスは`ImplementationSpecific`の`/rpc/publira.v1.`だけで、転送先は`publira-storefront`です。

### 分割を確認する

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

1つ目は`404`を返します。画像ホストは画像しか提供しないからです。2つ目は`publira-storefront`に届き、空のリクエストは`invalid_argument`で拒否されます。3つ目も`404`を返します。APIのホストは画像を提供しないからです。最後にテナントのサイトを開き、画像が`https://images.comics.example.com/images/…`から読み込まれることを確認します。

## メトリクス

`publira server`と`publira worker`は、[メトリクス](../../3-operations/11-monitoring.md#メトリクス)の説明に従って`PUBLIRA_METRICS_ENABLED=true`、`OTEL_METRICS_EXPORTER=prometheus`、`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`で有効にすると、ポート`9464`でPrometheusのメトリクスを公開します。[プロセスを起動する](./index.md#4-プロセスを起動する)の構成では両者が別々のPodで動くので、同じポートで待ち受けても衝突しません。2つを1つのPodの2つのコンテナとして動かす場合は、ネットワーク名前空間を共有します。そのため、後から起動した方は、先に起動した方が使っているポートで待ち受けられません。それぞれに別の`OTEL_EXPORTER_PROMETHEUS_PORT`を指定するか、別々のPodで動かしてください。

## アップグレード

[アップグレード](../8-upgrading.md)では、バックアップ、新しいリリースの`publiractl`によるマイグレーションとロールの更新、プロセスの入れ替えの順に、Publiraを新しいリリースに移行します。先にそのページと、リリースノートを読んでください。クラスターでは、手順は次のようになります。

1. 先にプロセスを停止すると決めた場合は、PubliraのすべてのDeploymentのレプリカ数を0にして**プロセスを停止します**。停止するかどうかは、[先にプロセスを停止するかどうかを決める](../8-upgrading.md#先にプロセスを停止するかどうかを決める)を参考に判断します。

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   このラベルで、PubliraのすべてのDeploymentのPodを選択します。JobのPodは選択されません。JobのPodは終了済みで、ログを読むために残されています。

2. [データベースをバックアップする](../8-upgrading.md#1-データベースをバックアップする)の説明のとおり、データベースに接続できるホストから`pg_dump`を実行するか、マネージドデータベースのスナップショットを取って、**データベースをバックアップします**。
3. **マイグレーションとロールを適用します。** Jobは変更できないので、前のリリースのJobが残っていれば削除します。そのうえで、[マイグレーションを適用する](./index.md#2-マイグレーションを適用する)と[ロールを作成する](./index.md#3-ロールを作成する)の2つのJobの`<tag>`を新しいリリースに変更し、この順に実行します。それぞれ完了するまで待ってから、次に進みます。

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   ロールのJobは、各ロールに`publira-db-roles`にあるパスワードを設定します。これは現在のパスワードと同じなので、フラグを変えずに実行できます。ロールを追加するリリースでは、そのロールのパスワードを`publira-db-roles`に追加し、フラグも追加する必要があります。

4. **新しいリリースを起動します。** すべてのDeploymentの`<tag>`を変更し、リリースノートに書かれている変数を追加して適用します。マニフェストを適用すると、0にしたレプリカ数も元に戻ります。
5. [Publiraの動作を確認する](../8-upgrading.md#5-動作を確認する)の説明のとおり、**動作を確認します**。

アップグレード中もプロセスを止めない場合は、手順4で、[プロセスを置き換える](../8-upgrading.md#4-プロセスを入れ替える)の順序に従ってプロセスを入れ替えます。`email-renderer`を動かしている場合は最初に適用し、続けてほかのDeploymentを適用します。ほかのDeploymentは、Publiraがサービスを続けたまま、1レプリカずつ入れ替わります。
