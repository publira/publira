# utils

The package that provides the shared frontend utilities.

## What it provides

- `cn`: a className-joining helper built on `clsx` and `tailwind-merge`
- `decodeBase64Url`: decodes Base64URL to bytes (it prefers `Uint8Array.fromBase64(..., { alphabet: "base64url" })` and falls back to `atob` only on browsers that lack it)
- `formatDateTime` / `formatDate` / `toDateTimeLocalValue` / `fromDateTimeLocalValue`: tenant-time-zone-aware date and time display, and the conversion to and from a `datetime-local` value (all on `Temporal`)
- `parseInstant` / `toInstantIsoString` / `startOfDayIsoString` / `endOfDayIsoString`: parsing and comparing absolute times, normalizing form values, and the day boundaries of a date-only filter
- `listSupportedTimeZones` / `isValidTimeZone`: the IANA time zone list and its validation, for the tenant time zone settings UI
- `@publira/utils/search-params`: the schema builders that validate `searchParams` (`string | string[] | undefined`) with zod
- `@publira/utils/route-params`: the schema builders that validate a dynamic route segment (`params`) with zod
- `@publira/utils/form-data`: the helper that turns `FormData` into an object zod can validate
- `@publira/utils/field-errors`: the helper that maps a `safeParse` failure into a Server Action's ActionState shape. The shared validation copy is `validationErrorMessage(locale)` (omit the locale and you get the Japanese `VALIDATION_ERROR_MESSAGE`)
- `@publira/utils/cached-read`: the helper that returns a failure as a value from a `"use cache"` read, and keeps that failure out of the cache
- `@publira/utils/image-loader`: the custom loader that lets `next/image` use the image-server (Manael) for conversion and resizing

## Usage

```ts
import { cn } from "@publira/utils";

const className = cn(
  "rounded-md px-3 py-2",
  isActive && "bg-primary text-primary-foreground"
);
```

### Date and time (the tenant's time zone)

`Temporal` has to exist at runtime; each app loads `temporal-polyfill/global` from its instrumentation or equivalent. An absolute time is parsed only through `Temporal.Instant.from` (a `Z` or a numeric offset is required). We do not use the host-local `Date.parse`.

```ts
import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@publira/utils";

// Display (for a tenant, pass the value from getTenantDisplayTimeZone; the default is DEFAULT_TIME_ZONE)
// locale is the UI locale; omitting it means ja, which matches the old fixed ja-JP output
formatDateTime(iso, { locale, timeZone: tenantTimeZone, fallback: "-" });

// An absolute time ↔ a datetime-local wall clock (independent of the host's local TZ)
const local = toDateTimeLocalValue(iso, tenantTimeZone); // "YYYY-MM-DDTHH:mm"
const absolute = fromDateTimeLocalValue(local, tenantTimeZone); // "...Z"
// fromDateTimeLocalValue rejects a string carrying Z, an offset, or [IANA]
```

### Parsing, comparing, and day boundaries

```ts
import {
  endOfDayIsoString,
  parseInstant,
  startOfDayIsoString,
  toInstantIsoString,
} from "@publira/utils";

// Compare and sort on Instant (not by chaining getTime() and not by comparing strings)
const at = parseInstant(apiTimestamp); // Temporal.Instant | null
if (at && Temporal.Instant.compare(at, Temporal.Now.instant()) <= 0) {
  /* in the past */
}

// A server action's input (it accepts an absolute time or a datetime-local wall clock)
toInstantIsoString(formValue, tenantTimeZone); // "...Z", or "" when it cannot be interpreted

// The day boundaries of a date-only filter (never pinned to UTC)
startOfDayIsoString("2024-03-10", tenantTimeZone); // 00:00 in that TZ
endOfDayIsoString("2024-03-10", tenantTimeZone); // the end of the same day (inclusive)
```

### Picking and validating a time zone

These are for a screen that lets someone choose an IANA name and saves it, such as the tenant time zone settings.

```ts
import { isValidTimeZone, listSupportedTimeZones } from "@publira/utils";

// The options (the zone names the runtime's ICU carries, plus UTC; sorted by name and memoized)
const items = listSupportedTimeZones().map((zone) => ({
  label: zone,
  value: zone,
}));

// Used in a Server Action's zod schema for immediate feedback
const schema = z.object({
  timezone: z.string().trim().min(1).refine(isValidTimeZone),
});
```

