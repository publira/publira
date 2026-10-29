---
title: Docker Compose
description: 各リリースが公開するComposeファイルで、インストール環境全体を1台のホストで動かす。ダウンロードから、テナント管理画面への最初のログインまで。
published: 2026-10-29
source_updated: 2026-10-28
---

各リリースは、インストール環境全体を1台のホストで動かすComposeファイルを公開しています。Publiraが依存するサービス、インストール環境のプロセス、その前に置くリバースプロキシが、すでに互いに接続された状態で含まれています。動くインストール環境を手にする最短の方法で、このページでは空のホストからテナント管理画面への最初のログインまでを説明します。

Composeファイルは[インストール](./2-installing.md)と同じ手順を実行します。各手順がなぜ必要か、各シークレットが何を保護するか、各データベースロールが何にアクセスできるかは、そちらで説明しています。このページで扱うのは、Composeファイルに固有のこと、つまり何を動かすか、何を設定するか、起動するためのコマンドです。Composeファイルが読む変数の完全な一覧は、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。

## ファイルが動かすもの

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)は次のサービスを定義しています。

| サービス | 内容 | ホストに保持するもの |
| --- | --- | --- |
| `postgres` | PostgreSQL。インストール環境が保存するすべてのものを保持します | `postgres-data`ボリューム |
| `valkey` | Valkey。画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュを保持します | なし。再起動のたびに空の状態で始まります |
| `rustfs` | [RustFS](https://github.com/rustfs/rustfs)。S3互換のオブジェクトストレージで、アップロードされたすべての画像を保持します | `rustfs-data`ボリューム |
| `proxy` | Caddy。リポジトリ独自のルーティングを持つリバースプロキシで、あなたのホスト名の証明書を取得・更新します | 証明書を保持する`caddy-data`ボリューム |
| `server` | `publira server`と`publira worker`を1つのプロセスにした`publira server --with-worker`。[概要](./1-overview.md#インストール環境が動かすもの)で説明しています | なし |
| `web-storefront`、`web-admin` | 公開サイトとテナント管理画面 | なし |
| `web-platform`、`email-renderer` | オプションのプロセス。有効にしたときだけ動きます | なし |
| `publiractl` | コマンドラインツール。常駐はせず、`docker compose run --rm publiractl <command>`で実行します | なし |
| `setup` | インストール環境のデータベースのパスワードとRustFSのバケットをあらかじめ渡した`publiractl setup`。常駐はせず、`docker compose run --rm setup`で実行します | なし |

サーバーとワーカーは1つのプロセスとして動くので、ホストで動かすコンテナが1つ少なくなります。別々にスケールさせたい場合や、ワーカーのデータベースのログインをプロキシの転送先のプロセスから切り離したい場合など、そのどちらかがインストール環境にとって重要なときは、2つに分けて動かしてください。2つのそれぞれが読む変数は、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)に一覧があります。

プロキシはホストのすべてのインターフェースでポート80と443を公開し、インターネットからアクセスできる唯一のサービスです。指定したホスト名に対してHTTPSを提供し、プレーンなHTTPはそこへリダイレクトします。それ以外のサービスには、他のサービスからしかアクセスできません。

サービスは2つのDockerネットワークに分かれています。`edge`にはプロキシと、その転送先である`server`とWebアプリがあります。`default`にはプロキシ以外のすべてのサービスがあります。そのためプロキシはデータベースにもValkeyにも到達できず、プロキシに欠陥があってもそれがどちらかへの侵入口にはなりません。

プロジェクト名は`publira-deploy`に固定されているため、どのディレクトリから実行しても、実行するどのコマンドでもボリュームの名前は変わらず、1台のホストでは1つのインストール環境を動かします。

## 始める前に

次のものが必要です。

- **Docker EngineとComposeプラグイン**（`docker compose`）があるホスト。イメージが公開されている2つのプラットフォームである`linux/amd64`または`linux/arm64`のものです。それ以外のプラットフォームでは最初のpullが`no matching manifest`で失敗するので、[イメージ](#イメージ)で説明しているとおり、そのプラットフォーム向けにビルドしたイメージを代わりに動かします。
- **インストールするリリース**。[Releases](https://github.com/publira/publira/releases)ページのそのリリースに`publira-deploy-<version>.tar.gz`として添付されており、[Composeファイルをダウンロードする](#composeファイルをダウンロードする)で取得します。ホストにはリポジトリの他のものは必要ありません。
- **ホストから`ghcr.io`へのアクセス**。各リリースはここにイメージを公開しています。`docker compose`は、コマンドが最初にイメージを必要としたときにログインせずにpullするので、ホストで何かをビルドすることはありません。
- **SMTPサーバー**。`publiractl setup`が尋ねます。ホスト、ポート、暗号化方式、メールの送信元アドレス、そしてログインに使うユーザー名とパスワードです。ただし、認証情報なしで中継するサーバーではユーザー名とパスワードは不要です。
- テナントのドメインと、その管理画面ホスト（`admin.<domain>`、または`--admin-domain`で指定するもの）の**DNS**。どちらもホストを指すようにします。
- **インターネットに開いたポート80と443**。ホスト上の他のものがどちらのポートでも待ち受けていない必要があります。プロキシは両方のポートで応答し、認証局は証明書を発行する前に、どちらかのポートで各ホスト名を確認します。

## Composeファイルをダウンロードする

インストールするリリースのアーカイブをダウンロードします。`<version>`はそのバージョン、つまりタグから`v`を除いたもので、`v0.1.0`なら`0.1.0`です。続いてアーカイブを展開し、展開されたディレクトリに移動します。

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

このディレクトリには、`compose.yaml`、`.env.example`、プロキシの`Caddyfile`、変数の完全な一覧を載せた`README.md`が入っています。このページのコマンドはすべてこのディレクトリで実行します。

コードに手を加える場合は、代わりにリリースのタグでチェックアウトしたリポジトリの`infra/deploy/`からインストール環境を動かします。そこには同じファイルがありますが、`Caddyfile`は`infra/proxy/`へのリンクになっているため、`infra/deploy/`だけをコピーして取り出さず、チェックアウト全体を残しておいてください。

## `.env`を書く

ファイルが必要とする値はすべて、その横にある`.env`ファイルから読まれます。`publiractl env generate`は、ファイルが読むすべての変数をそれぞれのコメント付きで列挙した`.env.example`からこのファイルを書き出し、すべてのシークレットにそれぞれ専用の値を入れます。インストールするリリースの`publiractl`イメージで実行してください。`<version>`は、[Composeファイルをダウンロードする](#composeファイルをダウンロードする)と同じくリリースのバージョンです。

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

出力されるのは`Wrote .env with 17 secrets generated.`だけです。イメージはあなたのユーザーとして動くのでファイルの所有者はあなたになり、あなただけが読める状態で作成されます。既存の`.env`は、インストール環境のデータを暗号化しているキーを含んでいる可能性があるため、上書きを拒否します。この手順は`docker compose run`では実行できません。`.env`に次の3つのセクションで設定する値がない間は、このコマンドが停止してしまうためです。

`.env`にはインストール環境のすべてのシークレット（暗号化キーを含む）が入っているので、ホスト以外の場所にコピーを保管してください。

あなたが設定する値として残っているのは3つです。2つのホストの一覧である`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`、そしてHTTPSを有効にする`PUBLIRA_EDGE_ACME_EMAIL`です。チェックアウトでは`PUBLIRA_IMAGE_TAG`が4つ目になります。

### イメージ

`PUBLIRA_IMAGE_REGISTRY`と`PUBLIRA_IMAGE_TAG`は、イメージを`<registry>/<name>:<tag>`として指定します。例にあるレジストリ`ghcr.io/publira`は、各リリースがイメージを公開する場所なので、そのままにしてください。タグはすでにダウンロードしたリリースのバージョンになっています。たとえば`v0.1.0`のアーカイブなら`0.1.0`です。

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

これもそのままにしてください。すべてのイメージがこの1つのタグで動き、それは`.env`の横にあるファイルと一致している必要があります。`publiractl`にはそのリリースのマイグレーションが含まれ、プロセスはそのリリースのスキーマを想定し、プロキシは横にある`Caddyfile`のルーティングで動くからです。チェックアウトでは`.env.example`のタグは空なので、チェックアウトしたリリースのバージョンを設定してください。

コードに手を加える場合や、ホストが`linux/amd64`でも`linux/arm64`でもない場合は、代わりに[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従ってイメージを自分でビルドし、両方の変数をその場所に設定します。プッシュ先のレジストリのアドレス（`registry.example.com/publira`など）と独自のタグか、`task docker:verify:full`がホスト自体でビルドするイメージなら`publira`と`local`です。

### HTTPSとテナントのURLスキーム

`PUBLIRA_EDGE_ACME_EMAIL`はHTTPSを有効にします。プロキシが認証局にアカウントを登録するときに使う、あなたのアドレスを設定してください。

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

するとプロキシは、ホストの一覧にあるすべてのホスト名の証明書を[Let's Encrypt](https://letsencrypt.org/)から（Let's Encryptで失敗した場合はZeroSSLから）取得し、期限が切れる前にそれぞれ更新し、ポート443でHTTPSを提供し、ポート80のプレーンなHTTPをそこへリダイレクトします。空のままにすると、プロキシはプレーンなHTTPだけを提供します。それが必要になるのは[1台のマシンで試す](#1台のマシンで試す)と[前に置くCDNやロードバランサー](#前に置くcdnやロードバランサー)の場合だけです。

`PUBLIRA_EDGE_HTTP_PORT`と`PUBLIRA_EDGE_HTTPS_PORT`は、プロキシが公開するポートで、`80`と`443`です。プロキシが証明書を取得する間はこのままにしてください。認証局はこのポートでしかプロキシに到達しません。

ブラウザーがHTTPSでインストール環境にアクセスする場合は、`PUBLIRA_TENANT_URL_SCHEME`を空のままにします。これはメールや`setup`の概要の中でPubliraが組み立てるリンクのスキームです。`http`に設定するのは、[1台のマシンで試す](#1台のマシンで試す)のように、ブラウザーが実際にHTTPでインストール環境を開く場合だけにしてください。

### ホスト名

`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`は、プロキシがテナントのサイトとテナント管理画面にルーティングするホスト名です。テナントのドメイン（`comics.example.com`など）と、その管理画面ホスト（`--admin-domain`で別のものを指定しない限り`admin.comics.example.com`）です。名前はポートを付けずに書きます。どちらの変数もスペース区切りで複数の名前（テナントごとに1つ）を受け取り、どちらにもないホストに対しては、プロキシが独自の404で応答します。

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`はプラットフォーム管理画面のもので、それを動かさない限り空のままです。`PUBLIRA_EDGE_IMAGE_HOSTS`には、[画像ホスト](../3-operations/2-tenants.md#画像ホスト)で説明しているとおり画像ホストを与えた各テナントのその画像ホストを入れ、与えるまでは空のままです。プロキシはそれらのホストでは`/images`だけを転送します。`PUBLIRA_EDGE_ACME_EMAIL`を設定すると、プロキシはこの4つの変数にあるすべての名前の証明書を取得します。

### シークレット

`env generate`は次の値を入れています。どれも、他のどのインストール環境とも共有しない新しい値です。

| 変数 | 生成された値 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32バイトのランダムな値のhex |
| `PUBLIRA_PUBLIC_DB_PASSWORD`、`PUBLIRA_ADMIN_DB_PASSWORD`、`PUBLIRA_PLATFORM_DB_PASSWORD`、`PUBLIRA_OUTBOX_DB_PASSWORD`、`PUBLIRA_TICKER_DB_PASSWORD`、`PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32バイトのランダムな値のhex（それぞれ1つずつ） |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`と、32バイトのランダムな値のbase64 |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`。上のキーの前に付いているID |
| `PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`、`PUBLIRA_WEB_ADMIN_AUTH_SECRET`、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`、`PUBLIRA_WEB_SERVICE_TOKEN` | 32バイトのランダムな値のbase64（それぞれ1つずつ） |
| `PUBLIRA_REVALIDATE_TOKEN` | 32バイトのランダムな値のhex |
| `PUBLIRA_RUSTFS_ACCESS_KEY`、`PUBLIRA_RUSTFS_SECRET_KEY` | 32バイトのランダムな値のhex（それぞれ1つずつ） |

これらはそのままにしてください。データベースのパスワードはエスケープされずに接続URLに入るため、hexになっています。代わりに手で設定する値も、URLで安全な文字だけを使う必要があります。最初のものはPostgreSQLのスーパーユーザーのパスワードで、これで接続するのは`publiractl setup`と`publiractl db`コマンドだけです。残りの6つは、プロセスが接続に使うロールに`setup`が与えるパスワードです。2つのRustFSの値はオブジェクトストレージ自体の認証情報で、RustFSはこれを使って起動し、`setup`はこれをPubliraがバケットにアクセスするための認証情報として保存します。残りのものが何を保護するかは[シークレットを生成する](./2-installing.md#シークレットを生成する)に書かれています。

### `docker compose`を止めるもの

`PUBLIRA_IMAGE_TAG`と2つのホストの一覧は必須で、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`以外のすべてのシークレットも必須です。それらのどれかが空の間は、`run`を含むすべての`docker compose`コマンドが、何かを起動する前に停止し、欠けている変数を、それを読むサービスごとに1回ずつ表示します。

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`は空でも`docker compose`を止めません。その場合、プロキシは代わりにプレーンなHTTPを提供します。ファイルの残りも空のままでかまいません。`PUBLIRA_TENANT_URL_SCHEME`、`COMPOSE_PROFILES`、`PUBLIRA_EDGE_PLATFORM_HOSTS`、`PUBLIRA_EDGE_IMAGE_HOSTS`、[前に置くCDNやロードバランサー](#前に置くcdnやロードバランサー)の場合だけ設定する`PUBLIRA_EDGE_TRUSTED_PROXIES`、そしてオプションのプロセスの変数です。オプションのプロセスの変数は、それを有効にするときに次のセクションで設定します。

`docker compose`を実行するシェルでエクスポートされている変数は、`.env`にある同じ変数より優先されます。`.env`に書いた値が無視されているように見える場合は、シェルの環境に`PUBLIRA_*`変数がないか確認してください。

## オプションのプロセスを選ぶ

オプションのプロセスは、`COMPOSE_PROFILES`にカンマ区切りで名前を挙げると動きます。それぞれ、以下に挙げる変数も`.env`に設定する必要があります。

| プロファイル | 追加されるもの | `.env`に設定する他の値 |
| --- | --- | --- |
| `email-renderer` | すべてのメールのHTMLパート | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | プラットフォーム管理画面 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`、オペレーターがプラットフォーム管理画面を開くアドレス（`https://platform.example.com`など）を設定した`PUBLIRA_PLATFORM_APP_URL`、そのアドレスのホスト名（`platform.example.com`など）を設定した`PUBLIRA_EDGE_PLATFORM_HOSTS`。セッションキーの`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`は`env generate`がすでに入れています |

たとえば、両方を動かすには次のようにします。

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`はプロファイルが動くときにしか意味を持たないため、空でも`docker compose`は止まりません。しかし、これがないとどのオペレーターもプラットフォーム管理画面にログインできないので、`env generate`が書いた値をそのまま残してください。そのホスト名にもホストを指すDNSが必要で、`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシは他の証明書と一緒にその証明書も取得します。

これらは今選んでも、後で選んでもかまいません。すでに動いているインストール環境で有効にするには、`COMPOSE_PROFILES`に追加し、その変数を設定して、もう一度`docker compose up -d`を実行します。新しいプロセスが起動し、変数が変わったプロセスが再起動します。各プロセスが動き始めてから何をするかは、[オプションのプロセスを有効にする](./2-installing.md#オプションのプロセスを有効にする)に書かれています。

## インストール環境を起動する

各手順を、展開したディレクトリで、この順に実行します。

### 1. インストール環境をセットアップする

```bash
docker compose run --rm setup
```

最初のコマンドは必要なイメージをpullし、PostgreSQLとRustFSを起動して、両方が応答するまで待ちます。続いて`setup`が、空のデータベースから管理者がログインするテナントまで、インストール環境を1手順ずつ構築し、各手順が終わるたびにそれを表示します。

1. マイグレーションを適用し、`.env`のパスワードで6つのデータベースロールを作成します。Composeファイルはパスワードをファイルとして渡すので、コマンドラインに現れることはありません。
2. RustFSに`publira`という名前のバケットを作成し、テストに合格したら、`.env`のRustFSの認証情報とともに保存します。
3. それ以外のすべてを端末で尋ねます。プラットフォームのデフォルトのロケール、タイムゾーン、通貨、SMTPの設定、Web Pushをセットアップするかどうか、テナントの名前とドメイン、そしてテナントの最初の管理者です。各手順は[インストール環境をセットアップする](./2-installing.md#4-インストール環境をセットアップする)で説明しています。

テナントのサイトのドメインを尋ねられたら、`PUBLIRA_EDGE_SITE_HOSTS`に挙げたドメイン（`comics.example.com`など）を入力します。テナント管理画面のドメインを尋ねられたら、`PUBLIRA_EDGE_ADMIN_HOSTS`に`admin.<domain>`を挙げた場合は空欄のままにし、それ以外の場合は挙げた名前を入力します。

最後の概要には、テナントのサイトとテナント管理画面が表示され、`setup`がパスワードを生成した場合は管理者のパスワードも表示されます。パスワードが表示されるのはここだけなので、端末を閉じる前に控えておいてください。

接続テストが失敗した、Ctrl+Cを押したなどの理由で実行が途中で止まった場合は、同じコマンドをもう一度実行してください。完了した手順はすべてそのまま残り、残りの手順だけが尋ねられます。完了したインストール環境で実行しても、何も変わりません。

例外はテストメッセージが拒否された場合です。`setup`はテストメッセージを送る前にSMTPの設定を保存するので、次の実行ではそれがそのまま残り、テストメッセージは送られません。誤った設定は、まず`docker compose run --rm publiractl smtp set`で直してください。[変更する](../3-operations/6-email.md#変更する)で説明しているとおり、このコマンドは保存されているすべての設定を与えられたフラグで置き換えます。設定が正しく、SMTPサーバーに到達できなかっただけの場合は、設定はそのままにしてください。`docker compose run --rm publiractl smtp test --to operator@example.com`でテストメッセージを送り、送れたら、もう一度`docker compose run --rm setup`を実行してSMTPより後の手順を完了させます。

### 2. インストール環境を起動する

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`は、まず`server`を起動し、`server`が準備完了を返してValkeyが正常になったらWebアプリを、`web-storefront`と`web-admin`が準備完了を返したらプロキシを起動し、すべてが起動したところで戻ります。`docker compose ps`は、インストール環境のすべてのサービスを実行中として表示し、`server`、Webアプリ、`email-renderer`はさらに`healthy`として表示します。`publiractl`と`setup`は1つのコマンドのためにしか動かないので、一覧には含まれません。`web-platform`と`email-renderer`を待つものはないため、コマンドが戻ってから数秒間は、どちらもまだ`health: starting`と表示されることがあります。再起動を繰り返すプロセスや`unhealthy`になったプロセスは、`docker compose logs <service>`でその理由がわかります。

`server`が起動時に終了した場合や、起動から1分半たっても準備完了にならない場合、`docker compose up -d`は`publira-deploy-server-1`をunhealthyまたはexitedとして挙げる`dependency failed to start`エラーで停止し、Webアプリとプロキシは起動しないままになります。理由は`docker compose logs server`でわかります。`setup`がまだ作成していないロールや、パスワードが`.env`と一致しないロールは、試したログインとともに`failed to initialize db`として記録されます。動いているが準備完了にならない`server`は、[ヘルスチェック](../3-operations/11-monitoring.md#ヘルスチェック)で説明しているとおり、失敗したチェックを`readiness check failed`の行として記録します。原因を直したら、もう一度`docker compose up -d`を実行してください。

`PUBLIRA_EDGE_ACME_EMAIL`を設定している場合、プロキシは起動時に証明書を要求し、`docker compose logs proxy`はホスト名ごとに1回`certificate obtained successfully`を表示します。証明書を取得できなかった名前は、認証局の理由とともに`could not get certificate from issuer`として記録されます。理由として最も多いのは、DNSがまだホストを指していないことと、ポートがインターネットに対して閉じていることです。プロキシは自動で再試行し続けるので、原因を直すだけで十分です。

### 3. ログインする

`setup`の概要に表示されたテナント管理画面のURL（`https://admin.<domain>`、または指定した管理画面ホスト）を開き、管理者のメールアドレスとパスワードでログインします。テナント管理画面は`setup`が作成したテナントで開き、テナントの公開サイトは`https://<domain>`で応答します。

プラットフォーム管理画面を有効にした場合は、`PUBLIRA_PLATFORM_APP_URL`を開き、セットアップ画面で最初のオペレーターを作成します。プラットフォーム管理画面のアカウントは、テナントの管理者のものとは別です。

## 1台のマシンで試す

DNSも証明書もなしに自分のコンピューターでインストール環境を試すには、`.localhost`配下のホスト名を使います。Chromium系のブラウザーとFirefoxは、すべての`.localhost`の名前をそのマシン自身に送り、プレーンなHTTPでも安全なものとして扱うので、ログイン時に設定されるセッションCookieを保持します。それ以外のホスト名でプレーンなHTTPを使うと、ログインは成功したように見えますが、次に開いたページでログイン画面に戻されます。

1. `.env`に`PUBLIRA_TENANT_URL_SCHEME=http`を設定し、`.localhost`の名前を挙げます。`PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`と`PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`、プラットフォーム管理画面を動かす場合はさらに`PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`です。`PUBLIRA_EDGE_ACME_EMAIL`は空のままにします。`.localhost`の名前にはどの認証局も到達できないので、プロキシはプレーンなHTTPを提供します。
2. 上の手順1と2を行い、`setup`にはテナントのドメインとして`comics.localhost`を入力します。
3. `http://admin.comics.localhost`を開いてログインします。

テナントのサイトは`http://comics.localhost`で応答し、プラットフォーム管理画面は、`PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`で有効にした場合はそのアドレスで応答します。

プロキシはプレーンなHTTPを提供している間もポート443を公開するため、コンピューター上の何かがすでにどちらかのポートで待ち受けていると、`docker compose up`はプロキシの起動に失敗します。ポート443の場合は、`PUBLIRA_EDGE_HTTPS_PORT`を`8443`のような空いている別のポートに設定します。試用ではこのポートを使わないので、他に変えることはありません。ポート80の場合は、`PUBLIRA_EDGE_HTTP_PORT`を`8080`のような別のポートに設定し、上のすべてのアドレスにそれを付けます。`setup`に入力するテナントのドメインは`comics.localhost:8080`になり、管理画面は`http://admin.comics.localhost:8080`で開きます。ブラウザーが80や443以外のポートでインストール環境にアクセスする場合、ポートは常にドメインの一部になりますが、プロキシに挙げる名前には含めません。

これはインストール環境を試すためだけに使ってください。ブラウザーとホストの間で送られるものは何も暗号化されず、プロキシはコンピューター自身からだけでなく、コンピューターのすべてのインターフェースで応答します。

## 前に置くCDNやロードバランサー

プラットフォームのCDNやロードバランサーが代わりにインストール環境のTLSを終端する場合は、`PUBLIRA_EDGE_ACME_EMAIL`を空のままにし、ブラウザーが送った`Host`ヘッダーを保ったまま、プロキシのポート80に転送させます。プロキシはこのヘッダーからテナントのサイト、テナント管理画面、プラットフォーム管理画面のどれかを選び、Publiraはこのヘッダーからテナントを選びます。代わりにHTTPSでプロキシに到達するホップでは、認証局が引き続き各ホスト名でポート80または443のプロキシに到達できる限り、設定したままにしておけます。

このときプロキシはすべてのリクエストをそのホップのアドレスで記録するため、監査ログには全員について1つのアドレスが表示され、Publiraがクライアントのアドレスごとに管理する制限はすべての読者で共有されます。代わりに読者のアドレスを記録するには、そのホップに`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を自分で設定させ、`.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`に、そのホップの接続元のアドレスまたはCIDR範囲（プロバイダーが公開しています）をスペース区切りで設定します。続いて`docker compose up -d proxy`を実行し、その値でプロキシを作り直します。そのホップを信頼することが何を意味するかは、[プロキシの前のホップ](./4-edge/1-sample-configurations.md#プロキシの前にあるホップ)で説明しています。

プロキシは、信頼するホップが送る`X-Forwarded-CountryRegion`も引き渡します。これは、[読者の地域](./4-edge/index.md#読者の地域)で説明しているとおり、読者の地域をテナントのGoogleタグゲートウェイに伝えるものです。読者の地域を調べるホップにはこれを設定させ、調べないホップにはこのヘッダーを削除させて、読者が好きな地域を名乗れないようにしてください。

## 1台のホストでは得られないもの

Composeファイルは完全なインストール環境ですが、そのすべての部分が1台のマシンにあります。

- **冗長性がありません。** 各プロセスは1つずつしか動きません。Dockerは終了したプロセスを再起動し、ホストが再起動したときにはインストール環境全体を再起動しますが、ホストが停止している間は、すべてのテナントのサイトも停止します。
- **データベースと画像が1つのディスクを共有します。** PostgreSQLとRustFSは、データをホスト自体のディスク上の`publira-deploy_postgres-data`と`publira-deploy_rustfs-data`ボリュームに保持します。ディスクが故障すると両方が失われるので、両方をバックアップし、`.env`も一緒にバックアップしてください。そこにある暗号化キーがないと、SMTPのパスワードをはじめ、インストール環境が保存する他のすべての認証情報を読めません。Valkeyはバックアップが必要なものを何も保持せず、`publira-deploy_caddy-data`ボリュームも同様です。プロキシは、ボリュームが空であれば証明書を再取得します。コマンドは[バックアップと復元](./9-backup-and-restore.md#docker-composeのインストール環境の場合)にあります。
- **`docker compose down -v`はデータを削除します。** `-v`はボリュームを削除し、それとともにすべての行とすべての画像も削除します。データを残したままインストール環境を停止するには、このオプションを付けずに実行してください。

インストール環境が1台のホストに収まらなくなったら、同じプロセスを、別の場所にあるマネージドのPostgreSQLとS3互換のオブジェクトストレージに対して動かします。そうしたインストール環境を順を追って起動する方法は[インストール](./2-installing.md)に、どのプロセスを複数動かすか、それらが何を共有する必要があるかは[スケールアウト](./7-scaling-out.md)に書かれています。

## 次のステップ

テナントを追加するときは、そのドメインと管理画面ホストを`.env`のホストの一覧に追加し、`docker compose up -d proxy`を実行します。プロキシはその2つの名前をルーティングし、`PUBLIRA_EDGE_ACME_EMAIL`を設定していればその証明書を取得します。DNSから始まる手順の順序は[テナントを追加する](./4-edge/index.md#テナントを追加する)にあります。

以降のリリースのたびに、[アップグレード](./8-upgrading.md#docker-composeのインストール環境の場合)でインストール環境をそのリリースに上げます。リリースのダウンロード、バックアップ、マイグレーション、新しいイメージでの再起動です。

Composeファイルが読む変数の完全な一覧と、リポジトリがそれに対して実行するチェックは、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。
