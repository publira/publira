# Apps Agent Guide

Shared conventions for Next.js apps under `apps/` (`web-admin`, `web-host`, `web-platform`). Prefer this file for monorepo frontend policy. Root [AGENTS.md](../AGENTS.md) remains the top-level source of truth. Per-app `AGENTS.md` files should keep only the Next.js-generated block (`BEGIN/END:nextjs-agent-rules`).

## React Effects / useEffectEvent

Norm and enforcement: repository root [AGENTS.md](../AGENTS.md) (React: Effects and useEffectEvent). Decision flow and OK/NG rules: the `coding-standards` skill.

## Layout components: compose slots, do not aggregate values in props

`@publira/layouts` uses the Compound Component Pattern. A layout component owns only its DOM structure; each independently resolved piece of copy, navigation, branding, or action is passed as a named child slot. Keep each async slot's `<Suspense>` boundary at the call site, where its fallback size is visible.

Props are limited to values that cannot be rendered as a node: HTML attributes such as `href` and `aria-label`, and a Server Action. Do not replace a slot with a bag prop (`navigation`, `currentUser`, `userMenuCopy`, `primaryAction`) or a `T | Promise<T>` prop. A slot that renders a link receives the `href`; its label is the child node. Do not pass Tailwind classes through a layout data object.

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
- Detail routes parse the whole `params` object with `@publira/utils/route-params` and `notFound()` on failure, then pass only the parsed ids into `lib/`: [`web-host` series detail](web-host/app/%5Btenant_id%5D/%28site%29/series/%5Bseries_id%5D/page.tsx)

Choose failure handling at the boundary:

- **Server Actions:** use `safeParse` for user-correctable input and return the existing form / Action state with a form message and field errors. Do not throw for an ordinary validation error.
- **`searchParams`:** normalize optional filter, sort, and pagination values to explicit safe defaults when the page still has a meaningful default view. Call `notFound()` when an invalid value makes the requested URL/resource meaningless instead of silently showing different content.
- **Dynamic segments and Route Handler bodies:** reject an invalid resource identifier with `notFound()` where existence must not be disclosed; return the handler's documented 4xx response for an invalid request body.

The normalization every boundary needs lives in `@publira/utils`, so a screen writes the rules that are actually its own and nothing else. Full API and examples: `packages/utils/README.md`.

| Boundary | Use |
| --- | --- |
| `searchParams` | `@publira/utils/search-params`: `searchParamString` / `searchParamStringArray` / `searchParamEnum` / `searchParamNumber` / `searchParamBoolean` / `searchParamDate` |
| Dynamic segments | `@publira/utils/route-params`: `routeParamString` / `routeParamStringArray` / `parseRouteParams` — compose a schema for the whole `params` object, then `notFound()` when parse returns `null` |
| `FormData` | `@publira/utils/form-data`: `toFormDataInput(formData, fields)`, declaring each field as `value` / `values` / `file` / `files` |
| `safeParse` failure → Action state | `@publira/utils/field-errors`: `toFieldErrors`, `toFormErrorMessage`, `validationErrorMessage` / `VALIDATION_ERROR_MESSAGE` |

The `searchParams` factories encode the failure decision above in one place: passing `fallback` gives a schema that never fails and resolves to that explicit safe default, and omitting it gives a schema that reports an issue so the page can `notFound()`. The `routeParamString` / `routeParamStringArray` factories have no fallback: a failed parse is `notFound()`, the same outcome as a missing record. Do not re-add a local `z.preprocess` that only trims and length-checks — extend the shared schema instead, and keep genuinely screen-specific rules (which action values exist, which sort keys a table has) at the call site.

Frontend validation is for typed application flow and prompt user feedback. It does **not** replace validation and authorization in the Go server; every RPC input must still be validated at the server's own trust boundary.

## Next.js cache (Redis)

All apps wire shared Redis cache via `@publira/next-cache-handlers` in `next.config`:

- **`cacheHandler` (singular)**: ISR / Route Handler / `fetch` / `unstable_cache` / optimized images
- **`cacheHandlers` (plural)**: `"use cache"` / `"use cache: remote"`

Keep **both** enabled. Details and env (`PUBLIRA_REDIS_URL`, `PUBLIRA_CACHE_APP`): `packages/next-cache-handlers/README.md`.

## Tracing: register through `@publira/tracing`

Every app's `instrumentation.ts` `register()` calls `registerTracing("publira-<app>")` after the Temporal polyfill import. Do not call `registerOTel` (or construct an OpenTelemetry SDK) in an app: the opt-in switch, the deployment tier attribute, and the parent-based sampler are one policy shared with the Go processes, and a second copy of it drifts.

Outbound RPC spans and `traceparent` come from `@publira/api-client`, so a call site needs no tracing code. Add a custom span only where a plain `@opentelemetry/api` tracer is genuinely warranted.

