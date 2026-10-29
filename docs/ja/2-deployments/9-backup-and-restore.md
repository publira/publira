---
title: バックアップと復元
description: Publiraで何をバックアップするか、確実に復元できるバックアップの取り方、空のサービスにバックアップから復元する方法を説明します。
published: 2026-10-29
source_updated: 2026-10-28
---

Publiraは状態を3か所に保存します。PostgreSQLのデータベース、オブジェクトストレージのバケット、そしてオペレーターだけが持っているシークレットの暗号化キーです。どれか1つだけを復元しても完全には戻りません。データベースの行はバケットにない画像を指し、バケットにはどの行からも指されない画像が残り、データベース内の認証情報は誰も持っていないキーで暗号化されたままになります。このページでは、何をなぜバックアップするのか、正常に動く状態に復元できるバックアップの取り方、空のサービスにバックアップから復元する方法を説明します。

手順は、[インストール](./2-installing.md)の手順で自分で構築したPubliraを前提にしています。リポジトリのComposeファイルで動かしている場合も手順は同じで、使うコマンドだけが違います。そのコマンドは[Docker Composeで動かしている場合](#docker-composeで動かしている場合)で説明します。

コマンド中の`publiractl`は、[インストール](./2-installing.md#始める前に)と同じく、動かしているリリースの`publiractl`イメージを指します。実行するときは、各コマンドが読む変数を渡します。`db`は管理用ログインの接続URLである`PUBLIRA_DB_URL`を読みます。`storage`は`PUBLIRA_PLATFORM_DB_URL`を、`search reindex`は`PUBLIRA_CONTENT_STATS_DB_URL`を読み、どちらも`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`も読みます。CIでは、スキーマが変わるたびにこれらのコマンドでバックアップを取って復元しています。その処理は[`scripts/backup-and-restore.sh`](https://github.com/publira/publira/blob/main/scripts/backup-and-restore.sh)にあります。

## バックアップするもの

| 対象 | 中身 | バックアップ |
| --- | --- | --- |
| PostgreSQLのデータベース | Publiraが保存するすべてのデータと、まだ実行していない処理 | 必要 |
| オブジェクトストレージのバケット | アップロードされたすべての画像 | 必要。データベースのあとに取ります |
| シークレットの暗号化キー | 保存されたすべての認証情報の暗号化に使うキー | 必要。データベースとは別に保管します |
| そのほかのシークレット | ロールのパスワード、署名キー、プロセス間で共有するトークン | 保管しておきます。どれも作り直せます |
| Valkey | キャッシュとカウンター | 不要 |
| 検索エンジンのインデックス | OpenSearchかElasticsearchで検索している場合の、カタログのコピー | 不要。データベースから再構築します |

### データベース

データベースには、すべてのテナントとアカウント、カタログ、すべてのコメントと購入、プラットフォームと各テナントのすべての設定が入っています。まだ実行していない処理も入っています。送信待ちのメールとプッシュ通知、そして`publira worker`のジョブキューです。ジョブキューのテーブルは、Publira自身のテーブルと同じデータベースにあります。バケットの中身については、データベースが基準になります。Publiraにとって画像が存在するのは、その画像を指す行があるときです。

### バケット

バケットには、スタッフがアップロードしたすべての画像(表紙、エピソードのページ、ロゴ、著者の写真)が入っています。1枚の画像は`tenants/`の下に、サイズと形式ごとに1つずつのオブジェクトとして保存されます。データベースの行がオブジェクトをキーで指しており、Publiraはバケットにそれ以外のものを置きません。

### シークレットの暗号化キー

`PUBLIRA_SECRET_ENCRYPTION_KEYS`と`PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`は、Publiraのどこにも保存されていません。データベースには、次の認証情報がこのキーで暗号化されて保存されています。

- プラットフォームのSMTPのパスワード、オブジェクトストレージのシークレットキー、検索エンジンのパスワード、Web Pushの秘密鍵。
- 各テナント独自のSMTPのパスワードと、決済サービス、App Store、Google Play、Firebase、Sign in with Apple、受信メールの認証情報。
- 2段階認証を有効にしたテナント管理画面の管理者全員の、2段階認証のシークレット。

キーなしでデータベースを復元すると、行はすべて戻りますが、これらはどれも読めません。ワーカーはメールを送れず、サーバーはバケットにアクセスできません。すべてのテナントが認証情報を入力し直す必要があり、どの管理者も認証アプリで2段階認証を通れなくなります。

キーの一覧にあるキーはすべて保管してください。ローテーションで使わなくなったキーも、そのキーで暗号化された値が残っているあいだは保管します。キーはデータベースのバックアップとは別の場所に保管してください。データベースのコピーとキーがそろうと、Publiraが保存しているすべての認証情報が読めてしまいます。

### バックアップが不要なもの

- **Valkey**には、画像変換のキャッシュ、レート制限のカウンター、Webアプリのキャッシュが入っています。どのエントリーもデータベースとバケットから作り直されるか、時間が経てば期限切れになります。そのため、空のValkeyで起動しても何も失われません。
- **検索エンジンのインデックス**(OpenSearchかElasticsearchで検索している場合)はデータベースから作られるので、復元のあとで[再構築](#5-検索インデックスを再構築する)します。
- **そのほかのシークレット**は、どれも作り直せます。ロールのパスワードは`publiractl db roles`で設定し直せます。アクセストークンの署名キーやWebアプリのセッションキーを新しくすると、全員が一度ログアウトされます。キャッシュの再検証のトークンとWebサービスのトークンは、共有するプロセスのあいだで一致していれば足ります。それでも、暗号化キーと一緒にシークレットストアに保管しておけば、こうした手間を省けます。
- **プロセスのイメージ**は、動かしているリリースのものを取得し直すか、自分でビルドしている場合はビルドし直します。バックアップを取るたびに、そのときのリリースを記録しておいてください。データベースのバックアップは、バックアップを取ったリリースのスキーマに復元するものだからです。

## バックアップを取る

`publira worker`を停止し、データベース、バケットの順にバックアップしてから、ワーカーを起動し直します。キーはバックアップのたびに変わるものではないので、キーを生成したときやローテーションしたときに、専用の安全な場所にコピーしておきます。

### 1. ワーカーを停止する

データベースのバックアップを始める前に`publira worker`のインスタンスをすべて停止し、バケットのコピーが終わるまで止めておきます。バケットからオブジェクトを削除するのは、ワーカーが行う孤立オブジェクトの削除だけです。ワーカーを止めておけば、データベースのバックアップが指すオブジェクトが、コピーされる前に削除されることはありません。バックアップ中は`publiractl job purge-orphan-images`も実行しないでください。

ワーカー以外はサービスを続けます。そのあいだにワーカーが行うはずだった処理(メール、プッシュ通知、キャッシュの再検証、予定時刻を迎えたエピソードの公開)はデータベースで待ち、ワーカーを起動するとすぐに実行されます。

### 2. データベースをバックアップする

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
```

`PUBLIRA_DB_URL`は[管理用ログイン](./2-installing.md#サービスを用意する)の接続URLです。`pg_dump`は、PostgreSQLサーバーと同じかそれより新しいメジャーバージョンのものを使います。`pg_dump`はすべてのテーブルを1つのスナップショットで読むので、プロセスが動いたままでも一貫したバックアップになり、開始時点でコミット済みのデータが含まれます。

`db version`はデータベースのスキーマのバージョンを出力します。このバージョンが、バックアップの復元先となるリリースを表します。`publira.version`とリリースのタグを、バックアップと一緒に保管してください。

マネージドPostgreSQLのスナップショットでもかまいません。スナップショットはプロバイダーが案内する方法で復元し、ロールもあわせて戻ります。

### 3. バケットをバックアップする

`aws s3 sync`や`rclone copy`など、バケット全体をコピーできるS3クライアントで、バケットのすべてのオブジェクトを別の場所のストレージにコピーします。コピー先から何も削除しない方法でコピーしてください。この2つのコマンドはどちらも削除しません。また、毎回同じコピー先にコピーしてください。そうすれば、最新のバックアップだけでなく、保管しているどのデータベースのバックアップについても、必要なオブジェクトがコピー先にそろいます。AWS CLIでバケット`publira-images`からディレクトリ`publira-bucket`にコピーする場合は、次のようにします。

```bash
aws s3 sync s3://publira-images publira-bucket
```

2つのバックアップの整合性は、この順序で保たれます。アップロードでは、先にオブジェクトを書き込み、そのあとでそれを指す行を書き込みます。また、オブジェクトが書き換えられることはありません。そのため、データベースのバックアップの行が指すオブジェクトは、どれもバックアップの開始時点でバケットにありました。ワーカーが止まっていれば、コピーされる前に削除されることもないので、バケットのバックアップにはそれらがすべて含まれます。

コピーが終わるまでワーカーを止めておく理由もここにあります。データベースのバックアップを始めたあとに画像が差し替えられると、古いオブジェクトはバックアップの行からは指されていますが、稼働中のデータベースのどの行からも指されていません。孤立オブジェクトの削除はどの行からも指されていないオブジェクトを削除するので、コピー中に実行されると、コピーされる前にそれらを削除してしまうおそれがあります。そうなると、復元した行が、バケットにもそのバックアップにもないオブジェクトを指すことになります。

バケットのバックアップには、データベースのバックアップが指す以上のオブジェクトが入ります。コピー中にアップロードされた画像と、コピー先を最初に使ってから差し替えられた画像がすべて残るからです。増えるのは容量だけで、ほかに困ることはありません。復元したあとは、復元したどの行からも指されていないオブジェクトを孤立オブジェクトの削除が消します。

逆の順序でコピーすると、2つのバックアップのあいだにアップロードされた画像がバケットのバックアップから抜け落ちます。データベースのバックアップから復元したそれらの画像の行は、存在しないオブジェクトを指します。その画像は、サイトでも管理画面でも壊れた状態で表示されます。

### 4. ワーカーを起動する

停止したインスタンスをすべて起動します。ワーカーは停止中に待っていた処理を送り、そのあいだに予定時刻を過ぎたエピソードをすべて公開します。

## 空の環境に復元する

バックアップを取ったリリースに、そのリリースの`publiractl`イメージで復元します。新しいリリースで動かしたい場合は、先に復元してから[アップグレード](./8-upgrading.md)します。

[インストール](./2-installing.md#サービスを用意する)の手順のとおりにサービスを用意します。必要なのは、同じかそれより新しいメジャーバージョンのPostgreSQLサーバーと空のデータベース、空のバケット、空のValkeyです。`db migrate`は実行しないでください。スキーマはバックアップに含まれています。

### 1. データベースを復元する

```bash
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction`を付けると、すべてが復元されるか、何も復元されないかのどちらかになります。途中で止まった場合、失敗した箇所より後のテーブルが欠けた状態ではなく、空のデータベースが残ります。これはワーカーを起動したときに重要です。ワーカーは、どの行からも指されていないオブジェクトをバケットからすべて削除するからです。

`--no-owner`と`--no-acl`により、6つのロールへの権限と、`publira_outbox`がジョブキューのテーブルを所有する設定は復元されません。また、リストから`publira_rls_bypass`という名前のポリシーを除いています。このポリシーは、テナントをまたいで動くロールがすべてのテナントの行を読めるようにするものです。ロールはデータベースではなくPostgreSQLサーバーに属するので、新しいサーバーにはまだありません。そのため、ロールを名指しする文はどれも失敗してしまいます。これらを除くと、すべてのオブジェクトは管理用ログインの所有になり、権限とポリシーは次の手順で戻ります。

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

これは、インストール時に[ロールの作成](./2-installing.md#2-ロールを作成する)で実行するコマンドと同じです。各パスワードは、コンテナの`/run/secrets`にマウントしたファイルから読みます。ここでの動作もインストール時と同じで、6つのロールを作成してリリースが定義する権限を与え、ジョブキューのテーブルを`publira_outbox`の所有にしてほかのロールからは触れられないようにし、すべてのパスワードを設定します。以前と同じパスワードを使えば、プロセスの接続URLはそのまま使えます。新しいパスワードにした場合は、接続URLを更新してください。

### 3. バケットを復元する

バケットのバックアップのすべてのオブジェクトを、同じキーで新しいバケットにコピーします。AWS CLIで、バックアップのコピー先にしたディレクトリからコピーする場合は、次のようにします。

```bash
aws s3 sync publira-bucket s3://publira-images
```

バケットの名前、アドレス、認証情報が以前と同じなら、ほかに変えるものはありません。違う場合は、`setup`で古いバケットを保存したときと同じように、新しいバケットを保存してテストします。

```bash
publiractl storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

Amazon S3以外のストレージでは`--endpoint`と`--force-path-style`も指定します。`storage set`のすべてのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage)にあります。

### 4. プロセスを起動する

`publira server`、`publira worker`、`web-storefront`、`web-admin`を起動します。`web-platform`と`email-renderer`も動かしている場合は、それらも起動します。暗号化キーは以前と同じものを使います。そのほかのシークレットは、保管しておいたものでも新しいものでもかまいません。新しくする場合は[シークレットの生成](./2-installing.md#シークレットを生成する)の説明に従って設定します。

プロセスは空のValkeyにつないで起動してください。復元前のPubliraが使っていたValkeyには、復元で巻き戻る前のデータからキャッシュしたページや画像が残っています。そのままでは、Webアプリはエントリーが期限切れになるまでそれを返し続けます。そのValkeyをほかの用途に使っていなければ、`FLUSHALL`で空にします。

### 5. 検索インデックスを再構築する

OpenSearchかElasticsearchで検索している場合は、復元したデータベースからインデックスを再構築します。

```bash
publiractl search reindex
```

復元後もインデックスが残っていると、バックアップのあとに公開されたものが検索で見つかり、復元したデータベースにはもうないシリーズへのリンクが表示されます。インデックスが失われていると、検索結果は空になります。既定の検索、つまりデータベース自体で検索している場合は、再構築するものはありません。

### ワーカーが取り戻す処理

`publira worker`は、バックアップの時点から自分が止まっていたかのように復元したデータベースを扱い、起動するとすぐに遅れを取り戻します。

- **メールと通知。** バックアップの時点で送信待ちだったものは、プッシュ通知とキャッシュの再検証も含めてすべて送られます。その一部は、バックアップのあと、Publiraが失われる前にすでに送られているので、同じメールを2回受け取る読者やスタッフが出ます。
- **予定された処理。** バックアップ以降に予定時刻を過ぎたエピソードがすべて公開されます。キャッシュ済みのページには、そのあいだに始まったり終わったりした無料公開期間が反映され、期限が切れた固定表示のお知らせは固定が解除されます。
- **日次の再構築。** 閲覧の統計、ランキング、おすすめが、バックアップに含まれる閲覧の記録をもとに、バックアップ以降の各日について再構築されます。
- **孤立オブジェクトの削除。** 最初の削除で、復元したどの行からも指されておらず、作成から1日以上経ったオブジェクトが削除されます。つまり、バックアップのあとにアップロードされた画像です。

### 復元で戻らないもの

バックアップのあとに書き込まれたものは、すべて戻りません。読者が作ったアカウント、コメント、アップロード、設定、購入です。そのあいだの購入は決済サービス、App Store、Google Playではすでに課金されていますが、Publiraには記録が残っていないので、購入者はそのエピソードを開けなくなります。バックアップの時点からPubliraが失われた時点までについて、各サービスの記録を確認して該当する購入を探してください。

## 復元を確認する

- `db version`が、バックアップと一緒に`publira.version`に保管したバージョンを示し、dirty状態でないこと。

  ```bash
  publiractl db version
  ```

- どのプロセスも`GET /readyz`に準備完了と応答すること。`publira server`と`publira worker`はデータベースのログインごとに1つのチェック結果を返すので、パスワードが接続URLと一致しないロールがあればここでわかります。
- `storage test`が成功すること。このコマンドは、データベースに暗号化して保存されたシークレットキーでバケットにアクセスするので、暗号化キーが正しいことの確認にもなります。

  ```bash
  publiractl storage test
  ```

- テナント管理画面にログインでき、テナントのサイトが画像付きで表示されること。シリーズの表紙と、バックアップの少し前にアップロードしたエピソードのページを確認します。

一度も復元を試したことのないバックアップは、バックアップとは言えず、そうであってほしいという期待にすぎません。ときどき予備のサービスに復元して、この一覧で確認してください。

## Docker Composeで動かしている場合

[Docker Compose](./3-docker-compose.md)の構成では、データベースは`publira-deploy_postgres-data`ボリュームに、バケットは`publira-deploy_rustfs-data`に、暗号化キーとそのほかのすべてのシークレットは`.env`にあります。各コマンドは、Publiraを動かしているディレクトリで実行します。リリースのアーカイブを展開したディレクトリか、チェックアウトの`infra/deploy/`です。

### バックアップを取る

```bash
docker compose stop server
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs server
```

ワーカーを停止する理由は[ワーカーの停止](#1-ワーカーを停止する)で説明したとおりです。ワーカーは`server`の中で動いているのでAPIも一緒に止まり、`server`を起動し直すまでテナントのサイトと管理画面は応答しません。`-T`を付けるのは、出力が端末を経由して壊れるのを防ぐためです。

RustFSのイメージにはS3クライアントが入っていないので、バケットはオブジェクト単位ではなく、RustFSがボリュームに保存しているファイルとしてバックアップします。ファイルをコピーするあいだはRustFSを停止しておく必要があります。停止しないと、書き込み途中のオブジェクトがアーカイブに入るおそれがあります。ComposeファイルではRustFSのイメージを固定しているので、同じリリースのComposeファイルを使えば、同じRustFSでアーカイブを復元できます。

`publira.dump`、`publira.version`、`publira-bucket.tar.gz`はホストの外にコピーしてください。インストール時に作った`.env`のコピーは、ホストとも、これらのファイルとも別の場所に保管します。

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

PostgreSQLは最初の起動時に空の`publira`データベースを作り、そこにバックアップを復元します。ダンプをコンテナの中にコピーするのは、[データベースの復元](#1-データベースを復元する)と同じく`pg_restore`で`publira_rls_bypass`のポリシーを除くためです。このポリシーは`db roles`で戻ります。バケットのアーカイブは、RustFSを初めて起動する前に、バケットとその中のすべてのオブジェクトごとRustFSのボリュームに展開します。Valkeyは何も保持しないので、空のまま起動します。

これらのコマンドは、Publiraの2つのボリュームがまだないホストを前提にしています。ホストに残っているPubliraに上書きして復元する場合は、先に`docker compose down -v`で既存のPubliraとそのボリュームを削除します。これを実行すると、保存されているすべての行と画像が削除されるので、バックアップが手元にあるときだけ実行してください。

その後、[復元を確認する](#復元を確認する)の手順で復元を確認します。`publiractl`は`docker compose run --rm publiractl db version`や`docker compose run --rm publiractl storage test`として実行し、バージョンを`publira.version`と比べます。

## 次のステップ

`db roles`、`storage`、`search reindex`の動作と、それぞれのすべてのフラグは[`publiractl`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md)にあります。古いリリースに復元したあとでアップグレードを進める方法は[アップグレード](./8-upgrading.md)で説明しています。
