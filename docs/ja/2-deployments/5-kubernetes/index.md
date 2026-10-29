---
title: Kubernetes
description: Kubernetesクラスターでインストール環境を動かす。SecretとDeployment、その前に置くGatewayまたはIngressから、テナント管理画面への最初のログインまで。
published: 2026-10-29
source_updated: 2026-10-23
---

このページでは、Kubernetesクラスターの空のnamespaceから始めて、テナント管理画面に初めてログインするまでのインストール環境を構築します。手順は[インストール](../2-installing.md)と同じです。各手順がなぜ必要か、各シークレットが何を守るのか、各データベースロールが何にアクセスできるのかは、そちらで説明しています。また、[エッジ](../4-edge/index.md#エッジが行うべきこと)の要件どおりに、前段にエッジを置きます。このページで扱うのはクラスターに固有のことです。各部分がどのリソースになるのか、そして2つのページの各要件をそれらのリソースでどう満たすのかです。

以下のマニフェストは手直しして使うための例であり、メンテナンスされたセットではありません。リポジトリにはHelmチャートもKustomizeのベースもOperatorも同梱されていません。マニフェストは公開イメージ`ghcr.io/publira/<name>:<tag>`を指定しています。[始める前に](../2-installing.md#始める前に)のとおり、`<tag>`はインストールするリリースのバージョンに書き換えてください。

## クラスターで動くもの

長時間動き続けるプロセスはすべてDeploymentです。そのうち何かから呼び出されるものは、すべて同じ名前のServiceを通じて到達します。

| Deployment | イメージと引数 | ポート | Service | レプリカ数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | あり。エッジとWebアプリが呼び出します | 任意 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`、引数は`worker` | `8003`（プローブ専用） | なし。呼び出すものがありません | 任意 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | あり。エッジと、サーバーとワーカーからのキャッシュの再検証が呼び出します | 任意 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | あり。`web-storefront`と同じです | 任意 |
| `web-platform`（動かす場合） | `ghcr.io/publira/web-platform:<tag>` | `4100` | あり。`web-storefront`と同じです | 任意 |
| `email-renderer`（動かす場合） | `ghcr.io/publira/email-renderer:<tag>` | `8080` | あり。ワーカーが呼び出します | 任意 |

ワーカーは複数のレプリカで動かしてかまいません。定期ジョブはどれも、実行中の間は一意であるため、2つのレプリカが同じジョブを同時に実行することはないからです。また、ワーカーは繰り返し実行するジョブをすべて自分でスケジュールするため、インストール環境にCronJobは必要ありません。サーバーとワーカーの各レプリカはデータベースのログインごとにプールを開くため、レプリカを増やすには、より多くの接続を受け付けるデータベースが必要です。その計算は[コネクションプール](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)にあります。

`publira server`と`publira worker`は、1つの`publira server --with-worker`としてではなく、上の2つのDeploymentとして動かしてください。このフラグは1台のホストで動かすインストール環境のためのものです。クラスターで使うと、2つを別々にスケールできなくなるうえ、[概要](../1-overview.md#インストール環境が動かすもの)で説明しているとおり、エッジが転送する先のプロセスにワーカーのデータベースのログインを置くことになり、クラスターに必要なものは何も得られません。

`publiractl`は常駐させません。インストールするリリースのイメージから、JobとしてまたはアタッチするPodとして実行します。

## 始める前に

次のものが必要です。

- **クラスター。** ノードは、イメージが公開されている2つのプラットフォームである`linux/amd64`または`linux/arm64`で、`kubectl`がそのクラスターにログインしている必要があります。手順では`publira` namespaceで、Secret、Deployment、Service、Job、Podを作成・変更・削除し、Podのログを読み、Podにアタッチし、エッジのリソースを管理します。エッジのリソースとは、GatewayとHTTPRouteとEnvoy GatewayのHTTPRouteFilter、またはIngressと2つのTraefik Middlewareです。namespaceと、どのnamespaceにも属さない`ClusterIssuer`の作成、そしてcert-managerとエッジのコントローラーのインストールには、クラスター管理者が必要です。それ以外は、namespaceにバインドした組み込みの`admin`ロールで足ります。ただしカスタムリソースは別で、カスタムリソースはそのインストールがこのロールに追加した場合にだけ含まれます。Envoy Gatewayのインストールは、Gateway、HTTPRoute、独自のHTTPRouteFilterについて追加しません。
- **エッジとなるGateway APIの実装またはIngressコントローラー**と、証明書を発行する**cert-manager**。[Kubernetesでのエッジ](./1-edge.md)で説明しています。エッジのServiceにはインターネットから到達できる必要があり、通常は`LoadBalancer`タイプのServiceにします。
- **インストール環境が依存するサービス。** [サービスを用意する](../2-installing.md#サービスを用意する)の一覧のとおりに用意します。クラスター外のマネージドサービスでも、クラスター内で動かすものでもかまいません。データベースを所有しロールを作成できる管理用ログインを持つPostgreSQLデータベース、Valkeyインスタンス、空のバケットとその認証情報、SMTPサーバーです。インストール環境のすべてのPodがこれらに到達できる必要があります。
- テナントのドメインと、その管理画面のホスト（`admin.<domain>`、または`--admin-domain`で指定するホスト）の**DNS**。どちらも、エッジのServiceにアドレスが割り当てられたら、そのアドレスを指すようにします。

以下のコマンドはすべて`publira` namespaceで実行します。

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. Secretを作成する

インストール環境に必要なすべてのシークレットと、それぞれが何を守るのかは、[シークレットを生成する](../2-installing.md#シークレットを生成する)に一覧があります。同じ方法で一度だけ生成します。

```bash
ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"
AUTH_JWT_SECRET="$(openssl rand -base64 32)"
STOREFRONT_AUTH_SECRET="$(openssl rand -base64 32)"
ADMIN_AUTH_SECRET="$(openssl rand -base64 32)"
REVALIDATE_TOKEN="$(openssl rand -hex 32)"
WEB_SERVICE_TOKEN="$(openssl rand -base64 32)"
PUBLIC_DB_PASSWORD="$(openssl rand -hex 32)"
ADMIN_DB_PASSWORD="$(openssl rand -hex 32)"
PLATFORM_DB_PASSWORD="$(openssl rand -hex 32)"
OUTBOX_DB_PASSWORD="$(openssl rand -hex 32)"
TICKER_DB_PASSWORD="$(openssl rand -hex 32)"
CONTENT_STATS_DB_PASSWORD="$(openssl rand -hex 32)"
```

次に、各プロセスには自分が読むものだけを、専用のSecretで渡します。接続URLにはロールのパスワードが含まれるためシークレットであり、パスワードを含むRedisのURLも同様です。以下のホストとValkeyのURLは、自分のデータベースのホストとValkeyのURLに書き換えてください。

```bash
DB="db.internal:5432/publira?sslmode=require"
REDIS_URL="rediss://:<valkey password>@valkey.internal:6379"

kubectl create secret generic publira-encryption \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_KEYS="$ENCRYPTION_KEYS" \
  --from-literal=PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1

kubectl create secret generic publira-server \
  --from-literal=PUBLIRA_AUTH_JWT_SECRET="$AUTH_JWT_SECRET" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:$PUBLIC_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_ADMIN_DB_URL="postgres://publira_admin:$ADMIN_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_PLATFORM_DB_URL="postgres://publira_platform:$PLATFORM_DB_PASSWORD@$DB"

kubectl create secret generic publira-worker \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PUBLIRA_WORKER_DB_URL="postgres://publira_outbox:$OUTBOX_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_TICKER_DB_URL="postgres://publira_ticker:$TICKER_DB_PASSWORD@$DB" \
  --from-literal=PUBLIRA_CONTENT_STATS_DB_URL="postgres://publira_content_stats:$CONTENT_STATS_DB_PASSWORD@$DB"

kubectl create secret generic web-storefront \
  --from-literal=PUBLIRA_AUTH_SECRET="$STOREFRONT_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL"

kubectl create secret generic web-admin \
  --from-literal=PUBLIRA_AUTH_SECRET="$ADMIN_AUTH_SECRET" \
  --from-literal=PUBLIRA_REVALIDATE_TOKEN="$REVALIDATE_TOKEN" \
  --from-literal=PNCH_REDIS_URL="$REDIS_URL" \
  --from-literal=PUBLIRA_WEB_SERVICE_TOKEN="$WEB_SERVICE_TOKEN"

kubectl create secret generic publiractl \
  --from-literal=PUBLIRA_DB_URL="postgres://postgres:<administrative login password>@$DB"

kubectl create secret generic publira-db-roles \
  --from-literal=public="$PUBLIC_DB_PASSWORD" \
  --from-literal=admin="$ADMIN_DB_PASSWORD" \
  --from-literal=platform="$PLATFORM_DB_PASSWORD" \
  --from-literal=outbox="$OUTBOX_DB_PASSWORD" \
  --from-literal=ticker="$TICKER_DB_PASSWORD" \
  --from-literal=content-stats="$CONTENT_STATS_DB_PASSWORD"
```

| Secret | 読むもの | 方法 |
| --- | --- | --- |
| `publira-encryption` | `publira-server`、`publira-worker`、すべての`publiractl`の実行 | 環境変数として |
| `publira-server` | `publira-server`と`publiractl setup` | 環境変数として。`setup`は`secretKeyRef`で、ここから`PUBLIRA_PLATFORM_DB_URL`だけを取得します |
| `publira-worker` | `publira-worker` | 環境変数として |
| `web-storefront`、`web-admin` | 同じ名前のWebアプリ | 環境変数として |
| `publiractl` | `db`のJob | 環境変数として。[管理用ログイン](../2-installing.md#サービスを用意する)の接続である`PUBLIRA_DB_URL`だけを保持します。これを読むのは`db`コマンドだけであるため、ほかの`publiractl`コマンドにも、常駐するものにも渡しません |
| `publira-db-roles` | `db roles`のJob | ロールごとに1つのファイルとして。`db roles`が`--<role>-password-file`フラグで読み込みます |

クラスター内のSecretはバックアップではありません。暗号化キーは自分のシークレットストアにも保管してください。[シークレットを生成する](../2-installing.md#シークレットを生成する)にあるとおり、キーを失うと、インストール環境が保存したすべての認証情報を入力し直すことになります。シークレットを、クラスターが同期するストア（たとえば、ストアからSecretを書き出すOperatorを使う場合）に保管するなら、同じSecretを同じキーで書き出すようにしてください。

## 2. マイグレーションを適用する

`db migrate`は、管理用ログインの接続で、そのリリースの`publiractl`イメージからJobとして実行します。

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-migrate
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args: ["db", "migrate"]
          envFrom:
            - secretRef:
                name: publiractl
```

```bash
kubectl apply -f publira-db-migrate.yaml
kubectl wait --for=condition=Complete --timeout=10m job/publira-db-migrate
kubectl logs job/publira-db-migrate
```

`backoffLimit: 0`は、失敗したマイグレーションをKubernetesが勝手に再実行しないようにします。失敗した実行はデータベースにdirtyの印を残し、それは[マイグレーションが失敗したとき](../8-upgrading.md#マイグレーションが失敗したとき)の手順で手作業で解消します。`kubectl wait`はJobが失敗した場合もまだ実行中の場合も10分で待つのをやめるため、どちらの場合もログを読んでください。

Jobは一度作成すると変更できず、完了したか失敗したかにかかわらず、終了したJobはマニフェストを適用しても再実行されません。このJobは終了の1日後に削除されます。それまでの間にJobを再実行するとき（その復旧手順の最後のステップのように）は、まずJobを削除します。

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

以下の`db roles`と`setup`のJobも、同じ方法で再実行します。

## 3. ロールを作成する

`db roles`は、マイグレーションの後に同じ方法で実行します。ロールのパスワードは、ファイルとしてマウントした`publira-db-roles` Secretから読み込みます。

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publira-db-roles
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - db
            - roles
            - --public-password-file=/run/secrets/publira/public
            - --admin-password-file=/run/secrets/publira/admin
            - --platform-password-file=/run/secrets/publira/platform
            - --outbox-password-file=/run/secrets/publira/outbox
            - --ticker-password-file=/run/secrets/publira/ticker
            - --content-stats-password-file=/run/secrets/publira/content-stats
          envFrom:
            - secretRef:
                name: publiractl
          volumeMounts:
            - name: db-roles
              mountPath: /run/secrets/publira
              readOnly: true
      volumes:
        - name: db-roles
          secret:
            secretName: publira-db-roles
```

```bash
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl logs job/publira-db-roles
```

ログにはロールごとに1行が出力されます。後でロールのパスワードをローテーションするときも、同じJobを使います。`publira-db-roles`と、そのパスワードを含む接続URLの両方でパスワードを変更し、Jobを再実行して、そのロールで接続するDeploymentを再起動します。マイグレーションと同じく、再適用する前に終了したJobを削除してください。`publira-server`がURLを持つ`publira_admin`の場合は次のとおりです。

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. プロセスを起動する

各プロセスは、Secretを環境変数として受け取り、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)に一覧がある残りの変数をDeploymentで受け取ります。livenessプローブは`/livez`、readinessプローブは`/readyz`で、タイムアウトは[オーケストレーターからのプローブ](../../3-operations/11-monitoring.md#オーケストレーターからの監視)のとおりです。チェックを順に実行するサーバーとワーカーは6秒より長く、Webアプリは2秒より長くします。

`publira server`と`publira worker`は停止を指示されてから30秒以内に停止するため、DeploymentではKubernetesが強制終了するまでの時間を、既定の30秒ではなく45秒にしています。また`publira-server`は、まず`preStop`フックで5秒待ちます。これにより、リクエストの受け付けをやめる前に、エッジがリクエストを送らなくなります。両方が必要な理由は[コピーを停止する](../7-scaling-out.md#コピーを停止する)で説明しています。フックは`sleep`アクションを使います。このアクションはイメージにシェルを必要とせず、Kubernetesはバージョン1.30以降で実行します。

`publira-server.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-server
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-server
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-server
          image: ghcr.io/publira/publira:<tag>
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
                name: publira-server
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
  name: publira-server
spec:
  selector:
    app.kubernetes.io/name: publira-server
  ports:
    - name: http
      port: 8000
      targetPort: http
```

`PUBLIRA_TRUSTED_PROXIES`は、クラスターがPodにアドレスを割り当てる範囲で、プロバイダーはクラスターのPodのアドレス範囲として表示しています。これを設定する理由は[クライアントのアドレス](./1-edge.md#クライアントのアドレス)で説明しています。

Serviceを必要としない`publira-worker.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: publira-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: publira-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: publira-worker
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: publira-worker
          image: ghcr.io/publira/publira:<tag>
          args: ["worker"]
          ports:
            - name: health
              containerPort: 8003
          envFrom:
            - secretRef:
                name: publira-encryption
            - secretRef:
                name: publira-worker
          env:
            - name: PUBLIRA_WEB_STOREFRONT_INTERNAL_URL
              value: http://web-storefront:3000
            - name: PUBLIRA_WEB_ADMIN_INTERNAL_URL
              value: http://web-admin:4000
          livenessProbe:
            httpGet:
              path: /livez
              port: health
          readinessProbe:
            httpGet:
              path: /readyz
              port: health
            timeoutSeconds: 8
```

2つのWebアプリも同じ形で、どちらもServiceを通じて`publira server`を呼び出します。`web-storefront.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: web-storefront
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web-storefront
    spec:
      containers:
        - name: web-storefront
          image: ghcr.io/publira/web-storefront:<tag>
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: web-storefront
          env:
            - name: PUBLIRA_GRPC_URL
              value: http://publira-server:8000/rpc
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
            timeoutSeconds: 3
---
apiVersion: v1
kind: Service
metadata:
  name: web-storefront
spec:
  selector:
    app.kubernetes.io/name: web-storefront
  ports:
    - name: http
      port: 3000
      targetPort: http
```

`web-storefront`は、テナントのGoogleタグゲートウェイに渡す読者のアドレスを特定するために、`publira server`と同じ`PUBLIRA_TRUSTED_PROXIES`を受け取ります。`web-admin.yaml`は、`web-storefront`が出てくる箇所をすべて`web-admin`にし（これでSecretの名前も変わります）、`3000`の代わりにポート`4000`を使い、`PUBLIRA_TRUSTED_PROXIES`を省いたものです。`web-admin`はこの変数を読みません。

すべてを適用し、すべてのDeploymentの準備ができるまで待ちます。

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker`はジョブキューのテーブルを起動時に作成するため、専用のJobは必要ありません。準備ができないDeploymentは、そのPodの`/readyz`と、ログの`readiness check failed`の行に理由を示します。パスワードが接続URLと一致しないロールは、そこに`db.public`などのログインとして示されます。

## 5. インストール環境をセットアップする

`publiractl setup`は一度だけ実行します。すべての値を尋ねるターミナルにアタッチして実行するか、すべての値をフラグで渡すJobとして実行します。どちらも、`publira-server` Secretの`PUBLIRA_PLATFORM_DB_URL`を使って`publira_platform`として接続し、保存するものを暗号化キーで封印します。そのため、どちらもプロセスと同じ`publira-encryption` Secretを読みます。どちらにも`publiractl` Secretは渡しません。`setup`が管理用ログインで接続することはないためです。

どちらの方法でも、出力はコンテナのログに送られ、クラスターのログ収集がそれを保管する場合があります。そのため、管理者のパスワードは生成させずに指定してください。生成されたパスワードはサマリーに出力されます。プロンプトで入力したパスワードはエコーされず、ファイルで渡したパスワードは出力されません。

ターミナルで実行するには、アタッチするPodで実行します。このPodは終了時に削除されます。

```bash
kubectl run publiractl-setup --rm -it --restart=Never \
  --image=ghcr.io/publira/publiractl:<tag> \
  --overrides='{
    "apiVersion": "v1",
    "spec": {
      "containers": [{
        "name": "publiractl-setup",
        "image": "ghcr.io/publira/publiractl:<tag>",
        "args": ["setup"],
        "stdin": true,
        "tty": true,
        "envFrom": [{"secretRef": {"name": "publira-encryption"}}],
        "env": [{
          "name": "PUBLIRA_PLATFORM_DB_URL",
          "valueFrom": {"secretKeyRef": {"name": "publira-server", "key": "PUBLIRA_PLATFORM_DB_URL"}}
        }]
      }]
    }
  }'
```

無人で実行するには、すべての値をフラグで渡し、保存されるシークレット（管理者のパスワードを含む）を専用のSecretからファイルとして渡します。

```bash
kubectl create secret generic publiractl-setup \
  --from-literal=secret-access-key='<the object store secret key>' \
  --from-literal=smtp-password='<the SMTP password>' \
  --from-literal=admin-password="$(openssl rand -base64 18)"
```

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: publiractl-setup
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: publiractl
          image: ghcr.io/publira/publiractl:<tag>
          args:
            - setup
            - --non-interactive
            - --default-locale=en
            - --bucket=publira-images
            - --region=us-east-1
            - --access-key-id=<the object store access key>
            - --secret-access-key-file=/run/secrets/setup/secret-access-key
            - --host=smtp.example.com
            - --port=587
            - --encryption=starttls
            - --username=mailer
            - --smtp-password-file=/run/secrets/setup/smtp-password
            - --from-address=no-reply@example.com
            - --tenant-name=Example Comics
            - --domain=comics.example.com
            - --admin-email=owner@comics.example.com
            - --admin-name=Owner
            - --admin-password-file=/run/secrets/setup/admin-password
          envFrom:
            - secretRef:
                name: publira-encryption
          env:
            - name: PUBLIRA_PLATFORM_DB_URL
              valueFrom:
                secretKeyRef:
                  name: publira-server
                  key: PUBLIRA_PLATFORM_DB_URL
          volumeMounts:
            - name: setup
              mountPath: /run/secrets/setup
              readOnly: true
      volumes:
        - name: setup
          secret:
            secretName: publiractl-setup
```

```bash
kubectl apply -f publiractl-setup.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publiractl-setup
kubectl logs job/publiractl-setup
```

Amazon S3以外のストアを使う場合は、`--endpoint`でそのURLを追加し、パスでバケットを指定するストアなら`--force-path-style`も追加します。すべてのフラグと省略できる手順は、[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)に一覧があります。

たとえば接続テストを拒否するオブジェクトストレージで途中で止まった実行は、保存したものを保持しているため、原因を直してから再実行すれば完了します。マイグレーションと同じく、失敗したJobを削除してから再適用してください。

管理者のパスワードは、`publiractl-setup` Secretの`admin-password`キーです。管理者がログインしてパスワードを変更したら、このSecretを削除してください。その後これを読むものはありません。

## 6. 前段にエッジを置く

エッジは、ホストとパスごとに適切なServiceへルーティングし、TLSを終端し、呼び出し元が選んではならないヘッダーを取り除きます。[Kubernetesでのエッジ](./1-edge.md)では、cert-managerが証明書を発行するGatewayまたはIngressとしてエッジを前段に置き、クラスターの外から確認します。その確認が通ったら、ログインするためにこのページに戻ってきてください。

## 7. ログインする

`https://admin.comics.example.com`、または`--admin-domain`で指定した管理画面のホストでテナント管理画面を開き、管理者のメールアドレスとパスワードでログインします。ここから先のインストール環境は、[ログインする](../2-installing.md#6-ログインする)で説明しているものと同じです。

## このセクションの内容

- [Kubernetesでのエッジ](./1-edge.md)：証明書、Serviceの前に置くGatewayまたはIngress、クライアントのアドレス、クラスターの外からのエッジの確認。
- [Kubernetesでの運用](./2-operating.md)：テナントの追加、管理画面の認証情報をテナントのドメインに置かないこと、メトリクス、アップグレード。

## 次のステップ

GatewayまたはIngressが果たすべきことの全体は[エッジ](../4-edge/index.md)に、インストール環境が稼働を始めた後に監視すべきことは[モニタリング](../../3-operations/11-monitoring.md)にあります。各プロセスが読む変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。オプションのプロセスは、[オプションのプロセスを有効にする](../2-installing.md#オプションのプロセスを有効にする)のとおりに、それぞれ上と同じようなDeploymentとServiceとして有効にします。
