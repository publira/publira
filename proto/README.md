# proto

This directory contains Protobuf definitions and contract decisions shared by multiple RPCs. As specified in [buf.gen.yaml](../buf.gen.yaml), generated output goes to `server/internal/proto/gen` (Go / Connect) and `packages/api-client/src/gen` (TypeScript); regenerate both with `task gen`.

## Compatibility with the previous release

The web apps and `publira server` of a release work with those of the release before it, in either direction. An install replaces its processes one copy at a time, may bring up either side first, and may roll one of them back, so for a while the newer web apps call the older server, or the older web apps the newer one. A change to `proto/` is therefore made so that both pairs keep working: what the newest release sends still means what it meant, and what it reads still arrives. A contract that no release tag carries yet is not held to this, and changes freely until one does.

Both sides speak the Connect protocol's JSON, and both drop what they do not know — a field they have not heard of, and an enum value's name. That is what makes an addition safe, and what decides how every other change is made:

- **Add rather than change.** A new field, message, or RPC is safe in both directions. The older side ignores a field it does not know, and answers an RPC it does not have with `unimplemented`, which costs the newer side only what that RPC adds.
- **A field keeps the meaning, type, name, number, and presence it shipped with.** Turning an implicit-presence field into `optional` reads an older client's empty value as "not sent"; renaming a field changes the JSON name the older side sends and looks for. When a field has to mean something else, add another field and replace the old one as below.
- **A new enum value reaches the older side as `*_UNSPECIFIED`.** JSON carries the value's name, and a side that does not know it drops it: a singular field reads as unspecified, and a repeated field loses the entry. Add a value only where reading it as unspecified does no harm — the older server takes its default, the older web app shows nothing for it — and add a field otherwise.
- **Replacing a field or an RPC takes two releases.** The first adds the replacement and keeps the old one working on both sides, and marks the old one `deprecated = true`. Its server accepts and answers both, because the older web apps know only the old one. Its web apps keep working against the older server too: they send the old field beside the new one and read the old one when the new one is missing, and they fall back to the old RPC when the new one answers `unimplemented`. The release after it removes the old one, and puts a removed field's number and name in `reserved`, so neither is reused with another meaning. Retiring one with no replacement takes the same two releases with nothing added: the first stops reading the field but keeps sending it, or stops calling the RPC from its web apps while its server keeps answering it, and the release after removes it.

`scripts/check-proto-compat.sh` runs `buf breaking` against the newest release tag with the rules in [`buf.yaml`](../buf.yaml), and the `Check` job runs it on every pull request: a field renamed, retyped, or deleted without reserving its number and name, or one whose presence changed, fails it. Run it before pushing a change to `proto/`. What no rule can see is the author's judgement and the reviewer's: whether a field still means what it meant, whether a new enum value is harmless as unspecified, and whether the release before still calls an RPC that a change deletes.

## Request size

A procedure reads at most 1 MiB of one request message. A request past its procedure's bound is refused as `resource_exhausted` while it is read, before it is decoded, so a caller with no session cannot make the server hold more than that. The procedures whose request carries an upload or a webhook body read more: one that carries an image reads that image's own limit in the base64 the JSON encoding carries it in, and 1 MiB beside it; `UploadEpisodeImages` reads its 128 MiB upload the same way; and `ProcessInboundEmailWebhook` reads 33 MiB. The payment and App Store webhooks cap their payloads at 64 KiB and stay within the 1 MiB.

The bounds live in `server/api/*/server.go`, in the `readLimits` table beside each namespace's handler registrations; a new procedure that takes more than 1 MiB is added there.

## The reader's locale

A `locale` field on a public request is the language the reader reads in. When a request that carries one is made with a reader's session, the server records it as that reader's last locale, whichever RPC it is, and the notifications written for the reader afterwards are in that language; the tenant's default locale stands in until one is recorded. An empty `locale` names no language and records nothing, so a client sends the locale it renders in, the tenant's default included, on its signed-in requests.

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
- If a list row is expensive (`json_agg` or multiple `LEFT JOIN`s), make the keyset scan a lightweight query that returns only IDs, then fetch display data by ID. This keeps one heavy query while each sort-order query stays short. `ListPublishedSeries` uses this pattern (`ListActiveSeriesIDsBy*` and `ListActiveSeriesByIDs` in `db/query/published_series.sql`).

### Lists with selectable ordering

- Put the **order name** (such as `published_at_desc`) in the first token key. The same token points to a different position if its order changes, so reject a token whose name does not match with `invalid_argument`. Silently reinterpreting it can jump to a non-existent page.
- When the client changes order, discard its token and request the first page again. The UI must follow the rule “reset to page 1 when changing sort order.”
- Scan direction is the exclusive OR of whether the sort order is descending and whether the token goes toward the previous page. Pass only this single resolved direction to SQL; do not combine two flags in SQL.

### Lists with filters

- A filter decides which rows the list holds, so a boundary row sits somewhere else once it changes — the same problem the order name solves. Bind the token to the filters as well, by appending the ones that are on to the order name in that first key (`published_at_desc+has_free_episodes`), and reject a mismatch with `invalid_argument`. A request with no filter therefore keeps the plain order name, and an unfiltered list needs no change.
- A filter that narrows to one value carries that value in the key, after the filter's own name (`published_at_desc+genre:GENRE0000001`), because two values of the same filter are two different lists. Append the filters in a fixed order rather than in the order the request happened to carry them, so one narrowed list always names itself the same way.
- Changing a filter resets the client to page 1, exactly as changing the order does.
- The calling surface (`ClientSurface`) decides which rows a list holds as well, so every token of a list it narrows — the catalog's, and the reader's own follows, history, library, and notifications — carries it too, as a leading `surface:<name>` key ahead of the list's own keys, and a token presented from another surface is `invalid_argument`. A web URL opened in the app is where one would otherwise cross over.
- Keep the filter out of the sort keys. It narrows the list rather than ordering it, so the keyset comparison and the index it walks stay as they are.

### Existing `limit` / `offset`

No list RPC takes `offset` any longer: every one that did has its number and name in `reserved`. Moving a list from `offset` to cursors changes what its request means, so it is a replacement as [Compatibility with the previous release](#compatibility-with-the-previous-release) describes: the release that adds `token` keeps honouring `offset` while `token` is empty, and the release after it removes `offset` and reserves its number and name. Keep `limit` as the number of items per page.

### Implementation checklist

1. Add `token` and `limit` to the request, and `previous_token` and `next_token` to the response.
2. Rewrite SQL as a keyset scan. Provide queries with a fixed `ORDER BY` for each sort order (and a reverse for previous-page direction), and index the sort-key combination.
3. In the handler, process `pagination.NormalizeLimit`, `pagination.Decode`, fetch `limit + 1` items, then `pagination.Page`, assembling tokens from boundary rows.
4. Run `task gen` and confirm `sqlc diff` is clean.
