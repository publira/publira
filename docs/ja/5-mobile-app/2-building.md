---
title: ビルドと署名
description: テナントのアプリの署名済みAndroid App BundleとiOSのアーカイブを、マニフェストから作成します。
published: 2026-10-29
source_updated: 2026-10-25
---

テナントのアプリのリリースは、`task mobile:build`という1つのコマンドで、Android用とiOS用に1回ずつビルドします。このコマンドは[アプリマニフェスト](./1-app-manifest.md)を読み、始める前にすべての入力を確認して、変更を加えていないチェックアウトからストア用のアプリをビルドします。このページでは、コマンドが環境から読み取る入力を説明し、そのあと2つのビルドを説明します。

コマンドが受け付けるすべてのフラグは、[モバイルアプリのリファレンス](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app)に載っています。

## すべてのビルドに必要なもの

### アプリの接続先のアドレス

テナントのサイトのオリジンを`PUBLIRA_BASE_URL`としてexportします。アプリはAPIを`/rpc`の下に、画像を`/images`の下に要求します。どちらもインストール環境のリバースプロキシがすでにルーティングしています。

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

`https://`で、パスのないオリジンだけである必要があります。それ以外の値は、読者のスマートフォンで初めて失敗するアプリを出荷するのではなく、ビルドが拒否します。通常はマニフェストの`tenant.host`と同じですが、マニフェストで決まるわけではありません。[画像と公開APIを別々に提供する](../2-deployments/7-scaling-out.md#画像と公開apiを分けて提供する)で説明しているとおり、インストール環境はAPIを別のホスト名で提供できます。そのようなホストは画像を提供しないため、そのホストに向けてビルドする前に、テナントに[画像用のホスト](../3-operations/2-tenants.md#画像ホスト)を設定してください。そうすると、アプリはすべての画像を、APIが返すアドレスで画像用のホストから読み込みます。

### プッシュ通知

アプリがプッシュ通知を受け取るFirebaseプロジェクトは、アプリに組み込まれます。[プッシュ通知](./3-push-notifications.md)の説明に従って最初のリリースの前に設定し、その値を`~/example-reader/firebase.json`のような専用のファイルに保存しておいてください。Firebaseの値を渡さずにビルドしてもアプリは動きますが、プッシュ通知はなく、アプリの**アカウント**画面にもプッシュ通知のスイッチが表示されません。

### バージョン

ストアへのアップロードでは、そのストアが前回受け付けたものより大きいビルド番号が毎回必要で、読者にはバージョン名が表示されます。リリース用のビルドには毎回両方を指定します。

```bash
--build-name 1.2.0 --build-number 7
```

指定しないとビルドは`1.0.0`、ビルド番号`1`になり、ストアは2回目以降のアップロードでこれを拒否します。

## Android

### アップロード鍵を作成する

Google Playでは、すべてのアップロードに同じ鍵での署名が必要です。この鍵をアップロード鍵と呼びます。ビルドするマシンかシークレットの保管場所で、一度だけ作成します。

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool`はどのJDKにも含まれており、キーストアのパスワードと鍵のパスワードを尋ねます。ファイルと2つのパスワードはリポジトリの外に保管し、バックアップを取ってください。Play Consoleでは失ったアップロード鍵を置き換えられますが、Googleの承認が必要な申請を通じてのみで、承認されるまでアップロードはできません。

Google Playの新しいアプリはPlay App Signingを使います。インストールされるアプリの署名に使う鍵はGoogleが保管し、アップロード鍵はアップロードが自分からのものであることを証明するだけです。この違いは[アプリリンク](./4-app-links.md)のページでもう一度重要になります。

### App Bundleをビルドする

キーストアとそのパスワードを環境で指定してから、ビルドします。

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

リポジトリのルートから実行してください。マニフェストやキーストアの相対パスは、実行を始めたディレクトリから読まれます。Firebaseのファイルは`mobile/`から読まれるため、例ではフルパスで指定しています。

署名用の4つの変数のどれかが欠けていると、Google Playが拒否する鍵で署名するのではなく、コンパイルの前にビルドが止まります。アップロードするApp Bundleは`mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`です。

アップロードする前にスマートフォンでリリース版を試すには、同じ変数のまま`appbundle`の代わりに`apk`をビルドし、`mobile/build/app/outputs/flutter-apk/app-production-release.apk`をインストールします。このビルドはアップロード鍵で署名されているため、アップロード鍵のフィンガープリントも[アプリリンク](./4-app-links.md)に登録しない限り、サイトへのリンクでこのアプリは開きません。

## iOS

### Macを準備する

iOSのビルドは、Xcodeを入れたMacで行います。**Xcode** › **Settings** › **Accounts**で、出版社のApple Developerチームに属するAppleアカウントにXcodeでサインインします。ビルドは自動署名を使います。Xcodeが、アプリが使う機能（プッシュ通知、Associated Domains、Sign in with Apple）とともにバンドルIDを登録し、証明書とプロファイルも自分で作成するため、Apple Developerのウェブサイトから手作業でダウンロードするものはありません。

Apple DeveloperのウェブサイトでチームのTeam ID（英字と数字10文字）を**Membership details**で調べ、環境で指定します。

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

同じTeam IDを、あとで[アプリリンク](./4-app-links.md)でも入力します。

### アーカイブをビルドする

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

アーカイブは`mobile/build/ios/archive/Runner.xcarchive`で、アップロードするファイルは`mobile/build/ios/ipa/`にある`.ipa`です。`.ipa`はAppleのTransporterアプリでアップロードするか、Xcodeの**Organizer**でアーカイブを開いて**Distribute App**を選びます。App Store Connectでの処理が終わると、TestFlightでスマートフォンでのテストに回せ、その後審査に出せます。

実機向けのビルドでは、`PUBLIRA_IOS_DEVELOPMENT_TEAM`が設定されていないと、Xcodeが最初に見つけたチームで署名するのではなく、最初のステップで止まります。

## ビルドが残すもの

ビルドがテナントのアイデンティティを書き込むのは、Gitが無視するファイルだけです。リポジトリが追跡しているファイルに変更を残した場合、ビルドは失敗します。そのため、同じチェックアウトで、事前に掃除をしなくても次のテナントのアプリや次のリリースをビルドできます。

次は[プッシュ通知](./3-push-notifications.md)です。
