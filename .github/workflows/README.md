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
| `Check` | `sqlc diff`・packages ビルド・`pnpm typegen`・`pnpm check`・べた書き `<svg>` の grep・`pnpm typecheck` | [`AGENTS.md`](../../AGENTS.md) |
| `Lint / Go` | `golangci-lint run ./...`（`server/`、設定は `server/.golangci.yml`） | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / Go` | `go test ./...`（`server/`） | [`server/AGENTS.md`](../../server/AGENTS.md) |
| `Test / TypeScript` | packages ビルド後に `pnpm test` | [`apps/AGENTS.md`](../../apps/AGENTS.md) |
| `Test / DB Migrations` | 空 Postgres に対する `migrate up` → `down -all` → `up` | [`db/AGENTS.md`](../../db/AGENTS.md) |
| `Test / Mobile` | `task mobile:check`（依存は `task mobile:deps`） | [`mobile/README.md`](../../mobile/README.md) |
| `Test / E2E` | `task e2e:run`（ビルド → readiness → Playwright → teardown） | [`e2e/README.md`](../../e2e/README.md) |
| `Test / Bootstrap` | `task e2e:bootstrap`（空 volume → `task setup` → DB 再起動 → `task dev`） | [`e2e/bootstrap/README.md`](../../e2e/bootstrap/README.md) |
| `Build` | `pnpm build`（Web）・`task server:build`（Go） | 本ファイル |
| `Docker / <target>` | `task docker:build:*`（web は続けて `task docker:smoke:web`） | [`infra/docker/README.md`](../../infra/docker/README.md) |
| `Summary` | 全ジョブの結果を集約する最終ジョブ | 本ファイル |

Branch ruleset が要求する必須チェックは最終集約ジョブ **`Summary` のみ**（UI 上は `CI / Summary`）。中間ジョブは path filter で個別にスキップされうるが、`Summary` は `skipped` を success として扱う。

## トリガと実行モード

| トリガ | ホスト CI | Docker |
| --- | --- | --- |
| `pull_request`（main 宛て） / `push`（main） | path filter で該当ジョブのみ | 変更ロールの代表のみ（`docker_core` に触れた場合は全ターゲット） |
| `schedule`（毎日 03:00 UTC） | `Test / Bootstrap` のみ | 全ターゲット（Nightly フル） |
| `workflow_dispatch` | 全ジョブ実行 | 入力 `docker_mode` で `verify`（代表）/ `full`（全ターゲット）を選択 |

Nightly フルは path filter で拾えないサービス横断のドリフトを検出するためのもので、ホスト CI は `Test / Bootstrap` を除き回さない。`Test / Bootstrap` だけは例外で、`.devcontainer/**` のように普段の PR ではほとんど触られない構成 path を監視対象に含むため、定期実行でも 1 日 1 回は通す。

## path filter

`Detect changes` が [dorny/paths-filter](https://github.com/dorny/paths-filter) で変更 path を判定し、`scripts/ci-plan-jobs.sh` が実行フラグと Docker 行列に変換する。

**全ジョブ共通**で、`.github/workflows/ci.yml` と `scripts/ci-plan-jobs.sh` の変更は必ずそのジョブを起動する（CI 自体の変更を取りこぼさないため）。また**全ジョブ共通で Markdown（`**/*.md`）は監視対象から除外**する（後述）。以下の表は共通分を除いた監視 path。

| ジョブ | 監視 path（共通分を除く） |
| --- | --- |
| `Check` | `apps/**`, `locales/**`, `packages/**`, `e2e/**`, `server/**`, `db/**`, `proto/**`, `sqlc.yaml`, `buf.yaml`, `buf.gen.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `oxlint.config.ts`, `oxfmt.config.ts` |
| `Lint / Go` | `server/**` |
| `Test / Go` | `server/**`, `db/**`, `proto/**`, `sqlc.yaml`, `buf.yaml`, `buf.gen.yaml` |
| `Test / TypeScript` | `apps/**`, `locales/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |
| `Test / DB Migrations` | `db/**`, `sqlc.yaml` |
| `Test / Mobile` | `mobile/**`, `Taskfile.yaml` |
| `Test / E2E` | `e2e/**`, `apps/web-host/**`, `apps/web-admin/**`, `apps/web-platform/**`, `packages/**`, `server/**`, `db/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `Taskfile.yaml` |
| `Test / Bootstrap` | `.devcontainer/**`, `db/**`, `e2e/bootstrap/**`, `apps/**`, `packages/**`, `server/**`, `Taskfile.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |
| `Build` | `apps/**`, `packages/**`, `server/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |
| `Docker`（ロール別） | [`infra/docker/README.md`](../../infra/docker/README.md) の「変更検知のロール対応」 |

### ドキュメントのみの変更の除外

監視 path は `apps/**` のようにディレクトリ単位で指定しているため、放置すると配下の README / AGENTS.md を直しただけで `Check` や `Test / E2E` まで走る。これを避けるため、全 filter が否定パターン `!**/*.md` を共有する（[#656](https://github.com/publira/publira/issues/656)）。

```yaml
predicate-quantifier: "some-with-excludes"
filters: |
  docs_excluded: &docs_excluded
    - '!**/*.md'
  check:
    - *docs_excluded
    - 'apps/**'
    …
