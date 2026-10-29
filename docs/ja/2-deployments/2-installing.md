---
title: インストール
description: 依存するサービスの用意から、テナント管理画面への最初のログインまで、空の状態からPubliraを稼働させる手順を説明します。
published: 2026-10-29
source_updated: 2026-10-25
---

このページでは、何もない状態から、最初の管理者がテナント管理画面にログインできるようになるまでの手順を説明します。手順は実行しなければならない順に並べ、それぞれの手順で何を決めるのかを説明します。各プロセスが読む環境変数の一覧と`publiractl`のすべてのフラグは、各手順からリンクしているリファレンスにあります。

ここで構築するのは、[構成の概要](./1-overview.md)で説明した最小構成です。`web-storefront`、`web-admin`、`publira server`、`publira worker`の4つのプロセスを動かし、`publiractl`で管理します。HTMLメールとプラットフォーム管理画面は、最後の[追加のプロセスを有効にする](#追加のプロセスを有効にする)で追加します。

## 始める前に

イメージはリリースごとにGitHub Container Registryへ`ghcr.io/publira/<name>:<tag>`として公開されます。タグはリリースのバージョン、つまりGitのタグから`v`を除いたもので、`v0.1.0`なら`0.1.0`です。公開されるイメージは`publira`、`publiractl`、`web-storefront`、`web-admin`と、追加のプロセス用の`web-platform`、`email-renderer`です。どれも公開イメージなので、ホストはログインせずにpullでき、自分でビルドする必要はありません。各イメージは`linux/amd64`と`linux/arm64`向けに公開されています。それ以外のプラットフォームのホストでは、pullできるイメージがありません。このページの例ではイメージを`ghcr.io/publira/<name>:<tag>`と書いているので、`<tag>`はインストールするリリースのバージョンに置き換えてください。タグの番号の付け方は[リリース](./10-releases.md)で説明しています。

コードを改修する場合や、ほかのプラットフォームで動かす場合は、イメージを自分でビルドします。動かすコミットの[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従ってビルドし、ホストがpullできる場所にプッシュしたうえで、このページの手順すべてで公開イメージの代わりにそのイメージを指定してください。

`publiractl`を使う手順では、どれもインストールするリリースの`publiractl`イメージを実行します。このイメージにはそのリリースのマイグレーションとロールの定義が入っているので、別のリリースのイメージを使うと、プロセスが想定していないスキーマが適用されてしまいます。

Publira全体を1台のホストで動かす場合は、[Docker Compose](./3-docker-compose.md)で説明しているように、リポジトリのComposeファイルがサービスの用意と環境変数の設定を代わりに行います。その場合も、内部で実行されるのは以下の手順と同じです。

## サービスを用意する

最初の手順を始める前に、次のものを作成しておきます。中身はすべてPubliraが作成するので、どれも空の状態で用意してください。

- **PostgreSQLのデータベース**と、そのデータベースを所有し、ロールを作成できる管理用ログイン。自分で運用するPostgreSQLサーバーなら、スーパーユーザーがこれにあたります。スーパーユーザーを利用者に渡さないマネージドのPostgreSQLでは、代わりにこの種のログインが用意されています(Cloud SQLの`postgres`ユーザーなど)。Publiraに必要なのはこのログインだけで、スーパーユーザーも、行レベルセキュリティを迂回できるロールも必要ありません。このログインで接続するのは`publiractl db`コマンドだけで、常駐プロセスが使うことはありません。
- **Valkeyのインスタンス**、またはRedisプロトコルに対応した任意のサーバー。`publira server`、`web-storefront`、`web-admin`が、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュに共同で使います。パスワードを使って接続する場合は、TLSを使う`rediss://`にする必要があります。パスワードを含む`redis://`のURLを指定すると、`publira server`は起動しません。
- S3互換のオブジェクトストレージの**空のバケット**と、そのバケットを読み書きできる認証情報。アップロードされたすべての画像はここに保存されます。バケットと認証情報は`publiractl setup`が保存するので、プロセスがバケットにアクセスするための設定はほかに必要ありません。インスタンスロールなど、プロセスの実行環境から得られる認証情報を使う場合は、初期設定でアクセスキーを入力せず、`publira server`、`publira worker`、`publiractl`に`AWS_*`の環境変数を設定してください。
- **SMTPサーバー**。ホスト、ポート、暗号化方式、メールの送信元アドレスと、ログインに使うユーザー名とパスワードを用意します。ローカルのMTAや、ホストのアドレスを信頼するリレーのように認証なしで中継するサーバーなら、ユーザー名とパスワードは不要です。読者の会員登録、パスワードの再設定、管理者の招待のメールは、すべてこのサーバーから送られます。
- テナントのドメインと`admin.<domain>`の**DNS**レコード。どちらもPubliraの前に置くリバースプロキシを指すように設定します。前者でテナントの公開サイトを、後者でテナントの管理画面を提供します。管理画面を別のホスト名で提供する場合は、ここで決めておいてください。そのホスト名は`publiractl setup`に`--admin-domain`で渡します。

## シークレットを生成する

Publiraには、自分だけが管理するいくつかのシークレットが必要です。環境ごとに新しく生成してシークレットストアに保管し、リポジトリに書かれている値は使い回さないでください。リポジトリの値はローカル開発用で、誰でも見られます。

| シークレット | 生成方法 | 設定先 | 保護するもの |
| --- | --- | --- | --- |
| シークレットの暗号化キー | `PUBLIRA_SECRET_ENCRYPTION_KEYS`に`k1:$(openssl rand -base64 32)`を、`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`に`k1`を設定 | `publira server`、`publira worker`、`publiractl` | Publiraが保存するすべての認証情報(SMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵、各テナントの決済、プッシュ通知、ログインの認証情報) |
| アクセストークンの署名キー | `openssl rand -base64 32`の値を`PUBLIRA_AUTH_JWT_SECRET`に設定 | `publira server` | ログイン中のすべてのセッション。このキーがあれば任意のユーザーのトークンに署名でき、そのユーザーとしてすべてのAPIを呼び出せます |
| Webアプリごとのセッションキー | `openssl rand -base64 32`の値を各アプリの`PUBLIRA_AUTH_SECRET`に設定 | `web-storefront`と`web-admin`にそれぞれ1つ | ユーザーのアクセストークンを格納するセッションCookie。2つのアプリで同じ値を使っても、別々の値にしてもかまいません |
| キャッシュ再検証トークン | `openssl rand -hex 32` | `publira server`、`publira worker`、`web-storefront`、`web-admin`の`PUBLIRA_REVALIDATE_TOKEN` | データの変更後に、Webアプリのキャッシュ済みページを破棄させるためにサーバーが呼び出すエンドポイント。このトークンがないとサーバーは何も送らず、Webアプリは変更前にキャッシュした内容を返し続けます |
| Webサービストークン | `openssl rand -base64 32`の値を`PUBLIRA_WEB_SERVICE_TOKEN`に設定 | `publira server`と`web-admin` | 管理画面がスタッフ個人ではなく管理画面自身として行う読み取り。たとえば、どのスタッフにも同じ内容が表示されるカタログの一覧がこれにあたり、全員分を1回キャッシュするだけで済みます。このトークンがないと`web-admin`は起動しません |
| データベースのロールごとのパスワード | `openssl rand -hex 32`を6回実行 | `publiractl db roles`と、そのロールを使うプロセスの接続URL | データベースそのもの。接続URLにはパスワードがエスケープされずに入るので、16進数の出力のようにURLで使える文字だけにしてください |

最も慎重に扱う必要があるのは暗号化キーです。`publiractl setup`にSMTPのパスワードやオブジェクトストレージのキーを渡すと、`setup`はそれをこのキーで暗号化して保存し、`publira server`と`publira worker`は自分に設定されたキーで復号します。別のキーを設定したプロセスは`publiractl`が保存した値を読めないので、ワーカーはメールを送れず、サーバーはオブジェクトストレージにアクセスできなくなります。キーを失うと、保存されているすべての認証情報を入力し直すことになります。あとでキーを入れ替えるときは、そのキーで暗号化した値を失わないように、古いキーを置き換えずに新しいキーを追加します。手順は[シークレットの暗号化キーのローテーション](../3-operations/12-security/1-rotating-secrets.md#シークレットの暗号化キーのローテーション)で説明しています。

## データベースのロール

プロセスが管理用ログインで接続することはありません。`publiractl db roles`は6つのログインロールを作成し、Publiraの各部分は自分の処理に合ったロールで接続します。

| ロール | 接続するプロセスと用途 | アクセスできる範囲 |
| --- | --- | --- |
| `publira_public` | `publira server`(公開サイトとモバイルアプリへの応答) | リクエスト先のテナントの行 |
| `publira_admin` | `publira server`(テナント管理画面への応答) | リクエスト先のテナントの行 |
| `publira_platform` | `publira server`(プラットフォーム管理画面への応答)と、`setup`などプラットフォームの設定を変更する`publiractl`コマンド | すべてのテナントと、プラットフォーム自体の設定 |
| `publira_outbox` | `publira worker`(メールとプッシュ通知の送信、キャッシュの再検証) | すべてのテナントと、メールの送信に必要なプラットフォームの設定 |
| `publira_ticker` | `publira worker`(エピソードの公開など、予定時刻になった瞬間に動くジョブの実行) | それらのジョブが扱う少数のテーブル |
| `publira_content_stats` | `publira worker`と`publiractl job`(メンテナンスと集計のジョブの実行) | すべてのテナントと、それらのジョブが読むプラットフォームの設定 |

ロールを分けているのは、テナントのデータをほかのテナントから切り離すためです。読者からのリクエストとテナントのスタッフからのリクエストに応答する2つのロールは、行レベルセキュリティによって、リクエストで指定されたテナントの行にしかアクセスできません。そのため、どちらかの処理に不具合があっても、ほかのテナントの行は読めません。オペレーターのパスワードハッシュやプラットフォームのメールの認証情報を保存するプラットフォーム自体のテーブルには、`publira_platform`以外のロールはアクセスできず、ほかのロールには必要な範囲の読み取りだけを個別に許可しています。ワーカーのロールは、ジョブとメールに必要な設定を読めます。テナント管理画面のロールは、リクエストの処理に使う少数の設定を読めます。その中にはプラットフォームのメールの送信元アドレスが含まれますが、同じ場所に保存されているメールサーバー、アカウント、パスワードは含まれません。こうした理由から、各プロセスには使うロールごとに接続URLを1つずつ渡します。どの環境変数がどのロールの接続URLかは[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)にあります。

## Publiraを起動する

### 1. マイグレーションを適用する

管理用ログインで接続して`db migrate`を実行します。このコマンドはスキーマを作成します。適用するマイグレーションがない場合は、何も変更せずに終了します。

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`には管理用ログインの接続URLを指定します。たとえば`postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`のようになります。

### 2. ロールを作成する

同じ接続で`db roles`を実行し、生成したパスワードを各ロールに渡します。このコマンドはマイグレーションで作成したテーブルに権限を付与するので、マイグレーションのあとに実行します。

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

もう一度実行しても、渡したパスワード以外は何も変わりません。あとでロールのパスワードをローテーションするときも、このコマンドを使います。パスワードのほかの渡し方は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)にあります。

### 3. 4つのプロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`を、同じリリースのイメージから起動します。`publira server`と`publira worker`は`ghcr.io/publira/publira:<tag>`を使い、`publira worker`ではコンテナの引数に`worker`を渡します。`web-storefront`と`web-admin`は、それぞれ`ghcr.io/publira/web-storefront:<tag>`と`ghcr.io/publira/web-admin:<tag>`を使います。環境変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)のとおりに設定します。各接続URLには、ロール名と、`db roles`でそのロールに設定したパスワードを指定します。たとえば`PUBLIRA_PUBLIC_DB_URL`なら`postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`です。接続URLは必ずすべて設定してください。設定していない接続URLは、設定済みのほかの環境変数ではなく開発用のURLにフォールバックするので、ログインに失敗します。

`publira worker`はジョブキューのテーブルを起動時に作成するので、そのための手順は必要ありません。`publira server`と`publira worker`は、`GET /readyz`でデータベースのログインごとにチェック結果を返します。パスワードが合っていないロールがあれば、そこに表示されます。

### 4. 初期設定をする

`publiractl setup`は、最初のテナントにサービスを提供するのに必要な設定を保存し、テナントの最初の管理者を作成します。

1. プラットフォームの既定のロケール、新しいテナントの初期タイムゾーン、テナントの管理者が通貨を選ぶまで販売に使う通貨(指定しなければ`USD`)
2. オブジェクトストレージ(接続テストに成功する必要があります)
3. 任意で、カタログの検索エンジン(ほかを選ばなければデータベース自体を使います)
4. SMTPの設定と、送信先アドレスを指定した場合はテストメール。認証なしで中継するリレーでは、ユーザー名を空欄にします。その場合、メールはログインせずに送られ、パスワードは尋ねられません。
5. 任意で、Web Push
6. テナントとそのドメイン
7. テナントの最初の管理者(パスワードは自分で入力するか、自動生成させます)

`setup`は`publira_platform`で接続し、保存する認証情報を暗号化キーで暗号化します。そのため、プロセスに設定するものと同じキーを渡してください。

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

端末で実行すると、すべての値を対話形式で尋ねられます。すべての値をフラグで渡せば、CIジョブやinitコンテナから無人で実行することもできます。その方法は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。`setup`が表示するリンクは`PUBLIRA_TENANT_URL_SCHEME`をもとに組み立てられます。この環境変数は読者のブラウザーがテナントにアクセスするときのスキームで、設定しなければ`https`です。表すのは公開されるアドレスであって、プロキシがプロセスにどう接続するかではありません。TLSを終端したあとの区間がHTTPでも、この値は変わりません。`http`に設定するのは、ブラウザーが実際にHTTPでテナントを開く場合だけにしてください。その場合は`publiractl`とプロセスの両方に設定します。

接続テストの失敗などで途中で止まった場合は、もう一度実行すれば最後まで進められます。保存済みの手順はそのまま残り、残りの手順だけを尋ねられます。ただし、テストメールがSMTPサーバーに拒否された場合は例外です。SMTPの設定はテストの前に保存されるため、次の実行ではその設定が残り、テストメールは送られません。[メール](../3-operations/6-email.md#アカウントをテストする)で説明しているように、誤った設定を`publiractl smtp set`で直し、`publiractl smtp test`でテストメールを送ってから、もう一度`setup`を実行してください。

`setup`は手順1と手順2も代わりに実行でき、まだ存在しないバケットを空の状態で作成することもできます。`PUBLIRA_DB_URL`と各ロールのパスワードを渡すと、自分の手順の前にマイグレーションの適用とロールの作成を行い、`--create-bucket`を付けると、接続テストの前にバケットを作成します。[Docker Compose](./3-docker-compose.md)の構成のように、`setup`が終わってからすべてのプロセスを起動する場合は、ほかのコマンドは必要ありません。フラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)にあります。

最後に表示される概要には、テナントのサイトとテナント管理画面が示され、管理者のパスワードを自動生成した場合はそのパスワードも表示されます。生成したパスワードが表示されるのはここだけなので、端末を閉じる前に控えておいてください。

### 5. リバースプロキシを設定する

ここでいうリバースプロキシは、読者のリクエストを受け取ってプロセスに転送するものです。プラットフォームが管理するロードバランサー、自分で運用するリバースプロキシ、またはそれらを組み合わせたものが該当します。2つのホスト名を次のようにプロセスへルーティングします。

- `admin.<domain>`(または自分で決めた管理画面のホスト)を`web-admin`へ
- テナントのドメインを`web-storefront`へ
- どちらのホストでも、`/rpc/publira.v1.`と`/images`を`publira server`(既定ではポート`8000`)へ
- どちらのホストでも、それ以外の`/rpc`はどこにも転送せず、リバースプロキシが`404`を返す。`publira server`はこのパスで管理画面のAPIを提供しており、WebアプリはこのAPIをプライベートネットワーク経由で呼び出します。詳しくは[リバースプロキシを通すのは公開APIだけ](./4-edge/index.md#リバースプロキシを通すのは公開apiだけ)を参照してください。

どちらのホスト名も、TLSはリバースプロキシで終端します。リバースプロキシに何を使う場合でも、ほかに必要な設定(転送するヘッダーと削除するヘッダー、クライアントのアドレス、通す必要があるアップロードとWebhook)は[リバースプロキシで必要な設定](./4-edge/index.md#リバースプロキシで必要な設定)で説明しています。[リバースプロキシの設定例](./4-edge/1-sample-configurations.md)で紹介しているリポジトリのTraefik、nginx、Caddyのサンプル設定は、そのすべてを実装した一例です。

### 6. ログインする

`setup`の概要に表示されたテナント管理画面のURL(`https://admin.<domain>`、または`--admin-domain`で指定した管理画面のホスト)を開き、管理者のメールアドレスとパスワードでログインします。ログインすると`setup`で作成したテナントの管理画面が開き、ここからスタッフを招待したり、サイトを設定したりできます。テナントの公開サイトには`https://<domain>`でアクセスできます。

## 追加のプロセスを有効にする

どちらのプロセスも、すでに稼働しているPubliraにあとから追加できます。どちらも独自のデータを持たないので、プロセスを起動し、環境変数が変わるプロセスを再起動するだけで有効になります。

### `email-renderer`によるHTMLメール

`email-renderer`がない場合、ワーカーはすべてのメールをプレーンテキストで送ります。`email-renderer`を起動し、`publira worker`の`PUBLIRA_EMAIL_RENDERER_URL`にプライベートネットワーク上のアドレス(`http://email-renderer:8080`など)を設定すると、以降のメールには同じ内容のテキストに加えてHTMLパートが付きます。この環境変数を設定したあとは、`email-renderer`がメール送信に欠かせなくなります。`email-renderer`が停止している間、ワーカーはプレーンテキストで送るのではなく、メールを保留して再試行します。

### `web-platform`によるプラットフォーム管理画面

`web-platform`はプラットフォーム管理画面のプロセスで、オペレーターは`publiractl`の代わりにブラウザーでテナントとプラットフォームの設定を管理できます。動かすには次の設定をします。

- ほかのWebアプリと同じ方法でセッションキーを生成し、32バイト以上の値を`web-platform`の`PUBLIRA_AUTH_SECRET`に設定します。設定しないと、どのオペレーターもログインできません。`PUBLIRA_GRPC_URL`、`PUBLIRA_WEB_SERVICE_TOKEN`、`PNCH_REDIS_URL`、`PUBLIRA_REVALIDATE_TOKEN`には`web-admin`と同じ値を設定します。
- キャッシュの再検証が`web-platform`に届くように、`publira server`と`publira worker`に`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`を設定します。また、`publira worker`に`PUBLIRA_PLATFORM_APP_URL`を設定します。これはオペレーターがプラットフォーム管理画面を開くアドレスで、プラットフォーム管理画面のメールに含まれるリンクはこのアドレスをもとに組み立てられます。
- `platform.example.com`のようなホスト名を決めてリバースプロキシに向け、リバースプロキシにそのホスト名の証明書を用意します。そのうえで、[ルーティング](./4-edge/index.md#ルーティング)で説明しているとおり、ほかのホストと同じパスで`web-platform`にルーティングします。サンプル設定では、このホスト名を`PUBLIRA_EDGE_PLATFORM_HOSTS`に指定します。

プラットフォーム管理画面を開き、セットアップ画面で最初のオペレーターを作成します。このオペレーターは、`publiractl setup`で作成したテナントの管理者とは別のアカウントです。プラットフォーム管理画面には独自のアカウントがあり、最初のアカウントが作成されるまでセットアップ画面が表示されます。セットアップ画面で選んだ言語は、`publiractl setup`で保存したロケールに代わってプラットフォームの既定のロケールになります。タイムゾーンも同様に置き換わり、画面での初期値はブラウザーのタイムゾーンです。既定の通貨も尋ねられますが、初期値は`publiractl setup`で保存した通貨なので、変更しなければそのまま維持されます。それ以外の設定はすべて残り、プラットフォーム管理画面を導入したあとも`publiractl`を併用できます。

## 次のステップ

各プロセスが読む環境変数の一覧は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)に、任意の環境変数は[`publira server`と`publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md)、[`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md)、[`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)の各READMEにあります。`publiractl`のすべてのコマンドは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。

新しいリリースが出るたびに、[アップグレード](./8-upgrading.md)の手順でPubliraを更新します。まずそのリリースの`publiractl`イメージでマイグレーションとロールを適用し、そのあとでプロセスを置き換えます。
