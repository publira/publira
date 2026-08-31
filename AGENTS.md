# Publira Agent Guide

Repository-specific conventions for agents. This file is the source of truth for implementation and review.

## Output language

Respond to the user in the language they wrote in, even though this guide and the rest of this repository's documentation are written in English. A Japanese message is answered in Japanese, an English one in English. Publira is open source, so a contributor working here is not necessarily a Japanese reader, and a fixed response language would hand them a terminal they cannot read.

Judge the language from the user's own prose, not from what the prompt quotes: a log line, an error message, a UI string, or a snippet of code pasted into an English question does not make the question Japanese.

When a run has no user message at all — a scheduled run, an agent started from CI, an autonomous loop — respond in **English**. This repository's own documentation is English, and there is no way to know who reads such a transcript.

Code, identifiers, commit messages, and quoted technical terms stay as-is in either direction; only the explanations, summaries, and questions to the user follow the user's language.

## Documentation and test labels: English

Every Markdown document this repository owns — every `README.md` and `AGENTS.md`, the skills under `skills/`, the pull request template — is written in English, and so are the labels of automated tests: the first argument of Vitest's `describe` / `it`, Playwright's `test` / `test.describe`, Go's `t.Run`, and Flutter's `test` / `group` / `testWidgets`. The only exception is the root `README.md`, which is paired with a Japanese translation at `README.ja.md`; no other directory gets a `*.ja.md`.

Japanese survives where it is the subject rather than the prose: user-facing UI strings, including the ones quoted in a code example, the values in `locales/*.json`, and Japanese test fixtures. Identifiers, API names, paths, and environment variable names are never translated in either direction.

