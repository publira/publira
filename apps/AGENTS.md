# Apps Agent Guide

Shared conventions for Next.js apps under `apps/` (`web-admin`, `web-host`, `web-platform`). Prefer this file for monorepo frontend policy. Root [AGENTS.md](../AGENTS.md) remains the top-level source of truth. Per-app `AGENTS.md` files should keep only the Next.js-generated block (`BEGIN/END:nextjs-agent-rules`).

## React Effects / useEffectEvent

OK and NG rules: repository root [AGENTS.md](../AGENTS.md) (React: Effects and useEffectEvent).

## Untrusted input: validate with zod at the boundary

Treat every value that a caller can put into a request as untrusted, even when Next.js gives the surrounding object a TypeScript type. This includes:

- every field read from `searchParams` or `FormData`
- dynamic route segments, because an external caller can supply arbitrary values even when app links only generate known ones
- Route Handler request bodies

Define a zod schema for the whole input and call `parse` / `safeParse` as the value is taken across that boundary. From that point on, pass only the schema's validated output type (`z.output` / `z.infer`) to application and RPC code. Do not let the original `string | string[] | undefined`, `FormDataEntryValue | null`, or `unknown` value travel further into the app.

### NG (do not)

```tsx
// NG: coercion is not validation; this also turns a File into "[object File]"
const title = String(formData.get("title") ?? "").trim();

// NG: NaN, negative values, fractions, and unbounded values still get through
const offset = Number(params.offset ?? "0");

// NG: field-by-field checks duplicate schema logic and easily miss a field
const body = await request.json();
if (typeof body.name !== "string" || !body.name.trim()) {
  return Response.json({ message: "invalid name" }, { status: 400 });
}
```

### OK (preferred)

```tsx
import { z } from "zod";

const formSchema = z.object({
  title: z.string().trim().min(1).max(255),
});

const parsed = formSchema.safeParse({
  title: formData.get("title"),
});
if (!parsed.success) {
  return {
    fieldErrors: parsed.error.flatten().fieldErrors,
    message: "入力内容を確認してください。",
    ok: false,
  };
}

await save(parsed.data); // only validated values cross into application code
```

Good in-repo examples:

- `web-admin` audit-log filters define normalization and validation in one zod schema, then expose only the parsed `AuditLogFilters`: [`audit-logs/_lib/search-params.ts`](web-admin/app/%5Btenant_id%5D/%28protected%29/audit-logs/_lib/search-params.ts)
- `web-admin` theme settings use `safeParse`, map zod field errors into the Action state, and call the update function only with `parsed.data`: [`settings/_lib/actions.ts`](web-admin/app/%5Btenant_id%5D/%28protected%29/settings/_lib/actions.ts)

Choose failure handling at the boundary:

- **Server Actions:** use `safeParse` for user-correctable input and return the existing form / Action state with a form message and field errors. Do not throw for an ordinary validation error.
- **`searchParams`:** normalize optional filter, sort, and pagination values to explicit safe defaults when the page still has a meaningful default view. Call `notFound()` when an invalid value makes the requested URL/resource meaningless instead of silently showing different content.
- **Dynamic segments and Route Handler bodies:** reject an invalid resource identifier with `notFound()` where existence must not be disclosed; return the handler's documented 4xx response for an invalid request body.

The normalization every boundary needs lives in `@publira/utils`, so a screen writes the rules that are actually its own and nothing else. Full API and examples: `packages/utils/README.md`.

| Boundary | Use |
| --- | --- |
| `searchParams` | `@publira/utils/search-params`: `searchParamString` / `searchParamStringArray` / `searchParamEnum` / `searchParamNumber` / `searchParamBoolean` / `searchParamDate` |
| `FormData` | `@publira/utils/form-data`: `toFormDataInput(formData, fields)`, declaring each field as `value` / `values` / `file` / `files` |
| `safeParse` failure → Action state | `@publira/utils/field-errors`: `toFieldErrors`, `toFormErrorMessage`, `VALIDATION_ERROR_MESSAGE` |

