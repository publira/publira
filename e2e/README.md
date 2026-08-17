# E2E テスト基盤

Playwright による Web 横断 E2E の共通基盤と、公開カタログ・管理画面入稿フローのシナリオです。  
残りの製品シナリオは子 Issue（#517–#518 など）側で追加します。本ディレクトリは起動・readiness・CI・成果物の標準化も責務に含みます。

関連: [#513](https://github.com/publira/publira/issues/513) / [#516](https://github.com/publira/publira/issues/516) / Epic [#512](https://github.com/publira/publira/issues/512)

開発環境そのもの（空 DB volume からの `task setup`、`task dev` の全サービス起動）の検証は Playwright を使わない別ライフサイクルで、[`bootstrap/README.md`](./bootstrap/README.md) が正（`task e2e:bootstrap`）。

Dev Container Traefik のホストベースルーティングは、同じく Playwright を使わない別ライフサイクルで、[`.devcontainer/compose.yaml`](../.devcontainer/compose.yaml) の labels を echo バックエンドで突く。[`routing/README.md`](./routing/README.md) が正（`task e2e:routing`）。

## 前提

- Docker（Compose v2）が使えること（Dev Container の DinD 可）
- リポジトリルートで `task deps` 済み
- 初回のみ Playwright の OS 依存（Chromium）:

  ```bash
  pnpm --dir e2e exec playwright install-deps chromium
  # 権限が必要なら sudo env "PATH=$PATH" pnpm --dir e2e exec playwright install-deps chromium
  ```

- ホスト上で次のポートが空いていること（既定値）

| 用途                                                   | 既定   |
| ------------------------------------------------------ | ------ |
| web-host（`other.localhost` などの別 Host も同ポート） | `3000` |
| web-admin（Host `admin.localhost`）                    | `4000` |
| web-platform（Host `platform.localhost`）              | `4100` |
| public API (Connect)                                   | `8000` |
| public API (gRPC 口 / Web が向ける先)                  | `8100` |
| admin API (Connect)                                    | `8001` |
| admin API (gRPC 口 / web-admin が向ける先)             | `8101` |
| platform API (Connect)                                 | `8002` |
| platform API (gRPC 口 / web-platform が向ける先)       | `8102` |
| E2E Postgres（compose 公開）                           | `5433` |
| E2E Redis（compose 公開）                              | `6380` |
| E2E RustFS / S3（compose 公開）                        | `9003` |

PID / ログは既定で `e2e/.run/` に置く。  
`E2E_*_PORT` や `COMPOSE_PROJECT_NAME` を既定から変えた場合、`lib.sh` はポート番号と project 名を組み合わせたサブディレクトリ（例: `e2e/.run/publira-e2e-pg5434-…/`）に state を分ける。明示的な `E2E_RUN_DIR` があればそちらを優先する。同じ compose project は `up` が残す lock-holder が lease を保持し、別の `E2E_RUN_DIR` からの `down` / `start-apps` は stack が残っている間拒否する。分解コマンドで同じ `E2E_RUN_DIR` を続ける leftover stack は `start` / `test` / `down` できる。同じポートでの並行起動はポート競合で失敗する想定。`PUBLIRA_REDIS_URL` は常に `E2E_REDIS_PORT` から組み立てる（devcontainer の `redis://redis:6379` を引き継がない）。`PUBLIRA_S3_ENDPOINT` も同様に常に `E2E_RUSTFS_PORT` から組み立てる（devcontainer の `http://rustfs:9000` を引き継ぐと、E2E のアップロードが開発用スタックの RustFS に入ってしまう）。

## 1 コマンド実行

```bash
# ビルド → Compose 起動 → migrate/seed → アプリ起動 → readiness → Playwright → 後片付け
task e2e
```

常に teardown します（成功・失敗・中断のいずれでも compose volume と app プロセスを消します）。

### 分解コマンド

| コマンド | 内容 |
| --- | --- |
| `task e2e:prepare` | server 全バイナリ / `web-host` / `web-admin` / `web-platform` ビルド + Playwright Chromium インストール |
| `task e2e:up` | Postgres + Redis + RustFS のみ起動 |
| `task e2e:db` | migrate + dev seed + S3 バケット作成（`task server:storage-init`） |
| `task e2e:start-apps` | api-server / admin-api-server / platform-api-server / publish-episodes / web-host / web-admin / web-platform をバックグラウンド起動 |
| `bash e2e/scripts/api-server.sh <start\|start-wait\|stop>` | api-server だけを操作（障害シナリオが使用） |
| `bash e2e/scripts/admin-api-server.sh <start\|start-wait\|stop>` | admin-api-server だけを操作 |
| `bash e2e/scripts/platform-api-server.sh <start\|start-wait\|stop>` | platform-api-server だけを操作 |
| `task e2e:wait-ready` | readiness ポーリング（失敗時は `readiness failed: …`） |
| `task e2e:test` | Playwright のみ（stack 起動済み前提） |
| `task e2e:test-lib` | `E2E_RUN_DIR` 隔離と compose project lock の確認（Docker 不要。`task e2e` からも走る） |
| `task e2e:down` | アプリ停止 + compose 削除（volume 含む） |

ローカルで stack を残したまま反復する場合の例:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test
# ...
task e2e:down
```

同じチェックアウトから 2 つ目の stack を並行起動するときは、compose project と **使うポートをすべて** ずらす。`lib.sh` が PID / ログを別ディレクトリに置くので、片方の障害シナリオ（`stopApiServer`）がもう片方の api-server を止めない。

```bash
COMPOSE_PROJECT_NAME=publira-e2e-alt \
  E2E_POSTGRES_PORT=5434 \
  E2E_REDIS_PORT=6381 \
  E2E_RUSTFS_PORT=9004 \
  E2E_WEB_HOST_PORT=3010 \
  E2E_WEB_ADMIN_PORT=4010 \
  E2E_WEB_PLATFORM_PORT=4110 \
  E2E_PUBLIC_API_PORT=8010 \
  E2E_PUBLIC_API_GRPC_PORT=8110 \
  E2E_ADMIN_API_PORT=8011 \
  E2E_ADMIN_API_GRPC_PORT=8111 \
  E2E_PLATFORM_API_PORT=8012 \
  E2E_PLATFORM_API_GRPC_PORT=8112 \
  task e2e
```

未指定の `E2E_*_PORT` は既定のままなので、片方だけ変えるとポート競合で失敗する。明示的な `E2E_RUN_DIR` があれば state ディレクトリはそちらを使う。同じ `COMPOSE_PROJECT_NAME` を別の `E2E_RUN_DIR` で触る操作は、先に立った stack の lease が残っている間は拒否される。

開発中に Next の HMR を使いたい場合: `E2E_WEB_MODE=dev task e2e`（CI では使わない）。

## 構成

```text
e2e/
├── bootstrap/             # 開発環境 bootstrap チェック（Playwright を使わない別ライフサイクル）
├── routing/               # Dev Container Traefik 疎通（Playwright を使わない別ライフサイクル）
├── compose.yaml           # postgres + redis + rustfs（project: publira-e2e）
├── playwright.config.ts
├── scripts/               # up / db / start / api-server / admin-api / platform-api / publish-episodes / wait-ready / stop-apps / test / lib_test / run / down
├── src/
│   ├── admin.ts           # web-admin ログイン・フォーム操作ヘルパー
│   ├── api-server.ts      # api-server の停止・再起動（障害シナリオ用）
│   ├── db.ts              # scenario SQL 適用ヘルパー
│   ├── platform.ts        # web-platform ログイン・テナント操作ヘルパー
│   ├── scenarios/         # scenario seed / seed アカウントの定数
│   └── urls.ts            # host ベース URL 定数
└── tests/
    ├── admin.publish-flow.spec.ts
    ├── catalog.browse.spec.ts
    ├── catalog.not-found.spec.ts
    ├── catalog.outage.spec.ts
    ├── catalog.error-boundary.spec.ts
    ├── catalog.tenant-boundary.spec.ts
    ├── admin.error-boundary.spec.ts
    ├── announcements.pagination.spec.ts
    ├── platform.tenant-ops.spec.ts
    ├── smoke.health.spec.ts
    └── smoke.web-host-home.spec.ts
```

- **依存 (Compose):** Postgres 18・Valkey（Redis 互換）・RustFS（S3 互換。path-style / バケット `publira`）
- **アプリ (ホストプロセス):**
  - `server/bin/api-server` + `server/bin/admin-api-server` + `server/bin/platform-api-server` + `server/bin/publish-episodes`
  - `apps/web-host` / `apps/web-admin` / `apps/web-platform`（standalone の `node server.js`）
- **seed:** 開発用 `task db:setup`（public domain `localhost` / admin domain `admin.localhost` / テナント名 `Seed Tenant` / platform `platform@example.com`）

Host ベース URL は `src/urls.ts` を参照。

### Playwright の並列と隔離

`playwright.config.ts` は `workers: 3` / `fullyParallel: false`（ファイル単位で並列、ファイル内は直列）。CI（`ubicloud-standard-4`、4 vCPU）と同じ数をローカルでも使い、隔離の前提を揃える。一時的に直列へ戻すときは `task e2e:test -- --workers=1`。

共有プロセスを落とす spec は並列 pool に載せない:

| project | 対象 | 開始条件 |
| --- | --- | --- |
| `web-host` / `web-admin` / `web-platform` | 通常 spec（3 worker で並列） | 同時開始 |
| `catalog-outage` | `catalog.outage.spec.ts` | 上記 3 project の完了後 |
| `catalog-error-boundary` | `catalog.error-boundary.spec.ts` | `catalog-outage` の完了後（同じ public API） |
| `admin-outage` | `admin.outage.spec.ts`（未追加） | main 3 project の完了後（admin API。catalog 側とは並列可） |
| `admin-error-boundary` | `admin.error-boundary.spec.ts` | `admin-outage` の完了後（同じ admin API） |
| `platform-outage` | `platform.outage.spec.ts`（未追加） | main 3 project の完了後（platform API。他系統とは並列可） |
| `platform-error-boundary` | `platform.error-boundary.spec.ts`（未追加） | `platform-outage` の完了後（同じ platform API） |

同じファイル内で共有シードを書き換える suite（お知らせの既読など）は `test.describe.configure({ mode: "serial" })` でファイル内だけ直列にする。

### Host によるテナント切り替え

web-host は単一ポートで待ち受け、テナントは `Host` / `x-forwarded-host` で解決されます。  
Chromium は `*.localhost` を RFC 6761 に従って自前でループバックへ解決するため、DNS 登録も hosts ファイルも不要です。

| 定数 | Host | 解決先 |
| --- | --- | --- |
| `WEB_HOST_BASE_URL` | `localhost` | dev seed の `Seed Tenant` |
| `WEB_HOST_OTHER_TENANT_BASE_URL` | `other.localhost` | scenario seed の `Boundary Tenant` |
| `WEB_HOST_UNKNOWN_TENANT_BASE_URL` | `unknown-tenant.localhost` | なし（proxy が 404） |
| `uncachedTenantBaseUrl()` | 毎回異なる `*.localhost` | なし（テナント解決キャッシュを外す） |

Node 側の `request` fixture は OS の名前解決を使うので、`localhost` 以外の Host はブラウザ (`page.goto`) からのみ使ってください。

## readiness 失敗とテスト失敗の区別

| 段階 | 失敗時の見え方 |
| --- | --- |
| readiness | ログに `readiness failed: <name>`。Playwright は起動しない |
| Playwright | `Playwright tests failed`。`test-results/` / `playwright-report/` / `.run/logs/` を確認 |

`wait-ready` のチェック順:

1. compose postgres / redis healthy、`GET :9003/health` → 200（RustFS。ホストから叩いて公開ポートごと確認する）
2. `GET :8100/readyz` → `status=ok`（public API）
3. `GET :8101/readyz` → `status=ok`（admin API）
4. `GET :8102/readyz` → `status=ok`（platform API）
5. `GET :3000/livez` → `ok`（web-host）
6. `GET :3000/readyz` → `status=ok`
7. `GET :4000/livez` → `ok`（web-admin）
8. `GET :4000/readyz` → `status=ok`
9. `GET :4100/livez` → `ok`（web-platform）
10. `GET :4100/readyz` → `status=ok`

## CI

ジョブ名: **Test / E2E**（`.github/workflows/ci.yml`）

- path filter: `e2e/**`（`e2e/routing/**` を除外）、`apps/web-host/**`, `apps/web-admin/**`, `apps/web-platform/**`, `packages/**`, `server/**`, `db/**` など
- 失敗時 artifact: `e2e-artifacts`（report / test-results / app logs）
- Playwright Chromium のみ、`workers: 3` / `fullyParallel: false`（ファイル単位の並列）、CI 時 retries=1
- 障害シナリオ（`.outage.` / `.error-boundary.`）は専用 project に分け、main 3 project のあとに `dependencies` で直列実行する（共有 API を落とすため）
- 必須ブランチチェックは最終ジョブ **Summary** が集約（他ジョブと同様）

CI 全体のジョブ構成・path filter・トリアージ: [.github/workflows/README.md](../.github/workflows/README.md)

## シナリオの追加手順

1. **（任意）fixture SQL**  
   `db/seeds/scenarios/<name>.sql` を追加し、必要ならテストから `applyScenarioSql('name')`（`src/db.ts`）で適用。
2. **spec を追加**  
   `e2e/tests/<area>.spec.ts` を作成。`@playwright/test` の `test` / `expect` を使う。  
   web-admin 向けはファイル名を `admin.*.spec.ts` にすると `web-admin` project（baseURL=`admin.localhost:4000`）に載る。  
   web-platform 向けは `platform.*.spec.ts`（baseURL=`platform.localhost:4100`）。  
   共有プロセスを止める spec（`stopApiServer` や `admin-api-server.sh stop`）はファイル名に `.outage.` または `.error-boundary.` を含め、同じ API を落とす隔離 project へ `dependencies` でチェーンする（`catalog-outage` → `catalog-error-boundary`、`admin-outage` → `admin-error-boundary`、`platform-outage` → `platform-error-boundary`）。
3. **Host が必要な場合**  
   `playwright.config.ts` の `projects` に `baseURL` を足すか、テスト内で `page.goto` の絶対 URL を使う。定数は `src/urls.ts` に集約する。
4. **起動対象を増やす場合**  
   `scripts/start-apps.sh` / `wait-ready.sh` / `stop-apps.sh` にプロセスと probe を追加（start だけ足して stop を忘れると `task e2e:down` 後もポートが残る）。Traefik の labels そのものを検証するのは [`routing/`](./routing/README.md)（#55）。  
   別ポートで stack を並行起動する場合、`lib.sh` がポート番号と project 名から `E2E_RUN_DIR` を自動で分ける。必要なら明示的に `E2E_RUN_DIR` を渡して上書きできる。
5. **ローカルで確認**  
   `task e2e` または stack 固定 + `task e2e:test`。
6. **CI**  
   上記 path に触れていれば `Test / E2E` が走る。`e2e/routing/**` だけを変えた場合は **Test / Routing**（`task e2e:routing`）が走り、Playwright は起動しない。

### シナリオ一覧（現状）

| ファイル | 検証内容 |
| --- | --- |
| `smoke.health.spec.ts` | `/livez`・`/readyz`（テナント非依存） |
| `smoke.web-host-home.spec.ts` | Host `localhost` で seed テナントのカタログトップ |
| `catalog.browse.spec.ts` | カタログトップの各セクション、シリーズ一覧 → 詳細 → エピソード、レーベル一覧、著者一覧 → 詳細 |
| `catalog.not-found.spec.ts` | 存在しないシリーズ / エピソード / 著者 |
| `catalog.outage.spec.ts` | 公開 API 停止中のテナント解決失敗（503 + `Retry-After`）と復旧。隔離 project `catalog-outage` |
| `catalog.error-boundary.spec.ts` | 公開 API 停止中のサイトエラー画面と再試行。隔離 project `catalog-error-boundary`（`catalog-outage` のあと） |
| `catalog.tenant-boundary.spec.ts` | Host による別テナント解決、公開中コンテンツのみの表示、テナント跨ぎ参照の遮断、未知 Host の 404 |
| `admin.error-boundary.spec.ts` | 管理 API 停止中のコンソールエラー画面と再試行。隔離 project `admin-error-boundary` |
| `announcements.pagination.spec.ts` | 会員お知らせ一覧の cursor ページングと既読 |
| `admin.publish-flow.spec.ts` | web-admin 入稿（シリーズ/エピソード作成・編集・公開）→ 管理画面再表示 → web-host 反映、バリデーションエラー、tenant 境界 |
| `platform.tenant-ops.spec.ts` | Platform Console のテナント作成・編集・停止/再開、domain の公開/管理側解決、監査ログ、operator ロール別の操作可否 |

`catalog.tenant-boundary.spec.ts` / `admin.publish-flow.spec.ts`（tenant 境界ケース）は `db/seeds/scenarios/010_multi_tenant.sql` を適用します（`applyScenarioSql`）。  
`platform.tenant-ops.spec.ts`（ロール拒否ケース）は `db/seeds/scenarios/030_platform_operators.sql` を適用します。  
`catalog.outage.spec.ts` / `catalog.error-boundary.spec.ts` は `src/api-server.ts` 経由で api-server を落として戻すので、単体で走らせる場合も `task e2e:test`（`scripts/test.sh` が `lib.sh` を読み込む）を使ってください。ファイル名で絞ると依存 project にマッチするテストが無いため、隔離 project だけが走ります。隔離 project 名を直接指定するとき（`--project=catalog-outage`）は、先に main 3 project 全部が走らないよう `--no-deps` を付けてください。

`admin.publish-flow.spec.ts` は dev seed の `admin@example.com` / `adminpass` でログインします（ログイン網羅は #67）。  
`platform.tenant-ops.spec.ts` は dev seed の `platform@example.com` / `platformpass`（super admin）と scenario の `platform-operator@example.com` を使います。  
エピソードの予約公開は UI で `scheduled` にしたあと、`datetime-local` の分単位制約を避けるため `runSql` で `scheduled_at` を過去へ進め、`publish-episodes` ワーカーの反映を待ちます。

### 未対応の挙動を先に書いておく

まだ直っていない挙動は、期待する側を `test.skip` で置き、コメントに Issue の URL を書いておきます。修正時に `test.skip` を外すだけで検証できます。

現在の `test.skip`:

| spec | 内容 | Issue |
| --- | --- | --- |
| `catalog.outage.spec.ts` | API 障害中のデータ取得失敗が素の 500 になり、フォールバックが表示されない | [#672](https://github.com/publira/publira/issues/672) |

## 失敗時のトリアージ

1. ログ先頭が `readiness failed:` か `Playwright tests failed` かを見る
2. `$E2E_RUN_DIR/logs/`（既定は `e2e/.run/logs/`。ポートや project をずらした実行では `e2e/.run/<project>-pg…/` 配下）の `api-server.log` / `admin-api-server.log` / `platform-api-server.log` / `publish-episodes.log` / `web-host.log` / `web-admin.log` / `web-platform.log`
3. `docker compose -p publira-e2e -f e2e/compose.yaml ps`
4. CI なら artifact `e2e-artifacts` の HTML report と trace

## 非スコープ

- モバイルの業務シナリオ本体（#518）
- ログイン・ログアウトとセッション失効の網羅（#67）
- ホストベースルーティングの Traefik 疎通（#55 → [`routing/`](./routing/README.md)）
- 開発環境の bootstrap 検証（#514 → [`bootstrap/`](./bootstrap/README.md)）
- 負荷試験
