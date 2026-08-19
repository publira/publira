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
| `safeParse` failure → Action state | `@publira/utils/field-errors`: `toFieldErrors`, `toFormErrorMessage`, `validationErrorMessage` / `VALIDATION_ERROR_MESSAGE` |

The `searchParams` factories encode the failure decision above in one place: passing `fallback` gives a schema that never fails and resolves to that explicit safe default, and omitting it gives a schema that reports an issue so the page can `notFound()`. Do not re-add a local `z.preprocess` that only trims and length-checks — extend the shared schema instead, and keep genuinely screen-specific rules (which action values exist, which sort keys a table has) at the call site.

Frontend validation is for typed application flow and prompt user feedback. It does **not** replace validation and authorization in the Go server; every RPC input must still be validated at the server's own trust boundary.

## Next.js cache (Redis)

All apps wire shared Redis cache via `@publira/next-cache-handlers` in `next.config`:

- **`cacheHandler` (singular)**: ISR / Route Handler / `fetch` / `unstable_cache` / optimized images
- **`cacheHandlers` (plural)**: `"use cache"` / `"use cache: remote"`

Keep **both** enabled. Details and env (`PUBLIRA_REDIS_URL`, `PUBLIRA_CACHE_APP`): root [AGENTS.md](../AGENTS.md) and `packages/next-cache-handlers/README.md`.

## RPC errors: classify by `Code`, never by message text

