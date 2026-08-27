# ホストベースルーティング疎通チェック

開発環境 Traefik（`.devcontainer/compose.yaml` の Docker labels）のルーティング退行を、実アプリを起動せずに検知する。

関連: [#55](https://github.com/publira/publira/issues/55) / Epic [#512](https://github.com/publira/publira/issues/512)

Playwright E2E（[`../README.md`](../README.md)）はアプリポートへ直結する。bootstrap（[`../bootstrap/README.md`](../bootstrap/README.md)）は `task setup` / `task dev` を検証するが Traefik は起動しない。どちらもここの対象外。

## なぜ必要か

Traefik の振り分けは `.devcontainer/compose.yaml` の `app` labels だけが正である。priority・HostRegexp・`/api` の strip-prefix・`/api/v1/revalidate` の除外・`/images` の admin 分岐は、ラベルを 1 行変えただけで壊れる。その退行は `pnpm preflight` でも Playwright でも bootstrap でも見えない。

本チェックは **同じ compose ファイル** を専用 project 名で起動し、`app` のプロセスだけをポート応答用の echo サーバーに差し替える。ラベルはそのままなので、compose 上のルール変更がそのままテストに現れる。

## 前提

- Docker（Compose v2, `!reset` / `!override` を解釈できる版）
- `curl` / `task`

| 用途 | ポート | 備考 |
| --- | --- | --- |
| Traefik web entrypoint | `13080` | `ROUTING_TRAEFIK_PORT` で変更可。Dev Container の `3080` とはずらしてある |
| Traefik API / dashboard | `18080` | `ROUTING_TRAEFIK_API_PORT` で変更可。readiness が routers を読む |

`db` / `redis` / `mailpit` は起動しない。`task dev` を動かしたままでも、既定ポートが衝突しなければ同時に走らせられる。

ログは既定で `e2e/routing/.run/` に置く。`ROUTING_TRAEFIK_PORT` / `ROUTING_TRAEFIK_API_PORT` / `ROUTING_PROJECT_NAME` を既定から変えた場合、`lib.sh` は project 名とポートを組み合わせたサブディレクトリに state を分ける。明示的な `ROUTING_RUN_DIR` があればそちらを優先する。同じ compose project の並行起動は flock で拒否する。同じポートでの並行起動はポート競合で失敗する想定。

## 実行

```bash
task e2e:routing
```

成功・失敗・中断のいずれでも teardown する（compose project + volume を消す）。

### 分解コマンド

| コマンド | 内容 |
| --- | --- |
| `task e2e:routing:up` | `.devcontainer/compose.yaml` + overlay で `traefik` + echo `app` を起動 |
| `task e2e:routing:wait-ready` | Traefik API に 6 本の labeled router が出るまで待つ |
| `task e2e:routing:test` | Host / `/api` / `/images` のプローブ（stack 起動済み前提） |
| `task e2e:routing:down` | teardown |

## 検証内容

echo サーバーは受けたリクエストを `{"backend","port","path","host","method"}` で返す。アサーションは **どのバックエンドに届いたか** と **そのバックエンドが見た path**（strip-prefix 後）の両方。

| 系統 | 例 | 期待 |
| --- | --- | --- |
| web-host | `Host: localhost` `/` | `web-host` (`:3000`) path `/` |
| web-host | `Host: other.localhost` `/catalog` | `web-host`（Host 非制限の fallback） |
| web-admin | `Host: admin.localhost` `/` | `web-admin` (`:4000`) |
| web-admin | `Host: admin2.example.com` `/series` | `web-admin`（`admin\d*`） |
| web-admin | `Host: administrator.localhost` `/` | `web-host`（非マッチ） |
| web-platform | `Host: platform.localhost` `/` | `web-platform` (`:4100`) |
| Host + port | `Host: admin.localhost:3080` `/` | `web-admin`（Traefik は hostname だけ見る） |
| `/api` strip | `GET /api/readyz` | `api` (`:8000`) path `/readyz` |
| `/api` on admin / platform | `Host: admin.localhost` `/api/readyz` | `api` path `/readyz`（priority 105 > host 100） |
| revalidate 除外 | `POST /api/v1/revalidate` | `web-host` path `/api/v1/revalidate`（strip しない） |
| revalidate on admin | `Host: admin.localhost` `POST /api/v1/revalidate` | `web-admin`（admin-api が叩く Next.js） |
| revalidate の prefix | `GET /api/v1/revalidate/extra` | `api` path `/v1/revalidate/extra`（完全一致だけ除外） |
| `/images` | `GET /images/cover` | `image-server` (`:8200`) |
| `/images` on platform | `Host: platform.localhost` `/images/cover` | `image-server`（priority 110 > 100） |
| `/images` on admin | `Host: admin.localhost` `/images/cover` | `admin-image-server` (`:8201`, priority 130） |

## 構成

```text
e2e/routing/
├── compose.override.yaml   # .devcontainer/compose.yaml への overlay（port 公開 + echo app）
├── echo.py                 # 3000 / 4000 / 4100 / 8000 / 8200 / 8201 で JSON を返す
├── Taskfile.yaml
└── scripts/
    ├── lib.sh
    ├── run.sh              # up → wait-ready → test + 常時 teardown
    ├── up.sh / wait-ready.sh / test.sh
    └── down.sh
```

`app` の Traefik labels は overlay しない。image / command / volumes / depends_on / healthcheck だけを差し替える。

## 失敗時のトリアージ

失敗したメッセージ（`[routing] ERROR: …`）がどのプローブかを示す。

1. **port is already in use** — `13080` / `18080` を空けたか、`ROUTING_TRAEFIK_PORT` を変える
2. **readiness failed: traefik-routers** — Docker provider が labels を読んでいない。`app` に `traefik.enable=true` があるか、`/var/run/docker.sock` が Traefik から見えるかを確認
3. **backend / path mismatch** — `.devcontainer/compose.yaml` の該当 router の rule / priority / middleware

`.run/logs/` に次を残す（teardown では消さない）。

- `compose-ps.log` / `compose.log` — 失敗時のみ
- `traefik-routers.json` — 失敗時のみ。Traefik API の routers 一覧

## CI

ジョブ名: **Test / Routing**（`.github/workflows/ci.yml`）

- path filter: `.devcontainer/**`, `e2e/routing/**`。ラベルの正本と本チェック自身だけ
- `workflow_dispatch` では他ジョブと同様に必ず実行する。Nightly には載せない（compose を触る PR で既に走る）
- 失敗時 artifact: `routing-artifacts`（`.run/`）

`e2e/routing/**` の変更では Playwright の **Test / E2E** は起動しない。

ジョブ構成全体: [`.github/workflows/README.md`](../../.github/workflows/README.md)

## 非スコープ

- 実アプリの業務シナリオ（[`../README.md`](../README.md)）
- `task setup` / `task dev`（[`../bootstrap/README.md`](../bootstrap/README.md)）
- 本番 Traefik / 監視 / 負荷試験