Details and env (`PUBLIRA_TRACING_ENABLED`, `OTEL_EXPORTER_OTLP_*`, `NEXT_OTEL_VERBOSE`): `packages/tracing/README.md`.

## RPC errors: classify by `Code`, never by message text

Connect errors are classified with `Code` only. `error.message.includes("not found")` breaks silently the day the server rewords its message, so it must not appear in app code.

Helpers and the shared copy live in `@publira/api-client/errors` and `@publira/api-client/error-messages`. Full API list and rationale: the Error classification section of `packages/api-client/README.md`.

The same rules apply to all three apps:

| Situation | Use |
| --- | --- |
| Record missing, or not visible to this caller | `isMissingResourceRpcError()` → treat as `notFound()`. Never distinguish the two — that leaks whether the record exists |
| Session-scoped read that may resolve to `null` | `isExpectedNullableRpcError()` |
| Form submission the server rejected | `isRejectedRequestRpcError()` |
| Any `catch` that turns an error into a message | `rethrowUnclassifiedRpcError(error)` first, then `rpcErrorMessage(error, fallback, options?)` |

- Take the wording from `rpcErrorMessage`'s shared table and override only the categories a screen genuinely words differently. Do not build a per-file mapping table. `{ locale }` is required, so the shared categories always follow the UI locale; a `catch` that cannot name one has a locale to resolve before it has an error to report.
- When one `Code` covers multiple actionable cases, choose wording with `rpcErrorHasFieldViolation()` (`google.rpc.BadRequest`) or `rpcErrorHasReason()` (`google.rpc.ErrorInfo`) after `rpcErrorDisposition()` has selected the category. Never read the server message. Details are unavailable after a `"use cache"` serialization boundary, so complete detail-based wording inside that scope.
- **Never swallow an unclassifiable error** (`internal`, `unimplemented`, or a throw that is not an RPC error at all). A `catch` returning `null` / `false` / `[]` still calls `rethrowUnclassifiedRpcError(error)` first.
- The exceptions are logout (the cookie must clear either way), non-critical chrome such as footer links, and every `catch` inside a `"use cache"` scope — that one cannot rethrow, because the fill would fail the whole request (see **A `"use cache"` function must not throw** below). Each one records why in a comment.

## RPC responses: `Pick` the generated message, never restate it

A `lib/` mapper that turns an RPC response into an app-facing value declares its input as `Pick<GeneratedMessage, ...>`, naming exactly the fields that mapper reads. It must not restate the message shape as a hand-written structural type.

The generated messages come from `@publira/api-client`:

| What the mapper reads | Where the type comes from |
| --- | --- |
| A generated entity — shared `publira.types.v1` messages (`Series`, `Label`, `Creator`, `Episode`, `EpisodeImage`, `SeriesEyeCatchVariant`, `TenantImageVariant`, `TenantTheme`, `Page`, `User`) and the admin.v1 entities re-exported beside them (`AdminAccessTicket`, `AdminAnnouncement`, `AdminAuditLog`, `AdminNotification`, `AdminTenantUser`, `TenantEmailSettings`, `TenantPaymentSettings`) | `@publira/api-client/admin/types` (`web-admin`). Host-facing `publira.types.v1` messages also come from `@publira/api-client/public/types` (`web-host`). Import from the subpath that matches the API the app calls |
| A public service's own message — the `publira.v1` entities (`AnnouncementItem`, `MyFollow`, `MyPurchase`, `NotificationItem`, `PublishedAuthor`) | `@publira/api-client/public/types` (`web-host`), beside the `publira.types.v1` messages |
| A platform service's own message — the `publira.platform.v1` entities (`Tenant`, `TenantMember`, `TenantAdminInvitation`, `EndUser`, `PlatformOperator`, `PlatformNotification`, `PlatformAuditLog`, `PlatformEmailSettings`, `PlatformSettings`, `DashboardRecentEvent`) | `@publira/api-client/platform/types` (`web-platform`) |

The reason is not brevity. A restated input type is looser than the response it describes — every field written optional — and nothing attaches it to the proto. Rename or remove a field and that type still compiles, so the mapper's `?? ""` / `?? 0` quietly stands in for a field that no longer exists. For the image variants that is invisible: the empty `label` / `url` fails the mapper's own emptiness check, every variant is dropped, and the screen renders its no-image placeholder with nothing pointing at the cause. Named against the message, the same rename fails at the mapper during `pnpm preflight` — `TS2344` on the `Pick` key list, or `TS2339` on the property the body reads.

Take the message from the `types` subpath by name. A subpath that does not exist yet is a missing re-export, not a reason to reach for `Awaited<ReturnType<PlatformApiClient["tenants"]["listTenants"]>>["tenants"][number]`: add the entity to `packages/api-client/src/<api>/types.ts` (plus the `exports` entry and the `tsdown` entry) and import it. Request and response wrappers stay on the per-service modules.

