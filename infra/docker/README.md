# Dockerfile 配置規約とビルド検証

本番・CI で使う実行イメージ用 Dockerfile の置き場、ビルド手順、`Docker / <target>` ジョブとの連携を定義する。  
新規サービス追加時は本ドキュメントに従い、配置先が一意に決まるようにする。

エージェント向け実装ルール: [`AGENTS.md`](./AGENTS.md)  
ホスト CI を含む CI 全体（ジョブ構成・path filter・トリアージ）: [`.github/workflows/README.md`](../../.github/workflows/README.md)

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
| API (常駐) | [`api/Dockerfile`](./api/Dockerfile) | `server/cmd/*` の HTTP サーバー（CGO なし） | `CMD_NAME`, `PORT` |
| Image (常駐) | [`image/Dockerfile`](./image/Dockerfile) | `image-server` / `admin-image-server`（Manael / libvips） | `CMD_NAME`, `PORT` |
| Batch (単発) | [`batch/Dockerfile`](./batch/Dockerfile) | `server/cmd/*` のジョブ | `CMD_NAME` |
| Node (常駐) | [`node/Dockerfile`](./node/Dockerfile) | `apps/*` のうち Next.js でないもの | `APP_NAME`, `PORT` |

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
├─ Go の常駐 HTTP サーバー (server/cmd/<name>、CGO なし)
│    → infra/docker/api/Dockerfile
│    → --build-arg CMD_NAME=<name>
│    → 必要なら PORT（既定 8000）
│
├─ Go の画像サーバー (image-server / admin-image-server)
│    → infra/docker/image/Dockerfile
│    → --build-arg CMD_NAME=<name>
│    → 必要なら PORT（既定 8200）
│
├─ Go の単発ジョブ (server/cmd/<name>)
│    → infra/docker/batch/Dockerfile
│    → --build-arg CMD_NAME=<name>
│
├─ Next.js でない Node.js の常駐サービス (apps/<name>)
│    → infra/docker/node/Dockerfile
│    → --build-arg APP_NAME=<name>   # package 名は @publira/<name>
│    → 必要なら PORT（既定 8080）
│
└─ 上記以外のランタイム（例: 別言語のワーカー）
     → 新ロール infra/docker/<role>/Dockerfile を追加し、本表を更新する
     → 既存ロールに無理に載せない
```

### 命名

- **ロールディレクトリ**: 短い種別名（`web` / `api` / `batch` / `node`）。サービス名は付けない。
- **`APP_NAME`**: `apps/` 直下のディレクトリ名（例: `web-admin`、`email-renderer`）。`@publira/` プレフィックスは Dockerfile 内で付与。
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

# Image (Manael / libvips)
docker build -f infra/docker/image/Dockerfile \
  --build-arg CMD_NAME=image-server --build-arg PORT=8200 \
  -t publira/image-server:local .

docker build -f infra/docker/image/Dockerfile \
  --build-arg CMD_NAME=admin-image-server --build-arg PORT=8201 \
  -t publira/admin-image-server:local .

# Batch
docker build -f infra/docker/batch/Dockerfile \
  --build-arg CMD_NAME=publish-episodes \
  -t publira/publish-episodes:local .

# Node
docker build -f infra/docker/node/Dockerfile \
  --build-arg APP_NAME=email-renderer --build-arg PORT=8080 \
  -t publira/email-renderer:local .
```

### マルチステージの共通方針

| 段階 | 内容 |
| --- | --- |
| ビルド | フルツールチェーン付き Debian 系（Node bookworm-slim / golang bookworm） |
| 実行 | distroless（Web / Node: `nodejs24-debian12:nonroot`、Go API / batch: `static:nonroot`）。画像サーバーだけ `debian:bookworm-slim` + `libvips42`（CGO） |
| ベースイメージ | `tag@sha256:…` で digest 固定（Renovate が追跡） |
| ツール版（turbo / pnpm 等） | `ARG *_VERSION` + `# renovate: datasource=…`（[`.devcontainer/Dockerfile`](../../.devcontainer/Dockerfile) と同じ形式） |

