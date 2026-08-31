# mobile

Flutter によるエンドユーザー向けモバイルアプリ (iOS / Android) です。

## 役割

- `web-host` と同等の閲覧体験をモバイルで提供する
- テナント別テーマ・ブランド表現をモバイル UI に反映する
- API は `packages/api-client/` で生成されるスキーマと整合させる

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
task mobile:test      # flutter test（unit / widget / HTTP fixture）
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
Android エミュレータ上の integration test は `Test / Mobile E2E` です（`PUBLIRA_LIVE_API=true task mobile:test-integration`）。CI ジョブが公開 API と dev seed の起動・終了を担当します。

CI 全体のジョブ構成・path filter・トリアージ: [.github/workflows/README.md](../.github/workflows/README.md)

## ディレクトリ構成

```
mobile/
├── lib/
│   ├── main.dart                 # エントリポイント
│   ├── app.dart                  # MaterialApp.router + CatalogScope
│   ├── router.dart               # go_router 定義
│   ├── config.dart               # --dart-define の API / image / tenant
│   ├── api/                      # Connect JSON クライアント
│   ├── catalog/                  # CatalogRepository
│   ├── models/                   # シリーズ / エピソード本文
│   ├── screens/                  # カタログ / シリーズ詳細 / ビューア
│   └── viewer/                   # ページ送りリーダー
├── test/                         # ウィジェット / HTTP fixture
├── integration_test/             # デバイス上の画面遷移
├── scripts/                      # mobile E2E ライフサイクル
├── android/                      # Android 固有ファイル
├── ios/                          # iOS 固有ファイル
├── web/                          # Web 固有ファイル
├── pubspec.yaml
└── analysis_options.yaml
```

## 画面遷移

`go_router` で以下を定義しています。カタログは公開 API（Connect JSON）から読みます。

| パス                                    | 画面               |
| --------------------------------------- | ------------------ |
| `/`                                     | カタログ一覧       |
| `/series/:seriesId`                     | シリーズ詳細       |
| `/series/:seriesId/episodes/:episodeId` | エピソードビューア |

一覧はローディング / 空 / 通信エラー（再試行）、詳細はローディング / 見つからない / 通信エラーを出します。ビューアはこれに加えて、未購入の有料話（`EPISODE_ACCESS_LOCKED`）とページのない話それぞれの案内を出します。

## ビューア

エピソード本文は `GetEpisodeDetail` が返す画像を、右から左へめくるページ送りで表示します（web-host のリーダーと同じ読み方向）。

- 1 画面につき 1 ページ。左半分のタップ・左スワイプ・`次のページ` ボタンで次のページへ進みます
- ページの箱は API が返す `width` / `height` から先に確保するので、画像が届いてもレイアウトが動きません。サイズを持たない画像はビューポート全体を仮の箱にします
- ページ単位で読み込み中 / 失敗（再読み込み）を出すため、1 ページの失敗が本文全体を落としません
- 画像は image-server から取得します。テナントは `X-Forwarded-Host`、読者は `Authorization: Bearer`（`PUBLIRA_ACCESS_TOKEN`）で伝えます。有料話の画像 URL に API が付けたメディアトークンはそのまま使います

## 公開 API への接続

`--dart-define` でテスト用 API と tenant host を切り替えます。

| 定義 | 既定 | 意味 |
| --- | --- | --- |
| `PUBLIRA_API_BASE_URL` | `http://127.0.0.1:8000` | 公開 API の Connect HTTP（`api-server` の 8000。8100 の gRPC ではない） |
| `PUBLIRA_IMAGE_BASE_URL` | `http://127.0.0.1:8200` | エピソード本文画像を返す `image-server` |
| `PUBLIRA_TENANT_HOST` | `localhost` | `GetTenantByDomain` に渡す host。dev seed は `localhost`。image-server へは `X-Forwarded-Host` として送ります |
| `PUBLIRA_ACCESS_TOKEN` | 空 | 公開 audience の JWT。空なら匿名で、無料話だけが読めます |
| `PUBLIRA_LIVE_API` | 未設定 | integration test が実 API の live グループを回すか |

```bash
# ローカルの api-server（task dev / e2e スタック）
flutter run --dart-define=PUBLIRA_API_BASE_URL=http://127.0.0.1:8000 \
  --dart-define=PUBLIRA_IMAGE_BASE_URL=http://127.0.0.1:8200 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost

# Android エミュレータからホストの api-server へ
flutter run -d android \
  --dart-define=PUBLIRA_API_BASE_URL=http://10.0.2.2:8000 \
  --dart-define=PUBLIRA_IMAGE_BASE_URL=http://10.0.2.2:8200 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost
```

## Integration test

`integration_test/` は次を繰り返します。

- アプリ起動とカタログ初期表示
- 一覧 → 詳細 → 戻る
- 無料話のビューア表示とページ送り
- 未購入の有料話のロック表示
- 存在しないシリーズ
- 空カタログ
- 到達できない API

既定はデバイス上の Connect fixture サーバーです。`PUBLIRA_LIVE_API=true` のときは dev seed（`Seed Series 001` / `SeedSERSAAA1`）に対する公開 API も回します。

```bash
# スタック起動 + integration test + teardown（エミュレータまたは実機が必要）
task mobile:e2e

# すでに API とデバイスがあるとき
task mobile:test-integration
```

失敗時は `mobile/.run/artifacts/` に logcat とスクリーンショットを残します。CI の `Test / Mobile E2E` は公開 API と dev seed を起動してから `PUBLIRA_LIVE_API=true task mobile:test-integration` を Android エミュレータで実行し、失敗時に artifact `mobile-e2e-artifacts` を上げます。