```

- **`predicate-quantifier: "some-with-excludes"` は必須**。既定の `some` は「どれか 1 つの pattern にマッチすれば採用」なので、`!**/*.md` が単なる選択肢の 1 つとして扱われて除外が効かない。`some-with-excludes` では「肯定 pattern に 1 つ以上マッチし、かつ否定 pattern に 1 つもマッチしない」となる。この入力はアクション全体（全 filter）に適用されるが、他の pattern はすべて肯定なので挙動は変わらない。
- 除外リストは YAML アンカー `&docs_excluded` に 1 箇所だけ定義し、各 filter が `*docs_excluded` で参照する。**filter を追加したらこの行も足す**（書き漏れるとその filter だけ Markdown で起動する）。
- `docs_excluded` 自体も filter として出力されるが、否定 pattern しか持たない filter は常に false で、`scripts/ci-plan-jobs.sh` も読んでいない。
- Markdown とコードが混在する PR では、コード側が肯定 pattern にマッチするので従来どおりジョブは起動する。
- 除外対象は `**/*.md` のみ。ルート直下の `LICENSE` や `.coderabbit.yaml` などはそもそもどの filter の監視 path にも入っていない。

### `Detect changes` の checkout（push イベントの base 解決）

paths-filter の判定方法はトリガによって異なり、`Detect changes` の checkout はそれに合わせる必要がある。

| トリガ | 判定方法 | 必要な履歴 |
| --- | --- | --- |
| `pull_request` | GitHub API から変更ファイル一覧を取得 | 不要（shallow で足りる） |
| `push` | `github.event.before`..HEAD を **ローカルで git diff** | base コミットがローカルに必要 |

`Detect changes` の checkout は `persist-credentials: false`（ハードニング）なので、base コミットが手元になくても paths-filter のフォールバックの `git fetch` は認証できず exit 128 で落ちる。そのため `push` のときだけ `fetch-depth: 0` にして base をローカルに用意し、`git cat-file -e` で解決できる状態にしている（[#657](https://github.com/publira/publira/issues/657)）。

```yaml
fetch-depth: ${{ github.event_name == 'push' && '0' || '1' }}
```

`'0'` のクォートは必須。GitHub の式では `0` が falsy なので、クォートを外すと `github.event_name == 'push' && 0 || 1` が push 時に `1` へ潰れ、同じ失敗が再発する。

### テストを分割している理由

Go / TypeScript / DB migration / Mobile / E2E / Bootstrap は**ジョブを分ける**。片方の言語しか触らない PR で無関係なツールチェーンのセットアップとテストを走らせないためで、`Summary` が集約するので必須チェックの数は増えない。

`sqlc diff` は、`sqlc.yaml` の `schema` 設定が指すスキーマファイル（`db/migrations/`）と `queries`（`db/query/`）を読んで生成結果との差分を検証する codegen チェックであり、生きた DB 接続を必要としない。したがって `Check` に残し、`Check` 自体は Postgres service を持たない。

## Lint / Go（golangci-lint）

フロントの lint が `Check` に入っているのと対称に、Go の静的解析は独立ジョブ `Lint / Go` で回す（[#587](https://github.com/publira/publira/issues/587)）。`Test / Go` と分けているのは、Testcontainers を伴う Go テストの完了を待たずに lint 結果が出るため、および `Check` の広い path filter（`apps/**` など）でフロントだけの PR に golangci-lint を走らせないため。

- ルールセットとバージョン: [`server/.golangci.yml`](../../server/.golangci.yml) と `ci.yml` の `GOLANGCI_LINT_VERSION`（devcontainer の同名 `ARG` と揃える。どちらも Renovate 管理）
- ローカル等価コマンド: `task server:lint`
- path filter は `Test / Go` より狭い `server/**` のみ。golangci-lint が読むのは Go ソースと `server/.golangci.yml` だけで、`task gen` の出力先も `server/` 配下なので、`db/**` や `proto/**` だけの変更で結果が変わることはない。

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
   - `Detect changes` → path filter の base 解決（push イベントの checkout 履歴。上記「`Detect changes` の checkout」を参照）
   - `Check` → lint・フォーマット・型・`sqlc diff`
   - `Test / Go` → `server/` の `go test`
   - `Test / TypeScript` → `pnpm test`
   - `Test / DB Migrations` → `db/migrations/00000000000000_baseline.{up,down}.sql` の SQL（`up` / `down -all` / `up` の往復）
   - `Test / Mobile` → `task mobile:check`（format / analyze / test）
   - `Test / E2E` → readiness 失敗かテスト失敗か（artifact `e2e-artifacts`）
   - `Test / Bootstrap` → どの phase で落ちたか（artifact `bootstrap-artifacts`）
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
   | `Test / Bootstrap` | `task e2e:bootstrap`（常に teardown する。`task dev` を止められないときは `BOOTSTRAP_SKIP_DEV=1`） |
   | `Build` | `pnpm build` / `task server:build` |
   | `Docker / <target>` | CI ログの `task docker:build:…` 行をそのまま実行、または `task docker:verify` |

3. **CI だけ失敗する場合**
   - ランナー arch とローカルの差（Docker については [`infra/docker/README.md`](../../infra/docker/README.md) の「ビルド失敗時のトリアージ」を参照）
   - キャッシュ汚れ → 再実行、ローカルは `docker builder prune`
   - path filter の取りこぼし懸念 → `workflow_dispatch` で全ジョブ実行（Docker は `full`）、または Nightly の結果を確認

## CI を変更するときのチェックリスト

- [ ] ジョブを追加・改名したら `Summary` の `needs` と集約ループ（`env` と表示名）に足した
- [ ] path filter を追加したら `scripts/ci-plan-jobs.sh` の `FILTER_*` 読み取り・出力・`workflow_dispatch` 分岐を更新した
- [ ] path filter を追加したら先頭に `- *docs_excluded` を入れた（ドキュメントのみの変更で起動しないこと）
- [ ] 本ファイルの「ジョブ一覧」「path filter」表を更新した
- [ ] `Detect changes` の checkout を変えた場合、push イベントで base コミットを解決できることを確認した（`fetch-depth` と `persist-credentials` の組み合わせ）
- [ ] ジョブ表示名を変えた場合、Branch ruleset の必須チェックは `Summary` のままで足りるか確認した
- [ ] Docker ターゲットを増やした場合は [`infra/docker/Taskfile.yaml`](../../infra/docker/Taskfile.yaml) の `verify:full` と `scripts/ci-plan-jobs.sh` の full 行列を同時に更新した