Web と Node は [Turborepo の Docker ガイド](https://turborepo.dev/docs/guides/tools/docker) に沿い `turbo prune --docker` で依存を絞る。  
実行イメージに shell / wget が無いため、**Docker `HEALTHCHECK` は置かない**。オーケストレータ側で `/livez`（liveness）/ `/readyz`（readiness）を probe する。

Node ロールは Next.js の standalone 出力に相当する仕組みを持たないため、`pnpm install --prod` で作った実行時依存ツリーと、ワークスペース各パッケージの `dist/` だけをランナーへ渡す。ソースと開発依存はランナーに入らない。実行時に import されるものが `dependencies` に無いと（`devDependencies` 止まり、未充足の `peerDependencies` など）、`--prod` のツリーから消えて起動時に落ちる。

### 実行時に渡す主な環境変数（参考）

- Web: `PORT`, `HOSTNAME`（イメージ内既定あり）, **`PUBLIRA_AUTH_SECRET`（必須。32 バイト以上。未設定だとセッション Cookie の暗号化・復号が例外になる）**, `PUBLIRA_REDIS_URL`, `PUBLIRA_CACHE_APP`（ビルド時に `APP_NAME` を既定セット）
- API: **`PUBLIRA_AUTH_JWT_SECRET`（必須。32 バイト以上。未設定だとアクセストークンの署名鍵が無く起動に失敗する）**, アプリ固有（`PUBLIRA_*_DB_URL` 等）。待受はバイナリ側の設定。`PORT` は `EXPOSE` / ドキュメント用メタデータ
- Node: `PORT`（既定 8080）, `HOST`（イメージ内既定 `0.0.0.0`）。email-renderer は外部依存を持たないので、他に必須の変数は無い

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
| **CI（イメージ）** | 変更検知で `Docker / <target>` ジョブを実行 | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)（ローカルと同じ `task docker:build:*`） |

本番イメージと Dev Container は別物である。イメージビルドが通っても `task dev` の代替にはならないし、その逆でもない。

ホスト CI（`Check` / `Test / *` / `Build` / `Summary`）を含む CI 全体像は [`.github/workflows/README.md`](../../.github/workflows/README.md) を正とする。

## ローカル検証手順

前提: リポジトリルート、Docker Engine / Buildx が利用可能であること。

### 代表イメージ（日常の確認）

Issue / CI の「主要ビルド経路」は次の 4 本（各ロール 1 つ）とする。

```bash
# まとめて（web-host / api-server / publish-episodes / email-renderer / image-server）
task docker:verify

# または個別
task docker:build:web APP_NAME=web-host PORT=3000
task docker:build:api CMD_NAME=api-server PORT=8000
task docker:build:batch CMD_NAME=publish-episodes
task docker:build:node APP_NAME=email-renderer PORT=8080
task docker:build:image CMD_NAME=image-server PORT=8200
```

起動確認（distroless・外部依存無し）:

```bash
task docker:smoke:web APP_NAME=web-host PORT=3000
task docker:smoke:node APP_NAME=email-renderer PORT=8080
```

`smoke:web` は `/livez`、`smoke:node` は `/livez` と `/readyz` の応答本文まで確認する。

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

## Docker の CI 実行戦略

ここで扱うのは `Docker / <target>` ジョブだけである。ホスト CI 全体（`Check` / `Test / Go` / `Test / TypeScript` / `Test / DB Migrations` / `Test / Mobile` / `Test / Mobile E2E` / `Test / E2E` / `Build` / `Summary`）の path filter・実行戦略は [`.github/workflows/README.md`](../../.github/workflows/README.md) を参照。

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
| `schedule`（毎日 03:00 UTC） | **full** | 全ターゲット（ホスト CI はスキップ） |
| `workflow_dispatch` | verify または full | 手動選択（入力 `docker_mode`） |

#### 変更検知のロール対応

