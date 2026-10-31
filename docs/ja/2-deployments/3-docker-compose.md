---
title: Docker Compose
description: リリースごとに公開されるComposeファイルで、Publira全体を1台のホストで動かします。ファイルのダウンロードから、テナント管理画面への最初のログインまでを説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-28
---

Publiraは、1台のホストでPublira全体を動かすComposeファイルをリリースごとに公開しています。Publiraが依存するサービス、Publiraのプロセス、その前に置くリバースプロキシが、すでに互いにつながった状態で定義されています。動くPubliraをいちばん早く用意できる方法で、このページでは空のホストからテナント管理画面への最初のログインまでを説明します。

Composeファイルが実行するのは[インストール](./2-installing.md)と同じ手順です。各手順がなぜ必要か、各シークレットが何を守るか、各データベースロールがどこまでアクセスできるかは、そちらで説明しています。このページで扱うのは、Composeファイルで何が動くか、何を設定するか、起動にどのコマンドを使うかといった、Composeファイルに固有の内容です。Composeファイルが読む環境変数の一覧は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。

## Composeファイルで動くサービス

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml)には、次のサービスを定義しています。

| サービス | 内容 | ホストに残すデータ |
| --- | --- | --- |
| `postgres` | PostgreSQL。Publiraが保存するすべてのデータを持ちます | `postgres-data`ボリューム |
| `valkey` | Valkey。画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュを持ちます | なし(再起動のたびに空で起動します) |
| `rustfs` | S3互換のオブジェクトストレージの[RustFS](https://github.com/rustfs/rustfs)。アップロードされたすべての画像を持ちます | `rustfs-data`ボリューム |
| `proxy` | リバースプロキシのCaddy。リポジトリのルーティング設定で動き、設定したホスト名の証明書を取得して更新します | 証明書を入れる`caddy-data`ボリューム |
| `server` | `publira server`と`publira worker`を1つのプロセスにまとめた`publira server --with-worker`。[構成の概要](./1-overview.md#publiraで動かすプロセス)で説明しています | なし |
| `web-storefront`、`web-admin` | 公開サイトとテナント管理画面 | なし |
| `web-platform`、`email-renderer` | 追加のプロセス。有効にしたときだけ動きます | なし |
| `publiractl` | コマンドラインツール。常駐はせず、`docker compose run --rm publiractl <command>`で実行します | なし |
| `setup` | Publiraのデータベースのパスワードと、RustFSのバケットを渡し済みの`publiractl setup`。常駐はせず、`docker compose run --rm setup`で実行します | なし |

サーバーとワーカーを1つのプロセスで動かすので、ホストのコンテナが1つ少なくて済みます。別々にスケールしたい場合や、プロキシの転送先のプロセスにワーカーのデータベースログインを持たせたくない場合は、2つに分けて動かしてください。2つのプロセスがそれぞれ読む環境変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にあります。

インターネットから届くのはプロキシだけです。プロキシはホストのすべてのネットワークインターフェースでポート80と443を公開し、設定したホスト名にHTTPSで応答して、HTTPのリクエストはHTTPSにリダイレクトします。ほかのサービスには、サービス同士でしかアクセスできません。

サービスは2つのDockerネットワークに分かれています。`edge`には、プロキシとその転送先の`server`とWebアプリがいます。`default`には、プロキシ以外のすべてのサービスがいます。プロキシからはデータベースにもValkeyにも届かないので、プロキシに脆弱性があっても、そこからデータベースやValkeyに侵入されることはありません。

プロジェクト名は`publira-deploy`に固定しています。どのディレクトリからどのコマンドを実行しても、ボリュームは同じ名前のままです。そのため、1台のホストで動かせるPubliraは1つだけです。

## 始める前に

次のものを用意してください。

- Docker EngineとComposeプラグイン(`docker compose`)を入れたホストが必要です。イメージを公開しているのは`linux/amd64`と`linux/arm64`だけです。ほかのプラットフォームでは最初のpullが`no matching manifest`で失敗するので、[イメージの指定](#イメージの指定)で説明しているように、そのプラットフォーム向けにビルドしたイメージを使います。
- インストールするリリースのアーカイブを使います。[Releases](https://github.com/publira/publira/releases)ページの各リリースに`publira-deploy-<version>.tar.gz`として添付してあり、[Composeファイルのダウンロード](#composeファイルのダウンロード)の手順で取得します。リポジトリのほかのファイルは、ホストにいりません。
- ホストから`ghcr.io`にアクセスできる必要があります。各リリースのイメージはここで公開しています。`docker compose`はイメージが必要になった時点でログインせずにpullするので、ホストでビルドすることはありません。
- SMTPサーバーのホスト、ポート、暗号化の方式、メールの送信元アドレスと、ログインに使うユーザー名とパスワードを、`publiractl setup`で尋ねます。認証なしで中継するサーバーなら、ユーザー名とパスワードはいりません。
- テナントのドメインと管理画面のホストのDNSレコードを、どちらもこのホストに向けておきます。管理画面のホストは`admin.<domain>`か、`--admin-domain`で指定するホストです。
- ポート80と443をインターネットに開き、ホスト上のほかのプログラムがどちらのポートでも待ち受けていないようにします。プロキシは両方のポートで応答します。認証局は証明書を発行する前に、どちらかのポートで各ホスト名を確認します。

## Composeファイルのダウンロード

インストールするリリースのアーカイブをダウンロードして展開し、展開されたディレクトリに移動します。`<version>`はリリースのバージョンで、タグから`v`を除いたものです。`v0.1.0`なら`0.1.0`です。

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
tar -xzf publira-deploy-<version>.tar.gz
cd publira-deploy-<version>
```

アーカイブには`compose.yaml`、`.env.example`、プロキシの`Caddyfile`と、環境変数の一覧を載せた`README.md`が入っています。このページのコマンドは、すべてこのディレクトリで実行します。

コードに手を加える場合は、リポジトリをリリースのタグでチェックアウトし、`infra/deploy/`で実行します。ファイルは同じですが、そこの`Caddyfile`は`infra/proxy/`へのリンクです。`infra/deploy/`だけを取り出さず、チェックアウトしたリポジトリ全体を残しておいてください。

## `.env`の作成

Composeファイルが必要とする値は、すべて同じディレクトリの`.env`から読み込みます。`.env.example`にはComposeファイルが読むすべての環境変数がコメント付きで並んでいて、`publiractl env generate`はこれをもとに`.env`を書き出します。そのとき、すべてのシークレットにそれぞれ固有の値を生成して入れます。インストールするリリースの`publiractl`イメージで実行してください。`<version>`は[Composeファイルのダウンロード](#composeファイルのダウンロード)と同じリリースのバージョンです。

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

表示されるのは`Wrote .env with 17 secrets generated.`の1行だけです。イメージを自分のユーザーで実行するので、ファイルの所有者は自分になり、自分だけが読める権限で作られます。`.env`がすでにあると、上書きせずに終了します。既存の`.env`には、Publiraのデータを暗号化したキーが入っているかもしれないからです。この手順は`docker compose run`では実行できません。次の3つの節で設定する値が`.env`にないうちは、`docker compose run`自体が止まるためです。

`.env`には暗号化キーをはじめPubliraのすべてのシークレットが入るので、ホスト以外の場所にもコピーを保管してください。

`.env`で自分で設定する値は3つです。2つのホストのリストの`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`と、HTTPSを有効にする`PUBLIRA_EDGE_ACME_EMAIL`です。チェックアウトしたリポジトリで動かす場合は、`PUBLIRA_IMAGE_TAG`も設定します。

### イメージの指定

`PUBLIRA_IMAGE_REGISTRY`と`PUBLIRA_IMAGE_TAG`は、使うイメージを`<registry>/<name>:<tag>`の形で指定します。`.env.example`のレジストリの`ghcr.io/publira`は、各リリースのイメージの公開先なので、そのままにしてください。タグには、ダウンロードしたリリースのバージョンがすでに入っています。`v0.1.0`のアーカイブなら`0.1.0`です。

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

タグもそのままにしてください。すべてのイメージがこの1つのタグで動き、タグは`.env`と同じディレクトリのファイルと合っている必要があります。`publiractl`には自分のリリースのマイグレーションが入っていて、各プロセスは自分のリリースのスキーマを前提にし、プロキシは隣の`Caddyfile`のルーティングで動くからです。チェックアウトしたリポジトリでは`.env.example`のタグが空なので、チェックアウトしたリリースのバージョンを設定します。

コードに手を加える場合や、ホストが`linux/amd64`でも`linux/arm64`でもない場合は、[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従ってイメージを自分でビルドし、2つの変数をそのイメージの場所に合わせます。プッシュ先のレジストリのアドレス(`registry.example.com/publira`など)と自分で決めたタグを設定してください。ホスト上で`task docker:verify:full`がビルドしたイメージを使うなら、`publira`と`local`です。

### HTTPSとテナントのURLのスキーム

`PUBLIRA_EDGE_ACME_EMAIL`を設定すると、HTTPSが有効になります。プロキシが認証局にアカウントを登録するときに使うので、自分のメールアドレスを設定してください。

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

プロキシは、ホストのリストにあるすべてのホスト名の証明書を[Let's Encrypt](https://letsencrypt.org/)から取得します。Let's Encryptで取得できなければ、ZeroSSLから取得します。証明書は期限が切れる前に更新し、ポート443でHTTPSを提供して、ポート80に来たHTTPのリクエストはHTTPSにリダイレクトします。空のままにすると、プロキシはHTTPだけで応答します。HTTPだけで動かすのは、[1台のマシンで試す](#1台のマシンで試す)場合と[CDNやロードバランサーを前に置く場合](#cdnやロードバランサーを前に置く場合)だけです。

`PUBLIRA_EDGE_HTTP_PORT`と`PUBLIRA_EDGE_HTTPS_PORT`は、プロキシが公開するポートで、値は`80`と`443`です。認証局はこの2つのポートでしかプロキシにアクセスしないので、証明書を取得する間は変えないでください。

ブラウザーがHTTPSでPubliraにアクセスするなら、`PUBLIRA_TENANT_URL_SCHEME`は空のままにします。これは、メールや`setup`の概要に載せるリンクをPubliraが組み立てるときのスキームです。`http`にするのは、[1台のマシンで試す](#1台のマシンで試す)場合のように、ブラウザーが実際にHTTPでPubliraを開くときだけです。

### ホスト名

`PUBLIRA_EDGE_SITE_HOSTS`と`PUBLIRA_EDGE_ADMIN_HOSTS`には、プロキシがテナントのサイトとテナント管理画面に振り分けるホスト名を設定します。前者にはテナントのドメインを、後者には管理画面のホストを書きます。たとえば`comics.example.com`と、`--admin-domain`で別のホストを指定しなければ`admin.comics.example.com`です。ホスト名にポートは付けません。テナントが複数あれば、どちらの変数にもテナントごとのホスト名をスペースで区切って並べます。どちらにも含まれないホストには、プロキシが自分で404を返します。

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS`はプラットフォーム管理画面のホスト名です。プラットフォーム管理画面を動かさないなら空のままにします。`PUBLIRA_EDGE_IMAGE_HOSTS`には、[画像ホスト](../3-operations/2-tenants.md#画像ホスト)を割り当てたテナントの分だけ、その画像ホストを設定します。割り当てるまでは空のままです。プロキシはこれらのホストでは`/images`だけを転送します。`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシは4つの変数に並ぶすべてのホスト名の証明書を取得します。

### シークレット

次の変数には、`env generate`がほかのPubliraと重ならない新しい値を入れています。

| 変数 | 生成した値 |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32バイトの乱数(16進数) |
| `PUBLIRA_PUBLIC_DB_PASSWORD`、`PUBLIRA_ADMIN_DB_PASSWORD`、`PUBLIRA_PLATFORM_DB_PASSWORD`、`PUBLIRA_OUTBOX_DB_PASSWORD`、`PUBLIRA_TICKER_DB_PASSWORD`、`PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32バイトの乱数(16進数)。それぞれ別の値です |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:`に続く32バイトの乱数(base64) |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`(上のキーの前に付いているID) |
| `PUBLIRA_AUTH_JWT_SECRET`、`PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`、`PUBLIRA_WEB_ADMIN_AUTH_SECRET`、`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`、`PUBLIRA_WEB_SERVICE_TOKEN` | 32バイトの乱数(base64)。それぞれ別の値です |
| `PUBLIRA_REVALIDATE_TOKEN` | 32バイトの乱数(16進数) |
| `PUBLIRA_RUSTFS_ACCESS_KEY`、`PUBLIRA_RUSTFS_SECRET_KEY` | 32バイトの乱数(16進数)。それぞれ別の値です |

これらの値は変えないでください。データベースのパスワードはエスケープされずに接続URLに入るので、16進数にしています。自分で値を決める場合も、URLで使える文字だけにしてください。

最初の値はPostgreSQLのスーパーユーザーのパスワードです。このユーザーで接続するのは`publiractl setup`と`publiractl db`のコマンドだけです。残りの6つは、プロセスが接続に使うロールに`setup`が設定するパスワードです。RustFSの2つの値はオブジェクトストレージ自体の認証情報で、RustFSはこれを使って起動し、`setup`はPubliraがバケットにアクセスするための認証情報として保存します。ほかのシークレットが何を守るかは[シークレットを生成する](./2-installing.md#シークレットを生成する)で説明しています。

### `docker compose`が止まる条件

`PUBLIRA_IMAGE_TAG`と2つのホストのリストは必須です。シークレットも`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`以外はすべて必須です。どれか1つでも空だと、`run`を含むすべての`docker compose`のコマンドが何も起動せずに止まり、足りない変数を、それを読むサービスごとに表示します。

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL`が空でも`docker compose`は止まらず、プロキシがHTTPで応答します。次の変数も空のままで構いません。

- `PUBLIRA_TENANT_URL_SCHEME`、`COMPOSE_PROFILES`、`PUBLIRA_EDGE_PLATFORM_HOSTS`、`PUBLIRA_EDGE_IMAGE_HOSTS`
- `PUBLIRA_EDGE_TRUSTED_PROXIES`(設定するのは[CDNやロードバランサーを前に置く場合](#cdnやロードバランサーを前に置く場合)だけです)
- 追加のプロセスの変数(プロセスを有効にするときに、次の節に従って設定します)

`docker compose`を実行するシェルでエクスポートした変数は、`.env`の同じ名前の変数より優先されます。`.env`に書いた値が効いていないようなら、シェルの環境に`PUBLIRA_*`の変数が残っていないか確認してください。

## 追加のプロセスの選択

追加のプロセスは、`COMPOSE_PROFILES`にカンマ区切りで並べたものが動きます。それぞれ、表の右の列の変数も`.env`に設定してください。

| プロファイル | 加わるもの | `.env`にほかに設定するもの |
| --- | --- | --- |
| `email-renderer` | すべてのメールに付くHTMLパート | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | プラットフォーム管理画面 | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`と、オペレーターがプラットフォーム管理画面を開くアドレス(`https://platform.example.com`など)を入れた`PUBLIRA_PLATFORM_APP_URL`と、そのアドレスのホスト名(`platform.example.com`など)を入れた`PUBLIRA_EDGE_PLATFORM_HOSTS`。セッションキーの`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`は`env generate`が設定済みです |

たとえば両方を動かすなら、次のように設定します。

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`PUBLIRA_WEB_PLATFORM_AUTH_SECRET`はこのプロファイルを動かすときにしか使わないので、空でも`docker compose`は止まりません。ただ、この値がないとどのオペレーターもプラットフォーム管理画面にログインできないので、`env generate`が書いた値を残しておいてください。プラットフォーム管理画面のホスト名にも、このホストに向けたDNSレコードが必要です。`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシはほかのホスト名と一緒にこのホスト名の証明書も取得します。

追加のプロセスは、今選んでもあとから選んでも構いません。稼働中のPubliraで有効にするには、`COMPOSE_PROFILES`に加えて必要な変数を設定し、もう一度`docker compose up -d`を実行します。新しいプロセスが起動し、変数が変わったプロセスは再起動します。各プロセスが動き始めてからのことは[追加のプロセスを有効にする](./2-installing.md#追加のプロセスを有効にする)で説明しています。

## Publiraを起動する

展開したディレクトリで、次の手順を順に実行します。

### 1. 初期設定をする

```bash
docker compose run --rm setup
```

このコマンドは、まず必要なイメージをpullしてPostgreSQLとRustFSを起動し、両方が応答するまで待ちます。続いて`setup`が、空のデータベースから管理者がログインできるテナントまでを1手順ずつ進め、終わった手順から順に表示します。

1. マイグレーションを適用し、`.env`のパスワードで6つのデータベースロールを作成します。パスワードはComposeファイルがファイルとして渡すので、コマンドラインに出ることはありません。
2. RustFSに`publira`という名前のバケットを作成し、`.env`にあるRustFSの認証情報でテストに成功したら、バケットと認証情報を保存します。
3. 残りを端末で尋ねます。プラットフォームの既定のロケール、タイムゾーン、通貨と、SMTPの設定、Web Pushを設定するかどうか、テナントの名前とドメイン、テナントの最初の管理者です。各項目は[初期設定をする](./2-installing.md#4-初期設定をする)で説明しています。

テナントのサイトのドメインを尋ねられたら、`PUBLIRA_EDGE_SITE_HOSTS`に設定したドメイン(`comics.example.com`など)を入力します。テナント管理画面のドメインを尋ねられたら、`PUBLIRA_EDGE_ADMIN_HOSTS`に`admin.<domain>`を設定したなら空欄のままにし、それ以外なら設定したホスト名を入力します。

最後に表示される概要には、テナントのサイトとテナント管理画面のURLが並びます。`setup`が管理者のパスワードを自動で生成した場合は、そのパスワードも表示されます。表示されるのはここだけなので、端末を閉じる前に控えておいてください。

接続テストの失敗やCtrl+Cで途中で止まったら、同じコマンドをもう一度実行します。終わった手順はそのまま残り、残りだけを尋ねます。すべて終わったあとに実行しても、何も変わりません。

例外は、テストメールが拒否された場合です。`setup`はテストメールを送る前にSMTPの設定を保存するので、次の実行ではその設定が残り、テストメールも送りません。設定が誤っていたなら、先に`docker compose run --rm publiractl smtp set`で直します。このコマンドは、保存してある設定をすべて、渡したフラグの値で置き換えます。詳しくは[設定を変更する](../3-operations/6-email.md#設定を変更する)を参照してください。設定は正しく、SMTPサーバーに接続できなかっただけなら、設定はそのままにします。そのうえで`docker compose run --rm publiractl smtp test --to operator@example.com`でテストメールを送り、届いたら`docker compose run --rm setup`をもう一度実行して、SMTPより後の手順を済ませます。

### 2. すべてのサービスを起動する

```bash
docker compose up -d
docker compose ps
```

`docker compose up -d`は、まず`server`を起動します。`server`が準備完了を返してValkeyが正常になるとWebアプリを起動し、`web-storefront`と`web-admin`が準備完了になるとプロキシを起動します。すべてが起動したところでコマンドは終わります。

`docker compose ps`では、Publiraのすべてのサービスが実行中と表示され、`server`とWebアプリと`email-renderer`には`healthy`も付きます。`publiractl`と`setup`は1つのコマンドを実行するときにしか動かないので、一覧には出ません。`web-platform`と`email-renderer`の起動は待たないので、コマンドが終わってから数秒は`health: starting`と表示されることがあります。再起動を繰り返すプロセスや`unhealthy`になったプロセスは、`docker compose logs <service>`で原因がわかります。

`server`が起動してすぐ終了した場合や、起動から1分30秒たっても準備完了にならない場合は、`docker compose up -d`が`dependency failed to start`のエラーで止まり、Webアプリとプロキシは起動しません。エラーには、異常か終了したサービスとして`publira-deploy-server-1`が出ます。原因は`docker compose logs server`で確認します。`setup`がまだ作成していないロールや、パスワードが`.env`と合わないロールは、試したログインとともに`failed to initialize db`として記録されます。動いているのに準備完了にならない`server`は、失敗したチェックを`readiness check failed`の行に記録します。詳しくは[ヘルスチェック](../3-operations/11-monitoring.md#ヘルスチェック)を参照してください。原因を直したら、もう一度`docker compose up -d`を実行します。

`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば、プロキシは起動時に証明書を要求し、取得できたホスト名ごとに`certificate obtained successfully`を1行ずつ出力します。この出力は`docker compose logs proxy`で確認できます。取得できなかったホスト名は、認証局が示した理由とともに`could not get certificate from issuer`として記録されます。よくある原因は、DNSがまだこのホストに向いていないことと、ポートがインターネットに開いていないことです。プロキシは自分で再試行を続けるので、原因を直すだけで構いません。

### 3. ログインする

`setup`の概要に表示されたテナント管理画面のURLを開き、管理者のメールアドレスとパスワードでログインします。URLは`https://admin.<domain>`か、指定した管理画面のホストです。`setup`が作成したテナントの管理画面が開きます。テナントの公開サイトは`https://<domain>`で開けます。

プラットフォーム管理画面を有効にしたなら、`PUBLIRA_PLATFORM_APP_URL`を開き、セットアップ画面で最初のオペレーターを作成します。プラットフォーム管理画面のアカウントは、テナントの管理者のアカウントとは別です。

## 1台のマシンで試す

DNSも証明書も用意せずに自分のコンピューターで試すなら、`.localhost`の下のホスト名を使います。Chromium系のブラウザーとFirefoxは、`.localhost`の名前をすべて自分のマシンに送り、HTTPでも安全な接続として扱います。そのため、ログインで設定されるセッションCookieを保持します。ほかのホスト名をHTTPで使うと、ログインは成功したように見えても、次のページを開くとログイン画面に戻されます。

1. `.env`に`PUBLIRA_TENANT_URL_SCHEME=http`を設定し、ホストのリストに`.localhost`のホスト名を並べます。`PUBLIRA_EDGE_SITE_HOSTS=comics.localhost`と`PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`です。プラットフォーム管理画面を動かすなら`PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost`も設定します。`PUBLIRA_EDGE_ACME_EMAIL`は空のままにします。認証局は`.localhost`の名前に届かないので、プロキシはHTTPで応答します。
2. 上の手順1と2を実行し、`setup`にはテナントのドメインとして`comics.localhost`を入力します。
3. `http://admin.comics.localhost`を開いてログインします。

テナントのサイトは`http://comics.localhost`で開けます。`PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`でプラットフォーム管理画面を有効にしたなら、そのアドレスでプラットフォーム管理画面が開きます。

プロキシはHTTPだけで応答している間もポート443を公開します。そのため、コンピューター上のほかのプログラムがポート80か443で待ち受けていると、`docker compose up`はプロキシを起動できません。

- ポート443が使われているなら、`PUBLIRA_EDGE_HTTPS_PORT`を`8443`など空いているポートに変えます。試用ではポート443を使わないので、ほかに変えるものはありません。
- ポート80が使われているなら、`PUBLIRA_EDGE_HTTP_PORT`を`8080`などに変え、上のアドレスすべてにそのポートを付けます。`setup`に入力するテナントのドメインは`comics.localhost:8080`になり、管理画面は`http://admin.comics.localhost:8080`で開きます。

ブラウザーが80と443以外のポートでPubliraにアクセスするときは、ポートもドメインの一部になります。ただし、プロキシのホストのリストに並べる名前にはポートを付けません。

この方法は試用だけに使ってください。ブラウザーとホストの間の通信はまったく暗号化されません。プロキシも、自分のコンピューターの中からだけでなく、すべてのネットワークインターフェースで応答します。

## CDNやロードバランサーを前に置く場合

CDNやプラットフォームのロードバランサーでTLSを終端するなら、`PUBLIRA_EDGE_ACME_EMAIL`は空のままにして、ブラウザーが送った`Host`ヘッダーを変えずにプロキシのポート80へ転送させます。プロキシはこのヘッダーでテナントのサイト、テナント管理画面、プラットフォーム管理画面のどれに送るかを決め、Publiraはこのヘッダーでテナントを特定します。前段がHTTPSでプロキシに接続する場合は、認証局が各ホスト名でプロキシのポート80か443に届く限り、`PUBLIRA_EDGE_ACME_EMAIL`を設定したままで構いません。

この構成では、プロキシはすべてのリクエストを前段のアドレスで記録します。監査ログには全員が同じアドレスで残り、Publiraがクライアントのアドレスごとに設ける上限もすべての読者で共有されます。読者のアドレスを記録するには、前段に`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`を自分で設定させ、`.env`の`PUBLIRA_EDGE_TRUSTED_PROXIES`に前段の接続元のアドレスかCIDR範囲をスペース区切りで設定します。接続元のアドレスは、前段の提供元が公開しています。設定したら`docker compose up -d proxy`を実行し、新しい設定でプロキシを作り直してください。前段を信頼するとどうなるかは、[前段にロードバランサーやCDNを置く場合](./4-edge/1-sample-configurations.md#前段にロードバランサーやcdnを置く場合)で説明しています。

信頼する前段が送る`X-Forwarded-CountryRegion`も、プロキシはそのまま転送します。[読者の地域](./4-edge/index.md#読者の地域)で説明しているとおり、このヘッダーは読者の地域をテナントのGoogleタグゲートウェイに伝えるものです。読者の地域を調べる前段にはこのヘッダーを設定させ、調べない前段には削除させてください。そうしておけば、読者が地域を自由に名乗ることはできません。

## 1台のホストでは得られないもの

Composeファイルで動かすPubliraは完全な構成ですが、すべてが1台のマシンに載っています。

### 冗長性がない

各プロセスは1つずつしか動きません。Dockerは終了したプロセスを再起動し、ホストが再起動すればPublira全体を起動し直します。それでも、ホストが止まっている間はすべてのテナントのサイトも止まります。

### データベースと画像が1つのディスクにある

PostgreSQLとRustFSは、ホスト自身のディスクにある`publira-deploy_postgres-data`と`publira-deploy_rustfs-data`のボリュームにデータを保存します。ディスクが壊れると両方が失われるので、両方と`.env`をバックアップしてください。`.env`の暗号化キーがないと、SMTPのパスワードをはじめ、Publiraが保存したすべての認証情報が読めなくなります。

Valkeyにはバックアップのいるデータはありません。`publira-deploy_caddy-data`のボリュームも同じで、空ならプロキシが証明書を取得し直します。コマンドは[バックアップと復元](./9-backup-and-restore.md#docker-composeで動かしている場合)にあります。

### `docker compose down -v`でデータが消える

`-v`を付けるとボリュームが削除され、すべての行と画像が失われます。データを残したままPubliraを止めるには、`-v`を付けずに実行します。

1台のホストで足りなくなったら、同じプロセスを、別の場所にあるマネージドのPostgreSQLとS3互換のオブジェクトストレージにつないで動かします。そうした構成を一歩ずつ構築する手順は[インストール](./2-installing.md)で、どのプロセスを増やし、何を共有する必要があるかは[スケールアウト](./7-scaling-out.md)で説明しています。

## 次のステップ

テナントを追加するときは、そのテナントのドメインと管理画面のホストを`.env`のホストのリストに加え、`docker compose up -d proxy`を実行します。プロキシは2つのホスト名を振り分けるようになり、`PUBLIRA_EDGE_ACME_EMAIL`を設定していれば証明書も取得します。DNSから始める作業の順序は[テナントを追加するとき](./4-edge/index.md#テナントを追加するとき)にあります。

新しいリリースが出たら、[アップグレード](./8-upgrading.md#docker-composeで動かしている場合)の手順で更新します。リリースのダウンロード、バックアップ、マイグレーションを済ませ、新しいイメージで起動し直す流れです。

Composeファイルが読む環境変数の一覧と、リポジトリがComposeファイルに対して実行するチェックは、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose)にあります。
