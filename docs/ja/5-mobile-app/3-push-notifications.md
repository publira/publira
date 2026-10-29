---
title: プッシュ通知
description: テナントのアプリがプッシュ通知を受け取るFirebaseプロジェクトを設定し、テナント管理画面に通知の送信に使う認証情報を渡します。
published: 2026-10-29
source_updated: 2026-10-22
---

読者がフォローしているシリーズの新しいエピソードや、フォローしている著者がクレジットされた新しいエピソードが公開されると、アプリは読者のスマートフォンにそれを知らせ、タップするとそのエピソードが開きます。インストール環境は通知をFirebase Cloud Messagingに送り、Firebase Cloud MessagingはAndroidのスマートフォンには自身で、iPhoneにはAppleのプッシュサービスを通じて届けます。これが動くには、次の3つが同じFirebaseプロジェクトを指している必要があります。

1. **アプリ**。プロジェクトの値を組み込んでビルドされ、各スマートフォンをプロジェクトに登録します。
2. **Apple**。プロジェクトは、AppleのプッシュキーでiPhoneへの通知を中継します。
3. **テナント管理画面**。`publira worker`が送信に使う、プロジェクトのサービスアカウントキーを保持します。

Firebaseプロジェクトは、テナントのアプリごとに1つ使います。プロジェクトはアプリをビルドする人のものなので、出版社が自分のプロジェクトを完全に所有することもできます。

## Firebaseプロジェクトを作成する

[Firebaseコンソール](https://console.firebase.google.com/)で、テナントのアプリ用のプロジェクトを追加します。Google Analyticsは不要なので、オフにしてかまいません。

次に、プロジェクトの**Project settings** › **General**から、プロジェクトに2つのアプリを追加します。

- **Androidアプリ**。パッケージ名にはマニフェストの`android.applicationId`を指定します。表示される`google-services.json`をダウンロードします。
- **Appleアプリ**。バンドルIDにはマニフェストの`ios.bundleIdentifier`を指定します。表示される`GoogleService-Info.plist`をダウンロードします。

そのあとFirebaseコンソールは、それぞれのファイルをアプリのソースコードに追加し、ビルドファイルを変更するよう求めます。この手順は飛ばしてください。Publiraのアプリは同じ値をビルドコマンドから受け取るため、リポジトリに特定のテナントのプロジェクトが入り込むことはありません。

## ビルドにプロジェクトの値を渡す

2つのファイルから7つの値を、ビルドが読むファイルにコピーします。[ビルドと署名](./2-building.md#プッシュ通知)の`~/example-reader/firebase.json`です。

```json
{
  "PUBLIRA_FIREBASE_PROJECT_ID": "example-reader",
  "PUBLIRA_FIREBASE_MESSAGING_SENDER_ID": "123456789012",
  "PUBLIRA_FIREBASE_ANDROID_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_ANDROID_APP_ID": "1:123456789012:android:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_IOS_APP_ID": "1:123456789012:ios:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_BUNDLE_ID": "com.example.reader"
}
```

| 値 | `google-services.json`での場所 | `GoogleService-Info.plist`での場所 |
| --- | --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | `project_info.project_id` | `PROJECT_ID` |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | `project_info.project_number` | `GCM_SENDER_ID` |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | Androidアプリの`api_key`の下の`current_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | Androidアプリの`client_info`の下の`mobilesdk_app_id` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

これらの値はシークレットではありません。アプリのすべてのコピーに含まれています。プロジェクトIDまたは送信者IDがないビルドにはプッシュ通知がまったくなく、一方のプラットフォームの組が欠けているビルドには、そのプラットフォームでのプッシュ通知がありません。

## FirebaseにAppleのプッシュキーを渡す

FirebaseがiPhoneに届くには、Appleのプッシュサービス用のキーが必要です。1つのキーでApple Developerチームのすべてのアプリをまかなえるので、すでにキーを持っているチームはそれを使い回します。

1. Apple Developerのウェブサイトの**Certificates, Identifiers & Profiles** › **Keys**で、「**Apple Push Notifications service (APNs)**」を有効にしたキーを作成します。
2. `.p8`ファイルをダウンロードします。Appleがこのファイルを提供するのは一度だけなので、シークレットの保管場所に保存してください。キーのKey IDを控えておきます。
3. Firebaseコンソールで**Project settings** › **Cloud Messaging**を開き、Appleアプリの設定の下で、`.p8`ファイルをAPNs認証キーとして、そのKey IDとチームのTeam IDとともにアップロードします。

アプリ自体が、開発環境と本番環境の両方でiOSにプッシュ通知を要求するようになっているため、Xcodeで有効にするものはありません。

## テナント管理画面に送信用の認証情報を渡す

`publira worker`は各通知をFirebaseプロジェクトのサービスアカウントとして送信するため、テナント管理画面にはそのアカウントのキーが必要です。

1. Firebaseコンソールで**Project settings** › **Service accounts**を開き、**Generate new private key**を選びます。JSONファイルがダウンロードされます。
2. テナント管理画面で**外部連携** › **モバイルプッシュ**を開きます。
3. **FirebaseプロジェクトID**に、アプリのビルドに使ったものと同じ`PUBLIRA_FIREBASE_PROJECT_ID`を入力し、**サービスアカウントキーのファイル**としてダウンロードしたファイルを選びます。
4. **認証情報を保存**を選びます。

入力したプロジェクトとは別のプロジェクトのキーは、管理画面が拒否します。送信したものをアプリが受け取ることがないためです。キーは書き込み専用です。ページにはキーが属するサービスアカウントと保存日時が表示されますが、キー自体は表示されません。新しいファイルを保存すると置き換わります。保存したら、ダウンロードしたファイルは削除してください。

APIサーバーに暗号鍵がないと管理画面が返す場合は、インストール環境が`PUBLIRA_SECRET_ENCRYPTION_KEYS`なしで起動されています。オペレーターが[インストール](../2-deployments/2-installing.md#シークレットを生成する)の説明に従ってそれを設定し、`publira server`がその設定で再起動したあとに、キーを保存できるようになります。

キーを保存するまで、アプリはプッシュ通知を受け取りません。アプリ内の通知の受信箱にはどちらの場合も通知が入り、読者の設定でメールがオンになっている種類の通知については、これまでどおりメールも届きます。

## 通知が届くことを確認する

実機のスマートフォンで試してください。FirebaseはiOSシミュレーターには通知を届けません。iPhoneではTestFlightから、AndroidではリリースAPKで、リリースビルドをインストールし、次の手順を行います。

1. 読者としてアプリにサインインし、**アカウント**を開いて**この端末でプッシュ通知を受け取る**をオンにし、スマートフォンに尋ねられたら通知を許可します。その上にある**通知設定**の**アプリ**のスイッチはオンのままにしておきます。これらのスイッチで、読者のスマートフォンに届く通知の種類が決まります。
2. アプリでシリーズをフォローします。
3. テナント管理画面から、そのシリーズの新しいエピソードを、アプリを含む**表示先**で公開します。

`publira worker`が送信すると通知が届き、タップするとエピソードが開きます。アプリがスマートフォンに許可を求めるのは、読者がスイッチをオンにしたときだけで、起動時に求めることはありません。そのため、スイッチをオンにしていない読者には何も届きません。

次は[アプリリンク](./4-app-links.md)です。