Connect errors are classified with `Code` only. `error.message.includes("not found")` breaks silently the day the server rewords its message, so it must not appear in app code (#645).

Helpers and the shared copy live in `@publira/api-client/errors` and `@publira/api-client/error-messages`. Full API list and rationale: the エラー分類 section of `packages/api-client/README.md`.

The same rules apply to all three apps:

| Situation | Use |
| --- | --- |
| Record missing, or not visible to this caller | `isMissingResourceRpcError()` → treat as `notFound()`. Never distinguish the two — that leaks whether the record exists |
| Session-scoped read that may resolve to `null` | `isExpectedNullableRpcError()` |
| Form submission the server rejected | `isRejectedRequestRpcError()` |
| Any `catch` that turns an error into a message | `rethrowUnclassifiedRpcError(error)` first, then `rpcErrorMessage(error, fallback, options?)` |

- Take the wording from `rpcErrorMessage`'s shared table and override only the categories a screen genuinely words differently. Do not build a per-file mapping table. Pass `{ locale }` so the shared categories follow the UI locale; omitting it keeps Japanese.
- When one `Code` covers multiple actionable cases, choose wording with `rpcErrorHasFieldViolation()` (`google.rpc.BadRequest`) or `rpcErrorHasReason()` (`google.rpc.ErrorInfo`) after `rpcErrorDisposition()` has selected the category. Never read the server message. Details are unavailable after a `"use cache"` serialization boundary, so complete detail-based wording inside that scope.
- **Never swallow an unclassifiable error** (`internal`, `unimplemented`, or a throw that is not an RPC error at all). A `catch` returning `null` / `false` / `[]` still calls `rethrowUnclassifiedRpcError(error)` first.
- The exceptions are logout (the cookie must clear either way), non-critical chrome such as footer links, and every `catch` inside a `"use cache"` scope — that one cannot rethrow, because the fill would fail the whole request (see **A `"use cache"` function must not throw** below). Each one records why in a comment.

## Failure display: `SectionError` and `SectionErrorBoundary`

A failure that only kills part of a page must not be hand-rolled into that page. Two shared pieces cover it (#647), and which one a screen reaches for follows from what it is holding:

| What the screen has | Use |
| --- | --- |
| A classified `ok: false` result with a message | Render `SectionError` from `@publira/ui-components/section-error` with that message as `description` — this is the normal case, because a cached read reports failure as a value (see below) |
| An `ok: false` that leaves nothing to show around it — a detail route whose whole content is that one read | Render that app's `PageLoadError` |
| A throw it never sees — a bug, or an uncached read that failed | Wrap the section's `<Suspense>` in that app's `SectionErrorBoundary` (`components/section-error-boundary.tsx`) |
| A submission the server rejected | `FormMessage` next to the control — unchanged |
| A form whose own choices or initial values failed to load — a `<select>`'s options, a settings form's saved state | `FormMessage` next to that control (#817). The form is still usable; the message says which input degraded, not that the section is gone |
| Nothing to show yet | `EmptyState` — unchanged |

The boundary goes **outside** the `<Suspense>`, not inside, so `retry()` puts that section's own skeleton back while the re-run is in flight:

```tsx
<SectionErrorBoundary title="おすすめ作品を表示できませんでした">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

Title the fallback after the section it replaces (「おすすめ作品を表示できませんでした」), so a reader can tell which part of the page is missing.

### NG (do not)

```tsx
// NG: page-local failure markup, duplicated per screen
<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6">
  <p>読み込みに失敗しました。</p>
  <Link href=".">再試行</Link>
</div>;

// NG: try/catch standing in for a boundary, with the behaviour split by env
try {
  series = await getCatalogTopRecommendedSeries(tenantId);
} catch (error) {
  if (process.env.NODE_ENV !== "production") {
    throw error;
  }
  return <SectionLoadError />;
}

// NG: `EmptyState` for a failure — it means "nothing yet", not "we could not load it"
<EmptyState description={result.message} title="データの取得に失敗しました" />;
```

A list component that receives the failure as a prop (`listErrorMessage` and friends) renders `SectionError` itself, with the same title the pages use ([#817](https://github.com/publira/publira/issues/817)). The prop carries the message from `rpcErrorMessage`, so the component supplies the title and passes the prop through as `description`:

```tsx
if (listErrorMessage) {
  return (
    <SectionError
      description={listErrorMessage}
      title="シリーズ一覧を表示できませんでした"
    />
  );
}
```

Two things follow from the list being gone rather than empty, and both are already true of every `*Manager`: the `EmptyState` is not rendered next to the error (a failed read still hands the component an empty array, and「まだ登録されていません」next to the error reads as "there is no data"), and the pager is hidden (its tokens are empty then, so "前へ / 次へ" chrome next to the error looks like the list exists).

Form components keep `FormMessage` for the row above: `creatorsErrorMessage`, `usersErrorMessage`, `loadErrorMessage` and friends stay where they are, next to the control they degrade.

The `catchError` call itself stays in each app's `components/section-error-boundary.tsx` rather than in `@publira/ui-components`: `tsdown` drops the `"use client"` directive when it bundles the package, and `catchError` cannot run in the server graph. The fallback body is shared from the package; only the four-line wiring is per app, the same split the route-level `error.tsx` bodies already use.

## A `"use cache"` function must not throw

Measured against the production build under Cache Components ([#672](https://github.com/publira/publira/issues/672)): **when a cache fill throws, Next.js fails the request that triggered it.** An awaiting `try` / `catch` does not save it, and neither does an outer cached function catching an inner one — both were measured returning a perfectly good element while the response was still a bare `500 Internal Server Error` document. The failure is only recoverable when a static shell has already been committed, and then only by a client error boundary (`SectionErrorBoundary`), which is why the catalog's `<Suspense>` sections survived an outage while its detail routes answered 500.

"Has a committed shell" is not something a `lib/` helper can assume: the same read is awaited by a section inside `<Suspense>` and by `generateMetadata`, which resolves before anything is flushed. So the rule is unconditional.

### Why a throw before the shell is fatal

The framework rule behind it, measured on the production standalone build for [#683](https://github.com/publira/publira/issues/683) by injecting a throw at each position:

| Where the throw happens | Direct hit |
| --- | --- |
| In the first synchronous pass — the top of a page body or of a suspended section, before any `await` | Bare `500 Internal Server Error`, 21-byte body |
| After any `await` — a failed RPC, a timer, `connection()` | `200`, static shell, the error streams into it and `error.tsx` / `SectionErrorBoundary` renders |

The static shell is flushed only once the render has yielded, so a throw in that first pass aborts the response before anything is committed. Next.js does not fall back to its own `__next_error__` recovery document there either — the error escapes the app render and the server answers plain text — which is why adding `app/global-error.tsx` changed nothing when it was measured, and why the reach notes in each `error.tsx` are worded around the flush rather than around direct hits versus client navigations.

This is a known Next.js behaviour, not something these apps configured. Two open issues report it, and they differ in what the reader ends up seeing rather than in how the error escapes:

| Issue | Trigger | What the response is |
| --- | --- | --- |
| [vercel/next.js#62046](https://github.com/vercel/next.js/issues/62046) | A route with `generateStaticParams` throwing while it is generated on demand | Neither `error.tsx` nor `global-error.tsx`; Next.js's built-in error page |
| [vercel/next.js#96567](https://github.com/vercel/next.js/issues/96567) | A `"use cache"` route throwing while it regenerates | Neither boundary; plain-text `Internal Server Error` |

The escape is the same in both: the error leaves the app render, and `base-server` falls back to `getFallbackErrorComponents()`. What that returns decides the ending — the pages-router `/_error` component when one exists, and otherwise the 21-byte plain-text body, because `NextNodeServer.getFallbackErrorComponents()` returns `null` outside dev. These apps are app-router-only in production, so they land on the plain-text row. Check both issues before re-investigating, and do not open a third.

The apps sit on the good side of that line by construction: every read crosses the network, so a failure that is left to throw lands after the flush, and the cached-read rule above keeps it from throwing at all. The bare 500 is what a bug that throws synchronously at the top of a component gets. That last row is a property of the tenant route structure, not something to work around per route — a minimal reproduction showed the same throw producing Next.js's `__next_error__` document only when the root layout sits above the top-level dynamic segment, which is not this app's shape. Do not add per-route escape hatches (a `connection()` call, a `try` / `catch` around a component body) to chase it.

## Never use `instant = false`

`export const instant = false` opts a segment out of Cache Components' static-shell validation. It is an escape hatch for codebases that cannot yet fix a blocking read, and it has no place in a product being built from scratch — **do not add it to any segment**, and do not treat an existing occurrence as licence to add another.

When the validation reports `blocking-prerender-dynamic`, the fix is the one it names: move the data access inside `<Suspense>` so the route keeps a non-empty static shell. A page whose whole body is one read becomes a `<Suspense>` with a skeleton around an async content component, which is also what lets a failed read render a fallback at all.

One consequence to know about, rather than to work around with the escape hatch: `notFound()` raised inside `<Suspense>` streams into an already-committed 200 response, so a missing record renders `not-found.tsx` without an HTTP 404 status. Where that status matters it needs a different mechanism, not a blocking page body.

| Inside a `"use cache"` function | Do |
| --- | --- |
| The record is missing / not visible | Return the "nothing" value (`null`, `[]`) — that is an answer, and it is cacheable |
| The fetch failed | `return cachedReadFailure(rpcErrorMessage(error, fallback))` from `@publira/utils/cached-read` |
| The fetch failed and the caller has nothing to say about it (site chrome) | `dropFailedCacheEntry()`, then return the default (`null`) |
| Anything at all | Never `throw`, and never `notFound()` — raise those in the caller, outside the cache scope |

`cachedReadFailure` marks the entry unstorable (`cacheLife({ expire: 0, revalidate: 0, stale: 0 })`), so the **failure is never cached**: a recovered API serves real content on the very next request instead of a fallback pinned for the cache's lifetime. Full API and rationale: `packages/utils/README.md`.

Classification stays inside the cache scope for a second reason. Next.js re-creates an error that crossed a `"use cache"` boundary from its name and message, and production replaces the message with a digest — so `Code`, and with it `rpcErrorDisposition()` / `rpcErrorMessage()`, is gone by the time an outside `catch` runs. Build the message where the `ConnectError` is still intact.

### NG (do not)

```ts
// NG: a throw inside a cache scope — the request 500s before any fallback runs
export const getSeriesDetail = async (tenantId: string, publicId: string) => {
  "use cache";
  try {
    return await apiClient.catalog.getSeriesDetail({
      publicId,
      tenant: { tenantId },
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return null;
    }
    throw error; // ← fails the whole request, caller's catch never runs
  }
};

// NG: catching outside the cache scope. The fill already failed the request,
// and the error arrives digest-only, so it cannot be classified here either.
try {
  return await getSeriesDetail(tenantId, publicId);
} catch {
  return { message: "取得できませんでした。", ok: false };
}
```

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
