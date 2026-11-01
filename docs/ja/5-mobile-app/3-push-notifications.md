---
title: プッシュ通知
description: テナントのアプリがプッシュ通知を受け取るためのFirebaseプロジェクトを設定し、通知を送るための認証情報をテナント管理画面に登録します。
published: 2026-10-29
updated: 2026-11-01
source_updated: 2026-11-01
---

読者がフォローしているシリーズのエピソードや、フォローしている著者がクレジットされたエピソードが新しく公開されると、アプリは読者のスマートフォンに通知し、タップするとそのエピソードが開きます。**アプリ**でお知らせをオンにしている読者には、お知らせも通知します。このスイッチは初期状態ではオフです。タップすると、そのお知らせが開きます。Publiraは通知をFirebase Cloud Messagingに送り、Firebase Cloud MessagingがAndroidのスマートフォンには直接、iPhoneにはAppleのプッシュ通知サービスを通じて届けます。これが動くには、次の3つが同じFirebaseプロジェクトを指している必要があります。

| 設定する場所 | 役割 |
| --- | --- |
| アプリ | プロジェクトの値を組み込んでビルドされ、各スマートフォンをプロジェクトに登録します |
| Apple | プロジェクトは、Appleのプッシュ通知用のキーを使ってiPhoneへの通知を中継します |
| テナント管理画面 | `publira worker`が通知の送信に使う、プロジェクトのサービスアカウントキーを保存します |

Firebaseプロジェクトは、テナントのアプリごとに1つ用意します。プロジェクトはアプリをビルドする人のものなので、出版社が自分のプロジェクトを完全に所有することもできます。

## Firebaseプロジェクトを作成する

[Firebaseコンソール](https://console.firebase.google.com/)で、テナントのアプリ用のプロジェクトを追加します。Google Analyticsは要らないので、オフにしてかまいません。

次に、プロジェクトの**Project settings** › **General**で、プロジェクトに2つのアプリを追加します。

| 追加するアプリ | 指定する値 | ダウンロードするファイル |
| --- | --- | --- |
| Androidアプリ | パッケージ名にマニフェストの`android.applicationId` | `google-services.json` |
| Appleアプリ | バンドルIDにマニフェストの`ios.bundleIdentifier` | `GoogleService-Info.plist` |

このあとFirebaseコンソールは、各ファイルをアプリのソースコードに追加し、ビルドファイルを変更するよう案内しますが、この手順は飛ばしてください。Publiraのアプリは同じ値をビルドコマンドから受け取るので、特定のテナントのプロジェクトの情報がリポジトリに入ることはありません。

## ビルドにプロジェクトの値を渡す

2つのファイルから7つの値を、ビルドが読み込むファイルにコピーします。[ビルドと署名](./2-building.md#プッシュ通知)の例では`~/example-reader/firebase.json`です。

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
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | Androidアプリの`api_key`内の`current_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | Androidアプリの`client_info`内の`mobilesdk_app_id` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

これらの値はシークレットではなく、配布されるアプリにすべて含まれます。プロジェクトIDか送信者IDがないビルドでは、プッシュ通知がまったく使えません。一方のプラットフォームの2つの値が欠けているビルドでは、そのプラットフォームでだけプッシュ通知が使えません。

## FirebaseにAppleのプッシュ通知用のキーを登録する

FirebaseがiPhoneに通知を届けるには、Appleのプッシュ通知サービス用のキーが必要です。1つのキーをApple Developerチームのすべてのアプリで使えるので、チームですでにキーを作成していればそれを使います。

1. Apple Developerのウェブサイトの**Certificates, Identifiers & Profiles** › **Keys**で、「**Apple Push Notifications service (APNs)**」を有効にしたキーを作成します。
2. `.p8`ファイルをダウンロードします。Appleからダウンロードできるのは一度だけなので、シークレットの保管場所に保存してください。キーのKey IDも控えておきます。
3. Firebaseコンソールで**Project settings** › **Cloud Messaging**を開き、Appleアプリの設定で、`.p8`ファイルをAPNs認証キーとしてアップロードし、キーのKey IDとチームのTeam IDを入力します。

アプリは、開発環境と本番環境の両方でiOSにプッシュ通知を要求するよう設定済みなので、Xcodeで有効にするものはありません。

## テナント管理画面に送信用の認証情報を登録する

`publira worker`は、Firebaseプロジェクトのサービスアカウントとして各通知を送信します。そのため、テナント管理画面にそのサービスアカウントのキーを登録します。

1. Firebaseコンソールで**Project settings** › **Service accounts**を開き、**Generate new private key**を選びます。JSONファイルがダウンロードされます。
2. テナント管理画面で**外部連携** › **モバイルプッシュ**を開きます。
3. **FirebaseプロジェクトID**に、アプリのビルドで使ったのと同じ`PUBLIRA_FIREBASE_PROJECT_ID`の値を入力し、**サービスアカウントキーのファイル**でダウンロードしたファイルを選びます。
4. **認証情報を保存**を選びます。

入力したプロジェクトと別のプロジェクトのキーは、管理画面が受け付けません。そのキーで送った通知はアプリに届かないからです。キーは書き込み専用で、ページにはキーが属するサービスアカウントと保存日時だけが表示され、キー自体は表示されません。新しいファイルを保存すると、キーが置き換わります。保存が終わったら、ダウンロードしたファイルは削除してください。

APIサーバーに暗号鍵がないというメッセージが管理画面に表示されたら、Publiraが`PUBLIRA_SECRET_ENCRYPTION_KEYS`を設定しないまま起動されています。オペレーターが[インストール](../2-deployments/2-installing.md#シークレットを生成する)の説明に従ってこの環境変数を設定し、`publira server`を再起動すれば、キーを保存できるようになります。

キーを保存するまで、アプリにプッシュ通知は届きません。アプリ内の通知の受信箱には、キーの有無にかかわらず通知が入ります。読者が通知設定でメールをオンにしている種類の通知も、これまでどおりメールで届きます。

## 通知が届くことを確認する

FirebaseはiOSシミュレーターには通知を届けないので、実機のスマートフォンで確認してください。リリースビルドを、iPhoneにはTestFlightから、AndroidにはリリースAPKでインストールし、次の手順で確かめます。

1. 読者としてアプリにログインし、**アカウント**を開いて**この端末でプッシュ通知を受け取る**をオンにします。スマートフォンに尋ねられたら、通知を許可します。その上にある**通知設定**の**アプリ**のスイッチはオンのままにします。読者のスマートフォンにどの種類の通知を届けるかは、このスイッチで決まります。お知らせのスイッチは初期状態ではオフなので、お知らせを受け取るにはオンにしてください。
2. アプリでシリーズをフォローします。
3. テナント管理画面で、そのシリーズの新しいエピソードを公開します。**表示先**にはアプリを含めます。

`publira worker`が送信すると通知が届き、タップするとエピソードが開きます。アプリがスマートフォンに通知の許可を求めるのは読者がスイッチをオンにしたときだけで、起動時には求めません。スイッチをオンにしていない読者には何も届きません。

次は[アプリリンク](./4-app-links.md)です。
