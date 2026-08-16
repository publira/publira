# 開発環境 bootstrap チェック

クリーンな環境でのセットアップから全開発サービス起動までを、実際の開発コマンド（`task setup` / `task dev`）で検証する。

関連: [#514](https://github.com/publira/publira/issues/514) / Epic [#512](https://github.com/publira/publira/issues/512)

## なぜ必要か

PostgreSQL 18 のデータディレクトリ仕様と Compose の volume マウント先が食い違い、DB コンテナが起動せず `task setup` が失敗したことがある（[#511](https://github.com/publira/publira/pull/511)）。この種の構成退行は `pnpm preflight` でも Playwright E2E（[`../README.md`](../README.md)）でも検出できない。前者はアプリコードを見ないため、後者は `e2e/compose.yaml` という専用スタックを使い Dev Container の定義を読まないため。

そこで本チェックは **`.devcontainer/compose.yaml` そのもの**を専用 project 名で起動し、空 volume から開発を始めたときの一連の流れを再現する。

## 前提

- Docker（Compose v2, `!override` を解釈できる版）
- `task` / `psql` / `migrate` / Node.js / pnpm / Go / `aws`（S3 バケット作成に使う。Dev Container は `aws-cli` feature で同梱）
- 下記ポートが空いていること

| 用途 | ポート | 備考 |
| --- | --- | --- |
| bootstrap Postgres | `5434` | `BOOTSTRAP_POSTGRES_PORT` で変更可 |
| bootstrap Redis | `6381` | `BOOTSTRAP_REDIS_PORT` で変更可 |
| bootstrap RustFS (S3) | `9002` | `BOOTSTRAP_RUSTFS_PORT` で変更可 |
| `task dev` の全サービス | `3000` `4000` `4100` `8000`–`8002` `8100`–`8102` `8200` `8201` | **変更不可**（Next.js のポートは `apps/*/package.json` の `dev` に固定） |

データストアのポートは Dev Container（`5432` / `6379`）とも Playwright E2E（`5433` / `6380` / `9003`）ともずらしてあるので、それらと同時に動かせる。一方 `task dev` のポートは固定なので、**開発用の `task dev` を動かしたままでは phase 4 が走らない**（起動前にポート衝突を検出して落とす）。

## 実行

```bash
task e2e:bootstrap
```

成功・失敗・中断のいずれでも teardown する（`task dev` のプロセスグループと compose project + volume を消す）。

### 分解コマンド

| コマンド | 内容 |
| --- | --- |
| `task e2e:bootstrap:up` | phase 1: 空 volume で `db` + `redis` + `rustfs` を起動 |
| `task e2e:bootstrap:setup` | phase 2: `task setup` と migration / seed の検証 |
| `task e2e:bootstrap:restart-db` | phase 3: DB と RustFS の再起動後の永続性検証 |
| `task e2e:bootstrap:dev-up` | phase 4a: `task dev` をバックグラウンド起動 |
| `task e2e:bootstrap:dev-wait` | phase 4b: 全サービスの health probe |
| `task e2e:bootstrap:dev-down` | `task dev` のプロセスグループを停止 |
| `task e2e:bootstrap:down` | teardown（`dev-down` + compose 削除） |

ローカルで開発用 `task dev` を止めたくない場合は `BOOTSTRAP_SKIP_DEV=1 task e2e:bootstrap`（phase 1–3 のみ）。CI では使わない。

## 検証内容

| phase | 実行 | アサーション |
| --- | --- | --- |
| 1 | 専用 project `publira-bootstrap` で `db` + `redis` + `rustfs` を起動 | volume `publira-bootstrap_postgres-data` が `/var/lib/postgresql` にマウントされている / `data_directory` がその配下（PG 18 なら `/var/lib/postgresql/18/docker`）にあり `PG_VERSION` が存在する / `schema_migrations` がまだ無い / teardown 後に `publira-bootstrap_postgres-data`・`publira-bootstrap_rustfs-data` が残っていない |
| 2 | `task setup`（Flutter が無ければ `task deps` + `task db:setup` + `task server:storage-init`） | `schema_migrations` が最新 version かつ dirty でない / seed テナント `localhost` がある / 主要テーブルが空でない / `task db:seed` を再実行しても件数が変わらない / `task server:storage-init` を再実行しても成功する（バケット作成が冪等） |
| 3 | `compose stop db rustfs` → `compose up --wait db rustfs` | `data_directory`・migration 状態・全 seed 件数が再起動前と一致する / 再起動前に置いた sentinel object がバケットごと残り、内容も一致する（`storage-init` を再実行する**前**に確認する） / 再度 `task db:setup` と `task server:storage-init` を流しても dirty にならない |
| 4 | `task dev` | 5 つの Go サーバー（public / admin / platform API の Connect + gRPC 口、image / admin image）と 3 つの Next.js アプリが `/livez`・`/readyz` を 200 で返し、11 ポート全てが listen している / bootstrap 用 Redis に app からの接続がある |

phase 2 で `task setup` を丸ごと実行するのは Flutter SDK がある環境（Dev Container）のみ。無い環境では `mobile:deps` を除いた `task deps` + `task db:setup` を実行する（モバイル依存は `Test / Mobile` ジョブの担当）。

`task dev` に渡す環境変数（`PUBLIRA_*_DB_URL` / `REDIS_URL` / `STORAGE_BACKEND` / `S3_*` / `AWS_*`）は `scripts/lib.sh` が bootstrap 用スタックを指すよう export する。ストレージは Dev Container と同じく `STORAGE_BACKEND=s3` + path-style で、`S3_ENDPOINT` は bootstrap 用 RustFS（`http://127.0.0.1:${BOOTSTRAP_RUSTFS_PORT}`）に固定する。Go サーバーと Next.js アプリの API 向き先は既定値（`localhost` + 標準ポート）のままなので上書きしない。

phase 4 の最後に bootstrap 用 Redis の `connected_clients` を確認するのは、`/readyz` が 200 でも「別の Redis に繋がっているだけ」の可能性を潰すため。実際 turbo は既定が strict env mode で、`turbo.json` の `dev` に `passThroughEnv` が無いと `REDIS_URL` がアプリに届かず `redis://localhost:6379` へフォールバックする。

## 構成

```text
e2e/bootstrap/
├── compose.override.yaml   # .devcontainer/compose.yaml への overlay（port 公開 + db healthcheck）
├── Taskfile.yaml
└── scripts/
    ├── lib.sh              # パス・URL・probe 一覧・アサーションヘルパー
    ├── run.sh              # phase 1–4 + 常時 teardown + 失敗時ログ収集
    ├── up.sh / setup.sh / restart-db.sh
    ├── dev-up.sh / dev-wait.sh / dev-down.sh
    └── down.sh
```

Dev Container の `rustfs` は S3 エンドポイントをホストへ公開しない（app コンテナが `http://rustfs:9000` で引ける）。bootstrap は `task dev` をホスト側プロセスとして動かすので、`compose.override.yaml` で `127.0.0.1:9002` に公開する。

`task db:setup` を bootstrap の DB に向けられるのは、`db/Taskfile.yaml` の `DB_URL` が `PUBLIRA_DB_URL` を既定値より優先するため。未設定なら従来どおり Dev Container の `db` サービスを指す。

## 失敗時のトリアージ

失敗した phase のメッセージ（`[bootstrap] ERROR: …`）がどの段階かを示す。

1. **phase 1** — Compose の定義そのもの。`.devcontainer/compose.yaml` の `db` の image / volume を確認する（[#511](https://github.com/publira/publira/pull/511) と同型の退行）
2. **phase 2** — migration か seed。`db/migrations/` と `db/seeds/`（[`../../db/AGENTS.md`](../../db/AGENTS.md)）
3. **phase 3** — データが volume に載っていない。DB ならマウント先と `data_directory` の関係、RustFS なら `rustfs-data` volume と sentinel object の消失を疑う
4. **phase 4** — `readiness failed: <name>` に出たサービス。`.run/logs/task-dev.log` を見る

`.run/logs/` に次を残す（teardown では消さない）。

- `task-dev.log` — `task dev` の全出力。phase 4 を実行すれば成功時も残る
- `compose-ps.log` / `compose.log` — Compose の状態とコンテナログ。失敗時のみ生成する

## CI

ジョブ名: **Test / Bootstrap**（`.github/workflows/ci.yml`）

- path filter: `.devcontainer/**`, `db/**`, `e2e/bootstrap/**`, `apps/**`, `packages/**`, `server/**`, `Taskfile.yaml`, lockfile など。`task dev` は全アプリ・全サーバーを起動するので、いずれのソース変更でも起動が壊れうる
- 上記に加えて **Nightly（`schedule`）でも実行**する。`.devcontainer/**` は普段の PR でほとんど触られないため
- 失敗時 artifact: `bootstrap-artifacts`（`.run/logs/`）

ジョブ構成全体: [`.github/workflows/README.md`](../../.github/workflows/README.md)

## 非スコープ

- 既存 DB データの major version upgrade
- 個別画面の業務シナリオ（[`../README.md`](../README.md) と #515–#518）
- Traefik のルーティング検証（[#55](https://github.com/publira/publira/issues/55) → [`../routing/README.md`](../routing/README.md)）
