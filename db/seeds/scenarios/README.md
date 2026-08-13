# Scenarios

画面確認・E2E 向けのシナリオ seed を置くディレクトリです。  
baseline / dev seed とは分離し、**必要時のみ**個別に実行します。

## 方針

- ファイル名: `<nnn>_<slug>.sql` または `<slug>.sql`（例: `010_multi_tenant.sql`）
- scenario seed は冪等な DML のみを含める。`ON CONFLICT` 等を使用し、共有 dev seed を壊さない ID 帯を使う
- DDL はここに置かない。現段階のスキーマ変更は `db/migrations/00000000000000_baseline.up.sql` と対応する down migration に置く

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

## 一覧

| ファイル | 内容 |
| --- | --- |
| `010_multi_tenant.sql` | dev seed（`localhost` / `Seed Tenant`）の隣に 2 つ目のテナント `other.localhost` / `Boundary Tenant` を追加する。公開シリーズ 1 本（公開エピソード 2 本 + 未公開の scheduled 1 本）と未公開シリーズ 1 本を持ち、テナント境界と公開判定の検証に使う（`e2e/tests/catalog.tenant-boundary.spec.ts`）。レコードの public_id は `e2e/src/scenarios/multi-tenant.ts` に定数化してある |
| `020_member_announcements.sql` | 会員お知らせのページング用シード（`e2e/tests/announcements.pagination.spec.ts`） |
| `030_platform_operators.sql` | dev seed の super admin に加え、`platform_operator` ロールの限定オペレーター `platform-operator@example.com` / `platformpass`（public_id `ScenPFUSAAA1`）を追加する。ロール別の操作可否検証に使う（`e2e/tests/platform.tenant-ops.spec.ts`）。定数は `e2e/src/scenarios/platform-tenants.ts` |

## 例（未作成）

- `040_suspended_tenant.sql`
- `050_paid_episode.sql`