The source of truth is the Go server (`server/internal/tenanttz`, which validates against the embedded IANA tzdata). `isValidTimeZone` is the check in front of it and must not be looser: it rejects `Local` and an offset spelling (`+09:00`), matching `time.LoadLocation`. An alias that is not enumerated (`Asia/Calcutta`) is accepted as a valid value.

## Validating untrusted input (zod)

For the policy, see "Untrusted input" in [`apps/AGENTS.md`](../../apps/AGENTS.md). What lives here are the shared schemas that let all three apps write that policy the same way. zod is a peerDependency, so the app's own zod is what runs.

### `searchParams`

Passing `fallback` gives you a schema that cannot fail; leaving it out gives you a schema that raises a zod error on an invalid value. The former is for falling back to a filter screen's default view, the latter for a URL you want to `notFound()`.

```ts
import {
  searchParamDate,
  searchParamEnum,
  searchParamNumber,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

const filtersSchema = z.object({
  from: searchParamDate({ fallback: "" }), // a date that cannot exist on the calendar falls back to ""
  limit: searchParamNumber({ clamp: true, fallback: 20, max: 50, min: 1 }),
  q: searchParamString({ fallback: "", maxLength: 255 }),
  sort: searchParamEnum(["asc", "desc"], { fallback: "desc" }),
});

const filters = filtersSchema.parse(await searchParams);
```

- When the same key appears more than once, a single-value schema treats it as invalid rather than picking one of them (falling back if there is a `fallback`)
- For several values, use `searchParamStringArray()`. A single `?tag=a` is accepted as a one-element array
- `searchParamNumber` accepts only decimal integers and decimals (`0x10`, `1e3`, and `Infinity` are invalid). `integer` defaults to `true`
- Exceeding `maxLength` is invalid by default. Only `truncate: true` truncates, and it never splits a surrogate pair
- `searchParamDate` checks calendar validity through `Temporal`, so the polyfill has to be present at runtime
- `searchParamEnum`'s rejection message is `errors.disallowed_value`. Passing `locale` renders it in that language; omitting it gives Japanese