The `searchParams` factories encode the failure decision above in one place: passing `fallback` gives a schema that never fails and resolves to that explicit safe default, and omitting it gives a schema that reports an issue so the page can `notFound()`. Do not re-add a local `z.preprocess` that only trims and length-checks — extend the shared schema instead, and keep genuinely screen-specific rules (which action values exist, which sort keys a table has) at the call site.

Frontend validation is for typed application flow and prompt user feedback. It does **not** replace validation and authorization in the Go server; every RPC input must still be validated at the server's own trust boundary.

## Next.js cache (Redis)

All apps wire shared Redis cache via `@publira/next-cache-handlers` in `next.config`:

- **`cacheHandler` (singular)**: ISR / Route Handler / `fetch` / `unstable_cache` / optimized images
- **`cacheHandlers` (plural)**: `"use cache"` / `"use cache: remote"`

Keep **both** enabled. Details and env (`REDIS_URL`, `NEXT_CACHE_APP`): root [AGENTS.md](../AGENTS.md) and `packages/next-cache-handlers/README.md`.

## RPC errors: classify by `Code`, never by message text

Connect errors are classified with `Code` only. `error.message.includes("not found")` breaks silently the day the server rewords its message, so it must not appear in app code (#645).

Helpers and the shared copy live in `@publira/api-client/errors` and `@publira/api-client/error-messages`. Full API list and rationale: the エラー分類 section of `packages/api-client/README.md`.

The same rules apply to all three apps:

| Situation | Use |
| --- | --- |
| Record missing, or not visible to this caller | `isMissingResourceRpcError()` → treat as `notFound()`. Never distinguish the two — that leaks whether the record exists |
| Session-scoped read that may resolve to `null` | `isExpectedNullableRpcError()` |
| Form submission the server rejected | `isRejectedRequestRpcError()` |
| Any `catch` that turns an error into a message | `rethrowUnclassifiedRpcError(error)` first, then `rpcErrorMessage(error, fallback, overrides?)` |

- Take the wording from `rpcErrorMessage`'s shared table and override only the categories a screen genuinely words differently. Do not build a per-file mapping table.
- `rpcErrorMentions()` is **not** an exception to the rule above — it does not classify. It only picks between wordings _inside_ a category `rpcErrorDisposition()` has already decided: one `Code` covering several distinct inputs (`invalid_argument` for both a bad slug and a rejected image), or a field name a `Code` cannot carry (`domain` vs `admin_domain`). It returns `false` for anything that is not an RPC error, every branch degrades to that category's generic message when the server rewords, and the call site names the server file its tokens come from.
- **Never swallow an unclassifiable error** (`internal`, `unimplemented`, or a throw that is not an RPC error at all). A `catch` returning `null` / `false` / `[]` still calls `rethrowUnclassifiedRpcError(error)` first.
- The exceptions are logout (the cookie must clear either way), non-critical chrome such as footer links, and the top page's per-section degradation. Each one records why in a comment.

## Icons: `@publira/icons`, never inline `<svg>`

Icons come from `@publira/icons`, a thin wrapper around `lucide-react`. App and package code must not hand-write `<svg>` in JSX, and must not import `lucide-react` directly — `packages/icons` is the only place allowed to (#690).

`pnpm check` fails on a `lucide-react` import (`no-restricted-imports`, with a `packages/icons/src/**` override). CI fails on `<svg>` in JSX, via a `git grep` step in the `Check` job.

The reason is not line count. A hand-written icon is drawn in its own coordinate system and stroke width, so it never matches the lucide icons standing next to it. And a path written into JSX gets copy-pasted instead of imported, so the same glyph drifts between files while the shared component that already covers it goes unused. Neither shows up in review — the markup looks fine on its own.

### NG (do not)

```tsx
// NG: hand-written icon in JSX
<svg
  aria-hidden="true"
  className="h-6 w-6"
  fill="none"
  stroke="currentColor"
  viewBox="0 0 24 24"
>
  <path
    d="M16 7a4 4 0 11-8 0 4 4 0 018 0z"
    strokeLinecap="round"
    strokeWidth={2}
  />
</svg>;

// NG: lucide imported straight into app / package code
import { ChevronDown } from "lucide-react";

// NG: porting a viewBox / strokeWidth off the markup you are replacing
<CheckIcon strokeWidth={1.5} viewBox="0 0 10 8" />;
```

### OK (preferred)

```tsx
// OK: apps import from the barrel
import { ImageIcon, UserIcon } from "@publira/icons";

// OK: packages/ui-components keeps its subpath imports
import { CheckIcon } from "@publira/icons/check-icon";

// OK: size via className, everything else left at lucide's defaults
<UserIcon className="h-6 w-6" />;
<CheckIcon className="size-3" />;
```

Barrel vs subpath is existing drift, not a rule — follow whatever the surrounding file does (#690 leaves the split alone).

### Adding and excepting

- **Missing icon** → wrap it in `packages/icons` (component, `exports` subpath, `tsdown` entry, `index.ts` re-export, test). Steps: `packages/icons/README.md`.
- **Sizing** → lucide is always `viewBox="0 0 24 24"` at `strokeWidth={2}`. Pick a `size-*` / `h-* w-*` class that suits the layout and leave the rest at lucide's defaults. Do not carry dimensions or stroke widths over from markup you are deleting.
- **A genuine non-icon SVG** (decorative artwork, a chart, a generated image) is a real exception. Add its path to the grep step's exclusions in `.github/workflows/ci.yml`, with a comment saying why — the same way the `Date` boundary is handled in root [AGENTS.md](../AGENTS.md).

## Global unmatched 404 (`global-not-found.tsx`)

All three apps enable `experimental.globalNotFound` and ship `app/global-not-found.tsx`.

| Concern | Where it lives |
| --- | --- |
| URL matches no route at all | `app/global-not-found.tsx` — full HTML document, **no** app layout, **no** tenant RPC |
| `notFound()` for a missing / invisible resource under a resolved tenant or session | Segment `not-found.tsx` inside `(site)` / `(protected)` — keeps site or console chrome |
| Browser `/favicon.ico` and `_next/*` | `proxy.ts` matcher exclusions (skip tenant / auth work). A non-UUID segment that still reaches the tree is rejected by `isTenantIdFormat` / `getTenantId()` |

`global-not-found.tsx` bypasses every layout, so it must import `globals.css` (and any fonts it needs) itself. Do **not** link tenant `/theme.css` there: there is no tenant context on an unmatched URL; brand defaults from `@publira/brand` are the intended look.

### `experimental.globalNotFound` is experimental

The flag is still under `experimental` in Next.js (introduced in 15.4). If it is removed, renamed, or the default flips:

1. Drop or rename the flag in each app's `next.config.ts`.
2. Keep or delete `app/global-not-found.tsx` to match the then-current Next.js file convention (`node_modules/next/dist/docs/` for that app's Next version).
3. Re-check that URLs which match no route still return 404 **without** entering `app/[tenant_id]/layout.tsx` on `web-host` / `web-admin` (those apps have no root layout above the dynamic segment — that is why this file exists).

Until the flag stabilises, do not build alternative "fake root layout" 404 schemes for the same job.

## Before coding in an app

1. Read this file (`apps/AGENTS.md`).
2. Read the **target** app's `AGENTS.md` (Next.js official rules only) and that app's `node_modules/next/dist/docs/` as needed.
3. Do **not** load other apps' `AGENTS.md` unless the change truly spans multiple apps.

## After changes

- Frontend / packages: `pnpm preflight` (typegen / typecheck / check / test) from the repo root.
