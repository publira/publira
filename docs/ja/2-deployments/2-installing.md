---
title: インストール
description: 依存するサービスを用意するところから、最初の管理者がテナント管理画面にログインするまでの、Publiraを空の状態から稼働させる手順を説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-25
---

このページでは、何もない状態から始めて、最初の管理者がテナント管理画面にログインできるようになるまでを説明します。手順は実行する順に並べ、それぞれの手順で何が決まるのかを添えています。各プロセスが読む環境変数の一覧と`publiractl`のすべてのフラグは、各手順からリンクしているリファレンスを参照してください。

ここで構築するのは、[構成の概要](./1-overview.md)で説明した最小構成です。`web-storefront`、`web-admin`、`publira server`、`publira worker`の4つのプロセスを動かし、`publiractl`で管理します。HTMLメールとプラットフォーム管理画面は、最後の[追加のプロセスを有効にする](#追加のプロセスを有効にする)で加えます。

## 始める前に

リリースのたびに、イメージがGitHub Container Registryに`ghcr.io/publira/<name>:<tag>`として公開されます。タグはリリースのバージョンで、Gitのタグから`v`を除いたものです。たとえば`v0.1.0`のタグは`0.1.0`です。公開されるイメージは`publira`、`publiractl`、`web-storefront`、`web-admin`の4つと、追加のプロセスで使う`web-platform`と`email-renderer`です。どれも公開イメージなので、ホストはログインせずにpullでき、自分でビルドする必要もありません。

各イメージは`linux/amd64`と`linux/arm64`向けに公開しています。ほかのプラットフォームのホストには、pullできるイメージがありません。このページの例ではイメージを`ghcr.io/publira/<name>:<tag>`と書いているので、`<tag>`はインストールするリリースのバージョンに置き換えてください。タグの番号の付け方は[リリース](./10-releases.md)で説明しています。

コードに手を加える場合や、ほかのプラットフォームで動かす場合は、イメージを自分でビルドします。動かすコミットの[イメージのビルド手順](https://github.com/publira/publira/blob/main/infra/docker/README.md)に従ってビルドし、ホストがpullする場所にプッシュしてください。以降の手順では、公開イメージの代わりにそのイメージを指定します。

`publiractl`を使う手順では、どれもインストールするリリースの`publiractl`イメージを実行します。このイメージにはそのリリースのマイグレーションとロールの定義が入っています。別のリリースのイメージを使うと、プロセスが想定していないスキーマが適用されてしまいます。

1台のホストですべてを動かすなら、リポジトリのComposeファイルがサービスの用意と環境変数の設定を引き受けます。詳しくは[Docker Compose](./3-docker-compose.md)を参照してください。その場合も、内部で実行されるのは以下と同じ手順です。

## サービスを用意する

最初の手順の前に、次のサービスを作成しておきます。中身はすべてPubliraが作成するので、どれも空のままで構いません。

### PostgreSQLのデータベース

データベースと一緒に、それを所有してロールを作成できる管理用ログインを用意します。自分で運用するPostgreSQLサーバーなら、スーパーユーザーがこれにあたります。スーパーユーザーを利用者に渡さないマネージドのPostgreSQLには、代わりにこの種のログインがあります。Cloud SQLの`postgres`ユーザーがその例です。Publiraに必要なのはこのログインだけで、スーパーユーザーも、行レベルセキュリティを迂回できるロールもいりません。このログインで接続するのは`publiractl db`コマンドだけで、常駐するプロセスが使うことはありません。

### Valkey

Valkeyのインスタンスか、Redisプロトコルを話す任意のサーバーを用意します。`publira server`と`web-storefront`と`web-admin`が、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュの置き場所として共有します。パスワードを使って接続するなら、TLSを使う`rediss://`にしてください。パスワードを含む`redis://`のURLでは、`publira server`が起動を拒否します。

### オブジェクトストレージのバケット

S3互換のオブジェクトストレージに空のバケットを作り、そのバケットを読み書きできる認証情報を用意します。アップロードされた画像はすべてここに保存されます。バケットと認証情報は`publiractl setup`が保存するので、プロセスがバケットにアクセスするための設定はほかにいりません。インスタンスロールのように実行環境から得られる認証情報をプロセスに使わせるなら、初期設定ではアクセスキーを入力せず、`publira server`、`publira worker`、`publiractl`に`AWS_*`の環境変数を設定します。

### SMTPサーバー

ホスト、ポート、暗号化の方式、メールの送信元アドレスと、ログインに使うユーザー名とパスワードを用意します。ローカルのMTAや、ホストのアドレスを信頼するリレーのように認証なしで中継するサーバーなら、ユーザー名とパスワードはいりません。読者の会員登録、パスワードの再設定、管理者の招待のメールは、どれもこのサーバーから送られます。

### DNS

テナントのドメインと`admin.<domain>`のレコードを作成し、どちらもPubliraの前に置くリバースプロキシに向けます。前者ではテナントの公開サイトを、後者ではテナントの管理画面を提供します。管理画面を別のホスト名で提供するなら、ここで決めておいてください。そのホスト名は`publiractl setup`に`--admin-domain`で渡します。

## シークレットを生成する

Publiraには、自分だけが持つシークレットがいくつか必要です。環境ごとに新しく生成してシークレットストアに保管してください。リポジトリに書かれている値はローカル開発用で、誰でも見られるので、決して使い回さないでください。

| シークレット | 生成方法 | 設定先 | 保護するもの |
| --- | --- | --- | --- |
| シークレットの暗号化キー | `PUBLIRA_SECRET_ENCRYPTION_KEYS`に`k1:$(openssl rand -base64 32)`を、`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`に`k1`を設定 | `publira server`、`publira worker`、`publiractl` | Publiraが保存するすべての認証情報。SMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵と、各テナントの決済、プッシュ通知、ログインの認証情報です |
| アクセストークンの署名キー | `openssl rand -base64 32`の値を`PUBLIRA_AUTH_JWT_SECRET`に設定 | `publira server` | ログイン中のすべてのセッション。このキーを持つ人は、任意のユーザーのトークンに署名して、そのユーザーとしてすべてのAPIを呼び出せます |
| Webアプリごとのセッションキー | `openssl rand -base64 32`の値を各アプリの`PUBLIRA_AUTH_SECRET`に設定 | `web-storefront`と`web-admin`に1つずつ | ユーザーのアクセストークンを入れるセッションCookie。2つのアプリで同じ値を使っても、別々の値にしても構いません |
| キャッシュ再検証トークン | `openssl rand -hex 32` | `publira server`、`publira worker`、`web-storefront`、`web-admin`の`PUBLIRA_REVALIDATE_TOKEN` | データが変わったあと、Webアプリのキャッシュ済みページを破棄させるためにサーバーが呼び出すエンドポイント。このトークンがないとサーバーは何も送らず、Webアプリは変更前にキャッシュした内容を返し続けます |
| Webサービストークン | `openssl rand -base64 32`の値を`PUBLIRA_WEB_SERVICE_TOKEN`に設定 | `publira server`と`web-admin` | 管理画面がスタッフ個人としてではなく管理画面自身として行う読み取り。どのスタッフにも同じ内容を表示するカタログの一覧などがこれにあたり、全員分を1回のキャッシュで済ませられます。このトークンがないと`web-admin`は起動しません |
| データベースのロールごとのパスワード | `openssl rand -hex 32`を6回実行 | `publiractl db roles`と、そのロールを使うプロセスの接続URL | データベースそのもの。接続URLにはパスワードがエスケープされずに入るので、16進数の出力のようにURLで使える文字だけにしてください |

いちばん慎重に扱うべきなのは暗号化キーです。`publiractl setup`にSMTPのパスワードやオブジェクトストレージのキーを渡すと、`setup`はこのキーで暗号化して保存します。`publira server`と`publira worker`は、自分に設定されたキーで復号します。別のキーを設定したプロセスには`publiractl`が保存した値が読めないので、ワーカーはメールを送れず、サーバーはオブジェクトストレージにアクセスできなくなります。キーを失うと、保存してあるすべての認証情報を入力し直すことになります。

あとでキーを入れ替えるときは、古いキーを置き換えずに新しいキーを追加します。そうすれば、古いキーで暗号化した値を失いません。手順は[シークレットの暗号化キーのローテーション](../3-operations/12-security/1-rotating-secrets.md#シークレットの暗号化キーのローテーション)で説明しています。

## データベースのロール

プロセスが管理用ログインで接続することはありません。`publiractl db roles`が6つのログインロールを作成し、Publiraの各部分は自分の役割に合ったロールで接続します。

| ロール | 接続するプロセスと用途 | アクセスできる範囲 |
| --- | --- | --- |
| `publira_public` | `publira server`(公開サイトとモバイルアプリへの応答) | リクエスト先のテナントの行 |
| `publira_admin` | `publira server`(テナント管理画面への応答) | リクエスト先のテナントの行 |
| `publira_platform` | `publira server`(プラットフォーム管理画面への応答)と、`setup`をはじめプラットフォームの設定を変える`publiractl`のコマンド | すべてのテナントと、プラットフォーム自体の設定 |
| `publira_outbox` | `publira worker`(メールとプッシュ通知の送信、キャッシュの再検証) | すべてのテナントと、メールの送信に必要なプラットフォームの設定 |
| `publira_ticker` | `publira worker`(エピソードの公開など、予定の時刻が来た瞬間に動くジョブ) | それらのジョブが扱う少数のテーブル |
| `publira_content_stats` | `publira worker`と`publiractl job`(メンテナンスと集計のジョブ) | すべてのテナントと、それらのジョブが読むプラットフォームの設定 |

ロールを分けるのは、テナントのデータをほかのテナントから切り離すためです。読者とテナントのスタッフからのリクエストに応答する2つのロールは、行レベルセキュリティによって、リクエストが指すテナントの行にしかアクセスできません。そのため、どちらかの処理に不具合があっても、ほかのテナントの行は読めません。

プラットフォーム自体のテーブルには、オペレーターのパスワードハッシュやプラットフォームのメールの認証情報が入っています。ここにアクセスできるのは`publira_platform`だけで、ほかのロールには必要な読み取りだけを個別に許しています。ワーカーのロールが読めるのは、ジョブとメールに必要な設定です。テナント管理画面のロールが読めるのは、リクエストの処理に使う少数の設定です。その中にはプラットフォームのメールの送信元アドレスも含まれますが、同じ場所にあるメールサーバー、アカウント、パスワードは含まれません。

このため、各プロセスには使うロールごとに接続URLを1つずつ渡します。どの環境変数がどのロールの接続URLなのかは、[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process)にあります。

## Publiraを起動する

### 1. マイグレーションを適用する

管理用ログインの接続で`db migrate`を実行し、スキーマを作成します。適用するマイグレーションがなければ、何も変えずに終了します。

```bash
docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<tag> db migrate
```

`PUBLIRA_DB_URL`には管理用ログインの接続URLを指定します。たとえば`postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`です。

### 2. ロールを作成する

同じ接続で`db roles`を実行し、生成しておいたパスワードを各ロールに渡します。このコマンドはマイグレーションが作ったテーブルに権限を付けるので、マイグレーションのあとに実行します。

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

もう一度実行しても、変わるのは渡したパスワードだけです。あとでロールのパスワードをローテーションするときも、このコマンドを使います。パスワードのほかの渡し方は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db)にあります。

### 3. 4つのプロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`を、同じリリースのイメージから起動します。

- `publira server`と`publira worker`は`ghcr.io/publira/publira:<tag>`から起動し、`publira worker`ではコンテナの引数に`worker`を渡します。
- `web-storefront`は`ghcr.io/publira/web-storefront:<tag>`から、`web-admin`は`ghcr.io/publira/web-admin:<tag>`から起動します。

環境変数は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables)に従って設定します。各接続URLには、ロール名と、`db roles`でそのロールに設定したパスワードを書きます。`PUBLIRA_PUBLIC_DB_URL`なら`postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require`のようになります。接続URLは必ずすべて設定してください。設定しなかった接続URLは、ほかに設定した環境変数ではなく開発用のURLにフォールバックするので、ログインに失敗します。

`publira worker`はジョブキューのテーブルを起動時に作成するので、そのための手順はいりません。`publira server`と`publira worker`は、`GET /readyz`でデータベースのログインごとのチェック結果を返します。パスワードが合わないロールがあれば、そこに名前が出ます。

### 4. 初期設定をする

`publiractl setup`は、最初のテナントを提供するのに必要な設定を保存し、テナントの最初の管理者を作成します。設定する内容は次のとおりです。

1. プラットフォームの既定のロケール、新しいテナントが最初に使うタイムゾーン、テナントの管理者が通貨を選ぶまでの販売の通貨(指定しなければ`USD`)
2. オブジェクトストレージ(接続テストに成功する必要があります)
3. カタログの検索エンジン(任意。ほかを選ばなければデータベース自体を使います)
4. SMTPの設定と、宛先を指定した場合はテストメール。認証なしで中継するリレーなら、ユーザー名を空欄にします。メールはログインせずに送られ、パスワードも尋ねられません。
5. Web Push(任意)
6. テナントとそのドメイン
7. テナントの最初の管理者(パスワードは自分で入力するか、自動で生成させます)

`setup`は`publira_platform`で接続し、保存する認証情報を暗号化キーで暗号化します。そのため、プロセスと同じキーを渡してください。

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  ghcr.io/publira/publiractl:<tag> setup
```

端末で実行すると、すべての値を対話形式で尋ねます。すべての値をフラグで渡せば、CIのジョブやinitコンテナから無人で実行することもできます。その方法は[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup)にあります。

`setup`が表示するリンクは、`PUBLIRA_TENANT_URL_SCHEME`をもとに組み立てます。これは読者のブラウザーがテナントにアクセスするときのスキームで、設定しなければ`https`です。表すのは公開しているアドレスで、プロキシがプロセスにどう接続するかではありません。TLSを終端したあとの区間がHTTPでも、値は変わりません。`http`にするのはブラウザーが実際にHTTPでテナントを開く場合だけで、そのときは`publiractl`とプロセスの両方に設定します。

接続テストの失敗などで途中で止まったら、もう一度実行すれば続きから終えられます。保存済みの手順はそのまま残り、残りの値だけを尋ねます。例外はテストメールが拒否された場合です。SMTPの設定はテストの前に保存されるので、次の実行ではその設定が残り、テストメールも送られません。[メール](../3-operations/6-email.md#アカウントをテストする)で説明しているように、誤った設定を`publiractl smtp set`で直し、`publiractl smtp test`でテストメールを送ってから、`setup`をもう一度実行してください。

`setup`には手順1と手順2も任せられ、まだないバケットを空の状態で作らせることもできます。`PUBLIRA_DB_URL`と各ロールのパスワードを渡すと、自分の手順の前にマイグレーションの適用とロールの作成を済ませます。`--create-bucket`を付けると、接続テストの前にバケットを作成します。[Docker Compose](./3-docker-compose.md)の構成のように`setup`が終わってからプロセスを起動するなら、ほかのコマンドはいりません。フラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#the-database-steps)にあります。

最後に表示される概要には、テナントのサイトとテナント管理画面のURLが並びます。管理者のパスワードを自動で生成した場合は、そのパスワードも表示されます。生成したパスワードが表示されるのはここだけなので、端末を閉じる前に控えておいてください。

### 5. リバースプロキシを設定する

ここでいうリバースプロキシは、読者のリクエストを受け取ってプロセスに転送するものです。プラットフォームが管理するロードバランサーでも、自分で運用するリバースプロキシでも、それらをつないだ構成でも構いません。2つのホスト名を次のようにプロセスへ振り分けます。

- `admin.<domain>`、または自分で決めた管理画面のホストは`web-admin`に転送します。
- テナントのドメインは`web-storefront`に転送します。
- どちらのホストでも、`/rpc/publira.v1.`と`/images`は`publira server`に転送します。ポートは既定で`8000`です。
- どちらのホストでも、それ以外の`/rpc`はどこにも転送せず、リバースプロキシが`404`を返します。`publira server`はこのパスで管理画面のAPIを提供していて、Webアプリはそれをプライベートネットワーク経由で呼び出します。理由は[リバースプロキシを通すのは公開APIだけ](./4-edge/index.md#リバースプロキシを通すのは公開apiだけ)で説明しています。

どちらのホスト名も、TLSはリバースプロキシで終端します。転送するヘッダーと削除するヘッダー、クライアントのアドレス、通す必要があるアップロードとWebhookなど、ほかに必要な設定は[リバースプロキシで必要な設定](./4-edge/index.md#リバースプロキシで必要な設定)にまとめてあります。何を使ってリバースプロキシを組む場合でも同じです。リポジトリにあるTraefik、nginx、Caddy向けの[設定例](./4-edge/1-sample-configurations.md)は、そのすべてを満たす一例です。

### 6. ログインする

`setup`の概要に表示されたテナント管理画面のURLを開き、管理者のメールアドレスとパスワードでログインします。URLは`https://admin.<domain>`か、`--admin-domain`で指定した管理画面のホストです。`setup`が作成したテナントの管理画面が開くので、ここからスタッフを招待したり、サイトを設定したりします。テナントの公開サイトは`https://<domain>`で開けます。

## 追加のプロセスを有効にする

どちらのプロセスも、すでに稼働しているPubliraにあとから加えられます。どちらも自分のデータを持たないので、プロセスを起動し、環境変数が変わるプロセスを再起動すれば有効になります。

### `email-renderer`によるHTMLメール

`email-renderer`がなければ、ワーカーはすべてのメールをプレーンテキストで送ります。`email-renderer`を起動し、`publira worker`の`PUBLIRA_EMAIL_RENDERER_URL`にプライベートネットワーク上のアドレスを設定してください。たとえば`http://email-renderer:8080`です。以降のメールには、同じ内容のテキストに加えてHTMLパートが付きます。

この環境変数を設定したあとは、`email-renderer`がメールの送信に欠かせなくなります。`email-renderer`が止まっている間、ワーカーはプレーンテキストに切り替えずに、メールを保留して再試行します。

### `web-platform`によるプラットフォーム管理画面

`web-platform`はプラットフォーム管理画面です。オペレーターは`publiractl`を使わずに、ブラウザーからテナントとプラットフォームの設定を管理できます。動かすには次のように設定します。

- ほかのWebアプリと同じ方法でセッションキーを生成し、32バイト以上の値を`web-platform`の`PUBLIRA_AUTH_SECRET`に設定します。設定しないと、どのオペレーターもログインできません。`PUBLIRA_GRPC_URL`、`PUBLIRA_WEB_SERVICE_TOKEN`、`PNCH_REDIS_URL`、`PUBLIRA_REVALIDATE_TOKEN`には`web-admin`と同じ値を設定します。
- キャッシュの再検証が`web-platform`に届くように、`publira server`と`publira worker`に`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`を設定します。`publira worker`には、オペレーターがプラットフォーム管理画面を開くアドレスを`PUBLIRA_PLATFORM_APP_URL`として設定します。プラットフォーム管理画面のメールに入るリンクは、このアドレスから組み立てます。
- `platform.example.com`のようなホスト名を決めてリバースプロキシに向け、リバースプロキシにそのホスト名の証明書を用意します。そのうえで、[ルーティング](./4-edge/index.md#ルーティング)で説明しているとおり、ほかのホストと同じパスの扱いで`web-platform`に振り分けます。設定例では、このホスト名を`PUBLIRA_EDGE_PLATFORM_HOSTS`で指定します。

プラットフォーム管理画面を開き、セットアップ画面で最初のオペレーターを作成します。このオペレーターは、`publiractl setup`が作成したテナントの管理者とは別のアカウントです。プラットフォーム管理画面には専用のアカウントがあり、最初の1人が作成されるまでセットアップ画面が表示されます。

セットアップ画面で選んだ言語は、`publiractl setup`が保存したロケールに代わって、プラットフォームの既定のロケールになります。タイムゾーンも同じように置き換わり、画面での初期値はブラウザーのタイムゾーンです。既定の通貨も尋ねられますが、初期値は`publiractl setup`が保存した通貨なので、そのままにすれば変わりません。それ以外の設定はすべて残り、プラットフォーム管理画面を導入したあとも`publiractl`を併用できます。

## 次のステップ

各プロセスが読む環境変数の一覧は[デプロイのリファレンス](https://github.com/publira/publira/blob/main/infra/deploy/README.md)にあります。任意の環境変数は、[`publira server`と`publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[`web-storefront`](https://github.com/publira/publira/blob/main/apps/web-storefront/README.md)、[`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md)、[`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md)の各READMEで説明しています。`publiractl`のすべてのコマンドは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。

新しいリリースが出たら、[アップグレード](./8-upgrading.md)の手順でPubliraを更新します。まずそのリリースの`publiractl`イメージでマイグレーションとロールを適用し、そのあとでプロセスを入れ替えます。