A real example: [web-admin's audit log filters](../../apps/web-admin/app/%5Btenant_id%5D/%28protected%29/audit-logs/_lib/search-params.ts)

### Dynamic route segments (`params`)

There is no `fallback` here. A value that cannot be an identifier gets the same `notFound()` as a missing resource, so nothing leaks about whether it exists.

```ts
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { notFound } from "next/navigation";
import { z } from "zod";

const paramsSchema = z.object({
  series_id: routeParamString(),
});

const parsed = parseRouteParams(paramsSchema, await params);
if (!parsed) {
  notFound();
}

await getSeries(parsed.series_id);
```

- A single segment is `routeParamString()`: trimmed, empty rejected, length capped (255 by default), and `generateStaticParams`'s placeholder rejected
- A catch-all (`[...slug]`) is `routeParamStringArray()`. An empty array and a non-array are invalid, and each element follows the same rules as `routeParamString()`
- A page builds the schema for the whole `params` and passes only the output of `parseRouteParams` to `lib/`. A failure is always `notFound()` — never turn `safeParse`'s `null` into some other default view

A real example: [web-host's series detail page](../../apps/web-host/app/%5Btenant_id%5D/%28site%29/series/%5Bseries_id%5D/page.tsx)

### `FormData` and Server Actions

`toFormDataInput` only declares and reads "text / repeated text / file / repeated file"; it neither trims nor caps lengths. What a form accepts lives in one place, the zod schema.

```ts
import {
  toFieldErrors,
  validationErrorMessage,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";

const parsed = seriesSchema.safeParse(
  toFormDataInput(formData, {
    creatorPublicIds: { kind: "values", name: "creator_public_ids" },
    eyeCatchImage: { kind: "file", name: "eye_catch_image" },
    title: "value",
  })
);

if (!parsed.success) {
  return {
    fieldErrors: toFieldErrors(parsed.error),
    message: validationErrorMessage(locale),
    ok: false,
  };
}
```

- `value` yields `undefined` rather than stringifying a file that was submitted, which prevents `String(formData.get(...))` from producing `"[object File]"`
- An `<input type="file">` with nothing chosen still submits a 0-byte entry, so the file kinds drop empty files
- A screen whose ActionState has no per-field slot collapses the errors into one message with `toFormErrorMessage(parsed.error)`

## A failing `"use cache"` read (`cached-read`)

Measured on a production build under Cache Components: **when filling a `"use cache"` entry throws, the request itself fails.** Neither a `try` / `catch` at the call site nor an enclosing cache function can save it, and only a committed static shell lets the client error boundary pick it up. So a cached read **returns the failure as a value instead of throwing**.

```ts
import {
  cachedReadFailure,
  dropFailedCacheEntry,
} from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

export const getSeriesDetail = async (
  tenantId: string,
  publicId: string
): Promise<CachedReadResult<SeriesDetail | null>> => {
  "use cache";
  try {
    const response = await apiClient.catalog.getSeriesDetail({
      publicId,
      tenant: { tenantId },
    });
    return { ok: true, value: toSeriesDetail(response) };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      // "it is not there" is an answer, and may be cached
      return { ok: true, value: null };
    }
    return cachedReadFailure(
      rpcErrorMessage(error, "シリーズを取得できませんでした。")
    );
  }
};

// A read for chrome with no message to show falls back to a default and only drops the entry
export const getTenantSiteInfo = async (
  tenantId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  try {
    return toTenantSiteInfo(
      await apiClient.tenant.getTenant({ tenant: { tenantId } })
    );
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      dropFailedCacheEntry();
    }
    return null;
  }
};
```

- `cachedReadFailure` and `dropFailedCacheEntry` set `cacheLife({ expire: 0, revalidate: 0, stale: 0 })`, which **keeps the failure out of the cache** (`@publira/next-cache-handlers`'s `set` does not store an entry with `expire === 0`, and even if one were stored, `revalidate: 0` makes the next read a miss). Once the API recovers, the next read returns the real content immediately
- The named profiles in `next.config.ts` are validated for things like `expire > revalidate` and a minimum `stale`, but **an inline `cacheLife()` call is not validated at all** (`next/dist/server/use-cache/cache-life.js` only records the explicit values). This combination of three values was measured on a production build: it raises no error, and the failure is not stored
- Classify the error **inside** the cache scope. An error that crosses a `"use cache"` boundary has its message replaced by a digest in production, which loses the `Code` (`rpcErrorDisposition()` / `rpcErrorMessage()`)
- The caller renders `ok: false` as a `SectionError` or a `PageLoadError`. Which one each screen uses is in `apps/AGENTS.md`

## The `next/image` loader (`image-loader`)

`imageServerLoader` is a custom loader for `next/image`. It builds the query Manael understands, and only when reading `/images/...` (the image-server or the admin-image-server).

```ts
// apps/web-host/lib/image-loader.ts
"use client";

export { imageServerLoader as default } from "@publira/utils/image-loader";
```

```ts
// apps/web-host/next.config.ts
images: {
  loader: "custom",
  loaderFile: "./lib/image-loader.ts",
},
```

`images.loaderFile` accepts only a path relative to the app root, so a package resolved with `import.meta.resolve` cannot be handed to it. Each app holds nothing but a re-export, and the implementation lives in this package.

| Input | Output |
| --- | --- |
| `/images/creators/<uuid>`, width 96 | `/images/creators/<uuid>?w=96&fit=scale-down` |
| The same with `quality={60}` | `…?w=96&fit=scale-down&q=60` |
| `blob:` / `data:` / an absolute URL / any other path | Returned unchanged |

- `fit=scale-down` is what keeps an image from growing past its original size. `next/image` asks for every width in `deviceSizes` (up to 3840px), so Manael's default (`contain`, which upscales) would stretch a small icon to 3840px.
- `q` is added only when the caller passed `quality`. `next/image` hands the loader `undefined` when there is no `quality` prop (Next.js 16.3's `get-img-props`), so leaving it out lets Manael's per-format defaults apply (WebP 90 / AVIF 60).
- When you do pass `quality`, add that value to the app's `images.qualities` too. The default is `[75]`, and a value outside it warns in development (the value itself still reaches the loader, since this is a custom loader).
- The choice between WebP and AVIF follows the browser's `Accept`, so the loader specifies no format.
- An `<Image>` that does not go through the image-server, such as a temporary `blob:` preview, keeps its `unoptimized`.

## Build

```bash
pnpm --filter @publira/utils build
```
