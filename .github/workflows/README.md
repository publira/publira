# CI ワークフロー

[`ci.yml`](./ci.yml)（workflow 名 `CI`）のジョブ構成・トリガ・path filter・失敗時のトリアージを定義する。  
「どのジョブがいつ動くか」の一次情報は本ファイル。「各ジョブが何を検証するか」は各ドメインの README / AGENTS を正とする。

実装:

- ワークフロー本体: [`ci.yml`](./ci.yml)
- ジョブ計画（どのジョブを走らせ、Docker 行列に何を積むか）: [`scripts/ci-plan-jobs.sh`](../../scripts/ci-plan-jobs.sh)

Docker イメージの配置規約・ビルド手順・Docker 固有のトリアージは [`infra/docker/README.md`](../../infra/docker/README.md) を正とする。本ファイルは `Docker` ジョブが CI 上でどう起動されるかだけを扱う。

## ジョブ一覧

| ジョブ（表示名） | 内容 | 詳細 |
| --- | --- | --- |
| `Detect changes` | path filter を評価し、実行するジョブと Docker 行列を決める | 本ファイル |
| `Check` | `sqlc diff`・packages ビルド・`pnpm typegen`・`pnpm check`・`pnpm typecheck` | [`AGENTS.md`](../../AGENTS.md) |
| `Test / Go` | `go test ./...`（`server/`） | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / TypeScript` | packages ビルド後に `pnpm test` | [`apps/AGENTS.md`](../../apps/AGENTS.md) |
| `Test / DB Migrations` | 空 Postgres に対する `migrate up` → `down -all` → `up` | [`db/AGENTS.md`](../../db/AGENTS.md) |
| `Test / Mobile` | `task mobile:check`（依存は `task mobile:deps`） | [`mobile/README.md`](../../mobile/README.md) |
| `Test / E2E` | `task e2e:run`（ビルド → readiness → Playwright → teardown） | [`e2e/README.md`](../../e2e/README.md) |
| `Build` | `pnpm build`（Web）・`task server:build`（Go） | 本ファイル |
| `Docker / <target>` | `task docker:build:*`（web は続けて `task docker:smoke:web`） | [`infra/docker/README.md`](../../infra/docker/README.md) |
| `Summary` | 全ジョブの結果を集約する最終ジョブ | 本ファイル |

Branch ruleset が要求する必須チェックは最終集約ジョブ **`Summary` のみ**（UI 上は `CI / Summary`）。中間ジョブは path filter で個別にスキップされうるが、`Summary` は `skipped` を success として扱う。

## トリガと実行モード

| トリガ | ホスト CI | Docker |
| --- | --- | --- |
| `pull_request`（main 宛て） / `push`（main） | path filter で該当ジョブのみ | 変更ロールの代表のみ（`docker_core` に触れた場合は全ターゲット） |
| `schedule`（毎日 03:00 UTC） | スキップ | 全ターゲット（Nightly フル） |
| `workflow_dispatch` | 全ジョブ実行 | 入力 `docker_mode` で `verify`（代表）/ `full`（全ターゲット）を選択 |

Nightly フルは path filter で拾えないサービス横断のドリフトを検出するためのもので、ホスト CI は回さない。

## path filter

`Detect changes` が [dorny/paths-filter](https://github.com/dorny/paths-filter) で変更 path を判定し、`scripts/ci-plan-jobs.sh` が実行フラグと Docker 行列に変換する。

**全ジョブ共通**で、`.github/workflows/ci.yml` と `scripts/ci-plan-jobs.sh` の変更は必ずそのジョブを起動する（CI 自体の変更を取りこぼさないため）。以下の表は共通分を除いた監視 path。

| ジョブ | 監視 path（共通分を除く） |
| --- | --- |
| `Check` | `apps/**`, `packages/**`, `e2e/**`, `server/**`, `db/**`, `proto/**`, `sqlc.yaml`, `buf.yaml`, `buf.gen.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `oxlint.config.ts`, `oxfmt.config.ts` |
| `Test / Go` | `server/**`, `db/**`, `proto/**`, `sqlc.yaml`, `buf.yaml`, `buf.gen.yaml` |
| `Test / TypeScript` | `apps/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |
| `Test / DB Migrations` | `db/**`, `sqlc.yaml` |
| `Test / Mobile` | `mobile/**`, `Taskfile.yaml` |
| `Test / E2E` | `e2e/**`, `apps/web-host/**`, `packages/**`, `server/**`, `db/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `Taskfile.yaml` |
| `Build` | `apps/**`, `packages/**`, `server/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |
| `Docker`（ロール別） | [`infra/docker/README.md`](../../infra/docker/README.md) の「変更検知のロール対応」 |

### テストを分割している理由

Go / TypeScript / DB migration / Mobile / E2E は**ジョブを分ける**。片方の言語しか触らない PR で無関係なツールチェーンのセットアップとテストを走らせないためで、`Summary` が集約するので必須チェックの数は増えない。

`sqlc diff` は `sqlc.yaml` がスキーマファイル（`db/migrations/`）を直接読む codegen 検証であり、生きた DB 接続を必要としない。したがって `Check` に残し、`Check` 自体は Postgres service を持たない。

## Test / DB Migrations（migration の up/down 検証）

[`db/AGENTS.md`](../../db/AGENTS.md) の baseline 単一ファイル運用を前提に、このジョブ専用の Postgres service（他ジョブとは別インスタンス）へ次の順で `golang-migrate` を実行する。

1. `migrate up` — 空 DB へ baseline を適用できること
2. `migrate down -all` — dirty にならず空 DB まで戻せること（baseline の `down.sql` の健全性）
3. `migrate up` — down 後に再適用できること（往復の整合性）

いずれかのステップが失敗（dirty 化を含む）すれば `Test / DB Migrations` が落ち、`Summary` が赤くなる。

## Docker ジョブ

`Docker / <target>` は matrix ジョブで、`scripts/ci-plan-jobs.sh` が組み立てた行列（ロール・ターゲット・`task` 名・build arg）をそのまま実行する。コマンドはローカルと同一の `task docker:build:web|api|batch` で、web ロールは続けて `task docker:smoke:web` を走らせる。

- 変更検知のロール対応（どの path でどの代表イメージをビルドするか）・verify / full の使い分け: [`infra/docker/README.md`](../../infra/docker/README.md) の「Docker の CI 実行戦略」
- ビルド規約・ローカル検証・Docker 固有のトリアージ: [`infra/docker/README.md`](../../infra/docker/README.md)

## 失敗時のトリアージ

1. **どのゲートが落ちたか**（workflow `CI` 内のジョブ名）を見る
   - 最終ジョブ **`Summary`** が赤 → 依存ジョブのどれかが `failure` / `cancelled`（ログに `Job failed: <名前>` が出る）
   - `Check` → lint・フォーマット・型・`sqlc diff`
   - `Test / Go` → `server/` の `go test`
   - `Test / TypeScript` → `pnpm test`
   - `Test / DB Migrations` → `db/migrations/00000000000000_baseline.{up,down}.sql` の SQL（`up` / `down -all` / `up` の往復）
   - `Test / Mobile` → `task mobile:check`（format / analyze / test）
   - `Test / E2E` → readiness 失敗かテスト失敗か（artifact `e2e-artifacts`）
   - `Build` → `pnpm build` / `go build`
   - `Docker / <target>` → Dockerfile 経路・context・ベースイメージ・コンテナ内ビルド
2. **ローカルで同じコマンドを再現する**

   | ジョブ | ローカル再現 |
   | --- | --- |
   | `Check` | `pnpm preflight`（typegen / typecheck / check / test） |
   | `Test / Go` | `task server:test-short` → `task server:test` |
   | `Test / TypeScript` | `pnpm test`（先に `pnpm build --filter "./packages/*"`） |
   | `Test / DB Migrations` | `task db:reset`（`drop` → `migrate` → `seed`）。`down` 単体は `task db:rollback` |
   | `Test / Mobile` | `task mobile:check`（依存は `task mobile:deps`） |
   | `Test / E2E` | `task e2e`（常に teardown する） |
   | `Build` | `pnpm build` / `task server:build` |
   | `Docker / <target>` | CI ログの `task docker:build:…` 行をそのまま実行、または `task docker:verify` |

3. **CI だけ失敗する場合**
   - ランナー arch とローカルの差（Docker については [`infra/docker/README.md`](../../infra/docker/README.md) の「ビルド失敗時のトリアージ」を参照）
   - キャッシュ汚れ → 再実行、ローカルは `docker builder prune`
   - path filter の取りこぼし懸念 → `workflow_dispatch` で全ジョブ実行（Docker は `full`）、または Nightly の結果を確認

## CI を変更するときのチェックリスト

- [ ] ジョブを追加・改名したら `Summary` の `needs` と集約ループ（`env` と表示名）に足した
- [ ] path filter を追加したら `scripts/ci-plan-jobs.sh` の `FILTER_*` 読み取り・出力・`workflow_dispatch` 分岐を更新した
- [ ] 本ファイルの「ジョブ一覧」「path filter」表を更新した
- [ ] ジョブ表示名を変えた場合、Branch ruleset の必須チェックは `Summary` のままで足りるか確認した
- [ ] Docker ターゲットを増やした場合は [`infra/docker/Taskfile.yaml`](../../infra/docker/Taskfile.yaml) の `verify:full` と `scripts/ci-plan-jobs.sh` の full 行列を同時に更新した
