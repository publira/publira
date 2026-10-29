---
title: Kubernetesでの運用
description: Kubernetesクラスターで動くインストール環境で、テナントを追加し、管理画面の認証情報をテナントのドメインに置かず、画像と公開APIを分けて提供し、メトリクスを公開し、アップグレードする。
published: 2026-10-29
source_updated: 2026-10-25
---

ここで扱うのは、[Kubernetes](./index.md)でインストール環境の運用を始めた後に加える変更です。どの変更も、そのページと[Kubernetesでのエッジ](./1-edge.md)で作成したリソースを変更します。

## テナントを追加する

`publiractl tenant create`またはプラットフォーム管理画面で作成したテナントには、[テナントを追加する](../4-edge/index.md#テナントを追加する)で説明しているとおり、エッジにその2つのホスト名が必要です。クラスターでは次のようになります。

- **Gatewayを使う場合**：Gatewayに2つのHTTPSリスナーを追加します。テナントのドメイン用と、その管理画面のホスト用で、それぞれ独自のSecret名を持たせます。そして各リスナーの名前を、そのWebアプリのHTTPRouteの`parentRefs`に追加します。cert-managerは、Gatewayのアノテーションによって両方の証明書を発行します。1つのGatewayが持てるリスナーは最大64個であるため、1つのGatewayで提供できるのは、`http`リスナーのほかに最大31テナントです。それ以降のテナントは、独自のHTTPRouteとともに別のGatewayに置いてください。
- **Ingressを使う場合**：ドメインを`web-storefront` Ingressの`tls`エントリーとルールに、管理画面のホストを`web-admin`のそれらに、両方を`api-not-found`のそれらに追加します。[Ingressを使う場合](./1-edge.md#ingressを使う場合)のYAMLアンカー（`&storefront-paths`、`&admin-paths`、`&not-found-paths`）を使えば、新しいルールで`paths: *storefront-paths`のようにパスを再利用できます。cert-managerは、`tls`エントリーが変わったときに新しい名前の証明書を発行します。

cert-managerのチャレンジがエッジに届くように、変更を適用する前に両方の名前をエッジのアドレスに向けておいてください。

## 管理画面の認証情報をテナントのドメインに置かない

エッジはすでに管理画面のAPIをインターネットから切り離していますが、エッジがテナントのドメインを転送する先の`publira-server`は依然としてそれらのAPIを提供しており、そのためにデータベースのログインとWebサービストークンを保持しています。[エッジを通るのは公開APIだけ](../4-edge/index.md#エッジを通るのは公開apiだけ)で説明しているとおり、エッジのルールとは別の層として、この3つすべてを読者が到達するプロセスから取り除くには、`--role storefront`を付けた2つ目のDeploymentを動かし、テナントのドメインと`web-storefront`をそこにルーティングします。各Deploymentは独自のレプリカを持つため、この分割によって、[役割ごとにサーバーを分割する](../7-scaling-out.md#ロールごとにサーバーを分ける)で説明しているとおり、読者のトラフィックを管理画面とは別にスケールすることもできます。

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

このDeploymentのSecretには、それが読む`publira server`の値を入れます。Webサービストークンと、`publira_public`以外の接続は含みません。[ほかのSecretを作成した](./index.md#1-secretを作成する)シェル（それらの値がまだ残っているシェル）で作成します。

```bash
kubectl create secret generic publira-storefront \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB"
```

次に、`web-storefront`のHTTPRouteまたはIngressで、テナントのドメインの`/images`と`/rpc`の下の公開APIについてだけ、バックエンドを`publira-server`から`publira-storefront`に変更します。`web-storefront`も公開APIだけを呼び出すため、同じくそこに向けます。そのDeploymentの`PUBLIRA_GRPC_URL`を`http://publira-storefront:8000/rpc`に設定してください。管理画面のホストのルート、`web-admin`、`web-platform`は、[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)で公開APIを外すまで、すべての役割を提供する`publira-server`を引き続き呼び出します。

どちらの場合も、エッジはすべてのホストで管理画面のAPIに`404`を返すため、確認では代わりにクラスターの中から2つのServiceを呼び出します。

```bash
for service in publira-storefront publira-server; do
  kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
    -s -o /dev/null -w "$service %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://$service:8000/rpc/publira.admin.v1.AdminAuditLogService/ListAuditLogs"
done
```

`publira-storefront`はそのAPIを提供していないため、`404`を返します。`publira-server`は`400`を返します。そこではAPIが提供されており、空のリクエストを拒否するためです。

### 管理画面のサーバーから公開APIを外す

`publira-server`は依然として公開APIを提供し、`publira_public`を保持しています。`web-admin`がテナントのテーマとタグのために公開APIを呼び出し、管理画面のホストのルートが公開APIをそこに転送しているためです。その両方を`publira-storefront`に送れば、[役割ごとにサーバーを分割する](../7-scaling-out.md#ロールごとにサーバーを分ける)の手順4で説明しているとおり、`publira-server`を`--role admin,platform`で動かせます。`publira-server`が公開APIのリクエストの提供をやめた時点で、まだそこに公開APIのリクエストを送っているものが残らないように、次の順序で変更してください。

まず、`web-admin`の公開APIの呼び出し先をストアフロントのServiceに向けます。そのDeploymentの`env`に、引き続き`publira-server`を指定する`PUBLIRA_GRPC_URL`と並べて変数を追加し、適用します。

```yaml
- name: PUBLIRA_PUBLIC_GRPC_URL
  value: http://publira-storefront:8000/rpc
```

これで、このWebアプリの`/readyz`はそのServiceも`public-api`として確認するようになります。

次に、管理画面のホストの公開APIを、どのホストでも応答する`publira-storefront`にルーティングし、`/images`は`publira-server`のままにします。管理画面のページに表示される画像は`admin`の役割に属するためです。`web-admin`のHTTPRouteで、最初のルールを2つに分けます。

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

`web-admin` Ingressの場合は、代わりに`/rpc/publira.v1.`のパスのバックエンドを`publira-storefront`に変更します。

最後に、`publira-server.yaml`で`publira-server`のコンテナに`args: ["server", "--role", "admin,platform"]`を与え、ほかにそこから読むもののない`PUBLIRA_PUBLIC_DB_URL`をそのSecretから削除して、Deploymentを適用します。

```bash
kubectl patch secret publira-server --type=json \
  -p '[{"op":"remove","path":"/data/PUBLIRA_PUBLIC_DB_URL"}]'
kubectl apply -f publira-server.yaml
kubectl rollout status deployment/publira-server
```

`publira-server`が公開APIを提供しなくなったことを確認します。以前は`400`を返していたこの呼び出しが、`404`を返します。

```bash
kubectl run publira-role-check --rm -i --restart=Never --image=curlimages/curl -- \
  -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://publira-server:8000/rpc/publira.v1.TenantService/GetTenant"
```

テナント管理画面にログインします。テナントのテーマが描画され、タグが以前と同じように一覧表示されます。これらは今では`publira-storefront`から読み込まれています。

## 画像と公開APIを分けて提供する

[画像と公開APIを分けて提供する](../7-scaling-out.md#画像と公開apiを分けて提供する)で説明しているとおり、テナントの画像と公開APIには、それぞれ専用のロードバランサーを通じて、専用のホスト名で到達できるようにできます。Gatewayを使うクラスターでは、Gatewayがそれぞれ独立したロードバランサーになるため、画像には専用のDeploymentの前に置く2つ目のGatewayを用意し、公開APIには既存のGateway上で`publira-storefront`の前に置くホスト名を用意します。これは、`publira-storefront`を作成した[管理画面の認証情報をテナントのドメインに置かない](#管理画面の認証情報をテナントのドメインに置かない)を前提としています。以下の名前は例です。テナントの画像ホストは`images.comics.example.com`、公開APIのホストは`api.example.com`です。

### 画像

画像のトラフィックをAPIのトラフィックとは別にスケールできるように、画像を専用のDeploymentで動かします。`publira-storefront`のDeploymentとServiceを`publira-images.yaml`にコピーし、名前、ラベル、セレクター、コンテナ名の`publira-storefront`を`publira-images`に変更します。`secretRef: {name: publira-storefront}`はそのままにします。2つは同じ役割を提供し、同じSecretを読むためです。そのうえで適用します。

```bash
kubectl apply -f publira-images.yaml
kubectl rollout status deployment/publira-images
```

画像ホストには、画像ホストごとに1つのHTTPSリスナーを持つ専用のGatewayと、そこでの`/images`だけを`publira-images`に転送するHTTPRouteを用意します。どのルールにも一致しないパスには、Gateway自身が`404`を返します。

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

フィルターは、[Gatewayを使う場合](./1-edge.md#gatewayを使う場合)で説明しているとおり、ほかのルートと同じヘッダーを取り除きます。cert-managerは画像ホストのACMEチャレンジに新しいGatewayの`http`リスナーで応答するため、`letsencrypt`発行者のソルバーの`parentRefs`に、[証明書](./1-edge.md#証明書)で指定したものと並べてそのリスナーを追加します。

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

各画像ホストを新しいGatewayのアドレスに向け、証明書を待ってから、[画像ホスト](../../3-operations/2-tenants.md#画像ホスト)で説明しているとおり、プラットフォーム管理画面の**画像ホスト**または`publiractl tenant update --image-domain`でテナントに割り当てます。後で追加したテナントには、その画像ホストのためのリスナーを`publira-images`に追加し、リスナーの名前を`images` HTTPRouteの`parentRefs`に追加します。

### 公開API

公開APIには、`publira` Gateway上の専用のホスト名と、そこでの公開APIだけを`publira-storefront`に転送するHTTPRouteを用意します。Gatewayの`listeners`にリスナーを追加し、

```yaml
- name: api-example-com
  protocol: HTTPS
  port: 443
  hostname: api.example.com
  tls:
    certificateRefs:
      - name: api-example-com-tls
```

ルートを適用します。

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

Webアプリはすでにクラスターのネットワーク経由で`publira-storefront`を呼び出しており、ロードバランサーを通りません。`web-storefront`は`PUBLIRA_GRPC_URL`で、`web-admin`は[管理画面のサーバーから公開APIを外す](#管理画面のサーバーから公開apiを外す)を済ませた後なら`PUBLIRA_PUBLIC_GRPC_URL`で呼び出します。クラスターの外で動くWebアプリは、代わりに`https://api.example.com/rpc`を指定します。テナントのモバイルアプリは、[アプリの接続先アドレス](../../5-mobile-app/2-building.md#アプリの接続先のアドレス)で説明しているとおり、テナントが画像ホストを持った後に`PUBLIRA_BASE_URL=https://api.example.com`でビルドします。テナントのドメインのルートはそのまま残るため、テナントのドメインを接続先としてビルドしたアプリも引き続き動作します。

### Ingressを使う場合

同じクラスのIngressはすべて、そのコントローラーのService、つまり1つのロードバランサーを通じて到達します。画像ホストには、[Ingressを使う場合](./1-edge.md#ingressを使う場合)の値でインストールした、独自のクラスを持つ2つ目のコントローラーを用意するか、既存のコントローラーに置いたままにします。[テナントの画像ホスト](../4-edge/index.md#テナントの画像ホスト)では後者も認められています。どちらの場合も1つのIngressがそれらをルーティングし、それ以外のパスはどのルールにも指定されていないため、Traefikが自分で`404`を返します。

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

公開APIのホストは、既存のコントローラー上の同じ形のIngressをもう1つ追加したものです。ホストは`api.example.com`、パスは`ImplementationSpecific`の`/rpc/publira.v1.`の1つだけで、`publira-storefront`に向けます。

### 分割を確認する

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://images.comics.example.com/
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://api.example.com/rpc/publira.v1.TenantService/GetTenant
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/images/
```

1つ目は`404`を返します。画像ホストは画像以外のものを提供しません。2つ目は`publira-storefront`に届き、空のリクエストが`invalid_argument`で拒否されます。3つ目も`404`を返します。APIのホストは画像を提供しません。そのうえでテナントのサイトを開くと、画像が`https://images.comics.example.com/images/…`から読み込まれます。

## メトリクス

`publira server`と`publira worker`は、[メトリクス](../../3-operations/11-monitoring.md#メトリクス)のとおりに`PUBLIRA_METRICS_ENABLED=true`、`OTEL_METRICS_EXPORTER=prometheus`、`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`で有効にすると、ポート`9464`でPrometheusのメトリクスを提供します。[プロセスを起動する](./index.md#4-プロセスを起動する)では両者がそれぞれ別のPodで動くため、どちらも衝突せずにこのポートで待ち受けます。2つを1つのPodの2つのコンテナとして動かすと、1つのネットワーク名前空間を共有するため、後から起動した方は先に起動した方が使っているポートで待ち受けられません。それぞれに別の`OTEL_EXPORTER_PROMETHEUS_PORT`を与えるか、別々のPodで動かしてください。

## アップグレード

[アップグレード](../8-upgrading.md)では、バックアップ、新しいリリースの`publiractl`によるマイグレーションとロール、そしてプロセスの順に、インストール環境を新しいリリースに移行します。まずそのページとリリースノートを読んでください。クラスターでは、その手順は次のようになります。

1. 先にプロセスを停止すると決めた場合は（その判断は[先にプロセスを停止するかどうかを決める](../8-upgrading.md#先にプロセスを停止するかどうかを決める)で検討します）、インストール環境のすべてのDeploymentをゼロにスケールして**プロセスを停止します**。

   ```bash
   kubectl scale deployment --all --replicas=0
   kubectl wait --for=delete pod -l app.kubernetes.io/name --timeout=2m
   ```

   このラベルはインストール環境のすべてのDeploymentのPodを選択し、Jobのものは除外します。JobのPodは終了済みで、ログのために残されています。

2. [データベースをバックアップする](../8-upgrading.md#1-データベースをバックアップする)で説明しているとおり、データベースに到達できるホストからの`pg_dump`、またはマネージドデータベースのスナップショットで、**データベースをバックアップします**。
3. **マイグレーションとロールを適用します。** Jobは変更できないため、前のリリースのJobがまだ残っていれば削除します。そのうえで、[マイグレーションを適用する](./index.md#2-マイグレーションを適用する)と[ロールを作成する](./index.md#3-ロールを作成する)の2つのJobの`<tag>`を新しいリリースに変更し、この順に実行して、それぞれが完了するのを待ちます。

   ```bash
   kubectl delete job publira-db-migrate publira-db-roles --ignore-not-found
   ```

   ロールのJobは、各ロールに`publira-db-roles`が保持しているパスワード、つまりすでに設定されているパスワードを与えるため、フラグを変えずに実行できます。ロールを追加するリリースでは、そのロールのパスワードを`publira-db-roles`に入れ、そのフラグを追加する必要があります。

4. **新しいリリースを起動します。** すべてのDeploymentの`<tag>`を変更し、リリースノートに記載された変数を追加して、適用します。マニフェストを適用すると、ゼロにスケールしたレプリカ数が元に戻ります。
5. [インストール環境を確認する](../8-upgrading.md#5-インストール環境を確認する)で説明しているとおり、**インストール環境を確認します**。

代わりにアップグレードの間もプロセスを動かし続ける場合は、手順4で、[プロセスを置き換える](../8-upgrading.md#4-プロセスを置き換える)に示す順序でプロセスを置き換えます。`email-renderer`を動かしている場合はそれを最初に適用し、その後でほかのDeploymentを適用します。それらは、インストール環境が提供を続けている間に、1レプリカずつ順に入れ替わります。
