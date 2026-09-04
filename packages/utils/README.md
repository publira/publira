# utils

The package that provides the shared frontend utilities.

`next` and `zod` are peerDependencies, so the app's own copies are what run.

## Subpaths

| Import | What it provides |
| --- | --- |
| `@publira/utils` | The client-safe barrel: `cn`, the `Temporal` date and time helpers, `formatPercent`, the IANA time zone list and its validation, `decodeBase64Url`, the tenant theme tokens and their contrast rules, and `getTenantDomainCandidates` |
| `@publira/utils/cn` | `cn`, the Tailwind-aware className helper, on its own |
| `@publira/utils/format-date-time` | The tenant-time-zone-aware date and time helpers on their own |
| `@publira/utils/theme-css-variables` | The tenant theme colors as `--publira-color-*` custom properties, and `DEFAULT_TENANT_THEME_COLORS` |
| `@publira/utils/theme-contrast` | The WCAG AA contrast check the theme settings form and its preview share |
| `@publira/utils/search-params` | The schema builders that validate `searchParams` (`string \| string[] \| undefined`) with zod |
| `@publira/utils/route-params` | The schema builders that validate a dynamic route segment (`params`) with zod |
| `@publira/utils/static-param-placeholder` | `STATIC_PARAM_PLACEHOLDER` and `createPlaceholderStaticParams`, free of `next/navigation` so a Route Handler can import them |
| `@publira/utils/next-static-params` | The same, plus `guardPlaceholder` for Server Components |
| `@publira/utils/form-data` | `toFormDataInput`, which turns `FormData` into an object zod can validate |
| `@publira/utils/field-errors` | `toFieldErrors` / `toFormErrorMessage` / `validationErrorMessage(locale)`, which map a `safeParse` failure into a Server Action's ActionState shape |
| `@publira/utils/cached-read` | `cachedReadFailure` / `dropFailedCacheEntry`, which return a failed `"use cache"` read as a value and keep that failure out of the cache |
| `@publira/utils/image-loader` | `imageServerLoader`, the custom loader that lets `next/image` use the image-server (Manael) for conversion and resizing |
| `@publira/utils/resolved-locale` | The helper a cookie console's `proxy.ts` publishes its server-resolved display locale to the browser with |
| `@publira/utils/health` | The `/livez` and `/readyz` handlers. Node-only, so it is deliberately outside the barrel |

## Usage

```ts
import { cn } from "@publira/utils";

const className = cn(
  "rounded-md px-3 py-2",
  isActive && "bg-primary text-primary-foreground"
);
```

### Date and time (the tenant's time zone)

`Temporal` has to exist at runtime; each app loads `temporal-polyfill/global` from its instrumentation or equivalent.

```ts
import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@publira/utils";

// Display (for a tenant, pass the value from getTenantDisplayTimeZone; the default is DEFAULT_TIME_ZONE)
formatDateTime(iso, { locale, timeZone: tenantTimeZone, fallback: "-" });

// An absolute time ↔ a datetime-local wall clock (independent of the host's local TZ)
const local = toDateTimeLocalValue(iso, tenantTimeZone); // "YYYY-MM-DDTHH:mm"
const absolute = fromDateTimeLocalValue(local, tenantTimeZone); // "...Z"
```

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

## Validating untrusted input (zod)

For the policy, see "Untrusted input" in [`apps/AGENTS.md`](../../apps/AGENTS.md). What lives here are the shared schemas that let all three apps write that policy the same way. What each builder accepts and rejects is specified by `src/search-params.test.ts` and `src/route-params.test.ts`.

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
  from: searchParamDate({ fallback: "" }),
  limit: searchParamNumber({ clamp: true, fallback: 20, max: 50, min: 1 }),
  q: searchParamString({ fallback: "", maxLength: 255 }),
  sort: searchParamEnum(["asc", "desc"], { fallback: "desc", locale }),
});

const filters = filtersSchema.parse(await searchParams);
```

`searchParamStringArray()` is the multi-value form, and `searchParamBoolean()` reads a checkbox. `searchParamDate` checks calendar validity through `Temporal`, so the polyfill has to be present at runtime.

A real example: [web-admin's audit log filters](../../apps/web-admin/app/%5Btenant_id%5D/%28protected%29/audit-logs/_lib/search-params.ts)

### Dynamic route segments (`params`)

There is no `fallback` here: a value that cannot be an identifier gets the same `notFound()` as a missing resource.

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

`routeParamStringArray()` is the catch-all (`[...slug]`) form. A page builds the schema for the whole `params` and passes only the output of `parseRouteParams` to `lib/`.

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

A screen whose ActionState has no per-field slot collapses the errors into one message with `toFormErrorMessage(parsed.error)`.

## Wiring the `next/image` loader

`images.loaderFile` takes a path relative to the app root, so each app re-exports `imageServerLoader` from a file of its own and this package holds the implementation.

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

An `<Image>` that does not go through the image-server, such as a temporary `blob:` preview, keeps its `unoptimized`.

## Build

```bash
pnpm --filter @publira/utils build
```
