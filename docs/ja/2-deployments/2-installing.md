---
title: インストール
description: 空のインストール環境を稼働させる。依存するサービスの用意から、テナント管理画面への最初のログインまで。
published: 2026-10-29
source_updated: 2026-10-25
---

このページでは、何もない状態から、最初の管理者がログインするテナント管理画面ができるまで、インストール環境を構築します。手順を実行すべき順に追い、それぞれの手順で何を決めるかを説明します。各プロセスが読む変数の完全な一覧と`publiractl`のすべてのフラグは、各手順からリンクしているリファレンスに書かれています。

ここで説明するのは、[概要](./1-overview.md)にある最小のインストール環境です。`web-storefront`、`web-admin`、`publira server`、`publira worker`で構成し、`publiractl`から管理します。最後の[オプションのプロセスを有効にする](#オプションのプロセスを有効にする)で、HTMLメールとプラットフォーム管理画面を追加します。

## 始める前に

各リリースは、そのイメージをGitHub Container Registryに`ghcr.io/publira/<name>:<tag>`として公開します。タグはリリースのバージョン、つまりGitタグから`v`を除いたもので、`v0.1.0`なら`0.1.0`です。公開されるイメージは`publira`、`publiractl`、`web-storefront`、`web-admin`と、オプションのプロセス用の`web-platform`と`email-renderer`です。公開イメージなので、ホストはログインせずにpullでき、何もビルドする必要はありません。各イメージは`linux/amd64`と`linux/arm64`向けに公開されており、それ以外のプラットフォームのホストではpullできるイメージがありません。このページの例ではイメージを`ghcr.io/publira/<name>:<tag>`と書いています。`<tag>`の部分には、インストールするリリースのバージョンを書いてください。タグの番号の付け方は[リリース](./10-releases.md)に書かれています。

コードに手を加えるインストール環境や、それ以外のプラットフォームで動かすインストール環境は、代わりに、動かすコミットの[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従って自分でイメージをビルドし、ホストがpullする場所にプッシュして、以降は公開イメージの代わりにそれを指定します。

`publiractl`の各手順では、インストールするリリースの`publiractl`イメージを実行します。このイメージにはそのリリースのマイグレーションとロールの定義が含まれているため、別のリリースのイメージを使うと、プロセスが想定していないスキーマが適用されてしまいます。

インストール環境全体を1台のホストで動かす場合は、[Docker Compose](./3-docker-compose.md)で説明しているとおり、リポジトリのComposeファイルがサービスを用意し、変数を設定します。その場合も、実行される内容は以下の手順と同じです。

## サービスを用意する

最初の手順の前に、次のものを作成しておきます。中身はすべてPubliraが作成するので、どれも空の状態で始めます。

- **PostgreSQLデータベース**と、それを所有しロールを作成できる管理用ログイン。自分で運用するPostgreSQLサーバーでは、そのスーパーユーザーがこれにあたります。スーパーユーザーを自分で保持するマネージドのPostgreSQLでは、代わりにこの種のログインが提供されます（Cloud SQLの`postgres`ユーザーなど）。Publiraが必要とするのはそれだけで、スーパーユーザーも、行レベルセキュリティを迂回するロールも必要ありません。このログインで接続するのは`publiractl db`コマンドだけで、常駐プロセスがこれを使うことはありません。
- **Valkeyインスタンス**、またはRedisプロトコルを話す任意のサーバー。`publira server`、`web-storefront`、`web-admin`が、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュのために共有します。パスワードを伴う接続には、TLSを使う`rediss://`を使う必要があります。`publira server`は、パスワードを含む`redis://`のURLでは起動を拒否します。
- S3互換のオブジェクトストレージにある**空のバケット**と、それを読み書きできる認証情報。アップロードされたすべての画像がここに保存されます。`publiractl setup`がバケットと認証情報を保存するので、プロセスがそれにアクセスするために他に必要なものはありません。プロセスが環境から得る認証情報（インスタンスロールなど）を代わりに使う場合は、セットアップでアクセスキーを省略し、`publira server`、`publira worker`、`publiractl`に`AWS_*`変数を渡してください。
- **SMTPサーバー**：ホスト、ポート、暗号化方式、メールの送信元アドレス、そしてログインに使うユーザー名とパスワード。ただし、ローカルのMTAや、ホストのアドレスを信頼するリレーのように、認証情報なしで中継するサーバーではユーザー名とパスワードは不要です。読者の会員登録、パスワードの再設定、管理者の招待はすべてこのサーバーを通ります。
- テナントのドメインと`admin.<domain>`の**DNS**。どちらもインストール環境の前にあるエッジを指すようにします。前者はテナントの公開サイトを、後者はその管理画面を提供します。管理画面を別のホスト名に置く場合は、ここで決めておいてください。`publiractl setup`がそれを`--admin-domain`として受け取ります。

## シークレットを生成する

インストール環境には、あなただけが保持するいくつかのシークレットが必要です。環境ごとに新しいものを生成してシークレットストアに保管し、リポジトリに書かれている値は決して使い回さないでください。それらはローカル開発用のもので、公開されています。

| シークレット | 生成方法 | 設定先 | 保護するもの |
| --- | --- | --- | --- |
| シークレットの暗号化キー | `PUBLIRA_SECRET_ENCRYPTION_KEYS`として`k1:$(openssl rand -base64 32)`、`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`として`k1` | `publira server`、`publira worker`、`publiractl` | インストール環境が保存するすべての認証情報。SMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵、各テナントの決済・プッシュ通知・ログインの認証情報 |
| アクセストークンの署名キー | `PUBLIRA_AUTH_JWT_SECRET`として`openssl rand -base64 32` | `publira server` | ログイン中のすべてのセッション。これを持つ人は任意のユーザーのトークンに署名でき、そのユーザーとしてすべてのAPIを呼び出せます |
| 各Webアプリのセッションキー | そのアプリの`PUBLIRA_AUTH_SECRET`として`openssl rand -base64 32` | `web-storefront`と`web-admin`に1つずつ | ユーザーのアクセストークンを運ぶセッションCookie。2つのアプリで共有してもかまいませんが、その必要はありません |
| キャッシュ再検証トークン | `openssl rand -hex 32` | `publira server`、`publira worker`、`web-storefront`、`web-admin`に`PUBLIRA_REVALIDATE_TOKEN`として | 変更後にWebアプリのキャッシュ済みページを破棄するためにサーバーが呼び出すエンドポイント。これがないとサーバーは何も送らず、Webアプリは変更前にキャッシュしたものを返し続けます |
| Webサービストークン | `PUBLIRA_WEB_SERVICE_TOKEN`として`openssl rand -base64 32` | `publira server`と`web-admin` | 管理画面がスタッフの誰かとしてではなく自分自身として行う読み取り。たとえば、どのスタッフにも同じように表示されるカタログの一覧で、これにより全員分を一度にキャッシュできます。`web-admin`はこれがないと起動しません |
| データベースのロールごとのパスワード | `openssl rand -hex 32`を6回 | `publiractl db roles`と、そのロールを使うプロセスの接続URL | データベースそのもの。接続URLにはパスワードがエスケープされずに入るので、hexの出力のようにURLで安全な文字だけを使ってください |

最も注意が必要なのは暗号化キーです。`publiractl setup`は、SMTPのパスワードとオブジェクトストレージのキーが与えられた場合、それらをこのキーで暗号化して保存し、`publira server`と`publira worker`は与えられたキーでそれを復号します。別のキーを与えられたプロセスは、`publiractl`が保存したものを読めません。ワーカーはメールを送れず、サーバーはオブジェクトストレージにアクセスできなくなります。キーを失うと、保存されているすべての認証情報を入力し直す必要があります。後でキーを入れ替えるときに、それで暗号化したものを失わないようにするには、[シークレットの暗号化キーのローテーション](../3-operations/12-security/1-rotating-secrets.md#シークレット暗号化キーの入れ替え)で説明しているとおり、古いキーを置き換えるのではなく、その横に新しいキーを追加します。

## データベースのロール

プロセスが管理用ログインで接続することはありません。`publiractl db roles`は6つのログインロールを作成し、インストール環境の各部分は、自分の役割に合ったロールで接続します。

| ロール | 接続する用途 | アクセスできる範囲 |
| --- | --- | --- |
| `publira_public` | 公開サイトとモバイルアプリにサービスを提供する`publira server` | リクエストの対象テナントの行 |
| `publira_admin` | テナント管理画面にサービスを提供する`publira server` | リクエストの対象テナントの行 |
| `publira_platform` | プラットフォーム管理画面にサービスを提供する`publira server`と、`setup`をはじめとするプラットフォームの設定を変更する`publiractl`コマンド | すべてのテナントと、プラットフォーム自体の設定 |
| `publira_outbox` | メールとプッシュ通知の送信、キャッシュの再検証を行う`publira worker` | すべてのテナントと、メールに必要なプラットフォームの設定 |
| `publira_ticker` | エピソードの公開など、予定時刻が過ぎた瞬間に動くジョブを実行する`publira worker` | それらのジョブが扱う少数のテーブル |
| `publira_content_stats` | メンテナンスと集計のジョブを実行する`publira worker`と`publiractl job` | すべてのテナントと、それらのジョブが読むプラットフォームの設定 |

この分割によって、あるテナントのデータが別のテナントから切り離されます。読者からのリクエストとテナントのスタッフからのリクエストに応答する2つのロールは、行レベルセキュリティによってリクエストが指定するテナントに限定されているため、それらの経路に不具合があっても別のテナントの行は読めません。オペレーターのパスワードハッシュやプラットフォームのメールの認証情報を保持するプラットフォーム自体のテーブルには、`publira_platform`以外のロールはアクセスできず、他のロールには限られた読み取りだけが改めて許可されています。ワーカーのロールは自分のジョブとメールに必要な設定を読み、テナント管理画面のロールはそのリクエストが適用する少数の設定を読みます。その中にはプラットフォームのメールの送信元アドレスが含まれますが、その横に保存されているメールサーバー、アカウント、パスワードは含まれません。そのため各プロセスには、使うロールごとに1つの接続URLを渡します。どの変数がどれを運ぶかは、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)に書かれています。

## インストール環境を起動する

### 1. マイグレーションを適用する

管理用ログインの接続で`db migrate`を実行します。スキーマを作成し、適用するものがない場合は何も変更せずに終了します。

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`はその接続で、たとえば`postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`です。

### 2. ロールを作成する

同じ接続で`db roles`を実行し、各ロールに生成したパスワードを渡します。マイグレーションが作成したテーブルに権限を付与するため、2番目に実行します。

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

もう一度実行しても、与えられたパスワード以外は何も変わりません。そのため、後でロールのパスワードをローテーションするときもこのコマンドを使います。パスワードを渡す他の方法は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)にあります。

### 3. 4つのプロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`を、同じリリースのイメージから、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)にある変数を付けて起動します。最初の2つは`ghcr.io/publira/publira:<tag>`で、2つ目にはコンテナの引数として`worker`を渡します。残りは`ghcr.io/publira/web-storefront:<tag>`と`ghcr.io/publira/web-admin:<tag>`です。各接続URLには、そのロールと`db roles`が与えたパスワードを指定します。たとえば`PUBLIRA_PUBLIC_DB_URL`なら`postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`です。接続URLはすべて設定してください。設定されていない接続URLは、あなたが設定した他の変数ではなく開発用のURLにフォールバックし、ログインに失敗します。

`publira worker`は起動時にジョブキューのテーブルを作成するので、そのための手順は必要ありません。`publira server`と`publira worker`はそれぞれ、`GET /readyz`でデータベースのログインごとに1つのチェックを報告するので、パスワードが一致しないロールはそこに表示されます。

### 4. インストール環境をセットアップする

`publiractl setup`は、インストール環境が最初のテナントにサービスを提供するために必要なものを保存し、テナントの最初の管理者を作成します。

1. プラットフォームのデフォルトのロケール、新しいテナントの初期のタイムゾーン、テナントの管理者が選ぶまでテナントが販売に使う通貨（別のものを指定しなければ`USD`）。
2. オブジェクトストレージ。接続テストに合格する必要があります。
3. 任意で、カタログの検索エンジン。別のものを選ばなければデータベース自体を使います。
4. SMTPの設定と、アドレスを指定した場合はテストメッセージ。認証情報を受け付けないリレーではユーザー名を空欄にします。その場合メールはログインせずに送られ、パスワードは尋ねられません。
5. 任意で、Web Push。
6. テナントとそのドメイン。
7. テナントの最初の管理者。パスワードは入力するか、生成させます。

このコマンドは`publira_platform`で接続し、保存する認証情報を暗号化キーで暗号化します。そのため、プロセスに与えるのと同じキーを渡してください。

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

端末から実行すると、すべての値を尋ねられます。同じ処理は、すべての値をフラグで渡すことで、CIジョブやinitコンテナから無人で実行することもできます。その形式は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。出力されるリンクは`PUBLIRA_TENANT_URL_SCHEME`をもとに組み立てられます。これは読者のブラウザーがテナントにアクセスするスキームで、設定しなければ`https`です。これは公開されるアドレスを表すもので、プロキシがプロセスにどう到達するかではないため、TLS終端の背後にあるプレーンなHTTPのホップはこれに影響しません。`http`に設定するのは、ブラウザーが実際にHTTPでテナントを開く場合だけにし、その場合は`publiractl`とプロセスの両方に設定してください。

接続テストの失敗などで途中で止まった実行は、もう一度実行すれば完了します。保存済みの手順はすべてそのまま残り、残りの手順だけが尋ねられます。例外はテストメッセージが拒否された場合です。SMTPの設定はテストの前に保存されるため、次の実行ではそれがそのまま残り、テストメッセージは送られません。[メール](../3-operations/6-email.md#アカウントをテストする)の説明どおり、誤った設定を`publiractl smtp set`で直し、`publiractl smtp test`でテストメッセージを送ってから、もう一度`setup`を実行してください。

`setup`は手順1と2を自分で行い、まだ存在しない空のバケットを作成することもできます。`PUBLIRA_DB_URL`と各ロールのパスワードを与えると、自分の手順の前にマイグレーションを適用してロールを作成し、`--create-bucket`を付けると接続テストの前にバケットを作成します。[Docker Compose](./3-docker-compose.md)のインストール環境のように、`setup`が完了してからすべてのプロセスを起動するインストール環境では、他のコマンドは必要ありません。そのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)にあります。

最後の概要には、テナントのサイトとテナント管理画面が表示され、管理者のパスワードを生成した場合はそれも表示されます。生成されたパスワードが表示されるのはここだけなので、端末を閉じる前に控えておいてください。

### 5. エッジを前に置く

エッジは、読者のリクエストを受け取ってプロセスに転送するものです。プラットフォームが管理するロードバランサー、自分で運用するリバースプロキシ、あるいはそれらを連ねたものです。2つのホスト名をプロセスにルーティングします。

- `admin.<domain>`、または選んだ管理画面ホストを`web-admin`へ。
- テナントのドメインを`web-storefront`へ。
- どちらのホストでも、`/rpc/publira.v1.`と`/images`を`publira server`（デフォルトではポート`8000`）へ。
- どちらのホストでも、それ以外の`/rpc`はどこにも送らず、エッジが`404`で応答します。そこは`publira server`が管理画面のAPIに応答する場所で、Webアプリがプライベートネットワーク経由で呼び出します。[エッジを通るのは公開APIだけ](./4-edge/index.md#エッジを通るのは公開apiだけ)で説明しています。

両方のホスト名のTLSはエッジで終端します。エッジが何で構成されていても、それに必要な残りのこと（引き渡すヘッダーと削除するヘッダー、クライアントのアドレス、通す必要のあるアップロードとWebhook）は[エッジが行うべきこと](./4-edge/index.md#エッジが行うべきこと)に書かれています。リポジトリにあるTraefik、nginx、Caddyの[サンプル設定](./4-edge/1-sample-configurations.md)は、そのすべてを実現する方法の1つです。

### 6. ログインする

`setup`の概要に表示されたテナント管理画面のURL（`https://admin.<domain>`、または`--admin-domain`で指定した管理画面ホスト）を開き、管理者のメールアドレスとパスワードでログインします。テナント管理画面は`setup`が作成したテナントで開き、そこからスタッフを招待したり、サイトを設定したりできます。テナントの公開サイトは`https://<domain>`で応答します。

## オプションのプロセスを有効にする

どちらのプロセスも、すでに稼働しているインストール環境に追加できます。どちらも独自のデータを保持しないため、有効にするには、そのプロセスを動かし、変数が変わるプロセスを再起動するだけです。

### `email-renderer`によるHTMLメール

`email-renderer`がない場合、ワーカーはすべてのメールをプレーンテキストで送ります。これを動かし、`publira worker`の`PUBLIRA_EMAIL_RENDERER_URL`に、プライベートネットワーク上のそのアドレス（`http://email-renderer:8080`など）を設定すると、それ以降、すべてのメールに同じテキストと並んでHTMLパートが付きます。変数を設定すると、レンダラーはメール送信の一部になります。レンダラーが停止している間、ワーカーはプレーンテキストにフォールバックせず、各メールを保留して再試行します。

### `web-platform`によるプラットフォーム管理画面

`web-platform`はプラットフォーム管理画面で、オペレーターは`publiractl`ではなくブラウザーからテナントとプラットフォームの設定を管理できます。動かすには次のようにします。

- 他のWebアプリと同じようにセッションキーを生成し、32バイト以上の値をその`PUBLIRA_AUTH_SECRET`として設定します。これがないとどのオペレーターもログインできません。`PUBLIRA_GRPC_URL`、`PUBLIRA_WEB_SERVICE_TOKEN`、`PNCH_REDIS_URL`、`PUBLIRA_REVALIDATE_TOKEN`には`web-admin`と同じ値を渡します。
- キャッシュの再検証が届くように、`publira server`と`publira worker`に`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`を設定します。また、`publira worker`に`PUBLIRA_PLATFORM_APP_URL`を設定します。これはオペレーターがプラットフォーム管理画面を開くアドレスで、そのメールに含まれるリンクはこれをもとに組み立てられます。
- `platform.example.com`のようなホスト名を決め、エッジを指すようにし、エッジにその証明書を用意して、[ルーティング](./4-edge/index.md#ルーティング)の説明どおり、他のホストと同じパスで`web-platform`にルーティングします。サンプル設定では`PUBLIRA_EDGE_PLATFORM_HOSTS`でこれを受け取ります。

プラットフォーム管理画面を開き、セットアップ画面で最初のオペレーターを作成します。このオペレーターは、`publiractl setup`が作成したテナントの管理者とは別のものです。プラットフォーム管理画面には独自のアカウントがあり、セットアップ画面は最初のアカウントができるまで表示されます。その画面で選んだ言語が、`publiractl setup`が保存したものに代わってプラットフォームのデフォルトのロケールになり、タイムゾーンも同様です。タイムゾーンの初期値はブラウザーのタイムゾーンです。画面ではデフォルトの通貨も尋ねられ、その初期値は`publiractl setup`が保存したものなので、そのままにすればそれが維持されます。それ以外の設定はすべてそのまま残り、`publiractl`もプラットフォーム管理画面と並行して使い続けられます。

## 次のステップ

各プロセスが読む変数の完全な一覧は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)に、オプションの変数は[`publira server`と`publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md)、[`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md)、[`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)の各READMEにあります。`publiractl`のすべてのコマンドは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。

以降のリリースのたびに、[アップグレード](./8-upgrading.md)でインストール環境を新しいリリースに上げます。まずそのリリースの`publiractl`イメージでマイグレーションとロールを、次にそのプロセスを更新します。
