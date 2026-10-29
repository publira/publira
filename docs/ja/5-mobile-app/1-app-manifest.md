---
title: アプリマニフェスト
description: テナントのアプリの名前と、ストアがアプリを識別するIDを記述するファイルを書き、ビルドの前に確認します。
published: 2026-10-29
source_updated: 2026-10-21
---

アプリマニフェストは、そのビルドが誰のアプリなのかを示す短いYAMLファイルです。ホーム画面に表示される名前、アプリが対象とする1つのテナント、そしてアプリを公開するときのIDを記述します。テナントのアプリのビルドはすべてこのファイルを読むので、テナントのほかのビルド用の入力と一緒に、リポジトリの外で、自分のバージョン管理の下に置いてください。

## マニフェストを書く

[`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml)を`~/example-reader/app.yaml`のような自分のディレクトリにコピーし、すべての値をテナントのものに置き換えます。

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
| `schemaVersion` | `1`。ファイルの形式を示すもので、アプリのバージョンではありません |
| `app.name` | ホーム画面のアイコンの下に表示される名前です。そこで途切れない程度に短くしてください。ストアの掲載情報には別にタイトルがあります |
| `tenant.host` | テナントの公開サイトのホスト名で、`https://`やパスは付けません。アプリはこのテナントだけを対象にし、AndroidとiOSはアプリのリンクをこのホストで確認します |
| `android.applicationId` | Google Playがアプリを識別するアプリケーションIDで、`com.example.reader`のような形式です。ドットで区切られた2つ以上の部分からなり、それぞれ英字で始まり、英字、数字、アンダースコアだけを含みます |
| `ios.bundleIdentifier` | App Storeがアプリを識別するバンドルIDです。ドットで区切られた2つ以上の部分からなり、英字、数字、ハイフンで構成します |
| `ios.googleSignInClientId` | 省略可能です。[アプリ内課金とログイン](./5-purchases-and-sign-in.md#appleとgoogleでのログイン)で説明している、テナントのGoogleログインのiOSクライアントです。iOSアプリでGoogleを提供しない場合は、この行を省きます |

ほかのフィールドはすべて必須です。形式に定義されていないフィールドは、無視されるのではなくエラーになります。

### IDは一度だけ決める

アプリケーションIDとバンドルIDは、ストアがアプリを識別するためのものです。ストアにそのIDでビルドが登録されると、変更はできません。IDが違えば別のアプリになり、レビューもインストール数も引き継がれず、読者を移す方法もありません。最初のアップロードの前に決め、以降のすべてのリリースで使い続けてください。

一般的な形式は、出版社が所有するドメインを逆順にし、その後にアプリの名前を続けたものです。`example.com`なら`com.example.reader`になります。2つのIDは同じでもよく、通常は同じにします。異なっていてもかまわないので、すでに一方のストアにアプリを持っている出版社は、そのストアでのIDをそのまま使い続けられます。

アプリの開発用ビルドは、テスト端末で公開版のアプリと並べてインストールできるよう、両方のIDに`.dev`を付け加えます。このビルドがアップロードされることはなく、そのIDをどこかに入力することもありません。

## マニフェストを確認する

ビルドに使う前に、リポジトリのルートからファイルを確認します。

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

出力される行は、このマニフェストからのビルドが持つアイデンティティで、あとでテナント管理画面とストアの管理画面にコピーする内容でもあります。問題のあるマニフェストに対しては、すべての問題が一度に示され、0以外の終了コードで終わります。ビルドも同じようにそのマニフェストを拒否します。

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

JSON Schemaに対応したエディターでは、入力しながらファイルが確認されます。1行目のコメントが、エディターに[形式](https://www.publira.dev/schemas/app-manifest/v1.json)を指し示しています。

次は[ビルドと署名](./2-building.md)です。
