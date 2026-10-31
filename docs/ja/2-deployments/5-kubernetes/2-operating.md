---
title: Kubernetesでの運用
description: Kubernetesクラスターで動かしているPubliraで、テナントを追加する、管理画面の認証情報をテナントのドメインから切り離す、画像と公開APIを別々に提供する、メトリクスを公開する、アップグレードするといった作業の手順を説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-25
---

[Kubernetes](./index.md)の手順で運用を始めたPubliraに、後から加える変更を説明します。どの変更も、そのページと[Kubernetesでのリバースプロキシの設定](./1-edge.md)で作成したリソースに手を入れます。

## テナントを追加する

`publiractl tenant create`やプラットフォーム管理画面でテナントを作成したら、そのテナントの2つのホスト名をリバースプロキシに追加します。必要な設定は[テナントを追加するとき](../4-edge/index.md#テナントを追加するとき)で説明しています。変更を適用する前に、両方のホスト名をリバースプロキシのアドレスに向けておいてください。そうしないとcert-managerのチャレンジが届きません。

### Gatewayの場合

GatewayにHTTPSリスナーを2つ追加します。テナントのドメイン用と管理画面のホスト用で、それぞれに別のSecret名を指定します。各リスナーの名前は、対応するWebアプリのHTTPRouteの`parentRefs`に加えます。証明書は2つとも、Gatewayのアノテーションに従ってcert-managerが発行します。

1つのGatewayに置けるリスナーは最大64個なので、`http`リスナーのほかに収められるテナントは31までです。32番目以降のテナントは、別のGatewayと、そのGateway用のHTTPRouteに置いてください。

### Ingressの場合

テナントのドメインを`web-storefront`のIngressの`tls`エントリーとルールに、管理画面のホストを`web-admin`のIngressの`tls`エントリーとルールに追加し、両方を`api-not-found`の`tls`エントリーとルールにも追加します。[Ingressを使う場合](./1-edge.md#ingressを使う場合)で定義したYAMLアンカー(`&storefront-paths`、`&admin-paths`、`&not-found-paths`)を使えば、新しいルールでも`paths: *storefront-paths`のようにパスを使い回せます。`tls`エントリーが変わると、cert-managerが新しいホスト名の証明書を発行します。

## テナントのドメインから管理画面の認証情報を切り離す

管理画面のAPIは、リバースプロキシによってすでにインターネットから遮断されています。それでも、テナントのドメインへのリクエストを受ける`publira-server`は管理画面のAPIも提供しており、そのためのデータベースのログインとWebサービストークンを持っています。管理画面のAPIとそのログインとトークンを、読者のリクエストを処理するプロセスから取り除くには、`--role storefront`を付けた2つ目のDeploymentを動かし、テナントのドメインと`web-storefront`の接続先をそちらに切り替えます。[リバースプロキシを通すのは公開APIだけ](../4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しているとおり、これはリバースプロキシのルールとは別の防御層になります。Deploymentごとにレプリカ数を決められるので、[サーバーをロールごとに分ける](../7-scaling-out.md#サーバーをロールごとに分ける)で説明しているように、読者のトラフィックを管理画面とは別にスケールできるようにもなります。

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

このDeploymentのSecretには、ここで`publira server`が読む値だけを入れ、Webサービストークンと`publira_public`以外の接続URLは入れません。[ほかのSecretを作成した](./index.md#1-secretを作成する)シェルには値がまだ残っているので、同じシェルで作成します。

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

次に、`web-storefront`のHTTPRouteかIngressで、テナントのドメインへの`/images`と`/rpc`配下の公開APIに限って、バックエンドを`publira-server`から`publira-storefront`に変えます。`web-storefront`も公開APIしか呼び出さないので、接続先を`publira-storefront`にします。`web-storefront`のDeploymentで、`PUBLIRA_GRPC_URL`を`http://publira-storefront:8000/rpc`にしてください。管理画面のホストのルートと`web-admin`と`web-platform`は、[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)で公開APIを外すまで、すべてのロールを提供する`publira-server`を呼び出し続けます。

リバースプロキシは分割の前も後も、どのホストでも管理画面のAPIに`404`を返します。そこで、クラスターの中から2つのServiceを直接呼び出して確認します。

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`はこのAPIを提供していないので`404`を返します。`publira-server`はこのAPIを提供しており、空のリクエストを拒否するので`400`を返します。

### 管理画面のサーバーから公開APIを外す

`publira-server`はまだ公開APIを提供し、`publira_public`の接続も持っています。`web-admin`がテナントのテーマとタグを取得するために公開APIを呼び出しており、管理画面のホストのルートも公開APIを`publira-server`に転送しているからです。この2つを`publira-storefront`に向ければ、[サーバーをロールごとに分ける](../7-scaling-out.md#サーバーをロールごとに分ける)の段階4のとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIの提供をやめたときに、公開APIのリクエストを送ってくるものが残っていないよう、次の順に変更してください。

まず、`web-admin`が公開APIを呼び出す先をストアフロントのServiceにします。`web-admin`のDeploymentの`env`に、次の変数を`PUBLIRA_GRPC_URL`と並べて追加し、適用します。`PUBLIRA_GRPC_URL`は`publira-server`のままです。

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

これで`web-admin`の`/readyz`は、このServiceも`public-api`として確認するようになります。

次に、管理画面のホストへの公開APIのリクエストを`publira-storefront`に転送します。`publira-storefront`はどのホストへのリクエストにも応答します。`/images`は`publira-server`に送ったままにします。管理画面のページに表示する画像は`admin`ロールが提供するからです。`web-admin`のHTTPRouteで、最初のルールを次の2つに分けます。

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

最後に、`publira-server.yaml`で`publira-server`のコンテナに`args: ["server", "--role", "admin,platform"]`を指定します。Secretの`PUBLIRA_PUBLIC_DB_URL`はほかに読むものがないので削除し、Deploymentを適用します。

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

`publira-server`が公開APIを提供しなくなったことを確認します。次の呼び出しは、これまで`400`を返していたのが`404`を返すようになります。

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

テナント管理画面にログインすると、テナントのテーマもタグの一覧もこれまでどおり表示されます。どちらも今は`publira-storefront`から読み込まれています。

## 画像と公開APIを別々に提供する

[画像と公開APIを別々に提供する](../7-scaling-out.md#画像と公開apiを別々に提供する)で説明しているとおり、テナントの画像と公開APIは、それぞれ専用のロードバランサーを通る専用のホスト名で提供できます。Gatewayを使うクラスターでは、Gatewayが1つずつ別のロードバランサーになります。そこで、画像には専用のDeploymentとその前に置く2つ目のGatewayを用意し、公開APIには既存のGatewayに`publira-storefront`へ転送するホスト名を追加します。`publira-storefront`は[テナントのドメインから管理画面の認証情報を切り離す](#テナントのドメインから管理画面の認証情報を切り離す)で作成するので、先にその手順を済ませておいてください。以下では、テナントの画像ホストを`images.comics.example.com`、公開APIのホストを`api.example.com`とします。

### 画像

画像のトラフィックをAPIとは別にスケールできるよう、画像は専用のDeploymentで動かします。`publira-storefront`のDeploymentとServiceを`publira-images.yaml`にコピーし、名前、ラベル、セレクター、コンテナ名にある`publira-storefront`を`publira-images`に書き換えます。`secretRef: {name: publira-storefront}`はそのままにします。2つは同じロールを提供し、同じSecretを読むからです。書き換えたら適用します。

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

画像ホスト専用のGatewayを用意して画像ホストごとにHTTPSリスナーを置き、そのホストへの`/images`だけを`publira-images`に転送するHTTPRouteを作成します。どのルールにも一致しないパスには、Gateway自身が`404`を返します。

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

フィルターは、ほかのルートと同じヘッダーを削除します。理由は[Gatewayを使う場合](./1-edge.md#gatewayを使う場合)で説明しています。画像ホストのACMEチャレンジには、cert-managerが新しいGatewayの`http`リスナーで応答します。そこで、`letsencrypt`発行者のソルバーの`parentRefs`に、[証明書](./1-edge.md#証明書)で指定したものと並べて新しいGatewayを追加します。

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

各画像ホストを新しいGatewayのアドレスに向け、証明書が発行されるのを待ってから、プラットフォーム管理画面の**画像ホスト**か`publiractl tenant update --image-domain`でテナントに割り当てます。詳しくは[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しています。後からテナントを追加したときは、その画像ホストのリスナーを`publira-images`に追加し、リスナーの名前を`images`のHTTPRouteの`parentRefs`に加えます。

### 公開API

公開APIには`publira`のGatewayで専用のホスト名を用意し、そのホストへの公開APIだけを`publira-storefront`に転送するHTTPRouteを作成します。まず、Gatewayの`listeners`に次のリスナーを追加します。

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

Webアプリは、すでにクラスター内のネットワークを通じてロードバランサーを経由せずに`publira-storefront`を呼び出しています。`web-storefront`は`PUBLIRA_GRPC_URL`で、`web-admin`は[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)を済ませていれば`PUBLIRA_PUBLIC_GRPC_URL`で呼び出します。クラスターの外で動かすWebアプリには、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、そのテナントに画像ホストを割り当ててから、`PUBLIRA_BASE_URL=https://api.example.com`を指定してビルドします。詳しくは[アプリの接続先](../../5-mobile-app/2-building.md#アプリの接続先)で説明しています。テナントのドメインのルートは変えないので、テナントのドメインに接続するようビルドしたアプリもそのまま動きます。

### Ingressを使う場合

同じクラスのIngressには、どれもコントローラーのServiceを通ってリクエストが届き、このServiceが1つのロードバランサーになります。画像ホスト用には、専用のクラスを持つ2つ目のコントローラーを[Ingressを使う場合](./1-edge.md#ingressを使う場合)の値でインストールします。既存のコントローラーで受けてもかまいません。[テナントの画像ホスト](../4-edge/index.md#テナントの画像ホスト)でも、その構成を認めています。どちらの場合も、画像ホストは1つのIngressで振り分けます。それ以外のパスはどのルールにもないので、Traefikが自分で`404`を返します。

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

公開APIのホストは、既存のコントローラーに同じ形のIngressをもう1つ追加して用意します。ホストは`api.example.com`で、パスは`ImplementationSpecific`の`/rpc/publira.v1.`だけを`publira-storefront`に転送します。

### 分割を確認する

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

画像ホストは画像しか提供しないので、1つ目は`404`を返します。2つ目は`publira-storefront`に届き、空のリクエストとして`invalid_argument`で拒否されます。APIのホストは画像を提供しないので、3つ目も`404`を返します。最後にテナントのサイトを開き、画像が`https://images.comics.example.com/images/…`から読み込まれていることを確かめます。

## メトリクス

[メトリクス](../../3-operations/11-monitoring.md#メトリクス)で説明しているとおり`PUBLIRA_METRICS_ENABLED=true`と`OTEL_METRICS_EXPORTER=prometheus`と`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`で有効にすると、`publira server`と`publira worker`はポート`9464`でPrometheusのメトリクスを公開します。[プロセスを起動する](./index.md#4-プロセスを起動する)の構成では両者が別々のPodで動くので、同じポートで待ち受けても衝突しません。2つを1つのPodの2つのコンテナとして動かすと、ネットワーク名前空間を共有するので、後から起動した方は先に起動した方が使っているポートで待ち受けられません。それぞれに別の`OTEL_EXPORTER_PROMETHEUS_PORT`を指定するか、別々のPodで動かしてください。

## アップグレード

[アップグレード](../8-upgrading.md)では、バックアップを取り、新しいリリースの`publiractl`でマイグレーションとロールを適用してから、プロセスを入れ替えて新しいリリースに移行します。先にそのページとリリースノートを読んでください。クラスターでは次の手順になります。

### 1. プロセスを停止する

先にプロセスを停止すると決めた場合は、PubliraのすべてのDeploymentのレプリカ数を0にします。停止するかどうかは、[先にプロセスを停止するかどうかを決める](../8-upgrading.md#先にプロセスを停止するかどうかを決める)を参考に判断してください。

```bash
kubectl scale deployment --all --replicas=0
kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
```

このラベルは、PubliraのすべてのDeploymentのPodを選び、JobのPodは選びません。JobのPodは終了済みで、ログを読むために残してあるものです。

### 2. データベースをバックアップする

[データベースをバックアップする](../8-upgrading.md#1-データベースをバックアップする)で説明しているとおり、データベースに接続できるホストから`pg_dump`を実行するか、マネージドデータベースのスナップショットを取ります。

### 3. マイグレーションとロールを適用する

Jobは変更できないので、前のリリースのJobが残っていれば削除します。

```bash
kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
```

そのうえで、[マイグレーションを適用する](./index.md#2-マイグレーションを適用する)と[ロールを作成する](./index.md#3-ロールを作成する)の2つのJobの`<tag>`を新しいリリースに書き換え、この順に実行します。次のJobは、前のJobが完了してから実行してください。

ロールのJobは、`publira-db-roles`にあるパスワードを各ロールに設定します。これは各ロールの現在のパスワードと同じなので、フラグは変えずに実行できます。ロールを追加するリリースでは、そのロールのパスワードを`publira-db-roles`に追加し、フラグも追加します。

### 4. 新しいリリースを起動する

すべてのDeploymentの`<tag>`を書き換え、リリースノートに書かれている変数を追加して適用します。マニフェストを適用すると、0にしたレプリカ数も元に戻ります。

アップグレード中もプロセスを止めない場合は、[プロセスを入れ替える](../8-upgrading.md#4-プロセスを入れ替える)の順序に従って入れ替えます。`email-renderer`を動かしているならそれを最初に適用し、続けてほかのDeploymentを適用します。ほかのDeploymentはサービスを続けたまま1レプリカずつ入れ替わります。

### 5. 動作を確認する

[動作を確認する](../8-upgrading.md#5-動作を確認する)の説明に従って確認します。
