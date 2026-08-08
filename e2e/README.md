# E2E テスト基盤

Playwright による Web 横断 E2E の共通基盤です。  
製品シナリオ本体は子 Issue（#515–#518 など）側で追加します。本ディレクトリは起動・readiness・CI・成果物の標準化が責務です。

関連: [#513](https://github.com/publira/publira/issues/513) / Epic [#512](https://github.com/publira/publira/issues/512)

## 前提

- Docker（Compose v2）が使えること（Dev Container の DinD 可）
- リポジトリルートで `task deps` 済み
- 初回のみ Playwright の OS 依存（Chromium）:

  ```bash
  pnpm --dir e2e exec playwright install-deps chromium
  # 権限が必要なら sudo env "PATH=$PATH" pnpm --dir e2e exec playwright install-deps chromium
  ```

- ホスト上で次のポートが空いていること（既定値）

| 用途                                  | 既定   |
| ------------------------------------- | ------ |
| web-host                              | `3000` |
| public API (Connect)                  | `8000` |
| public API (gRPC 口 / Web が向ける先) | `8100` |
| E2E Postgres（compose 公開）          | `5433` |
| E2E Redis（compose 公開）             | `6380` |

## 1 コマンド実行

```bash
# ビルド → Compose 起動 → migrate/seed → アプリ起動 → readiness → Playwright → 後片付け
task e2e
```

常に teardown します（成功・失敗・中断のいずれでも compose volume と app プロセスを消します）。

### 分解コマンド

| コマンド | 内容 |
| --- | --- |
| `task e2e:prepare` | `api-server` / `web-host` ビルド + Playwright Chromium インストール |
| `task e2e:up` | Postgres + Redis のみ起動 |
| `task e2e:db` | migrate + dev seed |
| `task e2e:start-apps` | api-server / web-host をバックグラウンド起動 |
| `task e2e:wait-ready` | readiness ポーリング（失敗時は `readiness failed: …`） |
| `task e2e:test` | Playwright のみ（stack 起動済み前提） |
| `task e2e:down` | アプリ停止 + compose 削除（volume 含む） |

ローカルで stack を残したまま反復する場合の例:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test
# ...
task e2e:down
```

開発中に Next の HMR を使いたい場合: `E2E_WEB_MODE=dev task e2e`（CI では使わない）。

## 構成

```text
e2e/
├── compose.yaml           # postgres + redis（project: publira-e2e）
├── playwright.config.ts
├── scripts/               # up / db / start / wait-ready / run / down
├── src/
│   ├── urls.ts            # host ベース URL 定数
│   └── db.ts              # scenario SQL 適用ヘルパー
└── tests/
    ├── smoke.health.spec.ts
    └── smoke.web-host-home.spec.ts
```

- **依存 (Compose):** Postgres 18・Valkey（Redis 互換）
- **アプリ (ホストプロセス):** `server/bin/api-server` + `apps/web-host`（standalone の `node server.js`）
- **seed:** 開発用 `task db:setup`（domain `localhost` / テナント名 `Seed Tenant`）

Host ベース URL は `src/urls.ts` を参照。将来の admin / platform 用定数もここにあります。

## readiness 失敗とテスト失敗の区別

| 段階 | 失敗時の見え方 |
| --- | --- |
| readiness | ログに `readiness failed: <name>`。Playwright は起動しない |
| Playwright | `Playwright tests failed`。`test-results/` / `playwright-report/` / `.run/logs/` を確認 |

`wait-ready` のチェック順:

1. compose postgres / redis healthy
2. `GET :8100/readyz` → `status=ok`
3. `GET :3000/livez` → `ok`
4. `GET :3000/readyz` → `status=ok`

## CI

ジョブ名: **Test / E2E**（`.github/workflows/ci.yml`）

- path filter: `e2e/**`, `apps/web-host/**`, `packages/**`, `server/**`, `db/**` など
- 失敗時 artifact: `e2e-artifacts`（report / test-results / app logs）
- Playwright Chromium のみ、workers=1、CI 時 retries=1
- 必須ブランチチェックは最終ジョブ **Summary** が集約（他ジョブと同様）

CI 全体のジョブ構成・path filter・トリアージ: [.github/workflows/README.md](../.github/workflows/README.md)

## シナリオの追加手順

1. **（任意）fixture SQL**  
   `db/seeds/scenarios/<name>.sql` を追加し、必要ならテストから `applyScenarioSql('name')`（`src/db.ts`）で適用。
2. **spec を追加**  
   `e2e/tests/<area>.spec.ts` を作成。`@playwright/test` の `test` / `expect` を使う。
3. **Host が必要な場合**  
   `playwright.config.ts` の `projects` に `baseURL` を足すか、テスト内で `page.goto` の絶対 URL を使う。定数は `src/urls.ts` に集約する。
4. **起動対象を増やす場合**  
   `scripts/start-apps.sh` / `wait-ready.sh` にプロセスと probe を追加（admin API・web-admin など）。compose に Traefik を足す場合は Dev Container のルールを参考にする（#55）。
5. **ローカルで確認**  
   `task e2e` または stack 固定 + `task e2e:test`。
6. **CI**  
   上記 path に触れていれば `Test / E2E` が走る。

### サンプルシナリオ（現状）

| ファイル | 検証内容 |
| --- | --- |
| `smoke.health.spec.ts` | `/livez`・`/readyz`（テナント非依存） |
| `smoke.web-host-home.spec.ts` | Host `localhost` で seed テナントのカタログトップ |

## 失敗時のトリアージ

1. ログ先頭が `readiness failed:` か `Playwright tests failed` かを見る
2. `e2e/.run/logs/api-server.log` / `web-host.log`
3. `docker compose -p publira-e2e -f e2e/compose.yaml ps`
4. CI なら artifact `e2e-artifacts` の HTML report と trace

## 非スコープ

- 各プロダクト領域の業務シナリオ本体（#514–#518, #55, #67）
- 負荷試験
- モバイル integration test（#518）
