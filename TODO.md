# TODO

Publira の実装ロードマップです。機能要件を領域別に整理しています。

## 優先度ガイド

- P0: MVP に必須 (最初に着手)
- P1: MVP 後の早期拡張
- P2: 中長期の強化項目

## 今週着手タスク (P0 実行リスト)

> まずは「入稿 → 公開設定 → 配信閲覧」の最短ループを成立させる。

### W1-1: 認証とテナント境界の土台

- 担当: Server
- 対象: セッションベース認証基盤 / テナント境界の認可チェック
- Done 条件:
  - ログイン済みセッションのみ管理 API を実行可能
  - テナント外データへアクセスすると 403 を返す
  - API サーバー起動時に認証・認可ミドルウェアが有効

### W1-2: 入稿 API (Series / Episode / 予約公開)

- 担当: Server + Admin Web
- 対象: Series CRUD / Episode 入稿 / 予約公開日時設定
- Done 条件:
  - Series の作成・更新・一覧・詳細 API が利用可能
  - Episode 作成時に公開予定日時を保存できる
  - Web Admin から上記 API を呼び出して入稿操作が完了する

### W1-3: 配信 API (カタログ / エピソード閲覧)

- 担当: Server + Host Web
- 対象: カタログ API / エピソード閲覧 API
- Done 条件:
  - 公開済みデータのみを返す API が利用可能
  - Web Host でシリーズ一覧→詳細→エピソード閲覧まで遷移できる
  - 未公開エピソードは配信 API で除外される

### W1-4: テーマ API と Web 反映

- 担当: Server + Admin Web + Host Web
- 対象: テーマ設定 API / CSS Variables 反映
- Done 条件:
  - テナントごとにテーマ設定を保存できる
  - Web Host / Web Admin の主要カラーがテーマ値に追従する
  - テーマ未設定時にデフォルトテーマで表示される

### W1-5: モバイル・CI の最小基盤

- 担当: Mobile + Platform
- 対象: mobile/ 初期セットアップ / CI パイプライン整備
- Done 条件:
  - `mobile/` で Flutter アプリが起動可能
  - CI で少なくとも `make setup` と server ビルドが実行される
  - main ブランチへの PR で CI が自動実行される

## W1 Issue バックログ (起票用)

### ISSUE-W1-01: セッション認証ミドルウェアを導入する

- 優先度: P0
- ラベル: area/server, type/feature, priority/P0
- 依存: なし
- 受け入れ条件:
  - 未認証の管理 API 呼び出しが拒否される
  - 認証済みセッションで管理 API を実行できる
  - API サーバー起動時にミドルウェアが有効化される

### ISSUE-W1-02: テナント境界の認可チェックを実装する

- 優先度: P0
- ラベル: area/server, type/feature, priority/P0, security
- 依存: ISSUE-W1-01
- 受け入れ条件:
  - テナント外データへのアクセスで 403 を返す
  - Series/Episode の取得・更新でテナント境界が強制される

### ISSUE-W1-03: Series CRUD API を実装する

- 優先度: P0
- ラベル: area/server, area/admin-web, type/feature, priority/P0
- 依存: ISSUE-W1-02
- 受け入れ条件:
  - Series の作成・更新・一覧・詳細 API が利用可能
  - 管理画面から各 API を呼び出して操作できる

### ISSUE-W1-04: Episode 入稿と予約公開設定 API を実装する

- 優先度: P0
- ラベル: area/server, area/admin-web, type/feature, priority/P0
- 依存: ISSUE-W1-03
- 受け入れ条件:
  - Episode 作成時に公開予定日時を保存できる
  - 管理画面から Episode 入稿フローを完了できる

### ISSUE-W1-05: カタログ配信 API を実装する

- 優先度: P0
- ラベル: area/server, area/host-web, type/feature, priority/P0
- 依存: ISSUE-W1-04
- 受け入れ条件:
  - 公開済みの Series 一覧と詳細を返せる
  - 未公開データがレスポンスに含まれない

### ISSUE-W1-06: エピソード閲覧 API を実装する

- 優先度: P0
- ラベル: area/server, area/host-web, type/feature, priority/P0
- 依存: ISSUE-W1-05
- 受け入れ条件:
  - 公開済み Episode の閲覧 API が利用可能
  - 未公開 Episode は配信 API で除外される

### ISSUE-W1-07: テナントテーマ設定 API と Web 反映を実装する

- 優先度: P0
- ラベル: area/server, area/admin-web, area/host-web, type/feature, priority/P0
- 依存: ISSUE-W1-03
- 受け入れ条件:
  - テナントごとにテーマ設定を保存できる
  - Web Host / Web Admin の主要カラーがテーマ値に追従する
  - テーマ未設定時はデフォルト値で表示される

### ISSUE-W1-08: mobile 初期セットアップを行う

- 優先度: P0
- ラベル: area/mobile, type/chore, priority/P0
- 依存: なし
- 受け入れ条件:
  - mobile で Flutter アプリが起動できる
  - 最低限の画面遷移を確認できる

### ISSUE-W1-09: CI でセットアップと server ビルドを実行する

- 優先度: P0
- ラベル: area/platform, type/chore, priority/P0
- 依存: ISSUE-W1-03, ISSUE-W1-04
- 受け入れ条件:
  - PR 作成時に `make setup` が実行される
  - PR 作成時に server ビルドが実行される
  - main ブランチ向け PR で CI が必ず走る

## 1) マルチテナント・ブランディング

- [ ] [P0] テナントごとのテーマ (カラー/ロゴ )設定 API
- [ ] [P0] Web 側の CSS Variables ベース動的テーマ反映
- [ ] [P1] テナント別ドメインルーティング

## 2) コンテンツ入稿・管理 (出版社/編集者向け)

- [ ] [P0] Series CRUD (基本情報・公開状態管理)
- [ ] [P0] Episode 入稿 (メタデータ保存)
- [ ] [P0] 予約公開日時の設定
- [ ] [P1] 画像処理パイプライン (リサイズ・最適化)
- [ ] [P2] 小説データ (ePub 等) の取り込み/変換

## 3) ビューア機能 (配信体験)

- [ ] [P0] カタログ API / 画面の本実装
- [ ] [P0] エピソード閲覧 API / 画面の本実装
- [ ] [P1] Web ビューア (Canvas)
- [ ] [P1] Mobile ビューア (Flutter)

## 4) 認証・セキュリティ

- [ ] [P0] セッションベース認証基盤 (server + PostgreSQL)
- [ ] [P0] テナント境界の認可チェック
- [ ] [P1] 機密情報暗号化保存 (例: AES-GCM)

## 5) 収益化・アクセス制御

- [ ] [P1] 決済連携 (Web / Mobile)
- [ ] [P1] 限定閲覧・チケット型アクセス制御

## 6) レコメンド・ランキング

- [ ] [P2] レコメンド用データモデル設計
- [ ] [P2] ランキング集計ロジック

## 7) 基盤整備

- [ ] [P0] mobile/ 初期セットアップ
- [ ] [P0] CI パイプライン整備
- [ ] [P1] `/readyz` エンドポイント整備 (現状は依存が未確定のため将来対応)
- [ ] [P1] 監視/ログ戦略の整理
