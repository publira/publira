# proto

This directory contains Protobuf definitions and contract decisions shared by multiple RPCs. As specified in [buf.gen.yaml](../buf.gen.yaml), generated output goes to `server/internal/proto/gen` (Go / Connect) and `packages/api-client/src/gen` (TypeScript); regenerate both with `task gen`.

## Cursor pagination for list RPCs

Use cursor pagination consistently for list RPCs. `offset` skips the requested number of rows, so later pages become slower. Inserts and deletes while paginating can also duplicate or omit records at the page boundary.

`ListPublishedSeries` (`publira/v1/catalog.proto`) was the first implementation of this pattern. Copy it for new list RPCs.

### Fields

| Direction | Field | Type | Meaning |
| --- | --- | --- | --- |
| Request | `token` | `string` | Pass the `previous_token` or `next_token` returned by the preceding response unchanged. An empty string means the first page |
| Request | `limit` | `int32` | Maximum items per page. Fall back to the default for `<= 0` or a value above the maximum |
| Request | `order` | `enum` | Sort order. Present only on lists whose order can be selected. Assign the default order to `*_UNSPECIFIED = 0` |
| Response | `previous_token` | `string` | Token for retrieving the **previous** page. Empty on the first page |
| Response | `next_token` | `string` | Token for retrieving the **next** page. Empty on the last page |

- Keep the default and maximum as constants for each RPC. Unless there is a specific reason, use a default of 20 and a maximum of 100 (matching `ListAuditLogs`).
- The presence of `previous_token` and `next_token` directly controls whether to show “previous” and “next.” The client does not need to know the total count.
- If a boundary row disappears and a page has no items, return the supplied token as a **recovery token** in the direction opposite to travel. Returning both tokens empty leaves the client no way to get back other than restarting at the first page.
- **Recover only once.** A recovery token re-queries inclusively against the boundary row, so it can return to the original page when that row remains. If the boundary row itself is gone, the recovery query also has no items, and a token assembled from it points to the same empty page. When an empty page's token is a recovery token, return both `previous_token` and `next_token` empty so the client falls back to the first page. Do not make it move back and forth between empty pages.
- Do not return a total count. `COUNT(*)` negates the benefit of cursors; design a separate RPC when a count is needed.

### Token contents

A token is an **opaque** string to the client. It is unpadded base64url encoding of this form:

```
v1|<direction>|<sort key 1>|<sort key 2>|...
```

- `direction` is `f` (the token points to the next page) or `b` (the previous page). The server reverses comparison operators and `ORDER BY` for the direction, then restores the row order before returning rows for `b`.
- A sort key is the sort-order key value of a boundary row. Use the final row of the page for `f` and the first row for `b`.
- The client does not depend on this structure. It neither assembles nor disassembles it, and only returns the received string unchanged.
- A recovery token appends `inclusive` after the sort keys. SQL uses this flag to change `<` to `<=` (or `>` to `>=` in ascending order), re-querying with the boundary row included. This key also lets the server identify a recovery token and enforce the one-recovery rule above. Any other trailing string produces `invalid_argument`.
- A malformed token produces `invalid_argument`. Do not expose its internal structure in the error message.

Go encoding and validation live in [server/internal/pagination](../server/internal/pagination). Use `Encode`, `Decode`, `NormalizeLimit`, and `Page`; do not reimplement base64 for each RPC.

### Sort keys

- Make the sort-key combination **unique**. When ties exist, the keyset-scan `WHERE` can either skip tied rows together or keep returning the same row.
- Use the primary-key `id` as the tiebreaker. `id` is UUIDv7 and therefore ordered by creation time, so equal `published_at` or `created_at` values still have a meaningful order. The selected sort direction determines whether later-created rows come first or last. `public_id` is a Base58 value from `crypto/rand` and has no ordering, so do not use it as a sort key.
- Use row-value comparison for keyset scans. `(a.created_at, a.id) < ($1, $2)` can use a composite index, while `a.created_at < $1 OR (a.created_at = $1 AND a.id < $2)` may not.
- Index the same combination as the sort keys. A btree can scan in reverse, so separate ascending and descending indexes are unnecessary.
- **Do not branch `ORDER BY` on a runtime parameter.** `CASE WHEN $1 THEN ... END` does not align with index ordering, which can force a full sort before `LIMIT` and defeat keyset pagination. Use separate queries with a fixed `ORDER BY` for each order.
- If a list row is expensive (`json_agg` or multiple `LEFT JOIN`s), make the keyset scan a lightweight query that returns only IDs, then fetch display data by ID. This keeps one heavy query while each sort-order query stays short. `ListPublishedSeries` uses this pattern (`ListActiveSeriesIDsBy*` and `ListActiveSeriesByIDs` in `db/query/series.sql`).

### Lists with selectable ordering

- Put the **order name** (such as `published_at_desc`) in the first token key. The same token points to a different position if its order changes, so reject a token whose name does not match with `invalid_argument`. Silently reinterpreting it can jump to a non-existent page.
- When the client changes order, discard its token and request the first page again. The UI must follow the rule “reset to page 1 when changing sort order.”
- Scan direction is the exclusive OR of whether the sort order is descending and whether the token goes toward the previous page. Pass only this single resolved direction to SQL; do not combine two flags in SQL.

### Existing `limit` / `offset`

For an RPC migrated to cursors, **remove** `offset` and put both its field number and name in `reserved`. This product is not public yet, so there is no reason to retain a deprecated field for backward compatibility. Keep `limit` as the number of items per page.

### Implementation checklist

1. Add `token` to the proto, remove `offset`, and reserve it. Add `previous_token` and `next_token` to the response.
2. Rewrite SQL as a keyset scan. Provide queries with a fixed `ORDER BY` for each sort order (and a reverse for previous-page direction), and index the sort-key combination.
3. In the handler, process `pagination.NormalizeLimit`, `pagination.Decode`, fetch `limit + 1` items, then `pagination.Page`, assembling tokens from boundary rows.
4. Run `task gen` and confirm `sqlc diff` is clean.
