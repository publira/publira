# Dockerfile 配置規約

本番・CI で使う実行イメージ用 Dockerfile の置き場とビルド手順を定義する。  
新規サービス追加時は本ドキュメントに従い、配置先が一意に決まるようにする。

エージェント向け実装ルール: [`AGENTS.md`](./AGENTS.md)

関連: [#82](https://github.com/publira/publira/issues/82)（方針策定） / [#83](https://github.com/publira/publira/issues/83)（本規約）

## 方針（採用）

**ロール別の共有 Dockerfile を `infra/docker/<role>/` に集約し、`ARG` で対象を切り替える。**  
build context は常に **リポジトリルート**（`.`）。

| ロール | パス | 対象 | 主な ARG |
| --- | --- | --- | --- |
| Web (Next.js) | [`web/Dockerfile`](./web/Dockerfile) | `apps/*` | `APP_NAME`, `PORT` |
| API (常駐) | [`api/Dockerfile`](./api/Dockerfile) | `server/cmd/*` の HTTP サーバー | `CMD_NAME`, `PORT` |
| Batch (単発) | [`batch/Dockerfile`](./batch/Dockerfile) | `server/cmd/*` のジョブ | `CMD_NAME` |

Dev Container 用は本番と分離する。

| 用途     | パス                                                         |
| -------- | ------------------------------------------------------------ |
| 開発環境 | [`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile) |

`apps/*/Dockerfile` や `server/cmd/*/Dockerfile` には **置かない**（コピー展開もしない）。

## なぜこの配置か

| 選択肢 | 採否 | 理由 |
| --- | --- | --- |
| サービス直下に Dockerfile（旧方針） | 不採用 | 同型イメージが N 本に複製され、ベースイメージ digest・ビルド手順の追随がバラつく |
| `infra/docker/templates/` + 各 cmd へコピー | 不採用 | 「正」がテンプレと生成物の二箇所になり、ドリフトしやすい |
| **ロール別 Dockerfile + ARG**（現行） | **採用** | 同ランタイムは 1 ファイル。ビルド時に対象だけ差し替え。ルート context で monorepo / `server/` を正しく扱える |
| Dev Container と本番を同居 | 不採用 | 開発ツール（task, sqlc, Flutter 等）と最小実行イメージの責務が異なる |

「サービス近接」の利点（対象がコード隣で見つけやすい）は、**ロール別パスと本 README・ルート README の導線**で補う。  
実装の詳細（`turbo prune`、Go の `cmd` パス等）は各 Dockerfile 先頭コメントを正とする。

## 新規サービス追加時の判断フロー

```text
何をコンテナ化するか？
├─ Next.js アプリ (apps/<name>)
│    → infra/docker/web/Dockerfile
│    → --build-arg APP_NAME=<name>   # package 名は @publira/<name>
│    → 必要なら PORT（既定 3000）
│
├─ Go の常駐 HTTP サーバー (server/cmd/<name>)
│    → infra/docker/api/Dockerfile
│    → --build-arg CMD_NAME=<name>
│    → 必要なら PORT（既定 8000）
│
├─ Go の単発ジョブ (server/cmd/<name>)
│    → infra/docker/batch/Dockerfile
│    → --build-arg CMD_NAME=<name>
│
└─ 上記以外のランタイム（例: 別言語のワーカー）
     → 新ロール infra/docker/<role>/Dockerfile を追加し、本表を更新する
     → 既存ロールに無理に載せない
```

### 命名

- **ロールディレクトリ**: 短い種別名（`web` / `api` / `batch`）。サービス名は付けない。
- **`APP_NAME`**: `apps/` 直下のディレクトリ名（例: `web-admin`）。`@publira/` プレフィックスは Dockerfile 内で付与。
- **`CMD_NAME`**: `server/cmd/` 直下のディレクトリ名（例: `api-server`）。
- **イメージタグ例**: `publira/<サービス名>:local`（ビルド側の慣習。レジストリ方針はデプロイ側で別途定義）。

## ビルド規約

### Context と `-f`

```bash
# 必ずリポジトリルートで実行する
docker build -f infra/docker/<role>/Dockerfile --build-arg ... -t publira/<name>:local .
```

- context は `.`（ルート）。`apps/web-admin` や `server` を context にしない。
- ルート [`.dockerignore`](../../.dockerignore) が context を絞り込む。

### 例

```bash
# Web
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-admin --build-arg PORT=4000 \
  -t publira/web-admin:local .

docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-host --build-arg PORT=3000 \
  -t publira/web-host:local .

docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-platform --build-arg PORT=4100 \
  -t publira/web-platform:local .

# API
docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=api-server --build-arg PORT=8000 \
  -t publira/api-server:local .

docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=admin-api-server --build-arg PORT=8001 \
  -t publira/admin-api-server:local .

docker build -f infra/docker/api/Dockerfile \
  --build-arg CMD_NAME=platform-api-server --build-arg PORT=8002 \
  -t publira/platform-api-server:local .

# Batch
docker build -f infra/docker/batch/Dockerfile \
  --build-arg CMD_NAME=publish-episodes \
  -t publira/publish-episodes:local .
```

### マルチステージの共通方針

| 段階 | 内容 |
| --- | --- |
| ビルド | フルツールチェーン付き Debian 系（Node bookworm-slim / golang bookworm） |
| 実行 | distroless（Web: `nodejs24-debian12:nonroot`、Go: `static:nonroot`） |
| ベースイメージ | `tag@sha256:…` で digest 固定（Renovate が追跡） |
| ツール版（turbo / pnpm 等） | `ARG *_VERSION` + `# renovate: datasource=…`（[`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile) と同じ形式） |

Web は [Turborepo の Docker ガイド](https://turborepo.dev/docs/guides/tools/docker) に沿い `turbo prune --docker` で依存を絞る。  
実行イメージに shell / wget が無いため、**Docker `HEALTHCHECK` は置かない**。オーケストレータ側で `/healthz` 等を probe する。

### 実行時に渡す主な環境変数（参考）

- Web: `PORT`, `HOSTNAME`（イメージ内既定あり）, `REDIS_URL`, `NEXT_CACHE_APP`（ビルド時に `APP_NAME` を既定セット）
- API: アプリ固有（`DB_URL` 等）。待受はバイナリ側の設定。`PORT` は `EXPOSE` / ドキュメント用メタデータ

詳細は各サービスの README と Dockerfile コメントを参照。

## 例外

次だけが本規約の対象外、または例外として許される。

1. **Dev Container**（`.devcontainer/Dockerfile`）  
   本番実行イメージではない。ツールチェーンとボリューム前提の開発環境専用。
2. **一時的な検証用 Dockerfile**  
   個人ブランチのみ。main に残す場合は新ロールとして `infra/docker/` に昇格し、本表を更新する。
3. **生成物のコミット**  
   テンプレートから各サービスへ Dockerfile をコピーしてコミットする運用は行わない。

## 変更時のチェックリスト

- [ ] 新ロールなら `infra/docker/<role>/Dockerfile` を追加し、本 README の表・判断フロー・ビルド例を更新した
- [ ] ベースイメージは digest 固定、ツール版は Renovate 追跡可能な `ARG` にした
- [ ] ルートからの `docker build -f … .` でビルドできることを確認した
- [ ] ルート [README.md](../../README.md) のドキュメント案内から辿れる（本ファイルへのリンクが生きている）
