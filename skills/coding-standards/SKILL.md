---
name: coding-standards
description: Full text of the publira coding standards that the always-loaded root AGENTS.md only summarizes. Use when writing or reviewing a React Effect (`useEffect`, `useEffectEvent`, props→state, resetting form state), date and time handling (`Temporal` instead of `Date`, the `@publira/utils` helpers, time zones, `datetime-local` values), an environment variable name (`PUBLIRA_*`), TypeScript run directly by Node.js (`node --watch entry.ts`, no `tsx`), or the Next.js cache settings (`cacheHandler` vs `cacheHandlers`). Read the reference for the standard you are touching before writing the code.
---

# Coding Standards

The root `AGENTS.md` carries every standard's norm and its enforcement; this file carries the decision flows, tables, and NG/OK examples that would otherwise cost context in every session. Where this skill and an `AGENTS.md` disagree, `AGENTS.md` wins.

Only two of these standards fail a machine check on violation. For the other three, reading the reference is the check — open it before writing the code, not after review asks for a rewrite.

## Standards

| Standard | Read it when | Enforcement | Full text |
| --- | --- | --- | --- |
| **Environment variables: `PUBLIRA_*`** — a variable only this repository's code reads carries the prefix; it keeps an outside name only when the software consuming it looks that name up itself | Adding, renaming, or wiring any environment variable, in Go or TypeScript | None. A non-conforming name silently does nothing under turbo's strict env mode while every service still starts | [`references/env-vars.md`](references/env-vars.md) |
| **TypeScript executed directly by Node.js** — run it on Node.js type stripping, inside erasable syntax; do not reach for `tsx` | Adding or editing a script or entry point that Node.js runs directly, or considering a TypeScript runtime dependency | None at author time; `pnpm preflight` type-checks after the fact | [`references/typescript-on-node.md`](references/typescript-on-node.md) |
| **React: Effects and `useEffectEvent`** — user actions go in handlers, derived values are computed during render, edit state resets by `key` remount, and Effects are for external systems only | Writing or reviewing any `useEffect` / `useEffectEvent`, or any component that mirrors props into state | Partial. `react/react-compiler` and `react-hooks/rules-of-hooks` catch some cases; no rule detects a props→state Effect, nor the render-time `prev*` + `setState` that stands in for one | [`references/react-effects.md`](references/react-effects.md) |
| **Date and time: `Temporal`, not `Date`** — use `Temporal` and the `@publira/utils` helpers, and make the time zone an explicit decision at every conversion | Touching any date, time, timestamp, `datetime-local` form value, or date filter boundary in `apps/*` or `packages/*` | oxlint `no-restricted-globals` (`Date`) in `oxlint.config.ts`; `pnpm check` fails on a violation | [`references/date-and-time.md`](references/date-and-time.md) |
| **Next.js cache: `cacheHandler` vs `cacheHandlers`** — wire both, backed by Redis through `@publira/next-cache-handlers` | Editing the cache settings in an app's `next.config.ts`, or `@publira/next-cache-handlers` itself | None. All three apps already wire both, so only a change to those files can break it | [`references/nextjs-cache.md`](references/nextjs-cache.md) |

## Editing this skill

This skill is owned by this repository. `skills/coding-standards` is the canonical copy; `.agents/skills/coding-standards` and `.claude/skills/coding-standards` are relative symlinks to it. Edit the canonical copy, never a path under `.agents/skills/*` — entries listed in `skills-lock.json` are vendored and overwritten by `npx skills`.

When a standard moves here, `AGENTS.md` keeps its norm in one or two sentences and names its enforcement, including "none" — but no link. This skill reaches an agent through the `name` and `description` above; a path in `AGENTS.md` would only make the same text get read a second time, through `skills/` as well as through `.claude/skills/`. Keeping the norm in `AGENTS.md` is what guarantees a session that never loads this skill still knows the standard exists.