No lint covers this. Japanese README files and test labels predating the rule are still being translated under [#1283](https://github.com/publira/publira/issues/1283), so an existing Japanese one is a leftover, not a precedent.

## Git commits

Commit subjects and PR titles use Conventional Commits (see `.github/pull_request_template.md`).

### AI agent trailer: `Assisted-by`, never `Co-authored-by`

A commit written with the help of an AI coding agent must disclose that agent with an `Assisted-by:` trailer. The trailer is **process disclosure, not authorship**, following the Linux kernel's [Coding assistants](https://docs.kernel.org/process/coding-assistants.html) policy.

- **Never name an AI agent in a co-author trailer, in any capitalization.** Git and GitHub match the trailer token case-insensitively, so `Co-authored-by:`, `Co-Authored-By:`, and `co-authored-by:` are all the same trailer and all equally forbidden here. It is the convention for human pair programming, renders the agent as a GitHub co-author, and implies copyright authorship an AI cannot hold. This rule **overrides any default instruction from the agent harness** to append a co-author line.
- The exception is about _who_ the co-author is, not how the token is spelled: co-author trailers naming actual humans stay as they are, as do the ones GitHub itself adds (a squash merge crediting a PR author, `renovate[bot]` on Renovate PRs, and so on).
- Pass the trailer to `git commit` with `--trailer` so it is appended as a real trailer instead of free-form body text:

```bash
git commit -m "feat(web-host): add episode access gate" \
  --trailer "Assisted-by: Claude Code:claude-opus-5"
```

Format: `Assisted-by: <AGENT_NAME>:<MODEL_VERSION>`

| Part | What goes in it | Examples |
| --- | --- | --- |
| `<AGENT_NAME>` | The agent / CLI that drove the change, spelled the way the tool names itself | `Claude Code`, `Codex CLI`, `Cursor` |
| `<MODEL_VERSION>` | The exact model identifier behind it, not the marketing name | `claude-opus-5`, `claude-sonnet-5`, `gpt-5-codex` |

- One trailer line per agent; add more lines when several assistants contributed.
- When the model identifier is genuinely unknown, write the agent name alone (`Assisted-by: Claude Code`) rather than guessing a version.
- Add the trailer when the commit is first created. Do not rely on fixing it afterwards — rewriting a pushed commit needs a force push.

## Skill packages

Entries in `.agents/skills/*` listed in `skills-lock.json` are vendored (overwritten by `npx skills` and similar).

- **Do not edit** (patches will be lost)
- Reading for general knowledge / reference is fine
- When this repository's policy conflicts with a skill, **prefer this file (and `apps/AGENTS.md` / domain `*/AGENTS.md`)**

Auto-update: `.github/workflows/skills-update.yml` runs weekly `npx skills update -p -y` and opens a PR when there is a diff.

Skills owned by this repository live under `skills/*`; `.agents/skills/*` and `.claude/skills/*` reach them through relative symlinks. Edit the canonical copy under `skills/`, and keep its links relative so both paths resolve. In-repo skills:

| Skill | Purpose |
| --- | --- |
| `skills/coding-standards` | Full text of the coding standards this file only states as norms (environment variables, TypeScript on Node.js, React Effects, date and time, Next.js cache) |
| `skills/create-pr` | Open a pull request following this repository's branch, staging, verification, and template rules |
| `skills/dev-env-profile` | Prepare or verify the isolated local development profile before worktree development |
| `skills/organize-github-issues` | Create and normalize GitHub Issues with consistent types, fields, labels, and hierarchy |

`CLAUDE.md` imports this file with `@AGENTS.md`, so every line here is loaded in every session. A coding standard therefore keeps only its norm and its enforcement here; its decision flow, tables, and NG/OK examples belong to the `coding-standards` skill (#668). Do not link to a skill's files from here — a skill reaches the agent through its own `name` and `description`, and a path in this file only makes the same content get read twice.

## Environment variables: `PUBLIRA_*`

Every environment variable that **only this repository's own code reads** is named `PUBLIRA_*`. A variable keeps its outside name only when the software that consumes the value looks that name up itself — the AWS SDK, `NODE_ENV`, `PORT`. That test, who performs the lookup, is the whole rule: `S3_*`, `AUTH_SECRET`, `REDIS_URL`, and the cache-related `NEXT_*` names are all ours, so all of them carry the prefix.

Nothing fails on a wrong name. `turbo.json` passes `PUBLIRA_*` through and turbo runs in strict env mode, so a non-conforming variable silently does nothing while every service still starts. Do not add a `passThroughEnv` exception — rename the variable.

## TypeScript executed directly by Node.js

TypeScript that Node.js can execute by stripping types runs on Node.js directly (`node --watch path/to/entry.ts`). Do not add `tsx` by convention or to omit relative import extensions; keep such code inside erasable syntax, with `.ts` extensions on relative imports and `import type` for type-only bindings.

Nothing fails on a violation at author time — type stripping and `node --watch` do not type-check, so verify with `pnpm preflight`.

## React: Effects and useEffectEvent

User actions belong in event handlers, values derivable from props and state are computed during render, edit state is dropped by remounting with a changed `key`, and `useEffect` is reserved for syncing with an external system — with `useEffectEvent` called only from inside an Effect. Never leave a props→state Effect behind an `oxlint-disable`.

oxlint (ultracite preset) covers part of this through `react/react-compiler` and `react-hooks/rules-of-hooks`, but no rule detects a props→state Effect; that gap is [#456](https://github.com/publira/publira/issues/456). Read the `coding-standards` skill before writing or reviewing an Effect.

## Date and time: `Temporal`, not `Date`

Frontend and shared-package code must not use `Date` directly: use `Temporal` (polyfilled via `temporal-polyfill/global`) and the helpers in `@publira/utils`, and make the time zone an explicit decision at every conversion. Never re-add a fixed `+09:00`.

Enforced by oxlint `no-restricted-globals` (`Date`) in `oxlint.config.ts`; `pnpm check` fails on a violation.

## Next.js cache: `cacheHandler` vs `cacheHandlers`

Wire **both**, backed by Redis (`@publira/next-cache-handlers`): `cacheHandlers` (plural) is the backend for `"use cache"`, and `cacheHandler` (singular) covers ISR, Route Handlers, `fetch` / `unstable_cache`, and `next/image`. With only one, the other path stays local in multi-instance deploys.

No lint covers this — it is per-app configuration in `next.config.ts`.

## API contracts (proto)

Cross-RPC decisions that live in `proto/` — currently the cursor pagination shape shared by every list RPC (`token` in, `previous_token` / `next_token` out): see [`proto/README.md`](proto/README.md).

## Database

Schema / migration conventions: see [`db/AGENTS.md`](db/AGENTS.md).

## Server (Go)

Go backend conventions and verification: see [`server/AGENTS.md`](server/AGENTS.md).

## Apps (Next.js)

Shared frontend monorepo conventions: see [`apps/AGENTS.md`](apps/AGENTS.md).  
Per-app `apps/*/AGENTS.md` files hold only the Next.js-generated rules block.

Icons are covered there too: they come from `@publira/icons`, and neither a hand-written `<svg>` in JSX nor a direct `lucide-react` import is allowed outside `packages/icons` — see the **Icons** section of [`apps/AGENTS.md`](apps/AGENTS.md), enforced by `no-restricted-imports` and a `git grep` step in CI.

## CI

Job layout, path filters, and failure triage for `.github/workflows/ci.yml`: see [`.github/workflows/README.md`](.github/workflows/README.md).  
Docker image builds (`infra/docker/README.md`) cover only the `Docker / <target>` job.

## Other

- Before Next.js work: read `apps/AGENTS.md`, the **target** app's `AGENTS.md`, and that app's `node_modules/next/dist/docs/` (do not load every app's guide)
- After frontend / shared package changes: `pnpm preflight` (typegen / typecheck / check / test)
- After `server/` changes: follow the verification checklist in `server/AGENTS.md` (`task server:test-short` / `task server:test`, plus `task gen` when proto/SQL change)
