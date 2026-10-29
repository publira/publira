---
title: アプリマニフェスト
description: テナントのアプリの名前と、ストアがアプリを識別するIDを書いたファイルを作成し、ビルドの前に確認します。
published: 2026-10-29
source_updated: 2026-10-21
---

アプリマニフェストは、ビルドするアプリがどのテナントのものかを示す短いYAMLファイルです。ホーム画面に表示する名前、アプリが対象とする1つのテナント、アプリを公開するときのIDを記述します。テナントのアプリをビルドするたびにこのファイルを読むので、テナントのほかのビルド用ファイルと一緒にリポジトリの外に置き、自分たちのバージョン管理で管理してください。

## マニフェストを書く

[`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml)を`~/example-reader/app.yaml`など自分のディレクトリにコピーし、すべての値をテナントのものに書き換えます。

```yaml
# yaml-language-server: $schema=https://www.publira.dev/schemas/app-manifest/v1.json
schemaVersion: 1

app:
  name: Example Reader

tenant:
  host: reader.example.com

android:
  applicationId: com.example.reader

ios:
  bundleIdentifier: com.example.reader
  googleSignInClientId: 123456789012-abc123.apps.googleusercontent.com
```

| フィールド | 入力する内容 |
| --- | --- |
| `schemaVersion` | `1`です。ファイルの形式のバージョンで、アプリのバージョンではありません |
| `app.name` | ホーム画面でアイコンの下に表示される名前です。途中で切れないよう短くしてください。ストアの掲載情報のタイトルは別に設定します |
| `tenant.host` | テナントの公開サイトのホスト名です。`https://`やパスは付けません。アプリはこのテナント専用になり、AndroidとiOSはアプリのリンクをこのホストに照らして確認します |
| `android.applicationId` | Google Playがアプリを識別するアプリケーションIDです。`com.example.reader`のように、ドットで区切った2つ以上の部分で構成します。各部分は英字で始め、英字、数字、アンダースコアだけを使います |
| `ios.bundleIdentifier` | App Storeがアプリを識別するバンドルIDです。ドットで区切った2つ以上の部分で構成し、英字、数字、ハイフンを使います |
| `ios.googleSignInClientId` | 省略できます。[アプリ内課金とログイン](./5-purchases-and-sign-in.md#appleとgoogleでのログイン)で説明している、テナントのGoogleログイン用のiOSクライアントです。iOSアプリでGoogleでのログインを提供しない場合は、この行を削除します |

ほかのフィールドはすべて必須です。形式で定義されていないフィールドがあると、無視されずにエラーになります。

### IDは最初に決めて変えない

アプリケーションIDとバンドルIDは、ストアがアプリを識別するためのものです。一度ストアにそのIDでビルドを登録すると、IDは変更できません。IDが違えば別のアプリとして扱われ、レビューもインストール数も引き継がれず、読者を移行する方法もありません。最初のアップロードの前に決め、以降のリリースでも同じIDを使い続けてください。

一般的には、出版社が所有するドメインを逆順にし、そのあとにアプリの名前を続けます。`example.com`なら`com.example.reader`です。2つのIDは同じでもかまわず、通常は同じにします。違うIDにすることもできるので、すでに一方のストアにアプリがある出版社は、そのストアでのIDをそのまま使えます。

開発用ビルドでは、テスト端末に公開版のアプリと並べてインストールできるよう、両方のIDの末尾に`.dev`が付きます。開発用ビルドをアップロードすることはなく、そのIDをどこかに入力することもありません。

## マニフェストを確認する

ビルドに使う前に、リポジトリのルートでファイルを確認します。

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

出力される1行が、このマニフェストからビルドしたアプリの識別情報です。あとでテナント管理画面や各ストアの管理画面に入力する値も、この行からコピーします。マニフェストに問題がある場合は、すべての問題がまとめて表示され、0以外の終了コードで終了します。ビルドも同じように、そのマニフェストを受け付けません。

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

JSON Schemaに対応したエディターでは、入力しながらファイルが検証されます。1行目のコメントで、エディターに[形式の定義](https://www.publira.dev/schemas/app-manifest/v1.json)を指定しているためです。

次は[ビルドと署名](./2-building.md)です。
