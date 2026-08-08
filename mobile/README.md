# mobile

Flutter によるエンドユーザー向けモバイルアプリ (iOS / Android) です。

## 役割

- `web-host` と同等の閲覧体験をモバイルで提供する
- テナント別テーマ・ブランド表現をモバイル UI に反映する
- 将来的な閲覧保護やオフライン最適化に対応する

## 実装方針 (初期)

- 画面構成はカタログ一覧・シリーズ詳細・エピソード閲覧を優先
- API は `packages/api-client/` で生成されるスキーマと整合させる
- モバイル固有機能 (通知・スクショ検知等) は要件確定後に段階導入する

## 前提条件

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.41 以上)
- Xcode (iOS ビルド時)
- Android Studio または Android SDK (Android ビルド時)

## セットアップ

### Dev Container

リポジトリルートの `task setup`（Dev Container の `postCreate` から実行）に `flutter pub get` が含まれます。追加の手動操作は不要です。

依存だけ更新する場合:

```bash
# リポジトリルートから
task mobile:deps

# または mobile 配下で
cd mobile
flutter pub get
```

### ローカル（Dev Container 以外）

Flutter SDK を入れたうえで:

```bash
cd mobile
flutter pub get
```

またはルートから `task mobile:deps` / `task setup` でも同様です。

## 開発

```bash
# iOS シミュレータで起動
flutter run -d ios

# Android エミュレータで起動
flutter run -d android

# Web (Chrome) で起動
flutter run -d chrome
```

## 品質ゲート（format / analyze / test）

CI と同じ検証はルートから次のコマンドで再現できます。

```bash
# 依存解決（clone 直後や pubspec 変更後）
task mobile:deps

# format チェック + analyze（info も fail）+ flutter test
task mobile:check
```

個別に実行する場合:

```bash
task mobile:format    # dart format --output=none --set-exit-if-changed .
task mobile:analyze   # flutter analyze --fatal-infos
task mobile:test      # flutter test
```

`mobile/` 配下で直接 Flutter を使う場合:

```bash
cd mobile
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze --fatal-infos
flutter test
```

PR で `mobile/**` が変更されると CI の `Test / Mobile` ジョブが同じゲートを実行します。

## ディレクトリ構成

```
mobile/
├── lib/
│   ├── main.dart                 # エントリポイント
│   ├── app.dart                  # MaterialApp.router
│   ├── router.dart               # go_router 定義
│   ├── data/sample_series.dart   # カタログ用サンプルデータ
│   ├── models/series_item.dart
│   └── screens/                  # カタログ / シリーズ詳細 など
├── test/          # ウィジェットテスト / ユニットテスト
├── android/       # Android 固有ファイル
├── ios/           # iOS 固有ファイル
├── web/           # Web 固有ファイル
├── pubspec.yaml   # 依存関係定義
└── analysis_options.yaml  # lint / 静的解析設定
```

## 画面遷移

`go_router` で以下を定義しています（プレースホルダ UI）。

| パス                | 画面         |
| ------------------- | ------------ |
| `/`                 | カタログ一覧 |
| `/series/:seriesId` | シリーズ詳細 |

公開 API 連携・ビューアは後続 Issue で差し替えます。

## 環境変数 / フレーバー方針

環境ごとの設定は `--dart-define` を利用して切り替える方針です。

```bash
# 例: ステージング環境
flutter run --dart-define=ENV=staging

# 例: 本番環境
flutter run --dart-define=ENV=production
```

フレーバー (Android の productFlavors / iOS の Scheme) は、要件が確定した段階で導入します。
