---
title: バックアップと復元
description: インストール環境が保持し、バックアップしなければならないもの、復元できるバックアップの取り方、空のサービスの上にインストール環境を戻す方法。
published: 2026-10-29
source_updated: 2026-10-28
---

インストール環境は、その状態を3か所に保持します。PostgreSQLのデータベース、オブジェクトストレージのバケット、そしてあなただけが持つシークレットの暗号化キーです。どれもほかのものなしで復元すると不完全になります。行はバケットにない画像を指し、バケットはどの行も指さない画像を保持し、データベースの認証情報は誰も持っていないキーで封印されたままになります。このページでは、何をなぜバックアップするのか、動くインストール環境に復元できるバックアップの取り方、そしてそこから空のサービスの上にインストール環境を戻す方法を説明します。

手順は、[インストール](./2-installing.md)で稼働させる、自分で運用するインストール環境を前提に書かれています。リポジトリのComposeファイルから動かすインストール環境は、独自のコマンドで同じ手順を実行します。それは[Docker Composeのインストール環境の場合](#docker-composeのインストール環境の場合)にあります。

コマンド中の`publiractl`は、[インストール](./2-installing.md#始める前に)と同じく、インストール環境が動かしているリリースの`publiractl`イメージを表し、各コマンドが読む変数を渡して実行します。`db`は管理用ログインの接続である`PUBLIRA_DB_URL`を読みます。`storage`は`PUBLIRA_PLATFORM_DB_URL`を、`search reindex`は`PUBLIRA_CONTENT_STATS_DB_URL`を読み、どちらも`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`も読みます。CIは、スキーマが変更されるたびに、これらのコマンドでバックアップを取って復元しています。それは[`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)にあります。

## バックアップするもの

| 対象 | 保持するもの | バックアップ |
| --- | --- | --- |
| PostgreSQLのデータベース | インストール環境が保存するすべてのものと、まだ行っていない処理 | する |
| オブジェクトストレージのバケット | アップロードされたすべての画像 | する（データベースの後に） |
| シークレットの暗号化キー | 保存されたすべての認証情報を封印しているキー | する（データベースとは別に） |
| そのほかのシークレット | ロールのパスワード、署名キー、プロセスが共有するトークン | 保管しておく。どれも置き換えられます |
| Valkey | キャッシュとカウンター | しない |
| 検索エンジンのインデックス | 検索をOpenSearchまたはElasticsearchで行う場合の、カタログのコピー | しない。データベースから再構築します |

### データベース

データベースは、すべてのテナント、すべてのアカウント、カタログ、すべてのコメントと購入、そしてプラットフォームと各テナントのすべての設定を保持します。また、インストール環境がまだ行っていない処理、つまりまだ送っていないメールとプッシュ通知、そして`publira worker`のジョブキューも保持し、ジョブキューのテーブルはPublira自身のテーブルと並んで置かれます。データベースはバケットに対して権威を持ちます。Publiraにとって画像が存在するのは、それを指す行があるときです。

### バケット

バケットは、スタッフがアップロードしたすべての画像（表紙、エピソードのページ、ロゴ、著者の写真）を保持し、それぞれを`tenants/`の下に、サイズと形式ごとに1つずつのオブジェクトの組として保持します。データベースの行が各オブジェクトをキーで指し、Publiraはバケットにそれ以外のものを保持しません。

### シークレットの暗号化キー

`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`は、インストール環境のどこにも保存されていません。データベースは、次のすべての認証情報をこれらで封印して保持します。

- プラットフォームのSMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵。
- 各テナント独自のSMTPのパスワードと、決済サービス、App Store、Google Play、Firebase、Sign in with Apple、受信メールの認証情報。
- 2段階認証を有効にしたすべてのテナント管理画面の管理者の、2段階認証のシークレット。

キーなしで復元したデータベースにはすべての行がありますが、これらはどれも読めません。ワーカーはメールを送れず、サーバーはバケットにアクセスできず、すべてのテナントが認証情報を入力し直さなければならず、どの管理者の認証アプリも2段階認証を通りません。

一覧が持つすべてのキーを保管してください。ローテーションで使わなくなったキーも、それで封印された値が残っているあいだは保管します。キーはデータベースのバックアップとは別に保管してください。データベースのコピーとキーがそろえば、インストール環境が保存するすべての認証情報になります。

### バックアップが不要なもの

- **Valkey**は、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュを保持します。その中のエントリーはどれも、データベースとバケットから作り直されるか、自然に期限切れになるので、インストール環境は空のValkeyで起動しても何も失いません。
- **検索エンジンのインデックス**は、検索をOpenSearchまたはElasticsearchで行う場合に、データベースから構築され、復元の後に[再構築](#5-検索インデックスを再構築する)します。
- **そのほかのシークレット**は、どれも置き換えられます。ロールのパスワードは`publiractl db roles`で設定し直し、アクセストークンの署名キーやWebアプリのセッションキーを新しくすると、全員が一度ログアウトされます。キャッシュの再検証のトークンとWebサービスのトークンは、それを共有するプロセスのあいだで一致していればよいだけです。それでも、それらすべてを暗号化キーと並べてシークレットストアに保管しておけば、その手間が省けます。
- **プロセスのイメージ**は、動かしているリリースのものを取得し直すか、自分でビルドしている場合はビルドし直します。どのリリースかは、バックアップのたびに書き留めておいてください。データベースのバックアップは、それを取ったリリースのスキーマの上に復元するものだからです。

## バックアップを取る

`publira worker`を停止し、データベース、続いてバケットをバックアップし、ワーカーを再び起動します。キーはバックアップのたびに変わるものではないので、キーを生成したりローテーションしたりしたときに、専用の安全な場所にコピーしてください。

### 1. ワーカーを停止する

データベースのバックアップを始める前に`publira worker`のすべてのレプリカを停止し、バケットのコピーが終わるまで停止したままにします。バケットからオブジェクトを削除するのは、ワーカーの孤立オブジェクトの削除だけです。ワーカーを停止しておけば、データベースのバックアップが指すオブジェクトが、コピーが届く前に削除されることはありません。バックアップ中に`publiractl job purge-orphan-images`も実行しないでください。

インストール環境のほかの部分はサービスを提供し続けます。その間にワーカーが行うはずだったこと（メール、プッシュ通知、キャッシュの再検証、予定した時刻を迎えたエピソードの公開）はデータベースで待ち、ワーカーが再び起動するとすぐに行われます。

### 2. データベースをバックアップする

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`は[管理用ログイン](./2-installing.md#サービスを用意する)の接続で、`pg_dump`はPostgreSQLサーバーと同じかそれより新しいメジャーバージョンである必要があります。このコマンドはすべてのテーブルを1つのスナップショットで読むので、プロセスがサービスを提供し続けていてもバックアップは一貫しており、開始時点でコミットされていたものを保持します。

`db version`はデータベースのスキーマのバージョンを出力します。これがバックアップを復元する先のリリースです。`publira.version`とリリースのタグを、バックアップと一緒に保管してください。

マネージドPostgreSQLのスナップショットでも同じ役割を果たせます。スナップショットはプロバイダーが説明する方法で復元し、ロールも一緒に戻ります。

### 3. バケットをバックアップする

`aws s3 sync`や`rclone copy`など、バケット全体をコピーできる任意のS3クライアントで、バケットのすべてのオブジェクトを別の場所のストレージにコピーします。コピー先から何も削除しないコピーを使い（この2つはどちらも削除しません）、毎回同じコピー先にコピーしてください。そうすれば、最新のものだけでなく、保管しているどのデータベースのバックアップも、そこで自分のオブジェクトを見つけられます。AWS CLIでバケット`publira-images`からディレクトリ`publira-bucket`にコピーするには、次のようにします。

```bash
aws s3 sync s3://publira-images publira-bucket
```

2つのバックアップを整合させるのはこの順序です。アップロードは先にオブジェクトを書き込み、その後でそれを指す行を書き込みます。また、オブジェクトが書き換えられることはありません。そのため、データベースのバックアップの行が指すオブジェクトはどれも、そのバックアップが始まった時点ですでにバケットにありました。ワーカーが停止していれば、コピーが届く前にそれが削除されることはないので、バケットのバックアップにはそのすべてが含まれます。

コピーが終わるまでワーカーを停止しておかなければならないのも、そのためです。データベースのバックアップが始まった後に差し替えられた画像は、古いオブジェクトがそのバックアップでは指されていますが、稼働中のデータベースのどの行からも指されていません。孤立オブジェクトの削除はどの行も指さないオブジェクトを削除するので、コピー中にそれが動くと、コピーが届く前にそれらを削除してしまう可能性があります。そうなると、復元した行は、バケットにもそのバックアップにもないオブジェクトを指すことになります。

バケットのバックアップには、データベースのバックアップが指すものより多くのものが含まれることになります。コピー中にアップロードされたすべての画像と、そのコピー先を最初に使ってから差し替えられたすべての画像です。これにかかるのは容量だけです。復元の後、孤立オブジェクトの削除が、復元したどの行も指さないオブジェクトを削除します。

逆の順序でコピーすると、バケットのバックアップには2つのバックアップのあいだにアップロードされた画像がすべて欠け、データベースのバックアップがそれらについて復元する行は、存在しないオブジェクトを指します。それらの画像は、サイトでも管理画面でも壊れて表示されます。

### 4. ワーカーを起動する

停止したすべてのレプリカを起動します。ワーカーは停止中に待っていたものを送り、その間に予定した時刻を過ぎたすべてのエピソードを公開します。

## 空のインストール環境に復元する

バックアップを取ったリリースに、そのリリースの`publiractl`イメージで復元します。より新しいリリースを動かすには、先に復元し、その後で[アップグレード](./8-upgrading.md)します。

[インストール](./2-installing.md#サービスを用意する)で説明しているとおりにサービスを用意します。同じかそれより新しいメジャーバージョンのPostgreSQLサーバーと空のデータベース、空のバケット、空のValkeyです。`db migrate`は実行しないでください。スキーマはバックアップに含まれています。

### 1. データベースを復元する

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`は、すべてを復元するか、何も復元しないかのどちらかにします。途中で止まった復元は、失敗した後のテーブルが欠けた状態ではなく、空のデータベースを残します。これはワーカーが起動したときに重要になります。ワーカーは、どの行も指さないオブジェクトをすべてバケットから削除するからです。

`--no-owner`と`--no-acl`は、6つのロールへの権限と、`publira_outbox`によるジョブキューのテーブルの所有を除外し、リストは`publira_rls_bypass`という名前のポリシーを除外します。このポリシーは、テナントをまたいで動くロールがすべてのテナントの行を読めるようにするものです。ロールはデータベースではなくPostgreSQLサーバーに属するので、新しいサーバーにはまだなく、ロールを指定する文はすべて失敗してしまいます。これらを除外すると、すべてのオブジェクトは管理用ログインのものになり、次の手順で権限とポリシーが戻されます。

### 2. ロールを作成する

```bash
publiractl db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

これは[ロールを作成する](./2-installing.md#2-ロールを作成する)でインストール時に実行するコマンドで、各パスワードをコンテナが`/run/secrets`にマウントしたファイルから読みます。ここでも同じことを行います。6つのロールを作成し、リリースが定義する権限を与え、ジョブキューのテーブルを`publira_outbox`の所有にしてほかのロールからは触れられないようにし、すべてのパスワードを設定します。インストール環境で使っていたパスワードを使えば、プロセスの接続URLはそのまま使えます。新しいパスワードを使う場合は、URLを更新してください。

### 3. バケットを復元する

バケットのバックアップのすべてのオブジェクトを、同じキーで新しいバケットにコピーします。AWS CLIで、バックアップのコピー先にしたディレクトリからコピーするには、次のようにします。

```bash
aws s3 sync publira-bucket s3://publira-images
```

バケットの名前、アドレス、認証情報がインストール環境のものと同じなら、ほかに変えるものはありません。そうでない場合は、`setup`が古いバケットを保存したのと同じように新しいバケットを保存し、テストします。

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

Amazon S3以外のストレージでは`--endpoint`と`--force-path-style`を追加します。`storage set`のすべてのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)にあります。

### 4. プロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`と、動かしている場合は`web-platform`と`email-renderer`を、インストール環境で使っていた暗号化キーで起動します。そのほかのシークレットは、保管しておいたものでも新しいものでもかまいません。新しいものは[シークレットを生成する](./2-installing.md#シークレットを生成する)で説明しているとおりに設定します。

プロセスは空のValkeyで起動してください。復元の前にインストール環境にサービスを提供していたValkeyには、復元で巻き戻したデータからキャッシュしたページや画像が残っており、Webアプリは各エントリーが期限切れになるまでそれを返し続けます。そのValkeyがほかに何も提供していないなら、`FLUSHALL`で空にします。

### 5. 検索インデックスを再構築する

検索をOpenSearchまたはElasticsearchで行う場合は、復元したデータベースからインデックスを再構築します。

```bash
publiractl search reindex
```

復元の後も残ったインデックスは、バックアップの後に公開されたものも引き続き見つけ、復元したデータベースにはもうないシリーズにリンクします。失われたインデックスでは、検索は空になります。既定の検索、つまりデータベース自体で検索する場合は、再構築するものはありません。

### ワーカーが追いつく処理

`publira worker`は、復元したデータベースを、バックアップを取った時点から離れていたデータベースのように扱い、起動するとすぐに追いつきます。

- **メールと通知。** バックアップを取った時点で送信待ちだったものは、プッシュ通知とキャッシュの再検証も含めてすべて送られます。その一部は、インストール環境が失われる前、バックアップの後にすでに送られていたので、一部の読者とスタッフは同じメールを2回受け取ります。
- **予定された処理。** バックアップ以降に予定した時刻を過ぎたすべてのエピソードが公開され、キャッシュされたページは開始・終了したすべての無料期間に追いつき、期限が切れた固定表示のお知らせは固定が解除されます。
- **日次の再構築。** 読書の統計、ランキング、おすすめは、バックアップが保持する読書の記録から、バックアップ以降の毎日について再構築されます。
- **孤立オブジェクトの削除。** 最初の削除で、復元したどの行も指さないオブジェクトのうち1日以上経ったもの、つまりバックアップを取った後にアップロードされた画像が削除されます。

### 復元で戻らないもの

バックアップを取った後に書き込まれたものはすべて戻りません。読者が作成したアカウント、コメント、アップロード、設定、購入です。その間に行われた購入は、決済サービス、App Store、Google Playがすでに請求しているのに、インストール環境にはもう記録がないので、購入者はそのエピソードを開けなくなります。バックアップの時点からインストール環境が失われた時点までの、各サービスの記録で探してください。

## 復元を確認する

- `db version`が、バックアップと一緒に`publira.version`に保管したバージョンを示し、dirty状態ではないことを報告します。

  ```bash
  publiractl db version
  ```

- どのプロセスも`GET /readyz`に準備完了と応答します。`publira server`と`publira worker`はデータベースログインごとに1つのチェックを報告するので、パスワードが接続URLと一致しないロールはそこに示されます。
- `storage test`が成功します。これはデータベースが封印して保持するシークレットキーでバケットにアクセスするので、暗号化キーが正しいことの確認にもなります。

  ```bash
  publiractl storage test
  ```

- テナント管理画面にログインでき、テナントのサイトが画像とともに開きます。シリーズの表紙と、バックアップの少し前にアップロードしたエピソードのページを確認します。

一度も復元したことのないバックアップは、バックアップではなく願望にすぎません。ときどき予備のサービスに復元して、この一覧を確認してください。

## Docker Composeのインストール環境の場合

[Docker Compose](./3-docker-compose.md)のインストール環境は、データベースを`publira-deploy_postgres-data`ボリュームに、バケットを`publira-deploy_rustfs-data`に、暗号化キーとそのほかのすべてのシークレットを`.env`に保持します。各コマンドは、インストール環境を動かしているディレクトリ、つまりリリースのアーカイブを展開したディレクトリか、チェックアウトの`infra/deploy/`から実行します。

### バックアップを取る

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

ワーカーを停止する理由は[ワーカーを停止する](#1-ワーカーを停止する)にあります。ワーカーは`server`の中で動くので、APIも一緒に停止し、`server`が再び起動するまでテナントのサイトと管理画面は応答しません。`-T`を付けると、出力が端末を経由しないので、破損しません。

RustFSのイメージにはS3クライアントが含まれていないので、バケットはオブジェクトごとではなく、RustFSがボリュームに保持するファイルとしてバックアップします。ファイルをコピーするあいだはRustFSを停止しておく必要があります。そうしないと、書き込みの途中だったオブジェクトがアーカイブに含まれる可能性があります。ComposeファイルはRustFSのイメージを固定しているので、同じリリースのComposeファイルなら、同じRustFSでアーカイブを復元できます。

`publira.dump`、`publira.version`、`publira-bucket.tar.gz`をホストの外にコピーし、インストール時に作成した`.env`のコピーは、ホストともそれらのファイルとも別の場所に保管してください。

### 復元する

[Composeファイルをダウンロードする](./3-docker-compose.md#composeファイルをダウンロードする)で説明しているとおりに、バックアップのリリースのアーカイブから展開したComposeファイルがあるホストで、`.env`を`compose.yaml`の隣に戻し、次を実行します。

```bash
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c 'cat > /tmp/publira.dump' < publira.dump
docker compose exec -T postgres sh -c "pg_restore --list /tmp/publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > /tmp/publira.list"
docker compose exec -T postgres pg_restore -U postgres -d publira --no-owner --no-acl --single-transaction --use-list=/tmp/publira.list /tmp/publira.dump
docker compose exec -T postgres rm /tmp/publira.dump /tmp/publira.list
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose run --rm --no-deps -T --entrypoint tar rustfs -xzf - -C /data < publira-bucket.tar.gz
docker compose up -d
```

PostgreSQLは最初の起動時に`publira`データベースを空の状態で作成し、復元がそれを埋めます。アーカイブをコンテナにコピーするのは、[データベースを復元する](#1-データベースを復元する)と同じく`pg_restore`が`publira_rls_bypass`のポリシーを除外できるようにするためで、そのポリシーは`db roles`が戻します。アーカイブは、RustFSが最初に起動する前に、バケットとその中のすべてのオブジェクトとともにRustFSのボリュームに入ります。Valkeyは何も保持しないので、空の状態で起動します。

これらのコマンドは、インストール環境の2つのボリュームがまだ存在しないホストを前提にしています。ホストにまだあるインストール環境の上に復元するには、先に`docker compose down -v`でインストール環境とそのボリュームを削除します。これはインストール環境が保持するすべての行とすべての画像を削除するので、バックアップが手元にあるときだけ実行してください。

その後、`publiractl`を`docker compose run --rm publiractl db version`と`docker compose run --rm publiractl storage test`として実行し、[復元を確認する](#復元を確認する)と同じく復元を確認して、バージョンを`publira.version`と比べます。

## 次のステップ

`db roles`、`storage`、`search reindex`が何をするかと、それぞれが受け取るすべてのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。古いリリースに復元した後にアップグレードを進める方法は[アップグレード](./8-upgrading.md)にあります。