`Pick` rather than the message type itself, for two reasons. The generated messages carry `$typeName`, so a bare `Series` parameter makes every caller and every test fixture build a whole message. And the key list is the declaration of what this mapper actually depends on: a field the mapper stops reading leaves the list, and the dependency shrinks with it.

### NG (do not)

```ts
// NG: the message shape restated by hand — looser than the response, and
// unattached to the proto
const toEyeCatchImageVariants = (
  variants:
    | {
        variantType?: string;
        label?: string;
        url?: string;
        contentType?: string;
        width?: number;
        height?: number;
        fileSizeBytes?: bigint | number;
      }[]
    | undefined
): EyeCatchImageVariant[] | undefined => {
  /* ... */
};

// NG: the whole generated message — forces $typeName on every caller and
// fixture, and stops saying which fields this mapper reads
const toEyeCatchImageVariants = (
  variants: SeriesEyeCatchVariant[] | undefined
): EyeCatchImageVariant[] | undefined => {
  /* ... */
};

// NG: the message dug out of a client method's return type. It is the same
// type, reached through a function signature instead of the name the proto
// owns — and it hides that the `types` subpath is missing an entity
type RawTenant = Pick<
  Awaited<
    ReturnType<PlatformApiClient["tenants"]["listTenants"]>
  >["tenants"][number],
  "domain" | "name" | "publicId"
>;
```

### OK (preferred)

```ts
import type { SeriesEyeCatchVariant } from "@publira/api-client/public/types";

/**
 * The generated `SeriesEyeCatchVariant` fields {@link toEyeCatchImageVariants}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, the empty string it
 * substitutes fails the check below, and the page then renders its no-image
 * placeholder with nothing pointing at the cause.
 */
type RawEyeCatchImageVariant = Pick<
  SeriesEyeCatchVariant,
  | "contentType"
  | "fileSizeBytes"
  | "height"
  | "label"
  | "url"
  | "variantType"
  | "width"
>;

const toEyeCatchImageVariants = (
  variants: RawEyeCatchImageVariant[] | undefined
): EyeCatchImageVariant[] | undefined => {
  /* ... */
};
```

Good in-repo examples: [`web-host` `catalog.ts`](web-host/lib/catalog.ts) (`RawEyeCatchImageVariant`, `RawEpisodeImage`), [`web-admin` `series.ts`](web-admin/lib/series.ts) (`RawSeries`), and [`web-platform` `tenants.ts`](web-platform/lib/tenants.ts) (`RawTenant`, `RawTenantAdminInvitation`).

### What stays in the mapper

The generated message is the mapper's **input** type only. The app-facing result type stays hand-written in the app, so screens are not coupled to the proto, and the conversion between the two stays in the mapper body:

- **`bigint` → `number`.** `SeriesEyeCatchVariant.fileSizeBytes` is `bigint`; the app-facing field is `number`. Keep `Number(variant.fileSizeBytes ?? 0)` in the body rather than widening the app type.
- **The `?? ""` / `?? 0` defaults.** They cover values that did not come through the deserializer — the partial mock responses the mappers' unit tests pass in. Deriving the input type does not make them redundant.
- **Adoption conditions** (dropping a variant with an empty `label` / `url`, zero-dimension checks) are the mapper's own rules and are unaffected.

A value that is not a generated message in the first place — an already-mapped app type, or JSON parsed out of a string field such as the platform notification `payload` — is outside this rule. Type it against whatever schema actually validates it.

## `"use client"` is dropped from `@publira/ui-components`

`tsdown` strips the `"use client"` directive when it bundles the package, so a component imported straight from `@publira/ui-components` is evaluated in the **server graph** whatever its source file says. Most of the package survives that: the `@base-ui/react` primitives it renders keep their own directive and become the client boundary underneath it.

A component that creates a client function of its own does not survive it. `LocaleSwitcher` hands `<form action={...}>` a callback that writes `document.documentElement.lang` once the Action resolves; created in the server graph, that function has to be serialized into the client primitive below it, and `next dev` logs `Functions cannot be passed directly to Client Components` once per request while the screen still renders.

Such a component is imported through an app-side `"use client"` module that only re-exports it — `components/locale-switcher-control.tsx`, `components/action-form.tsx` — and the Server Component imports that module instead. Next.js compiles the app's own file from source, so the directive stands and the whole subtree moves into the client graph; only the Server Action and the copy the server already resolved cross the boundary. `SectionErrorCatch` is the same split applied to `catchError`.

## Failure display: `SectionError` and `SectionErrorBoundary`

A failure that only kills part of a page must not be hand-rolled into that page. Two shared pieces cover it, and which one a screen reaches for follows from what it is holding:

