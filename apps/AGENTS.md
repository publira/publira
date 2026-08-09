# Apps Agent Guide

Shared conventions for Next.js apps under `apps/` (`web-admin`, `web-host`, `web-platform`). Prefer this file for monorepo frontend policy. Root [AGENTS.md](../AGENTS.md) remains the top-level source of truth. Per-app `AGENTS.md` files should keep only the Next.js-generated block (`BEGIN/END:nextjs-agent-rules`).

## React Effects / useEffectEvent

OK and NG rules: repository root [AGENTS.md](../AGENTS.md) (React: Effects and useEffectEvent).

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

## Before coding in an app

1. Read this file (`apps/AGENTS.md`).
2. Read the **target** app's `AGENTS.md` (Next.js official rules only) and that app's `node_modules/next/dist/docs/` as needed.
3. Do **not** load other apps' `AGENTS.md` unless the change truly spans multiple apps.

## After changes

- Frontend / packages: `pnpm preflight` (typegen / typecheck / check / test) from the repo root.
