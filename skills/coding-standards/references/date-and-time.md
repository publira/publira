# Date and time: `Temporal`, not `Date`

Frontend and shared-package code must not use `Date` directly. Use `Temporal` (polyfilled via `temporal-polyfill/global`) and the helpers in `@publira/utils`.

oxlint enforces this with `no-restricted-globals` (`Date`) in `oxlint.config.ts`; `pnpm check` fails on a violation.

The reason is not style. `new Date("2030-01-01T10:00")` reads a zone-less string in **the host's** zone, so the same submitted value means a different instant on a developer's laptop, in a container running UTC, and in a user's browser. `getTime()` comparisons and `` `${date}T00:00:00.000Z` `` concatenation then bake that ambiguity in silently. Splitting wall clock (`PlainDateTime` / `PlainDate`) from absolute time (`Instant`) makes the interpretation explicit at the type level.

## What to use

| Need | Use |
| --- | --- |
| Parse an API timestamp (`timestamptz` / RFC3339) | `parseInstant(value)` → `Temporal.Instant \| null` |
| Compare / sort timestamps | `Temporal.Instant.compare(a, b)` |
| "Is it in the past?" | `Temporal.Instant.compare(at, Temporal.Now.instant())` |
| Display date + time | `formatDateTime(value, { timeZone, fallback })` |
| Display date only | `formatDate(value, { timeZone, fallback })` |
| Absolute → `datetime-local` initial value | `toDateTimeLocalValue(value, timeZone)` |
| `datetime-local` → absolute | `fromDateTimeLocalValue(value, timeZone)` |
| Form value that may be either shape | `toInstantIsoString(value, timeZone)` |
| Date-only filter boundary (`YYYY-MM-DD`) | `startOfDayIsoString` / `endOfDayIsoString` |

The zone must always be a decision, never an accident:

- **Conversion helpers** (`toInstantIsoString`, `fromDateTimeLocalValue`, `toDateTimeLocalValue`, `startOfDayIsoString`, `endOfDayIsoString`) take `timeZone` as a **required parameter** — the signature forces the choice.
- **Display helpers** (`formatDateTime`, `formatDate`) default to `DEFAULT_TIME_ZONE` only as a last-resort stand-in. Tenant-facing dates pass the resolved zone from `getTenantDisplayTimeZone` (web-admin [#566](https://github.com/publira/publira/issues/566), web-host [#567](https://github.com/publira/publira/issues/567)). Omitting `timeZone` on a tenant-facing call site is a bug.
- `DEFAULT_TIME_ZONE` remains the fallback when the tenant read is unavailable, so the wall clock never depends on the host zone. Pass it explicitly and say in a comment which zone it stands in for ("unavailable tenant read", "non-tenant context").

Never re-add a fixed `+09:00`.

## NG (do not)

```ts
// NG: host-zone interpretation of a zone-less value
const iso = new Date(formData.get("publish_at")).toISOString();

// NG: hand-built offset / day boundary
const publishedAt = `${wallClock}+09:00`;
const createdTo = `${date}T23:59:59.999Z`;

// NG: getTime() / Date.parse() ordering
items.toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

// NG: UTC day by string surgery
const day = episode.publishedAt.slice(0, 10);

// NG: one-off formatter that drifts from the shared TZ policy
new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
```

## OK (preferred)

```ts
import {
  formatDateTime,
  parseInstant,
  toInstantIsoString,
} from "@publira/utils";

const timeZone = await getTenantDisplayTimeZone(tenantId);

// OK: wall clock resolved against the tenant's zone
const iso = toInstantIsoString(raw, timeZone);

// OK: "is it in the past?" without leaving Temporal
const at = parseInstant(iso);
if (at && Temporal.Instant.compare(at, Temporal.Now.instant()) <= 0) {
  return { message: "未来の日時を指定してください。", ok: false };
}

// OK: absolute-time ordering (parseInstant returns null, so decide where
// unparseable values go instead of letting them collapse to the epoch)
items.toSorted((a, b) => {
  const left = parseInstant(a.at);
  const right = parseInstant(b.at);
  if (!(left || right)) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return Temporal.Instant.compare(right, left);
});

// OK: shared formatter with the resolved tenant zone
formatDateTime(value, { fallback: "-", timeZone });
```

## The `Date` boundary

Some external APIs only accept a `Date` — cookie `expires`, the Next.js cache handler's TTLs. Those modules are listed in the `oxlint.config.ts` override and keep using `Date`.

- Convert at the boundary only; do not let a `Date` travel back into business logic.
- Adding a path to that override is a deliberate decision, and the entry needs a comment naming the API that forces it. "Temporal was inconvenient" is not a reason.
- Do not silence the rule with an inline `oxlint-disable`.

Helper implementations and the polyfill wiring: `packages/utils/README.md`, [#573](https://github.com/publira/publira/issues/573) / [#564](https://github.com/publira/publira/issues/564) / [#575](https://github.com/publira/publira/issues/575).
