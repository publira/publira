# Scenarios

画面確認・E2E 向けのシナリオ seed を置くディレクトリです。  
baseline / dev seed とは分離し、**必要時のみ**個別に実行します。

## 方針

- ファイル名: `<nnn>_<slug>.sql` または `<slug>.sql`（例: `010_multi_tenant.sql`）
- 冪等（`ON CONFLICT` 等）を推奨。共有 dev seed を壊さない ID 帯を使う
- マイグレーション（DDL）はここではなく `db/migrations/` へ

## 適用方法

### 手動

```bash
# E2E compose の Postgres を使う例（ポートは e2e/compose.yaml 既定）
psql "postgres://postgres:password@127.0.0.1:5433/publira?sslmode=disable" \
  -v ON_ERROR_STOP=1 \
  -f db/seeds/scenarios/010_multi_tenant.sql
```

### E2E（Playwright）から

1. スタック起動後（`task e2e:db` 済み）に、テスト内で:

```ts
import { applyScenarioSql } from "../src/db";

test.beforeAll(() => {
  applyScenarioSql("010_multi_tenant"); // → db/seeds/scenarios/010_multi_tenant.sql
});
```

2. `PUBLIRA_DB_URL` は e2e スクリプトが設定します。単体で `pnpm exec playwright test` する場合は同 URL を export してください。

詳細な E2E 運用は [e2e/README.md](../../../e2e/README.md) を参照。

## 例（未作成）

- `010_multi_tenant.sql`
- `020_suspended_tenant.sql`
- `030_paid_episode.sql`
