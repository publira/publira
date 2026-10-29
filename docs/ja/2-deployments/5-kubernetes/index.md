---
title: Kubernetes
description: Kubernetesクラスターで、SecretとDeploymentを作成し、その前段にGatewayかIngressを置いて、テナント管理画面に初めてログインするまでの手順を説明します。
published: 2026-10-29
source_updated: 2026-10-23
---

このページでは、Kubernetesクラスターの空のnamespaceから始めて、テナント管理画面に初めてログインできるまでPubliraを構築します。手順は[インストール](../2-installing.md)と同じです。各手順が必要な理由、各シークレットが守るもの、各データベースロールがアクセスできる範囲は、そちらで説明しています。リバースプロキシは、[リバースプロキシの設定](../4-edge/index.md#リバースプロキシで必要な設定)の要件どおりに前段に置きます。このページで扱うのは、クラスターに固有の部分です。Publiraの各部分をどのリソースで動かすか、2つのページの要件をそのリソースでどう満たすかを説明します。

以下のマニフェストは手直しして使うための例で、継続的にメンテナンスしているものではありません。リポジトリには、HelmチャートもKustomizeのベースもOperatorもありません。マニフェストでは公開イメージ`ghcr.io/publira/<name>:<tag>`を指定しています。[始める前に](../2-installing.md#始める前に)の説明のとおり、`<tag>`はインストールするリリースのバージョンに書き換えてください。

## クラスターで動かすもの

常駐するプロセスは、すべてDeploymentとして動かします。ほかから呼び出されるプロセスには、同じ名前のServiceを通じて接続します。

| Deployment | イメージと引数 | ポート | Service | レプリカ数 |
| --- | --- | --- | --- | --- |
| `publira-server` | `ghcr.io/publira/publira:<tag>` | `8000` | あり。リバースプロキシとWebアプリが呼び出します | 任意 |
| `publira-worker` | `ghcr.io/publira/publira:<tag>`、引数は`worker` | `8003`(プローブ専用) | なし。呼び出し元がありません | 任意 |
| `web-storefront` | `ghcr.io/publira/web-storefront:<tag>` | `3000` | あり。リバースプロキシが呼び出すほか、サーバーとワーカーがキャッシュの再検証で呼び出します | 任意 |
| `web-admin` | `ghcr.io/publira/web-admin:<tag>` | `4000` | あり。呼び出し元は`web-storefront`と同じです | 任意 |
| `web-platform`(動かす場合) | `ghcr.io/publira/web-platform:<tag>` | `4100` | あり。呼び出し元は`web-storefront`と同じです | 任意 |
| `email-renderer`(動かす場合) | `ghcr.io/publira/email-renderer:<tag>` | `8080` | あり。ワーカーが呼び出します | 任意 |

ワーカーは複数のレプリカで動かせます。定期ジョブは実行中は一意になるので、2つのレプリカが同じジョブを同時に実行することはありません。繰り返し実行するジョブもワーカーが自分でスケジュールするので、CronJobは必要ありません。サーバーとワーカーの各レプリカは、データベースのログインごとにコネクションプールを開きます。そのため、レプリカを増やすには、より多くの接続を受け付けるデータベースが必要です。必要な接続数の計算は[コネクションプール](https://github.com/publira/publira/blob/main/server/README.md#connection-pools)にあります。

`publira server`と`publira worker`は、1つの`publira server --with-worker`ではなく、上の2つのDeploymentとして動かしてください。このフラグは1台のホストで動かす構成のためのものです。クラスターで使うと、2つを別々にスケールできなくなります。さらに[構成の概要](../1-overview.md#publiraで動かすプロセス)で説明しているとおり、リバースプロキシの転送先のプロセスが、ワーカーのデータベースのログインを持つことになります。クラスターにとって得るものはありません。

`publiractl`は常駐させません。インストールするリリースのイメージから、JobとしてかアタッチするPodとして実行します。

## 始める前に

次のものが必要です。

- **クラスター**。ノードは、イメージを公開している2つのプラットフォーム`linux/amd64`か`linux/arm64`にします。`kubectl`でクラスターにログインしておきます。手順の中では`publira` namespaceで、Secret、Deployment、Service、Job、Podを作成、変更、削除し、Podのログを読み、Podにアタッチし、リバースプロキシのリソースを管理します。リバースプロキシのリソースとは、GatewayとHTTPRouteとEnvoy GatewayのHTTPRouteFilter、またはIngressと2つのTraefikのMiddlewareです。namespaceの作成と、namespaceに属さない`ClusterIssuer`の作成、cert-managerとリバースプロキシのコントローラーのインストールには、クラスター管理者の権限が必要です。それ以外の操作は、namespaceにバインドした組み込みの`admin`ロールでできます。ただしカスタムリソースを操作できるのは、そのリソースをインストールしたときに`admin`ロールへ権限が追加された場合だけです。Envoy Gatewayのインストールでは、Gateway、HTTPRoute、Envoy Gateway独自のHTTPRouteFilterの権限は追加されません。
- リバースプロキシになる**Gateway APIの実装かIngressコントローラー**と、証明書を発行する**cert-manager**。詳しくは[Kubernetesでのリバースプロキシの設定](./1-edge.md)で説明します。リバースプロキシのServiceには、インターネットから接続できる必要があります。通常は`LoadBalancer`タイプのServiceにします。
- **Publiraが依存するサービス**。[サービスを用意する](../2-installing.md#サービスを用意する)の一覧のとおりに用意します。クラスター外のマネージドサービスでも、クラスター内で動かすものでもかまいません。必要なのは、データベースを所有しロールを作成できる管理用ログインのあるPostgreSQLデータベース、Valkeyインスタンス、空のバケットとその認証情報、SMTPサーバーです。PubliraのすべてのPodから、これらに接続できる必要があります。
- テナントのドメインと管理画面のホストの**DNS**。管理画面のホストは`admin.<domain>`か、`--admin-domain`で指定するホストです。リバースプロキシのServiceにアドレスが割り当てられたら、どちらもそのアドレスに向けます。

以下のコマンドは、すべて`publira` namespaceで実行します。

```bash
kubectl create namespace publira
kubectl config set-context --current --namespace=publira
```

## 1. Secretを作成する

Publiraに必要なシークレットと、それぞれが守るものは、[シークレットを生成する](../2-installing.md#シークレットを生成する)に一覧があります。同じ方法で、一度だけ生成します。

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

次に、各プロセスが読む値だけを、プロセスごとのSecretにして渡します。接続URLにはロールのパスワードが入るので、接続URLもシークレットです。RedisのURLも、パスワードを含む場合はシークレットです。以下のデータベースのホストとValkeyのURLは、実際のものに書き換えてください。

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

| Secret | 読むもの | 渡し方 |
| --- | --- | --- |
| `publira-encryption` | `publira-server`、`publira-worker`、すべての`publiractl`の実行 | 環境変数 |
| `publira-server` | `publira-server`と`publiractl setup` | 環境変数。`setup`は`secretKeyRef`で`PUBLIRA_PLATFORM_DB_URL`だけを読みます |
| `publira-worker` | `publira-worker` | 環境変数 |
| `web-storefront`、`web-admin` | 同じ名前のWebアプリ | 環境変数 |
| `publiractl` | `db`のJob | 環境変数。[管理用ログイン](../2-installing.md#サービスを用意する)の接続情報`PUBLIRA_DB_URL`だけを入れます。この変数を読むのは`db`コマンドだけなので、ほかの`publiractl`コマンドにも、常駐するプロセスにも渡しません |
| `publira-db-roles` | `db roles`のJob | ロールごとに1つのファイル。`db roles`が`--<role>-password-file`フラグで読み込みます |

クラスター内のSecretはバックアップになりません。暗号化キーは、自分で管理するシークレットストアにも保管してください。[シークレットを生成する](../2-installing.md#シークレットを生成する)にあるとおり、キーを失うと、Publiraに保存したすべての認証情報を入力し直すことになります。シークレットをストアで管理してクラスターに同期する場合(ストアからSecretを書き出すOperatorを使う場合など)は、同じ名前のSecretに同じキー名で書き出すようにしてください。

## 2. マイグレーションを適用する

`db migrate`は、そのリリースの`publiractl`イメージを使い、管理用ログインの接続でJobとして実行します。

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

`backoffLimit: 0`を指定すると、失敗したマイグレーションをKubernetesが自動で再実行しなくなります。マイグレーションが失敗するとデータベースにdirtyの印が残り、[マイグレーションが失敗したとき](../8-upgrading.md#マイグレーションが失敗したとき)の手順に従って手作業で解消する必要があります。`kubectl wait`は、Jobが失敗した場合もまだ実行中の場合も、10分で待つのをやめます。どちらの場合も、ログを確認してください。

Jobは作成後に変更できません。また、完了したか失敗したかにかかわらず、終了したJobはマニフェストを適用し直しても再実行されません。このJobは終了の1日後に削除されます。それまでに再実行するとき(マイグレーションが失敗したときの復旧手順の最後のステップなど)は、まずJobを削除します。

```bash
kubectl delete job publira-db-migrate --ignore-not-found
kubectl apply -f publira-db-migrate.yaml
```

以下の`db roles`と`setup`のJobも、同じ方法で再実行します。

## 3. ロールを作成する

マイグレーションの後に、`db roles`を同じ方法で実行します。ロールのパスワードは、ファイルとしてマウントした`publira-db-roles`のSecretから読み込みます。

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

ログには、ロールごとに1行が出力されます。後でロールのパスワードをローテーションするときも、このJobを使います。`publira-db-roles`と、そのパスワードを含む接続URLの両方でパスワードを変更し、Jobを再実行してから、そのロールで接続するDeploymentを再起動します。マイグレーションと同じく、終了したJobは削除してから適用し直してください。`publira-server`が接続URLを持つ`publira_admin`の場合は、次のとおりです。

```bash
kubectl delete job publira-db-roles --ignore-not-found
kubectl apply -f publira-db-roles.yaml
kubectl wait --for=condition=Complete --timeout=5m job/publira-db-roles
kubectl rollout restart deployment/publira-server
```

## 4. プロセスを起動する

各プロセスには、Secretを環境変数として渡し、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にあるそのほかの変数をDeploymentで設定します。livenessプローブには`/livez`、readinessプローブには`/readyz`を使い、タイムアウトは[オーケストレーターからの監視](../../3-operations/11-monitoring.md#オーケストレーターからのプローブ)のとおりにします。サーバーとワーカーはチェックを順に実行するので6秒より長く、Webアプリは2秒より長くします。

`publira server`と`publira worker`は、停止を指示されてから30秒以内に停止します。そのためDeploymentでは、Kubernetesが強制終了するまでの猶予を、既定の30秒ではなく45秒にしています。さらに`publira-server`は、まず`preStop`フックで5秒待ちます。こうすると、`publira-server`がリクエストの受け付けをやめる前に、リバースプロキシがリクエストを送らなくなります。両方が必要な理由は[コピーを停止する](../7-scaling-out.md#インスタンスを停止する)で説明しています。フックには`sleep`アクションを使います。`sleep`アクションはイメージにシェルがなくても動き、Kubernetes 1.30以降で使えます。

`publira-server.yaml`の内容は次のとおりです。

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

`PUBLIRA_TRUSTED_PROXIES`には、クラスターがPodにアドレスを割り当てる範囲を指定します。クラウドプロバイダーでは、クラスターのPodのアドレス範囲として表示されます。設定する理由は[クライアントのアドレス](./1-edge.md#クライアントのアドレス)で説明しています。

`publira-worker.yaml`の内容は次のとおりです。ワーカーにはServiceは必要ありません。

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

2つのWebアプリも同じ形で、どちらもServiceを通じて`publira server`を呼び出します。`web-storefront.yaml`の内容は次のとおりです。

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

`web-storefront`にも、`publira server`と同じ`PUBLIRA_TRUSTED_PROXIES`を設定します。テナントのGoogleタグゲートウェイに渡す読者のアドレスを判断するためです。`web-admin.yaml`は、`web-storefront`をすべて`web-admin`に置き換え(Secretの名前も変わります)、ポートを`3000`から`4000`に変え、`PUBLIRA_TRUSTED_PROXIES`を削除したものです。`web-admin`はこの変数を読みません。

すべて適用し、すべてのDeploymentの準備ができるまで待ちます。

```bash
kubectl apply -f publira-server.yaml -f publira-worker.yaml -f web-storefront.yaml -f web-admin.yaml
kubectl rollout status deployment/publira-server deployment/publira-worker deployment/web-storefront deployment/web-admin
```

`publira-worker`は起動時にジョブキューのテーブルを作成するので、専用のJobは必要ありません。準備ができないDeploymentは、Podの`/readyz`とログの`readiness check failed`の行に理由を出力します。ロールのパスワードが接続URLと一致しない場合は、`db.public`などのログイン名がそこに出力されます。

## 5. Publiraをセットアップする

`publiractl setup`は一度だけ実行します。実行方法は2つあります。ターミナルにアタッチして、すべての値を対話的に入力する方法と、すべての値をフラグで渡してJobとして実行する方法です。どちらも`publira-server`のSecretにある`PUBLIRA_PLATFORM_DB_URL`を使って`publira_platform`として接続し、保存する値を暗号化キーで暗号化します。そのため、どちらの方法でも、プロセスと同じ`publira-encryption`のSecretを読みます。`setup`は管理用ログインでは接続しないので、どちらの方法でも`publiractl`のSecretは渡しません。

どちらの方法でも、出力はコンテナのログに書かれ、クラスターのログ収集で保管される場合があります。そのため、管理者のパスワードは自動生成させずに指定してください。自動生成したパスワードは、最後の概要に出力されます。プロンプトで入力したパスワードは画面に表示されず、ファイルで渡したパスワードは出力されません。

ターミナルで実行する場合は、アタッチするPodで実行します。このPodは終了すると削除されます。

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

無人で実行する場合は、すべての値をフラグで渡します。保存するシークレットは、管理者のパスワードも含めて、専用のSecretからファイルとして渡します。

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

Amazon S3以外のストレージを使う場合は、`--endpoint`でそのURLを追加します。パス形式でバケットを指定するストレージでは、`--force-path-style`も追加します。すべてのフラグと、省略できる手順は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。

オブジェクトストレージが接続テストを拒否した場合などに実行が途中で止まっても、それまでに保存した値は残ります。原因を直してから再実行すれば完了します。マイグレーションと同じく、失敗したJobを削除してから適用し直してください。

管理者のパスワードは、`publiractl-setup`のSecretの`admin-password`キーにあります。管理者がログインしてパスワードを変更したら、このSecretは削除してください。以降はどこからも読まれません。

## 6. リバースプロキシを置く

リバースプロキシは、ホストとパスに応じて適切なServiceにルーティングし、TLSを終端し、呼び出し元に指定させてはならないヘッダーを削除します。[Kubernetesでのリバースプロキシの設定](./1-edge.md)では、cert-managerで証明書を発行するGatewayかIngressをリバースプロキシとして前段に置き、クラスターの外から動作を確認します。確認が済んだら、このページに戻ってログインします。

## 7. ログインする

`https://admin.comics.example.com`(`--admin-domain`で管理画面のホストを指定した場合はそのホスト)でテナント管理画面を開き、管理者のメールアドレスとパスワードでログインします。ここから先は、[インストールのログインの手順](../2-installing.md#6-ログインする)を済ませた後と同じです。

## このセクションのページ

- [Kubernetesでのリバースプロキシの設定](./1-edge.md)では、証明書、Serviceの前段に置くGatewayかIngress、クライアントのアドレス、クラスターの外からの確認方法を説明します。
- [Kubernetesでの運用](./2-operating.md)では、テナントの追加、テナントのドメインから管理画面の認証情報を切り離す方法、メトリクス、アップグレードを説明します。

## 次のステップ

GatewayやIngressに必要な設定の全体は[リバースプロキシの設定](../4-edge/index.md)に、運用を始めた後に監視すべきことは[監視](../../3-operations/11-monitoring.md)にあります。各プロセスが読む変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。オプションのプロセスは、[オプションのプロセスを有効にする](../2-installing.md#追加のプロセスを有効にする)の説明のとおり、それぞれ上と同じようにDeploymentとServiceで動かします。
