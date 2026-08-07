# Dockerfile 配置規約とビルド検証

本番・CI で使う実行イメージ用 Dockerfile の置き場、ビルド手順、検証・CI 連携を定義する。  
新規サービス追加時は本ドキュメントに従い、配置先が一意に決まるようにする。

エージェント向け実装ルール: [`AGENTS.md`](./AGENTS.md)

関連:

- [#82](https://github.com/publira/publira/issues/82)（方針策定・配置）
- [#83](https://github.com/publira/publira/issues/83)（配置規約）
- [#87](https://github.com/publira/publira/issues/87)（ビルド検証と CI 連携）

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

## 責務分担（docker build / ローカル開発 / CI）

| 経路 | 用途 | 正とするコマンド |
| --- | --- | --- |
| **本番イメージビルド** | デプロイ用イメージの作成・検証 | `task docker:build:*`（中身はルート context の `docker build -f infra/docker/...`） |
| **ローカル開発** | ホットリロード開発 | Dev Container + `task dev` / `task server:dev` 等（本番 Dockerfile は使わない） |
| **CI（ホスト + イメージ）** | 変更検知で Check / Test / Build / Docker を実行し、最終ジョブ `Summary` で集約 | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)（イメージは同じ `task docker:build:*`） |

本番イメージと Dev Container は別物である。イメージビルドが通っても `task dev` の代替にはならないし、その逆でもない。

## ローカル検証手順

前提: リポジトリルート、Docker Engine / Buildx が利用可能であること。

### 代表イメージ（日常の確認）

Issue / CI の「主要ビルド経路」は次の 3 本（各ロール 1 つ）とする。

```bash
# まとめて（web-host / api-server / publish-episodes）
task docker:verify

# または個別
task docker:build:web APP_NAME=web-host PORT=3000
task docker:build:api CMD_NAME=api-server PORT=8000
task docker:build:batch CMD_NAME=publish-episodes
```

Web のみ起動確認（distroless・Redis 無し）:

```bash
task docker:smoke:web APP_NAME=web-host PORT=3000
```

API / batch のランタイムスモークは DB・ストレージ等の依存があるため、**イメージビルド成功をゲート**とする。起動確認はオーケストレータまたは結合環境で行う。

### 全イメージ（リリース前・Dockerfile 大きな変更時）

```bash
task docker:verify:full
```

README のビルド例に載っている全ターゲットを順にビルドする。

### 生の `docker build`（デバッグ用）

Task は次と等価である（トラブルシュート時に Task を挟まず実行してよい）。

```bash
docker build -f infra/docker/web/Dockerfile \
  --build-arg APP_NAME=web-host --build-arg PORT=3000 \
  -t publira/web-host:local .
```

## CI 実行戦略

### 比較

| 戦略 | 内容 | 利点 | 欠点 |
| --- | --- | --- | --- |
| **全イメージ毎回** | PR のたびに全ターゲット | 取りこぼし最小 | 時間・コスト大（特に Web×3） |
| **変更検知** | 影響ロールの代表だけビルド | PR が速い | ロール外の間接影響を見逃しうる |
| **Nightly フル** | 定期で全ターゲット | ドリフト検出 | フィードバックが遅い |

### 採用案

**変更検知（ロール代表） + Nightly フル** を採用する。

| トリガ | モード | ビルド対象 |
| --- | --- | --- |
| `pull_request` / `push`（main）かつ関連 path | **verify** | 変更ロールの代表のみ（下表） |
| Dockerfile 本体・Taskfile・`.dockerignore`・`ci.yml` の変更 | **full** | ドキュメント上の全ターゲット |
| `schedule`（毎日 03:00 UTC） | **full**（Docker のみ） | 全ターゲット（Check / Test / Build はスキップ） |
| `workflow_dispatch` | verify または full | 手動選択（ホスト CI も実行） |

#### 変更検知のロール対応

| ロール | 代表ターゲット | 監視 path（概要） |
| --- | --- | --- |
| web | `web-host` | `apps/**`, `packages/**`, lockfile / turbo, `infra/docker/web/**` |
| api | `api-server` | `server/**`, `infra/docker/api/**` |
| batch | `publish-episodes` | `server/**`, `infra/docker/batch/**` |

`server/**` 変更時は api と batch の両方の代表をビルドする（共有モジュールのため）。

実装: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) の `docker` ジョブ。  
ローカルと同一コマンド: `task docker:build:web|api|batch`（Web は続けて `task docker:smoke:web`）。

Check / Test / Build / Docker は path filter により個別にスキップされうる。Branch ruleset が見る必須チェックは最終集約ジョブ **`Summary` のみ**（UI 上は `CI / Summary`。スキップされた中間ジョブは success 扱い）。

## 失敗時のトリアージ

1. **どのゲートが落ちたか**（workflow `CI` 内のジョブ名）
   - 最終ジョブ **`Summary`** が赤 → 依存ジョブのどれかが `failure` / `cancelled`
   - `Check` / `Test` / `Build` → ホスト上の依存・型・テスト・`pnpm build` / `go build`
   - `Docker / <target>` → Dockerfile 経路・context・ベースイメージ・コンテナ内ビルド
2. **ローカルで同じ Task を再現する**（CI ログの `task docker:build:…` 行をそのまま使う）
   ```bash
   task docker:build:web APP_NAME=web-host PORT=3000
   # または
   task docker:verify
   ```
3. **レイヤで切り分ける**
   | 症状 | 疑う箇所 |
   | --- | --- |
   | `ERROR: APP_NAME/CMD_NAME is required` | build-arg の渡し忘れ |
   | context / file not found | ルート以外での実行、`.dockerignore` の過剰除外 |
   | `turbo prune` / `pnpm install` 失敗 | lockfile 不整合、workspace 名、`APP_NAME` 誤り |
   | `pnpm turbo run build` 失敗 | アプリ本体のビルドエラー（先にホストで `pnpm build --filter @publira/<app>`） |
   | `go build` 失敗 | `server/` のコンパイルエラー（先に `task server:build`） |
   | ベース pull 失敗 / digest | レジストリ・digest 更新・Renovate PR の取りこぼし |
   | Web smoke (`/healthz`) のみ失敗 | エントリポイント経路・`PORT`・standalone 出力（ビルドは成功している） |
4. **CI だけ失敗する場合**
   - ランナー arch / Buildx とローカルの差（Go は `TARGETOS`/`TARGETARCH` を既定固定しない）
   - キャッシュ汚れ → ローカルは `docker builder prune`、CI は再実行
   - path filter の取りこぼし懸念 → `workflow_dispatch` で Docker `full`、または Nightly 結果を確認
5. **直したら**
   - 代表 3 本（`task docker:verify`）が通ることを確認してから PR を更新する
   - ロール追加時は README の表・Taskfile の `verify:full`・`ci.yml` の full 行列を同時更新する

## 変更時のチェックリスト

- [ ] 新ロールなら `infra/docker/<role>/Dockerfile` を追加し、本 README の表・判断フロー・ビルド例を更新した
- [ ] ベースイメージは digest 固定、ツール版は Renovate 追跡可能な `ARG` にした
- [ ] ルートからの `docker build -f … .` および `task docker:build:*` でビルドできることを確認した
- [ ] 代表検証 `task docker:verify`（必要なら `verify:full`）を通した
- [ ] 新ターゲットなら [`Taskfile.yaml`](./Taskfile.yaml) の `verify:full` と [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) の Docker full 行列を更新した
- [ ] ルート [README.md](../../README.md) のドキュメント案内から辿れる（本ファイルへのリンクが生きている）
