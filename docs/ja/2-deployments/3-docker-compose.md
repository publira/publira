---
title: Docker Compose
description: リリースごとに公開されるComposeファイルを使い、ダウンロードからテナント管理画面への最初のログインまで、1台のホストでPublira全体を動かす手順を説明します。
published: 2026-10-29
source_updated: 2026-10-28
---

Publiraは、1台のホストでPublira全体を動かすComposeファイルをリリースごとに公開しています。このファイルには、Publiraが依存するサービス、Publiraのプロセス、その前に置くリバースプロキシが、互いに接続された状態で定義されています。動くPubliraを用意するには、これが最も手早い方法です。このページでは、空のホストからテナント管理画面への最初のログインまでを説明します。

Composeファイルは[インストール](./2-installing.md)と同じ手順を実行します。各手順が必要な理由、各シークレットが保護するもの、各データベースロールがアクセスできる範囲は、そのページで説明しています。このページでは、Composeファイルで何が動くか、何を設定するか、起動に使うコマンドなど、Composeファイルに固有の内容を説明します。Composeファイルが読む環境変数の一覧は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。

## Composeファイルで動くサービス

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)には、次のサービスが定義されています。

| サービス | 内容 | ホストに残すデータ |
| --- | --- | --- |
| `postgres` | PostgreSQL。Publiraが保存するすべてのデータを保持します | `postgres-data`ボリューム |
| `valkey` | Valkey。画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュを保持します | なし(再起動のたびに空の状態で起動します) |
| `rustfs` | S3互換のオブジェクトストレージである[RustFS](https://github.com/rustfs/rustfs)。アップロードされたすべての画像を保持します | `rustfs-data`ボリューム |
| `proxy` | リバースプロキシのCaddy。リポジトリのルーティング設定で動き、設定したホスト名の証明書を取得、更新します | 証明書を保持する`caddy-data`ボリューム |
| `server` | `publira server`と`publira worker`を1つのプロセスで動かす`publira server --with-worker`。詳しくは[構成の概要](./1-overview.md#publiraで動かすプロセス)で説明しています | なし |
| `web-storefront`、`web-admin` | 公開サイトとテナント管理画面 | なし |
| `web-platform`、`email-renderer` | 追加のプロセス。有効にしたときだけ動きます | なし |
| `publiractl` | コマンドラインツール。常駐せず、`docker compose run --rm publiractl <command>`で実行します | なし |
| `setup` | Publiraのデータベースのパスワードと、RustFSのバケットをあらかじめ渡した`publiractl setup`。常駐せず、`docker compose run --rm setup`で実行します | なし |

サーバーとワーカーを1つのプロセスで動かすので、ホストで動かすコンテナが1つ減ります。別々にスケールしたい場合や、プロキシの転送先のプロセスにワーカーのデータベースログインを持たせたくない場合は、2つに分けて動かしてください。2つのプロセスがそれぞれ読む環境変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にあります。

プロキシはホストのすべてのネットワークインターフェースでポート80と443を公開し、インターネットからアクセスできる唯一のサービスになります。設定したホスト名に対してHTTPSで応答し、HTTPのリクエストはHTTPSにリダイレクトします。ほかのサービスには、サービス同士でしかアクセスできません。

サービスは2つのDockerネットワークに分かれています。`edge`には、プロキシとその転送先である`server`とWebアプリが属します。`default`には、プロキシ以外のすべてのサービスが属します。そのため、プロキシからはデータベースにもValkeyにもアクセスできず、プロキシに脆弱性があっても、データベースやValkeyへの侵入経路にはなりません。

プロジェクト名は`publira-deploy`に固定されています。そのため、どのディレクトリからどのコマンドを実行してもボリューム名は変わらず、1台のホストで動かせるPubliraは1つだけです。

## 始める前に

次のものが必要です。

- **Docker EngineとComposeプラグイン(`docker compose`)を入れたホスト**。プラットフォームは、イメージが公開されている`linux/amd64`か`linux/arm64`である必要があります。それ以外のプラットフォームでは最初のpullが`no matching manifest`で失敗するので、[イメージの指定](#イメージの指定)で説明しているように、そのプラットフォーム向けにビルドしたイメージを使います。
- **インストールするリリースのアーカイブ**。[Releases](https://github.com/publira/publira/releases)ページの各リリースに`publira-deploy-<version>.tar.gz`として添付されています。取得方法は[Composeファイルのダウンロード](#composeファイルのダウンロード)で説明します。ホストには、リポジトリのほかのファイルは必要ありません。
- **ホストから`ghcr.io`へのアクセス**。各リリースのイメージは`ghcr.io`で公開されています。`docker compose`は、コマンドの実行に必要になった時点でログインせずにイメージをpullするので、ホストでビルドする必要はありません。
- **SMTPサーバー**。`publiractl setup`で、ホスト、ポート、暗号化方式、メールの送信元アドレスと、ログインに使うユーザー名とパスワードを尋ねられます。認証なしで中継するサーバーなら、ユーザー名とパスワードは不要です。
- テナントのドメインと管理画面のホスト(`admin.<domain>`、または`--admin-domain`で指定するホスト)の**DNS**レコード。どちらもこのホストを指すように設定します。
- **インターネットに公開したポート80と443**。ホスト上のほかのプログラムがどちらかのポートで待ち受けていてはいけません。プロキシは両方のポートで応答し、認証局は証明書を発行する前に、どちらかのポートで各ホスト名を確認します。

## Composeファイルのダウンロード

インストールするリリースのアーカイブをダウンロードします。`<version>`はリリースのバージョン、つまりタグから`v`を除いたもので、`v0.1.0`なら`0.1.0`です。ダウンロードしたら展開し、展開されたディレクトリに移動します。

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

アーカイブには`compose.yaml`、`.env.example`、プロキシの`Caddyfile`と、環境変数の一覧を載せた`README.md`が入っています。このページのコマンドは、すべてこのディレクトリで実行します。

コードを改修する場合は、代わりにリポジトリをリリースのタグでチェックアウトし、`infra/deploy/`で実行します。入っているファイルは同じですが、`Caddyfile`は`infra/proxy/`へのリンクなので、`infra/deploy/`だけをコピーせず、チェックアウトしたリポジトリ全体を残しておいてください。

## `.env`の作成

Composeファイルが必要とする値は、すべて同じディレクトリの`.env`から読み込まれます。`publiractl env generate`は、Composeファイルが読むすべての環境変数をコメント付きで並べた`.env.example`をもとに`.env`を作成し、すべてのシークレットにそれぞれ固有の値を生成して書き込みます。インストールするリリースの`publiractl`イメージで実行してください。`<version>`は[Composeファイルのダウンロード](#composeファイルのダウンロード)と同じく、リリースのバージョンです。

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

実行すると`Wrote .env with 17 secrets generated.`とだけ表示されます。イメージは自分のユーザーとして実行されるので、ファイルの所有者は自分になり、自分だけが読める権限で作成されます。既存の`.env`があると、上書きせずに終了します。既存の`.env`には、Publiraのデータを暗号化したキーが入っている可能性があるからです。この手順は`docker compose run`では実行できません。次の3つの節で設定する値が`.env`にない間は、`docker compose run`自体が止まってしまうためです。

`.env`には暗号化キーを含むPubliraのすべてのシークレットが入っているので、ホスト以外の場所にもコピーを保管してください。

`.env`で自分で設定する値が3つ残っています。2つのホストのリストである`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`、HTTPSを有効にする`PUBLIRA_EDGE_ACME_EMAIL`です。チェックアウトしたリポジトリで動かす場合は、4つ目として`PUBLIRA_IMAGE_TAG`も設定します。

### イメージの指定

`PUBLIRA_IMAGE_REGISTRY`と`PUBLIRA_IMAGE_TAG`は、使うイメージを`<registry>/<name>:<tag>`の形で指定します。`.env.example`のレジストリ`ghcr.io/publira`は各リリースのイメージの公開先なので、変更しないでください。タグには、ダウンロードしたリリースのバージョンがすでに入っています。たとえば`v0.1.0`のアーカイブなら`0.1.0`です。

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

タグも変更しないでください。すべてのイメージがこの1つのタグで動き、タグは`.env`と同じディレクトリにあるファイルと一致している必要があります。`publiractl`には自分のリリースのマイグレーションが入っており、各プロセスは自分のリリースのスキーマを前提にしていて、プロキシは同じディレクトリの`Caddyfile`のルーティングで動くからです。チェックアウトしたリポジトリでは`.env.example`のタグが空なので、チェックアウトしたリリースのバージョンを設定してください。

コードを改修する場合や、ホストが`linux/amd64`でも`linux/arm64`でもない場合は、[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従ってイメージを自分でビルドし、2つの変数をそのイメージの場所に合わせます。プッシュ先のレジストリのアドレス(`registry.example.com/publira`など)と独自のタグを設定するか、ホスト上で`task docker:verify:full`がビルドしたイメージを使う場合は`publira`と`local`を設定します。

### HTTPSとテナントのURLのスキーム

`PUBLIRA_EDGE_ACME_EMAIL`を設定するとHTTPSが有効になります。プロキシが認証局にアカウントを登録するときに使うので、自分のメールアドレスを設定してください。

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

設定すると、プロキシはホストのリストにあるすべてのホスト名の証明書を[Let's Encrypt](https://letsencrypt.org/)から取得します。Let's Encryptで取得できない場合はZeroSSLから取得します。証明書は期限が切れる前に更新され、プロキシはポート443でHTTPSを提供し、ポート80へのHTTPのリクエストをHTTPSにリダイレクトします。空のままにすると、プロキシはHTTPだけで応答します。HTTPだけで動かすのは、[1台のマシンで試す場合](#1台のマシンで試す)と[CDNやロードバランサーを前に置く場合](#cdnやロードバランサーを前に置く場合)だけです。

`PUBLIRA_EDGE_HTTP_PORT`と`PUBLIRA_EDGE_HTTPS_PORT`はプロキシが公開するポートで、値は`80`と`443`です。認証局はこの2つのポートでしかプロキシにアクセスしないので、証明書を取得する間はこの値を変えないでください。

ブラウザーがHTTPSでPubliraにアクセスする場合は、`PUBLIRA_TENANT_URL_SCHEME`を空のままにします。この変数は、メールや`setup`の概要に含まれる、Publiraが組み立てるリンクのスキームです。`http`に設定するのは、[1台のマシンで試す場合](#1台のマシンで試す)のように、ブラウザーが実際にHTTPでPubliraを開く場合だけにしてください。

### ホスト名

`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`には、プロキシがテナントのサイトとテナント管理画面にルーティングするホスト名を設定します。前者にはテナントのドメイン(`comics.example.com`など)を、後者には管理画面のホスト(`--admin-domain`で別のホストを指定しない限り`admin.comics.example.com`)を設定します。ホスト名にはポートを付けません。どちらの変数にも、テナントごとに1つずつ、スペース区切りで複数のホスト名を設定できます。どちらにも含まれないホストへのリクエストには、プロキシが独自の404を返します。

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`はプラットフォーム管理画面のホスト名で、プラットフォーム管理画面を動かさない場合は空のままにします。`PUBLIRA_EDGE_IMAGE_HOSTS`には、[画像用のホスト](../3-operations/2-tenants.md#画像ホスト)で説明している画像用のホストを、割り当てたテナントの分だけ設定します。割り当てるまでは空のままです。プロキシはこれらのホストでは`/images`だけを転送します。`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシは4つの変数すべてのホスト名について証明書を取得します。

### シークレット

`env generate`は次の変数を、ほかのPubliraと重複しない新しい値で埋めています。

| 変数 | 生成された値 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32バイトの乱数(16進数) |
| `PUBLIRA_PUBLIC_DB_PASSWORD`、`PUBLIRA_ADMIN_DB_PASSWORD`、`PUBLIRA_PLATFORM_DB_PASSWORD`、`PUBLIRA_OUTBOX_DB_PASSWORD`、`PUBLIRA_TICKER_DB_PASSWORD`、`PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32バイトの乱数(16進数)。それぞれ別の値です |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`に続く32バイトの乱数(base64) |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`(上のキーの前に付いているID) |
| `PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`、`PUBLIRA_WEB_ADMIN_AUTH_SECRET`、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`、`PUBLIRA_WEB_SERVICE_TOKEN` | 32バイトの乱数(base64)。それぞれ別の値です |
| `PUBLIRA_REVALIDATE_TOKEN` | 32バイトの乱数(16進数) |
| `PUBLIRA_RUSTFS_ACCESS_KEY`、`PUBLIRA_RUSTFS_SECRET_KEY` | 32バイトの乱数(16進数)。それぞれ別の値です |

これらの値は変更しないでください。データベースのパスワードはエスケープされずに接続URLに入るので、16進数にしています。自分で値を設定する場合も、URLで使える文字だけにする必要があります。最初の値はPostgreSQLのスーパーユーザーのパスワードで、このユーザーで接続するのは`publiractl setup`と`publiractl db`コマンドだけです。残りの6つは、プロセスが接続に使うロールに`setup`が設定するパスワードです。RustFSの2つの値はオブジェクトストレージ自体の認証情報です。RustFSはこの認証情報で起動し、`setup`はこれをPubliraがバケットにアクセスするための認証情報として保存します。そのほかのシークレットが保護するものは[シークレットの生成](./2-installing.md#シークレットを生成する)で説明しています。

### `docker compose`が止まる条件

`PUBLIRA_IMAGE_TAG`と2つのホストのリストは必須で、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`以外のすべてのシークレットも必須です。どれか1つでも空だと、`run`を含むすべての`docker compose`コマンドは何も起動せずに止まり、足りない変数の名前を、その変数を読むサービスごとに表示します。

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`は空でも`docker compose`は止まらず、プロキシがHTTPで応答します。ほかの変数も空のままでかまいません。対象は`PUBLIRA_TENANT_URL_SCHEME`、`COMPOSE_PROFILES`、`PUBLIRA_EDGE_PLATFORM_HOSTS`、`PUBLIRA_EDGE_IMAGE_HOSTS`、`PUBLIRA_EDGE_TRUSTED_PROXIES`(設定するのは[CDNやロードバランサーを前に置く場合](#cdnやロードバランサーを前に置く場合)だけです)、追加のプロセスの変数(プロセスを有効にするときに次の節に従って設定します)です。

`docker compose`を実行するシェルでエクスポートした変数は、`.env`にある同じ名前の変数より優先されます。`.env`に書いた値が無視されているように見える場合は、シェルの環境に`PUBLIRA_*`の変数がないか確認してください。

## 追加のプロセスの選択

追加のプロセスは、`COMPOSE_PROFILES`にカンマ区切りで指定したものが動きます。それぞれのプロセスには、表に示した環境変数も`.env`に設定する必要があります。

| プロファイル | 追加される機能 | `.env`に設定するほかの値 |
| --- | --- | --- |
| `email-renderer` | すべてのメールにHTMLパートが付きます | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | プラットフォーム管理画面 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`と、オペレーターがプラットフォーム管理画面を開くアドレス(`https://platform.example.com`など)を設定した`PUBLIRA_PLATFORM_APP_URL`と、そのアドレスのホスト名(`platform.example.com`など)を設定した`PUBLIRA_EDGE_PLATFORM_HOSTS`。セッションキーの`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`は`env generate`が設定済みです |

たとえば両方を動かすには、次のように設定します。

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`はプロファイルを動かすときにしか使わないので、空でも`docker compose`は止まりません。ただし、この値がないとどのオペレーターもプラットフォーム管理画面にログインできないので、`env generate`が書き込んだ値を残しておいてください。プラットフォーム管理画面のホスト名にも、このホストを指すDNSレコードが必要です。`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシはほかのホスト名と一緒にこのホスト名の証明書も取得します。

追加のプロセスは、今選んでも、あとから選んでもかまいません。稼働中のPubliraで有効にするには、`COMPOSE_PROFILES`に追加して必要な変数を設定し、もう一度`docker compose up -d`を実行します。新しいプロセスが起動し、変数が変わったプロセスが再起動されます。各プロセスが動き始めてからの動作は[追加のプロセスを有効にする](./2-installing.md#追加のプロセスを有効にする)で説明しています。

## Publiraを起動する

展開したディレクトリで、次の手順を順に実行します。

### 1. 初期設定をする

```bash
docker compose run --rm setup
```

最初に実行するこのコマンドは、必要なイメージをpullし、PostgreSQLとRustFSを起動して、両方が応答するまで待ちます。続いて`setup`が、空のデータベースから管理者がログインできるテナントまで手順を1つずつ実行し、終わった手順を順に表示します。

1. マイグレーションを適用し、`.env`のパスワードで6つのデータベースロールを作成します。パスワードはComposeファイルからファイルとして渡されるので、コマンドラインに現れることはありません。
2. RustFSに`publira`という名前のバケットを作成し、`.env`にあるRustFSの認証情報での接続テストに成功したら、バケットと認証情報を保存します。
3. 残りの項目を端末で尋ねます。プラットフォームの既定のロケール、タイムゾーン、通貨、SMTPの設定、Web Pushを設定するかどうか、テナントの名前とドメイン、テナントの最初の管理者です。各項目は[初期設定](./2-installing.md#4-初期設定をする)で説明しています。

テナントのサイトのドメインを尋ねられたら、`PUBLIRA_EDGE_SITE_HOSTS`に設定したドメイン(`comics.example.com`など)を入力します。テナント管理画面のドメインを尋ねられたら、`PUBLIRA_EDGE_ADMIN_HOSTS`に`admin.<domain>`を設定した場合は空欄のままにし、それ以外の場合は設定したホスト名を入力します。

最後に表示される概要には、テナントのサイトとテナント管理画面が示され、`setup`が管理者のパスワードを自動生成した場合はそのパスワードも表示されます。パスワードが表示されるのはここだけなので、端末を閉じる前に控えておいてください。

接続テストの失敗やCtrl+Cで途中で止まった場合は、同じコマンドをもう一度実行します。終わった手順はそのまま残り、残りの手順だけを尋ねられます。すべての手順が終わったあとに実行しても、何も変わりません。

ただし、テストメールを送れなかった場合は例外です。`setup`はテストメールを送る前にSMTPの設定を保存するので、次の実行ではその設定が残り、テストメールは送られません。設定が誤っていた場合は、先に`docker compose run --rm publiractl smtp set`で直します。このコマンドは、保存されているすべての設定を渡したフラグの値で置き換えます。詳しくは[メールの設定の変更](../3-operations/6-email.md#設定を変更する)を参照してください。設定は正しく、SMTPサーバーに接続できなかっただけの場合は、設定をそのままにします。そのうえで`docker compose run --rm publiractl smtp test --to operator@example.com`でテストメールを送り、送信できたら`docker compose run --rm setup`をもう一度実行して、SMTPより後の手順を終わらせます。

### 2. すべてのサービスを起動する

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`は、まず`server`を起動します。`server`が準備完了を返し、Valkeyが正常になったらWebアプリを起動し、`web-storefront`と`web-admin`が準備完了になったらプロキシを起動して、すべてが起動した時点で終了します。`docker compose ps`を実行すると、Publiraのすべてのサービスが実行中と表示され、`server`、Webアプリ、`email-renderer`は`healthy`とも表示されます。`publiractl`と`setup`は1つのコマンドを実行するときにしか動かないので、一覧には表示されません。`web-platform`と`email-renderer`の起動は待たないので、コマンドが終了してから数秒間は`health: starting`と表示されることがあります。再起動を繰り返すプロセスや`unhealthy`になったプロセスは、`docker compose logs <service>`で原因を確認できます。

`server`が起動直後に終了した場合や、起動から1分30秒たっても準備完了にならない場合、`docker compose up -d`は`dependency failed to start`エラーで止まり、Webアプリとプロキシは起動しません。このエラーには、異常または終了したサービスとして`publira-deploy-server-1`が示されます。原因は`docker compose logs server`で確認できます。`setup`がまだ作成していないロールや、パスワードが`.env`と一致しないロールは、接続を試みたログインとともに`failed to initialize db`として記録されます。動いてはいるものの準備完了にならない`server`は、失敗したチェックを`readiness check failed`の行として記録します。詳しくは[ヘルスチェック](../3-operations/11-monitoring.md#ヘルスチェック)を参照してください。原因を直したら、もう一度`docker compose up -d`を実行します。

`PUBLIRA_EDGE_ACME_EMAIL`を設定している場合、プロキシは起動時に証明書を要求し、ホスト名ごとに1回ずつ`certificate obtained successfully`を出力します。この出力は`docker compose logs proxy`で確認できます。証明書を取得できなかったホスト名は、認証局が示した理由とともに`could not get certificate from issuer`として記録されます。多くの場合、原因はDNSがまだこのホストを指していないことか、ポートがインターネットに開いていないことです。プロキシは自動で再試行を続けるので、原因を直すだけでかまいません。

### 3. ログインする

`setup`の概要に表示されたテナント管理画面のURL(`https://admin.<domain>`、または指定した管理画面のホスト)を開き、管理者のメールアドレスとパスワードでログインします。ログインすると`setup`で作成したテナントの管理画面が開きます。テナントの公開サイトには`https://<domain>`でアクセスできます。

プラットフォーム管理画面を有効にした場合は、`PUBLIRA_PLATFORM_APP_URL`を開き、セットアップ画面で最初のオペレーターを作成します。プラットフォーム管理画面のアカウントは、テナントの管理者のアカウントとは別のものです。

## 1台のマシンで試す

DNSや証明書を用意せずに自分のコンピューターで試すには、`.localhost`配下のホスト名を使います。Chromium系のブラウザーとFirefoxは、`.localhost`の名前をすべて自分のマシンに送り、HTTPでも安全な接続として扱うので、ログイン時に設定されるセッションCookieを保持します。それ以外のホスト名をHTTPで使うと、ログインは成功したように見えますが、次のページを開くとログイン画面に戻されます。

1. `.env`に`PUBLIRA_TENANT_URL_SCHEME=http`を設定し、`.localhost`のホスト名を設定します。`PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`と`PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`を設定し、プラットフォーム管理画面を動かす場合は`PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`も設定します。`PUBLIRA_EDGE_ACME_EMAIL`は空のままにします。`.localhost`の名前には認証局がアクセスできないので、プロキシはHTTPで応答します。
2. 上の手順1と2を実行し、`setup`にはテナントのドメインとして`comics.localhost`を入力します。
3. `http://admin.comics.localhost`を開いてログインします。

テナントのサイトには`http://comics.localhost`でアクセスできます。`PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`でプラットフォーム管理画面を有効にした場合は、そのアドレスでプラットフォーム管理画面にアクセスできます。

プロキシはHTTPだけで応答している間もポート443を公開するので、コンピューター上のほかのプログラムがポート80か443で待ち受けていると、`docker compose up`はプロキシを起動できません。ポート443が使われている場合は、`PUBLIRA_EDGE_HTTPS_PORT`を`8443`など空いているほかのポートに変えます。試用ではポート443を使わないので、ほかに変更は必要ありません。ポート80が使われている場合は、`PUBLIRA_EDGE_HTTP_PORT`を`8080`などほかのポートに変え、上のすべてのアドレスにそのポートを付けます。この場合、`setup`に入力するテナントのドメインは`comics.localhost:8080`になり、管理画面は`http://admin.comics.localhost:8080`で開きます。ブラウザーが80と443以外のポートでPubliraにアクセスする場合、ポートはドメインの一部になります。ただし、プロキシのホストのリストに設定する名前にはポートを付けません。

この方法は試用だけに使ってください。ブラウザーとホストの間の通信はまったく暗号化されず、プロキシは自分のコンピューター内からのアクセスに限らず、すべてのネットワークインターフェースで応答します。

## CDNやロードバランサーを前に置く場合

CDNやプラットフォームのロードバランサーでPubliraのTLSを終端する場合は、`PUBLIRA_EDGE_ACME_EMAIL`を空のままにし、ブラウザーが送った`Host`ヘッダーを保ったまま、プロキシのポート80に転送するように設定します。プロキシはこのヘッダーをもとにテナントのサイト、テナント管理画面、プラットフォーム管理画面のどれに送るかを決め、Publiraはテナントを判断します。前段からHTTPSでプロキシに接続する場合は、各ホスト名について認証局がポート80か443でプロキシにアクセスできる限り、`PUBLIRA_EDGE_ACME_EMAIL`を設定したままでかまいません。

この構成では、プロキシはすべてのリクエストを前段のアドレスから来たものとして記録します。そのため、監査ログには全員が同じアドレスで表示され、Publiraがクライアントのアドレスごとに設ける制限もすべての読者で共有されます。読者のアドレスを記録するには、前段自身が`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を設定するようにし、`.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`に、前段の接続元のアドレスかCIDR範囲をスペース区切りで設定します。接続元のアドレスは提供元が公開しています。設定したら`docker compose up -d proxy`を実行し、新しい設定でプロキシを作り直します。前段を信頼することの意味は[プロキシの前に中継を置く場合](./4-edge/1-sample-configurations.md#前段にロードバランサーやcdnを置く場合)で説明しています。

信頼する前段が送る`X-Forwarded-CountryRegion`も、プロキシはそのまま転送します。このヘッダーは、[読者の地域](./4-edge/index.md#読者の地域)で説明しているように、読者の地域をテナントのGoogleタグゲートウェイに伝えます。読者の地域を調べる前段にはこのヘッダーを設定させ、調べない前段にはこのヘッダーを削除させてください。そうすれば、読者が任意の地域を名乗ることはできません。

## 1台のホストでは得られないもの

Composeファイルで動かすPubliraは完全な構成ですが、すべてが1台のマシンにあります。

- **冗長性はありません**。各プロセスは1つずつしか動きません。Dockerは終了したプロセスを再起動し、ホストの再起動時にはPublira全体を再起動しますが、ホストが停止している間はすべてのテナントのサイトも停止します。
- **データベースと画像は1つのディスクを共有します**。PostgreSQLとRustFSは、ホスト自身のディスク上の`publira-deploy_postgres-data`と`publira-deploy_rustfs-data`ボリュームにデータを保存します。ディスクが故障すると両方が失われるので、両方をバックアップし、`.env`も一緒にバックアップしてください。`.env`の暗号化キーがないと、SMTPのパスワードをはじめ、Publiraが保存している認証情報を読めなくなります。Valkeyにはバックアップが必要なデータはなく、`publira-deploy_caddy-data`ボリュームも同様です。このボリュームが空なら、プロキシが証明書を取得し直します。コマンドは[バックアップと復元](./9-backup-and-restore.md#docker-composeで動かしている場合)にあります。
- **`docker compose down -v`はデータを削除します**。`-v`はボリュームを削除するので、すべての行とすべての画像が失われます。データを残したままPubliraを停止するには、`-v`を付けずに実行します。

1台のホストで足りなくなったら、同じプロセスを、別の場所にあるマネージドのPostgreSQLとS3互換のオブジェクトストレージにつないで動かします。そうした構成の構築手順は[インストール](./2-installing.md)で、どのプロセスを増やし、何を共有する必要があるかは[スケールアウト](./7-scaling-out.md)で説明しています。

## 次のステップ

テナントを追加するときは、そのテナントのドメインと管理画面のホストを`.env`のホストのリストに追加し、`docker compose up -d proxy`を実行します。プロキシは2つのホスト名をルーティングし、`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、その証明書を取得します。DNSの設定から始まる作業の順序は[テナントを追加するとき](./4-edge/index.md#テナントを追加するとき)にあります。

以降のリリースへは、[アップグレード](./8-upgrading.md#docker-composeで動かしている場合)の手順で更新します。リリースのダウンロード、バックアップ、マイグレーション、新しいイメージでの再起動を行います。

Composeファイルが読む環境変数の一覧と、リポジトリがComposeファイルに対して実行するチェックは[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。