| ロール | 代表ターゲット | 監視 path（概要） |
| --- | --- | --- |
| web | `web-host` | `apps/**`, `packages/**`, lockfile / turbo, `infra/docker/web/**` |
| api | `api-server` | `server/**`, `infra/docker/api/**` |
| image | `image-server` | `server/**`, `infra/docker/image/**` |
| batch | `publish-episodes` | `server/**`, `infra/docker/batch/**` |
| node | `email-renderer` | `apps/email-renderer/**`, `packages/**`, `locales/**`, lockfile / turbo, `infra/docker/node/**` |

`server/**` 変更時は api と batch の両方の代表をビルドする（共有モジュールのため）。  
`locales/**` は node ロールだけが見る。`@publira/email-templates` がリポジトリルートの文言カタログを相対 import してバンドルするため。

実装: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) の `docker` ジョブ。  
ジョブ計画: [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh)（path filter 結果から Docker 行列を決定）。  
ローカルと同一コマンド: `task docker:build:web|api|batch|node`（Web は続けて `task docker:smoke:web`、Node は `task docker:smoke:node`）。

`Docker / <target>` も他ジョブと同様に path filter でスキップされうる。Branch ruleset が見る必須チェックは最終集約ジョブ **`Summary` のみ**（UI 上は `CI / Summary`。スキップされた中間ジョブは success 扱い）。

## ビルド失敗時のトリアージ

`Docker / <target>` ジョブ、およびローカルの `task docker:build:*` が失敗したときの手順。ホスト CI 側のジョブ（`Check` / `Test / *` / `Build`）については [`.github/workflows/README.md`](../../.github/workflows/README.md) の「失敗時のトリアージ」を参照。

1. **落ちた段階を切り分ける**
   - イメージビルド → Dockerfile 経路・context・ベースイメージ・コンテナ内ビルド
   - smoke（`/livez` / `/readyz`）のみ → エントリポイント経路・`PORT`・standalone 出力や `dist/` の配置（ビルドは成功している）
2. **ローカルで同じ Task を再現する**

   CI ログの `task docker:build:…` 行をそのまま実行する。

   ```bash
   task docker:build:web APP_NAME=web-host PORT=3000
   # または代表まとめて
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
   | Web smoke (`/livez`) のみ失敗 | エントリポイント経路・`PORT`・standalone 出力（ビルドは成功している） |
   | Node smoke で `Cannot find package` | 実行時依存が `dependencies` ではなく `devDependencies` / `peerDependencies` にある（`pnpm install --prod` に載らない） |
   | Node ロールで `locales/*.json` が解決できない | `turbo prune` はリポジトリルートの `locales/` を含めないため、builder 段で明示 `COPY` する必要がある |

4. **CI だけ失敗する場合**
   - ランナー arch / Buildx とローカルの差（Go は `TARGETOS`/`TARGETARCH` を既定固定しない）
   - キャッシュ汚れ → ローカルは `docker builder prune`、CI は再実行
   - path filter の取りこぼし懸念 → `workflow_dispatch` で Docker `full`、または Nightly 結果を確認
5. **直したら**
   - 代表イメージ（`task docker:verify`）が通ることを確認してから PR を更新する
   - ロール追加時は本 README の表・[`Taskfile.yaml`](./Taskfile.yaml) の `verify:full`・[`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh) の Docker full 行列を同時更新する

## 変更時のチェックリスト

- [ ] 新ロールなら `infra/docker/<role>/Dockerfile` を追加し、本 README の表・判断フロー・ビルド例を更新した
- [ ] ベースイメージは digest 固定、ツール版は Renovate 追跡可能な `ARG` にした
- [ ] ルートからの `docker build -f … .` および `task docker:build:*` でビルドできることを確認した
- [ ] 代表検証 `task docker:verify`（必要なら `verify:full`）を通した
- [ ] 新ターゲットなら [`Taskfile.yaml`](./Taskfile.yaml) の `verify:full` と [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh) の Docker full 行列を更新した
- [ ] ルート [README.md](../../README.md) のドキュメント案内から辿れる（本ファイルへのリンクが生きている）
