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
- **Never swallow an unclassifiable error** (`internal`, `unimplemented`, or a throw that is not an RPC error at all). A `catch` returning `null` / `false` / `[]` still calls `rethrowUnclassifiedRpcError(error)` first.
- The exceptions are logout (the cookie must clear either way), non-critical chrome such as footer links, and the top page's per-section degradation. Each one records why in a comment.

## Before coding in an app

1. Read this file (`apps/AGENTS.md`).
2. Read the **target** app's `AGENTS.md` (Next.js official rules only) and that app's `node_modules/next/dist/docs/` as needed.
3. Do **not** load other apps' `AGENTS.md` unless the change truly spans multiple apps.

## After changes

- Frontend / packages: `pnpm preflight` (typegen / typecheck / check / test) from the repo root.
