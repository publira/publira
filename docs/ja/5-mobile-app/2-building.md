---
title: ビルドと署名
description: マニフェストをもとに、テナントのアプリの署名済みAndroid App BundleとiOSのアーカイブを作成します。
published: 2026-10-29
source_updated: 2026-10-25
---

テナントのアプリのリリース版は、`task mobile:build`という1つのコマンドで、Android用とiOS用に1回ずつビルドします。このコマンドは[アプリマニフェスト](./1-app-manifest.md)を読み込み、ビルドを始める前にすべての入力を確かめてから、手を加えていないチェックアウトからストア向けのアプリをビルドします。このページでは、まずコマンドが環境から読み取る入力を、次にAndroidとiOSのビルドを説明します。

コマンドで使えるフラグは、すべて[モバイルアプリのリファレンス](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app)に載っています。

## すべてのビルドに必要なもの

### アプリの接続先

テナントのサイトのオリジンを`PUBLIRA_BASE_URL`に設定してexportします。アプリはこのオリジンの`/rpc`以下にAPIを、`/images`以下に画像を要求します。どちらも、Publiraの前に置いたリバースプロキシがすでに振り分けているパスです。

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

値は`https://`で始まり、パスを含まないオリジンでなければなりません。それ以外の値はビルドの時点で拒否します。読者のスマートフォンで初めて失敗するアプリを配布しないためです。通常はマニフェストの`tenant.host`と同じホストですが、マニフェストで決まるわけではありません。[画像と公開APIを別々に提供する方法](../2-deployments/7-scaling-out.md#画像と公開apiを別々に提供する)で説明しているとおり、APIを別のホスト名で提供する構成もあります。そのようなホストは画像を提供しないので、そこに向けてビルドする前に、テナントに[画像用のホスト](../3-operations/2-tenants.md#画像ホスト)を設定してください。設定すると、アプリはAPIが返すアドレスに従って、すべての画像を画像用のホストから読み込みます。

### プッシュ通知

アプリがプッシュ通知を受け取るFirebaseプロジェクトは、ビルド時にアプリに組み込まれます。最初のリリースの前に[プッシュ通知](./3-push-notifications.md)の説明に従って設定し、その値を`~/example-reader/firebase.json`のような専用のファイルに保存しておいてください。Firebaseの値を渡さずにビルドしてもアプリは動きますが、プッシュ通知は届かず、アプリの**アカウント**画面にもプッシュ通知のスイッチが表示されません。

### バージョン

ストアにアップロードするたびに、そのストアが前回受け付けたものより大きいビルド番号が必要です。読者にはバージョン名が表示されます。リリース用のビルドでは、毎回この2つを指定してください。

```bash
--build-name 1.2.0 --build-number 7
```

指定しないとバージョン名は`1.0.0`、ビルド番号は`1`になり、2回目以降のアップロードはストアに拒否されます。

## Android

### アップロード鍵を作成する

Google Playにアップロードするビルドは、すべて同じ鍵で署名しなければなりません。この鍵をアップロード鍵と呼びます。ビルドするマシンかシークレットの保管場所で、一度だけ作成します。

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool`はどのJDKにも含まれています。実行すると、キーストアのパスワードと鍵のパスワードを尋ねられます。キーストアのファイルと2つのパスワードはリポジトリの外に保管し、バックアップを取っておいてください。アップロード鍵をなくしてもPlay Consoleで置き換えられますが、Googleの承認が要る申請が必要で、承認されるまではアップロードできません。

Google Playの新しいアプリはPlay App Signingを使います。インストールされるアプリの署名に使う鍵はGoogleが保管し、アップロード鍵は、アップロードしたのが自分であることを証明するためだけに使います。この違いは[アプリリンク](./4-app-links.md)のページで改めて出てきます。

### App Bundleをビルドする

キーストアとパスワードを環境変数で指定してから、ビルドします。

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

コマンドはリポジトリのルートで実行してください。マニフェストやキーストアの相対パスは、コマンドを実行したディレクトリを基準に解釈されます。一方、Firebaseのファイルは`mobile/`を基準に解釈されるので、例ではフルパスで指定しています。

署名用の4つの環境変数のどれかが設定されていないと、ビルドはコンパイルの前に止まります。Google Playが受け付けない鍵で署名しないためです。アップロードするApp Bundleは`mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`です。

アップロードする前にスマートフォンでリリース版を試すには、同じ環境変数のまま`appbundle`の代わりに`apk`を指定してビルドし、`mobile/build/app/outputs/flutter-apk/app-production-release.apk`をインストールします。このビルドはアップロード鍵で署名されるので、アップロード鍵のフィンガープリントも[アプリリンク](./4-app-links.md)に登録しない限り、サイトへのリンクからは開けません。

## iOS

### Macを準備する

iOSアプリはXcodeを入れたMacでビルドします。**Xcode** › **Settings** › **Accounts**で、出版社のApple Developerチームに所属するAppleアカウントにログインします。ビルドは自動署名を使います。Xcodeが、アプリで使う機能(プッシュ通知、Associated Domains、Sign in with Apple)を付けてバンドルIDを登録し、証明書とプロファイルも作成するので、Apple Developerのウェブサイトから手作業でダウンロードするものはありません。

チームのTeam IDは、Apple Developerのウェブサイトの**Membership details**にある、英字と数字からなる10文字のIDです。これを環境変数で指定します。

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

同じTeam IDは、あとで[アプリリンク](./4-app-links.md)でも入力します。

### アーカイブをビルドする

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

アーカイブは`mobile/build/ios/archive/Runner.xcarchive`に、アップロードするファイルは`mobile/build/ios/ipa/`内の`.ipa`として出力されます。`.ipa`はAppleのTransporterアプリでアップロードするか、Xcodeの**Organizer**でアーカイブを開いて**Distribute App**を選びます。App Store Connectでの処理が終わると、TestFlightでスマートフォンでテストできるようになり、そのあと審査に提出できます。

実機向けのビルドは、`PUBLIRA_IOS_DEVELOPMENT_TEAM`が設定されていないと最初の段階で止まります。Xcodeがたまたま最初に見つけたチームで署名しないためです。

## ビルドが残すもの

ビルドがテナントの識別情報を書き込むのは、Gitが無視するファイルだけです。リポジトリで管理しているファイルに変更が残れば、ビルドは失敗します。そのため、同じチェックアウトを片付けずに、そのまま次のテナントのアプリや次のリリースをビルドできます。

次は[プッシュ通知](./3-push-notifications.md)です。