| What the screen has | Use |
| --- | --- |
| A classified `ok: false` result with a message | Render `SectionError` from `@publira/ui-components/section-error` with that message as `description` — this is the normal case, because a cached read reports failure as a value (see below) |
| An `ok: false` that leaves nothing to show around it — a detail route whose whole content is that one read | Render that app's `PageLoadError` |
| A throw it never sees — a bug, or an uncached read that failed | Wrap the section's `<Suspense>` in that app's `SectionErrorBoundary` (`components/section-error-boundary.tsx`) |
| A submission the server rejected | `FormMessage` next to the control — unchanged |
| A form whose own choices or initial values failed to load — a `<select>`'s options, a settings form's saved state | `FormMessage` next to that control. The form is still usable; the message says which input degraded, not that the section is gone |
| Nothing to show yet | `EmptyState` — unchanged |

The boundary goes **outside** the `<Suspense>`, not inside, so `retry()` puts that section's own skeleton back while the re-run is in flight:

```tsx
<SectionErrorBoundary title="おすすめ作品を表示できませんでした">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

Title the fallback after the section it replaces ("Could not show the recommended works"), so a reader can tell which part of the page is missing.

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

A list component that receives the failure as a prop (`listErrorMessage` and friends) renders `SectionError` itself, with the same title the pages use. The prop carries the message from `rpcErrorMessage`, so the component supplies the title and passes the prop through as `description`:

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

Two things follow from the list being gone rather than empty, and both are already true of every `*Manager`: the `EmptyState` is not rendered next to the error (a failed read still hands the component an empty array, and "No series have been registered yet." next to the error reads as "there is no data"), and the pager is hidden (its tokens are empty then, so "Previous / Next" chrome next to the error looks like the list exists).

Form components keep `FormMessage` for the row above: `creatorsErrorMessage`, `usersErrorMessage`, `loadErrorMessage` and friends stay where they are, next to the control they degrade.

The `catchError` call itself stays in each app rather than in `@publira/ui-components`: `tsdown` drops the `"use client"` directive when it bundles the package, and `catchError` cannot run in the server graph. The fallback body is shared from the package; only the wiring is per app, the same split the route-level `error.tsx` bodies already use. Where the app's boundary resolves its own chrome (see **UI locale**) that wiring is a `"use client"` module of its own — `web-host`'s `components/section-error-catch.tsx` — and `components/section-error-boundary.tsx` is the Server Component the pages import.

## Live regions in a form: `<p role="status">`, never `<output>`

A live region rendered inside a form — `FormMessage` above all — must not be an `<output>`. `<output>` is a resettable element, and resetting a form replaces such an element's children with a single text node holding its default value. React resets a form on its own once the Action passed to it settles, so the elements React rendered inside the `<output>` are detached on the very first submission; every message written after that goes to nodes the document no longer holds. `className` sits on the element itself and keeps updating, which is what makes the symptom confusing: the border turns red while the body still reads "Saved."

Use `<p role="status">`. That is the role `<output>` carried implicitly, so `getByRole("status")` in unit tests and e2e keeps matching.

oxlint's `jsx-a11y/prefer-tag-over-role` asks for the opposite — `<output>` for any `role="status"` — and inside a form its advice is the bug. `packages/ui-components/src/form-message/form-message.tsx` turns that rule off through an `oxlint.config.ts` override, with the reason recorded there. Do not silence it with an inline `oxlint-disable`, and do not read the override as licence to bring `<output>` back.

## A `"use cache"` function must not throw

Measured against the production build under Cache Components: **when a cache fill throws, Next.js fails the request that triggered it.** An awaiting `try` / `catch` does not save it, and neither does an outer cached function catching an inner one — both were measured returning a perfectly good element while the response was still a bare `500 Internal Server Error` document. The failure is only recoverable when a static shell has already been committed, and then only by a client error boundary (`SectionErrorBoundary`), which is why the catalog's `<Suspense>` sections survived an outage while its detail routes answered 500.

"Has a committed shell" is not something a `lib/` helper can assume: the same read is awaited by a section inside `<Suspense>` and by `generateMetadata`, which resolves before anything is flushed. So the rule is unconditional.

### Why a throw before the shell is fatal

The framework rule behind it, measured on the production standalone build by injecting a throw at each position:

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

## `proxy.ts` must not throw

The proxy answers before any page renders, so a proxy that rejects is a bare `500 Internal Server Error` on every path its matcher covers. `error.tsx`, `global-error.tsx`, and the login screen are all out of reach — the app has nothing at all to show. A backend read the proxy depends on must therefore still produce a routing decision when the API is unreachable.

| App | What the proxy reads | While the API is down |
| --- | --- | --- |
| `web-admin` / `web-host` | `resolveTenantId()` | An in-process LRU keeps serving the hosts it has already resolved; a host it cannot resolve gets `503` + `Retry-After` from the proxy's own `try` / `catch` |
| `web-platform` | `resolveSetupState()` | Routing continues on the last state the platform API confirmed, so a protected path reaches the page and `app/error.tsx` renders the failure. The saved default locale it also carries follows the same rule, so that screen keeps the console's language |

Two rules follow:

- **Answer the paths that must survive an outage above the read.** `isHealthProbePath()` and `/setup` return before any RPC is attempted, so a probe never reports the API's health as its own.
- **Never fall back to a value that changes what the operator is asked to do.** "Setup is not completed" during an outage re-opens the bootstrap form on a platform that was set up long ago. The fallback is the state the API last confirmed, and a fixed default only where it has never confirmed one.

No lint covers this. The `*.error-boundary` e2e specs measure it: each stops that app's API server and asserts the app answers `200` with its own error screen instead of a bare 500.

## UI locale

The UI renders in `ja` or `en`. No i18n library is added.

**Nothing turns a missing value into a locale.** `parseLocale` and `parseLocaleCookie` answer `undefined` for anything that is not one of `getLocales()`, and every API that renders copy — `loadMessages`, `sharedCatalog`, `sharedMessage`, `sharedRpcErrorMessage`, `formatDateTime`, `validationErrorMessage`, `toFormErrorMessage`, `rpcErrorMessage` — takes a required `Locale`. There is no repository-wide default to fall back on, and adding one back — under any name — is forbidden: a fixed `ja` shows Japanese to an English reader and hides the failure that produced it.

So a path that cannot resolve a locale **fails** — a type error at the call site, a thrown read, a `notFound()`, or a result that reports the failure instead of naming a language. What it must never do is pick one.

| Layer | Where it lives |
| --- | --- |
| Locale parsing, catalog loading, `{$name}` interpolation | `@publira/i18n` (`parseLocale` / `parseLocaleCookie` / `loadMessages` / `getMessage`) |
| The messages themselves | The repo-root `locales/{locale}.json`, shared with Go and Flutter |
| Where the locale is resolved from | The `publira_locale` cookie in `web-platform` / `web-admin`; the URL's `locale` segment in `web-host` |
| What a missing cookie falls through to | The stored default: the platform's in `web-platform`, the tenant's in `web-admin`. A read that fails is reported, not replaced |
| How the browser learns that default | The `publira_resolved_locale` cookie the proxy publishes — in `web-host` too, where an unprefixed URL is the tenant's default. It is all `<html lang>` and a client error boundary have to go on |

The shared layer never reads request state: `cookies()` and `next/root-params` stay in the app.

- **A message is a MessageFormat 2 simple message.** Interpolation is `{$name}`, a literal brace is `\{` / `\}`, and a literal backslash is `\\` — the Unicode standard's syntax ([UTS #35 Part 9](https://www.unicode.org/reports/tr35/tr35-messageFormat.html)), parsed and formatted by the `messageformat` package rather than by anything hand-written here. Selection (`.match`), functions (`:number` / `:datetime`), markup, and declarations are rejected by `pnpm locales:check`, so a plural that only works for one language has to be a separate key for now. Dates and numbers are formatted by `@publira/utils` with the resolved time zone and passed in already rendered. Full rules: `locales/README.md`
- **`cookies()` inside `<Suspense>` only.** Under Cache Components a locale read above a boundary costs that route its static shell. Keep the read in the app's `lib/locale.ts` (`getPlatformLocale()` / `getLocale()`), and call it from a component that sits inside a boundary
- **Never read the locale inside `"use cache"`.** Pass it in as an argument so it becomes part of the cache key
- **Waiting on a message means `Suspense` + `Skeleton`.** The static shell is locale-independent
- **Never build an `import()` path with a template string.** Write one static path per locale (`loadMessages`'s importers)
- **Cookie apps resolve cookie → stored console default.** A supported cookie always wins, `ja` included; only an unset or unknown value falls through to the default. Both consoles resolve that default without a session — `web-admin` from the public `GetTenant`, `web-platform` from `CheckSetupStatus`, which reports the saved language beside the setup state — so a login screen renders in the same language the signed-in console does. Only a platform that has saved nothing yet negotiates from `Accept-Language`: a statement about the visitor, made where there is no stored answer to state instead. A read that cannot answer is a failure — `web-admin` throws, `web-platform` keeps the last language its API confirmed — never a fixed language stood in for it

### Localizing a screen

The shape a screen takes when its copy moves into the catalog. Worked example: `web-platform`'s auth and setup screens.

- **Give each string its own boundary, not each screen.** A `<Message>` component resolves one key, and the call site wraps it in the `<Suspense>` whose fallback stands in for that one string, so the card, the inputs, and the buttons around it stay in the static shell:

  ```tsx
  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
    <Message message="platform.auth.login.submit" />
  </Suspense>
  ```

  An async section that awaits the catalog and then renders a whole screen takes that structure down with it, and the reader waits on markup that never depended on a message. Write the `<Suspense>` out at the call site rather than hiding it inside the component: it is the standard React mechanism, it is what makes the fallback visible where the size is chosen, and a `fallbackClassName`-style prop forwarding classes into a child is one more name every Tailwind-aware tool has to be told about

- **Do not reach for `connection()` to make a section request-time.** A section that reads `searchParams`, `cookies()`, or a `"use cache: private"` function already defers on its own. Adding `connection()` on top only removes what Cache Components could still have prerendered
- **A section that branches on an RPC or the query picks a key, not a string.** The setup gate and the confirmation screens still decide what to render before anything appears, but what they hand down is a `PlatformMessageKey`, and the copy still goes through `<Message>`. Never pass a loaded catalog into a component: a `messages` prop makes the key an implicit attribute of whatever the caller happened to load, and a key built by interpolation (`platform.auth.confirm_password.${status}`) is not checked against the catalog at all
- **A localized attribute suspends the control, not the screen.** `placeholder`, `aria-label`, and `title` cannot be nodes, so the one control that carries one resolves the catalog itself and sits behind a `<Suspense>` the size of that control. Never drop the copy to avoid this, and never let it pull the rest of the form in with it
- **`getMessage` is otherwise for values that cannot be nodes at all**: `generateMetadata`'s `title`, and anything crossing into a Server Action
- **Client Components take rendered nodes, never catalogs.** Pass copy in as `ReactNode` through a `copy` prop (`LoginFormCopy`), so each string keeps its boundary. An `import()` of a catalog from the client ships both locales to the browser
- **A copy prop takes a `ReactNode`, never a catalog key.** `title="admin.audit.section_error"` is a contract that the component must resolve the key itself, and it hides where the `<Suspense>` lands. Type the prop `ReactNode` and pass `<Suspense><Message /></Suspense>` from the caller
- **A copy prop is for copy that names the caller.** `SectionErrorBoundary`'s `title` says which section is missing, so it differs per boundary and belongs to the page. Everything else the fallback shows — what the reader can do about it, the retry button, the digest label — says the same thing at every boundary, so it is the frame rather than the section and the app's own component resolves it from the catalog instead of taking it as a prop. Judge that by what the copy is about, not by how many call sites happen to exist today. A shared package still takes everything as a node: `@publira/ui-components` and `@publira/layouts` are used from both a URL-locale app and the cookie apps, so they cannot read a locale at all
- **A shared component holds no copy, not even as a default.** A component in `@publira/ui-components` or `@publira/layouts` cannot resolve a locale, so a default string there is a fixed language — one that reads as Japanese on an English console, and only where the caller forgot the prop, which is exactly where nobody looks. Every string the component renders is therefore a required prop, and the invariant is expressed in the type: `SectionError` takes `digest` as `{ label, value }` so a digest cannot arrive without the label that introduces it. The one exception is a string whose absence is itself a design: an omitted `placeholder` renders nothing, in every language. Autonyms — the language names in a switcher — come from `getLocaleLabel` rather than a catalog, because they are the same in every locale
- **Do not wrap that in a helper.** A function whose whole body is one `<Suspense><Message /></Suspense>`, or a factory returning a bag of them to spread onto a component, buys a little less repetition and costs the reader a jump to its definition to learn what the call site does. Write the JSX where it is used. Repetition that is the frame rather than the call site's own copy is answered by the component owning it, never by a helper the call sites spread
- **An `error.tsx` boundary must wrap its own copy in `<Suspense>`.** A boundary directly under the root layout has nothing above it to catch a suspend, so React has no fallback to flush and the streamed response is cut off mid-body — the browser shows its own network-error page instead of the error screen, after the 200 is already committed. Measured on `web-admin` by `e2e/tests/admin.error-boundary.spec.ts`, which is what caught it
- **A string that has to be an attribute has no boundary.** `placeholder`, `aria-label`, and `title` cannot stream, so they come from a section that already blocks, resolved as a string
- **Keys live under the app's namespace.** Split by reader (`platform.*` / `admin.*` / `host.*`), then by screen. Lift a string into an area-wide section (`platform.auth.fields`) only once more than one screen uses it. The top-level list is in `locales/README.md`
- **A zod schema carrying user-facing messages is a function of the catalog, not a module constant.** Its wording depends on the request's locale, which only a Server Action or a suspended section can resolve. Pass the same locale to `toFormErrorMessage(parsed.error, { locale })` and `rpcErrorMessage(error, fallback, { locale, overrides })`
- **Never write a sentence into a `Suspense` fallback.** A fallback is part of the static shell and cannot follow the locale; use a `Skeleton` sized to the string it stands in for
- **`metadata` becomes `generateMetadata`.** `<title>` is screen copy too. It streams separately on a route whose body already reads request data (`node_modules/next/dist/docs/`, generate-metadata / With Cache Components)

### `<html lang>`

**A root layout reads nothing, in any of the three apps.** An `<html>` attribute has no child `<Suspense>` boundary a read could move into, so awaiting there settles the whole tree before anything below it can flush — and a `cookies()` read costs every route below it its static shell on top of that. The attribute is therefore written by a script rather than rendered, everywhere. Four pieces solve it.

1. Every root layout stays synchronous and renders **no** `lang` at all, with `suppressHydrationWarning`. A document that reaches the browser before a locale has been resolved names no language rather than guessing: a wrong `lang` tells a screen reader to pronounce the page in a language it is not written in, which is worse for that reader than an absent one
2. `<head>` carries an inline script, a constant of `@publira/i18n`. `LOCALE_LANG_SCRIPT` in the cookie consoles applies the first supported locale it finds in the order the server resolves them: `publira_locale`, the reader's own choice, then `publira_resolved_locale`. `PATH_LOCALE_LANG_SCRIPT` in `web-host` reads the URL's own locale segment first and `publira_resolved_locale` only for the unprefixed path that serves the tenant's default. Anything else leaves what the server rendered alone
3. The proxy publishes `publira_resolved_locale` — the stored default it read to route the request anyway. All three do this through `@publira/utils/resolved-locale`: `web-platform` from its `CheckSetupStatus` read, `web-admin` and `web-host` from the Host-to-tenant resolution that carries the tenant's saved language. The cookie is a copy of a server-resolved value, never a choice, so a chosen cookie always wins and no server path reads it back. It is also what a **client** error boundary resolves its copy from: that boundary renders when the API holding the setting is unreachable, so without the cookie it would word an outage from `Accept-Language` instead of in the language the site is served in
4. A cookie console's switcher writes `document.documentElement.lang` **after its Action resolves**. The script only runs on a full load, and a Server Action's re-render produces the same static attribute value, so React never touches the DOM. Writing it in the click handler would leave the document claiming a language that neither the cookie nor the copy on screen agrees with whenever the Action fails. `web-host`'s switcher is a link to another URL, so the script runs again on its own

That fourth piece is why the chosen cookie is not `httpOnly`, and neither is the resolved one — the scripts and the error boundaries read both from `document.cookie`. `instant = false` is not an option here (see **Never use `instant = false`**).

`global-not-found.tsx` is outside all of this in **all three apps**. It is a static page that never passes through a layout, and an unmatched URL carries neither a cookie the app has read nor a tenant whose saved default could word it, so its body cannot follow a locale either. So the locale is a decision the file states rather than resolves — `web-host` and `web-admin` name it once as a `NOT_FOUND_LOCALE` constant that both `lang` and the catalog lookups read — and it is `ja` because that is the language the copy is written in. Switching the attribute alone would only misreport the text below it.

### Switching

The switcher writes the cookie from a Server Action. Never write `document.cookie` from the client. Validate the value against a `getLocales()` zod schema and drop anything outside it rather than storing it. The cookie is `Path=/`, `SameSite=Lax`, with `LOCALE_COOKIE_MAX_AGE`.

Worked examples:

- `web-platform`: `lib/locale.ts` / `lib/locale-action.ts` and the Display language card on `/settings/general`
- `web-admin`: `lib/locale.ts` (`getLocale()`) / `lib/locale-action.ts` and the Display language card on `/settings`

### A URL-locale app (`web-host`)

The public site keeps the locale in the path, not in a cookie. A reader shares a URL and gets the language it names, and every cache key downstream — CDN, `"use cache"`, the prerendered shell — already separates the two languages. There is no `publira_locale` here and no switcher Action: the switcher is a link. What `web-host` does share with the consoles is `<html lang>`, written by `PATH_LOCALE_LANG_SCRIPT` because its root layout reads nothing either.

The route tree is `app/[tenant_id]/[locale]/...`, and `proxy.ts` rewrites a public `/{locale}{path}` onto it after resolving the tenant from the Host. These rules follow from that shape:

- **A path with no locale is served as the tenant's default, and only the redundant prefix redirects.** `GetTenantByDomain` returns `default_locale` alongside the tenant id precisely so the proxy can name that language in the round trip it already makes: an unprefixed path is rewritten onto it, and a URL that spells the default out is sent back to the unprefixed canonical with a 307 — temporary, so a browser caches neither a change to that setting nor a decision `Accept-Language` negotiation would later have to override. Nothing on this path names a language of its own: a stored code this build serves no catalog for, and a tenant read that fails outright, both end the request (503) rather than answering in a language the tenant never chose
- **`/theme.css` and the Route Handlers stay outside the locale tree.** They answer machines, and a Route Handler cannot read `next/root-params` anyway, so a locale segment there would be a value nothing could use. The exemption lives in `lib/locale-path.ts`
- **The locale is stripped before a path is classified.** `buildTenantRewritePathname` decides "published page or app route" on the locale-less remainder, so a tenant page whose slug happens to be `ja` still resolves, and a locale code can never collide with a reserved segment
- **A Server Component that needs the tenant's default reads `getTenantDefaultLocale()`.** The setting rides on `getTenantSiteInfo`, next to the display time zone and under the same `tenant:<id>:site` tag, so the admin console's save reaches the site. The proxy is the one caller that cannot use it — it runs before any route renders, where a `"use cache"` read is unavailable — which is why the same value also comes back from `GetTenantByDomain`. `generateStaticParams` still emits every supported locale: the default picks a redirect target, it does not narrow what the site serves
- **The root layout is the document shell and nothing else.** It is synchronous and reads nothing, so both locales enter the tree one level down, at the `(site)` and `(auth)` layouts. That is also what puts the tenant read behind `app/[tenant_id]/[locale]/error.tsx`: a stored default that cannot be read brings up that boundary instead of a bare 500 no boundary catches. The boundary stands in for those layouts, so it seeds a provider of its own from what the browser holds (`lib/client-locale.ts`): the same path and cookie `<html lang>` was written from, and then `Accept-Language`, which the script has no equivalent of — an attribute can be left unset, copy cannot, so the boundary states what the visitor asked for where no stored answer is within reach

Reading the locale, by context:

| Context | How |
| --- | --- |
| Server Component | `getLocale()` from `lib/locale.ts` — `next/root-params`, `notFound()` on an unsupported value |
| Client Component | `useLocale()` from `components/locale-provider.tsx` (React context, seeded by the `(site)` and `(auth)` layouts). The tenant's stored default travels beside it as `useTenantDefaultLocale()`, from a provider of its own |
| Server Action | An argument bound by the Server Component, or the `<LocaleField />` hidden field parsed with `localeFormSchema` |

- **Never read the locale with `useParams()` or `usePathname()`.** Both call Next.js's dynamic-route-param hook, which aborts the prerender of a **fallback shell** — a route whose own dynamic segment has no value yet, such as `/series/[series_id]` — by bailing out to client rendering. The build fails with an empty `Error occurred prerendering page` line, so the cause is not obvious from the output. A Client Component that genuinely needs the current path (the locale switcher) belongs inside a `<Suspense>` with a skeleton. `lib/client-locale.ts` reads `window.location` rather than either hook, and only `app/[tenant_id]/[locale]/error.tsx` calls it: that boundary has no provider above it and renders in the browser, so there is no shell for the read to abort
- **In-app links go through `<LocaleLink>`**, or through `withLocalePrefix()` where an href is handed to a shared component that renders a plain `next/link` (`@publira/layouts` is shared with the cookie apps and cannot add the prefix itself). A bare `<Link href="/series">` drops the prefix and bounces the reader through the compatibility redirect. A `next/form` `action` is a path too — the search box in the site header carries the prefix the same way
- **`@publira/layouts` holds no copy.** Nav labels, the account actions from `getAuthActions(hasSession, labels)`, the sign-out button, and the footer link list's `aria-label` all arrive resolved from the caller, for the same reason the hrefs do: the package cannot read either app's locale
- **`returnTo` and other stored paths stay locale-less.** `sanitizeRedirectPath` strips the segment, so whoever performs the redirect decides the language and `/en/login?returnTo=/ja/my` cannot throw a reader back into the other one
- **A path that a Server Action redirects to needs the prefix applied at the `redirect()` call**, from the locale the action was given — including an operator-authored internal link, where `withLocalePrefix` leaves external URLs untouched

## Icons: `@publira/icons`, never inline `<svg>`

Icons come from `@publira/icons`, a thin wrapper around `lucide-react`. App and package code must not hand-write `<svg>` in JSX, and must not import `lucide-react` directly — `packages/icons` is the only place allowed to.

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

Barrel vs subpath is existing drift, not a rule — follow whatever the surrounding file does.

### Adding and excepting

- **Missing icon** → wrap it in `packages/icons` (component, `exports` subpath, `tsdown` entry, `index.ts` re-export, test). Steps: `packages/icons/README.md`.
- **Sizing** → lucide is always `viewBox="0 0 24 24"` at `strokeWidth={2}`. Pick a `size-*` / `h-* w-*` class that suits the layout and leave the rest at lucide's defaults. Do not carry dimensions or stroke widths over from markup you are deleting.
- **A genuine non-icon SVG** (decorative artwork, a chart, a generated image) is a real exception. Add its path to the grep step's exclusions in `.github/workflows/ci.yml`, with a comment saying why — the same way the `Date` boundary exemptions are handled in `oxlint.config.ts`.

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
