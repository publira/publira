---
title: バックアップと復元
description: Publiraが保持していてバックアップすべきもの、確実に復元できるバックアップの取り方、空のサービスにPubliraを復元する方法を説明します。
published: 2026-10-29
updated: 2026-10-31
source_updated: 2026-10-28
---

Publiraは状態を3か所に持っています。PostgreSQLのデータベース、オブジェクトストレージのバケット、そして自分だけが持っているシークレットの暗号化キーです。どれか1つだけを復元しても元には戻りません。データベースの行はバケットにない画像を指し、バケットにはどの行からも指されない画像が残り、データベースの認証情報は誰も持っていないキーで暗号化されたままになります。このページでは、何をなぜバックアップするのか、動く状態に復元できるバックアップの取り方、空のサービスにバックアップから復元する方法を説明します。

手順は、[インストール](./2-installing.md)の手順で自分で構築したPubliraを前提にしています。リポジトリのComposeファイルで動かしている場合も手順は同じで、使うコマンドだけが違います。そのコマンドは[Docker Composeで動かしている場合](#docker-composeで動かしている場合)で説明しています。

コマンドの`publiractl`は、[インストール](./2-installing.md#始める前に)と同じく、動かしているリリースの`publiractl`イメージのことです。実行するときは、各コマンドが読む変数を渡します。`db`が読むのは、管理用ログインの接続URLの`PUBLIRA_DB_URL`です。`storage`は`PUBLIRA_PLATFORM_DB_URL`を、`search reindex`は`PUBLIRA_CONTENT_STATS_DB_URL`を読み、どちらも`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`も読みます。CIでは、スキーマが変わるたびにこれらのコマンドでバックアップを取って復元しています。その処理は[`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)にあります。

## バックアップするもの

| 対象 | 中身 | バックアップ |
| --- | --- | --- |
| PostgreSQLのデータベース | Publiraが保存するすべてのデータと、まだ済んでいない処理 | 必要です |
| オブジェクトストレージのバケット | アップロードされたすべての画像 | 必要です。データベースのあとに取ります |
| シークレットの暗号化キー | 保存したすべての認証情報の暗号化に使うキー | 必要です。データベースとは別に保管します |
| ほかのシークレット | ロールのパスワード、署名キー、プロセス同士で共有するトークン | 保管しておきます。どれも作り直せます |
| Valkey | キャッシュとカウンター | 不要です |
| 検索エンジンのインデックス | OpenSearchかElasticsearchで検索している場合の、カタログのコピー | 不要です。データベースから作り直します |

### データベース

データベースには、すべてのテナントとアカウント、カタログ、すべてのコメントと購入、プラットフォームと各テナントのすべての設定が入っています。まだ済んでいない処理も入っています。送信を待っているメールとプッシュ通知と、`publira worker`のジョブキューです。ジョブキューのテーブルは、Publira自身のテーブルと同じデータベースにあります。バケットの中身はデータベースを基準に決まり、Publiraにとって画像が存在するのは、その画像を指す行があるときです。

### バケット

バケットには、スタッフがアップロードしたすべての画像が入っています。表紙、エピソードのページ、ロゴ、著者アイコンなどです。1枚の画像は、`tenants/`の下にサイズと形式ごとのオブジェクトとして保存されます。データベースの行が各オブジェクトをキーで指していて、Publiraはバケットにそれ以外のものを置きません。

### シークレットの暗号化キー

`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`は、Publiraのどこにも保存されていません。データベースには、次の認証情報がこのキーで暗号化して保存されています。

- プラットフォームのSMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵
- 各テナント独自のSMTPのパスワードと、決済プロバイダー、App Store、Google Play、Firebase、Sign in with Apple、メール受信の認証情報
- 2段階認証を有効にしたテナント管理画面の管理者全員の、2段階認証のシークレット

キーなしでデータベースを復元すると、行はすべて戻っても、これらはどれも読めません。ワーカーはメールを送れず、サーバーはバケットにアクセスできません。すべてのテナントが認証情報を入力し直すことになり、どの管理者も認証アプリで2段階認証を通れなくなります。

キーの一覧にあるキーは、すべて保管してください。ローテーションで使わなくなったキーも、そのキーで暗号化した値が残っている間は保管します。キーはデータベースのバックアップとは別の場所に置いてください。データベースのコピーとキーがそろえば、Publiraが保存しているすべての認証情報が読めてしまいます。

### バックアップが不要なもの

#### Valkey

Valkeyには、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュが入っています。どのエントリーも、データベースとバケットから作り直されるか、時間がたてば期限切れになります。空のValkeyで起動しても、何も失われません。

#### 検索エンジンのインデックス

OpenSearchかElasticsearchで検索している場合のインデックスは、データベースから作られます。復元のあとで[作り直します](#5-検索インデックスを再構築する)。

#### ほかのシークレット

どれも作り直せます。ロールのパスワードは`publiractl db roles`で設定し直せます。アクセストークンの署名キーやWebアプリのセッションキーを新しくすると、全員が一度ログアウトされます。キャッシュ再検証トークンとWebサービストークンは、共有するプロセスの間で一致していれば十分です。それでも、暗号化キーと一緒にシークレットストアに保管しておけば、この手間が省けます。

#### プロセスのイメージ

動かしているリリースのイメージをpullし直すか、自分でビルドしているならビルドし直します。バックアップを取るたびに、そのときのリリースを記録しておいてください。データベースのバックアップは、取ったときのリリースのスキーマに復元するものだからです。

## バックアップを取る

`publira worker`を止め、データベース、バケットの順にバックアップしてから、ワーカーを起動し直します。キーはバックアップのたびに変わるものではありません。キーを生成したときやローテーションしたときに、専用の安全な場所にコピーしておきます。

### 1. ワーカーを停止する

データベースのバックアップを始める前に、`publira worker`のレプリカをすべて止め、バケットのコピーが終わるまで止めておきます。バケットからオブジェクトを削除するのは、ワーカーが行う孤立オブジェクトの削除だけです。ワーカーが止まっていれば、データベースのバックアップが指すオブジェクトが、コピーされる前に消えることはありません。バックアップ中は`publiractl job purge-orphan-images`も実行しないでください。

ワーカー以外は提供を続けます。その間にワーカーがするはずだった処理は、データベースで待ち、ワーカーを起動するとすぐに実行されます。メール、プッシュ通知、キャッシュの再検証、予定の時刻が来たエピソードの公開です。

### 2. データベースをバックアップする

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`は[管理用ログイン](./2-installing.md#サービスを用意する)の接続URLです。`pg_dump`は、PostgreSQLサーバーと同じかそれより新しいメジャーバージョンのものを使ってください。`pg_dump`はすべてのテーブルを1つのスナップショットで読むので、プロセスが動いたままでも一貫したバックアップになり、開始した時点でコミットされていたものが入ります。

`db version`はデータベースのスキーマのバージョンを出力します。これが、バックアップを復元できるリリースを表します。`publira.version`とリリースのタグを、バックアップと一緒に保管してください。

マネージドのPostgreSQLのスナップショットでも構いません。スナップショットは提供元が案内する方法で復元し、ロールも一緒に戻ります。

### 3. バケットをバックアップする

`aws s3 sync`や`rclone copy`のように、バケット全体をコピーできるS3クライアントで、バケットのすべてのオブジェクトを別の場所のストレージにコピーします。コピー先から何も削除しない方法を使ってください。この2つのコマンドはどちらも削除しません。コピー先も毎回同じにします。そうすれば、最新のバックアップだけでなく、保管しているどのデータベースのバックアップにとっても、必要なオブジェクトがコピー先にそろいます。AWS CLIでバケット`publira-images`からディレクトリ`publira-bucket`にコピーするなら、次のとおりです。

```bash
aws s3 sync s3://publira-images publira-bucket
```

2つのバックアップが食い違わないのは、この順序のおかげです。アップロードでは、先にオブジェクトを書き、そのあとでそれを指す行を書きます。オブジェクトが書き換えられることもありません。そのため、データベースのバックアップの行が指すオブジェクトは、どれもバックアップを始めた時点でバケットにありました。ワーカーが止まっていれば、コピーされる前に削除されることもないので、バケットのバックアップにすべて入ります。

コピーが終わるまでワーカーを止めておくのも、同じ理由からです。データベースのバックアップを始めたあとで差し替えられた画像は、古いオブジェクトがバックアップの行からは指されていても、稼働中のデータベースのどの行からも指されていません。孤立オブジェクトの削除はどの行からも指されていないオブジェクトを消すので、コピー中に動くと、コピーされる前にそれらを消してしまうおそれがあります。そうなると、復元した行が、バケットにもそのバックアップにもないオブジェクトを指すことになります。

バケットのバックアップには、データベースのバックアップが指す以上のオブジェクトが入ります。コピー中にアップロードされた画像と、コピー先を初めて使ってから差し替えられた画像がすべて残るからです。増えるのは容量だけで、困ることはありません。復元したあとは、復元したどの行からも指されていないオブジェクトを、孤立オブジェクトの削除が消します。

逆の順序でコピーすると、2つのバックアップの間にアップロードされた画像がバケットのバックアップから抜け落ちます。データベースのバックアップから復元したそれらの画像の行は、存在しないオブジェクトを指します。その画像は、サイトでも管理画面でも壊れた状態で表示されます。

### 4. ワーカーを起動する

止めたレプリカをすべて起動します。ワーカーは止まっている間に待っていたものを送り、その間に予定の時刻を過ぎたエピソードをすべて公開します。

## 空の環境に復元する

バックアップを取ったリリースに、そのリリースの`publiractl`イメージで復元します。新しいリリースで動かしたいなら、先に復元してから[アップグレード](./8-upgrading.md)します。

[インストール](./2-installing.md#サービスを用意する)の手順どおりにサービスを用意します。必要なのは、同じかそれより新しいメジャーバージョンのPostgreSQLサーバーと空のデータベース、空のバケット、空のValkeyです。スキーマはバックアップに入っているので、`db migrate`は実行しないでください。

### 1. データベースを復元する

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`を付けると、すべて復元されるか、何も復元されないかのどちらかになります。途中で止まっても、失敗したところより後のテーブルが欠けたデータベースではなく、空のデータベースが残ります。これはワーカーを起動したときに効いてきます。ワーカーは、どの行からも指されていないオブジェクトをバケットからすべて削除するからです。

`--no-owner`と`--no-acl`によって、6つのロールへの権限と、ジョブキューのテーブルを`publira_outbox`が所有する設定は復元されません。リストからは、`publira_rls_bypass`という名前のポリシーも除いています。テナントをまたいで働くロールがすべてのテナントの行を読めるようにするポリシーです。ロールはデータベースではなくPostgreSQLサーバーのものなので、新しいサーバーにはまだなく、ロールを名指しする文はどれも失敗してしまいます。これらを除くと、すべてのオブジェクトは管理用ログインの所有になります。権限とポリシーは次の手順で戻ります。

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

インストールのときに[ロールを作成する](./2-installing.md#2-ロールを作成する)で実行するのと同じコマンドで、各パスワードはコンテナの`/run/secrets`にマウントしたファイルから読みます。ここでもインストールのときと同じことをします。6つのロールを作ってリリースが定める権限を与え、ジョブキューのテーブルを`publira_outbox`の所有にしてほかのロールから遠ざけ、すべてのパスワードを設定します。以前と同じパスワードを使えば、プロセスの接続URLはそのまま使えます。新しいパスワードにしたなら、接続URLを更新してください。

### 3. バケットを復元する

バケットのバックアップのすべてのオブジェクトを、同じキーで新しいバケットにコピーします。AWS CLIで、バックアップのコピー先にしたディレクトリからコピーするなら、次のとおりです。

```bash
aws s3 sync publira-bucket s3://publira-images
```

バケットの名前、アドレス、認証情報が以前と同じなら、ほかに変えるものはありません。違うなら、`setup`が古いバケットを保存したときと同じように、新しいバケットを保存してテストします。

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

Amazon S3以外のストレージなら、`--endpoint`と`--force-path-style`も指定します。`storage set`のすべてのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)にあります。

### 4. プロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`を起動します。`web-platform`と`email-renderer`も動かしているなら、それも起動します。暗号化キーは以前と同じものを使います。ほかのシークレットは保管しておいたものでも新しいものでも構いません。新しくするなら、[シークレットを生成する](./2-installing.md#シークレットを生成する)に従って設定します。

プロセスは空のValkeyにつないで起動してください。復元前のPubliraが使っていたValkeyには、復元で巻き戻る前のデータからキャッシュしたページや画像が残っていて、Webアプリはエントリーが期限切れになるまでそれを返し続けます。そのValkeyをほかに使っていなければ、`FLUSHALL`で空にします。

### 5. 検索インデックスを再構築する

OpenSearchかElasticsearchで検索しているなら、復元したデータベースからインデックスを作り直します。

```bash
publiractl search reindex
```

復元後もインデックスが残っていると、バックアップのあとに公開したものが検索で見つかり、復元したデータベースにはもうないシリーズへのリンクが出ます。インデックスが失われていれば、検索結果は空になります。既定の検索、つまりデータベース自体で検索しているなら、作り直すものはありません。

### ワーカーが取り戻す処理

`publira worker`は、復元したデータベースを、バックアップの時点から自分が離れていたデータベースとして扱い、起動するとすぐに遅れを取り戻します。

| 処理 | 起動後に起きること |
| --- | --- |
| メールと通知 | バックアップの時点で送信を待っていたものが、プッシュ通知とキャッシュの再検証も含めてすべて送られます。その一部は、バックアップのあと、Publiraが失われる前にすでに送られているので、同じメールを2回受け取る読者やスタッフが出ます |
| 予定された処理 | バックアップのあとに予定の時刻を過ぎたエピソードがすべて公開されます。キャッシュしたページには、その間に始まったり終わったりした無料公開期間が反映され、期限が過ぎた固定表示のお知らせは固定が外れます |
| 日次の再構築 | 閲覧の統計、ランキング、おすすめが、バックアップにある閲覧の記録をもとに、バックアップ以降の毎日の分について作り直されます |
| 孤立オブジェクトの削除 | 最初の削除で、復元したどの行からも指されず、作られてから1日たったオブジェクトが消えます。バックアップのあとにアップロードされた画像です |

### 復元で戻らないもの

バックアップのあとに書き込まれたものは、何も戻りません。読者が作ったアカウント、コメント、アップロード、設定、購入です。その間の購入は、決済プロバイダー、App Store、Google Playではすでに課金されていても、Publiraには記録がないので、購入者はそのエピソードを開けなくなります。バックアップの時点からPubliraが失われた時点までの各プロバイダーの記録で、該当する購入を探してください。

## 復元を確認する

次の4つを確かめます。

- `db version`が、バックアップと一緒に`publira.version`に保管したバージョンを示し、dirtyになっていません。

  ```bash
  publiractl db version
  ```

- どのプロセスも`GET /readyz`に準備完了と応答します。`publira server`と`publira worker`はデータベースのログインごとのチェック結果を返すので、パスワードが接続URLと合わないロールがあればここに名前が出ます。
- `storage test`が成功します。このコマンドは、データベースに暗号化して保存したシークレットキーでバケットにアクセスするので、暗号化キーが正しいことの確認にもなります。

  ```bash
  publiractl storage test
  ```

- テナント管理画面にログインでき、テナントのサイトが画像付きで開きます。シリーズの表紙と、バックアップの少し前にアップロードしたエピソードのページを見てください。

一度も復元したことのないバックアップは、バックアップではなく願望にすぎません。ときどき予備のサービスに復元して、この一覧で確かめてください。

## Docker Composeで動かしている場合

[Docker Compose](./3-docker-compose.md)の構成では、データベースは`publira-deploy_postgres-data`のボリュームに、バケットは`publira-deploy_rustfs-data`に、暗号化キーとほかのすべてのシークレットは`.env`にあります。各コマンドは、Publiraを動かしているディレクトリで実行します。リリースのアーカイブを展開したディレクトリか、チェックアウトした`infra/deploy/`です。

### バックアップを取る

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

ワーカーを止める理由は[ワーカーを停止する](#1-ワーカーを停止する)で説明したとおりです。ワーカーは`server`の中で動いているのでAPIも一緒に止まり、`server`を起動し直すまでテナントのサイトと管理画面は応答しません。`-T`を付けるのは、出力が端末を通って壊れるのを防ぐためです。

RustFSのイメージにはS3クライアントが入っていないので、バケットはオブジェクトごとではなく、RustFSがボリュームに置いているファイルとしてバックアップします。ファイルをコピーする間はRustFSを止めておいてください。止めないと、書き込みの途中のオブジェクトがアーカイブに入るおそれがあります。ComposeファイルはRustFSのイメージを固定しているので、同じリリースのComposeファイルを使えば、同じRustFSでアーカイブを復元できます。

`publira.dump`、`publira.version`、`publira-bucket.tar.gz`はホストの外にコピーしてください。インストールのときに作った`.env`のコピーは、ホストとも、これらのファイルとも別の場所に保管します。

### 復元する

バックアップを取ったリリースのアーカイブから、[Composeファイルのダウンロード](./3-docker-compose.md#composeファイルのダウンロード)の手順でComposeファイルを展開したホストを用意します。`.env`を`compose.yaml`と同じディレクトリに戻し、次を実行します。

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

PostgreSQLは最初の起動時に空の`publira`データベースを作り、そこにバックアップを復元します。ダンプをコンテナの中にコピーするのは、[データベースを復元する](#1-データベースを復元する)と同じく、`pg_restore`で`publira_rls_bypass`のポリシーを除くためです。このポリシーは`db roles`で戻ります。バケットのアーカイブは、RustFSを初めて起動する前に、バケットとその中のすべてのオブジェクトごとRustFSのボリュームに展開します。Valkeyは何も持たないので、空で起動します。

これらのコマンドは、Publiraの2つのボリュームがまだないホストを前提にしています。ホストに残っているPubliraの上に復元するなら、先に`docker compose down -v`でそのPubliraとボリュームを削除します。保存されているすべての行と画像が消えるので、バックアップが手元にあるときだけ実行してください。

そのあと、[復元を確認する](#復元を確認する)の手順で確かめます。`publiractl`は`docker compose run --rm publiractl db version`と`docker compose run --rm publiractl storage test`のように実行し、バージョンを`publira.version`と比べます。

## 次のステップ

`db roles`、`storage`、`search reindex`の動作とすべてのフラグは、[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。古いリリースに復元したあとでアップグレードを進めるには、[アップグレード](./8-upgrading.md)を参照してください。
