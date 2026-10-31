# Publira Agent Guide

Repository-specific conventions for agents. This file is the source of truth for implementation and review.

## Output language

Respond to the user in the language they wrote in, even though this guide and the rest of this repository's documentation are written in English. A Japanese message is answered in Japanese, an English one in English. Publira is open source, so a contributor working here is not necessarily a Japanese reader, and a fixed response language would hand them a terminal they cannot read.

Judge the language from the user's own prose, not from what the prompt quotes: a log line, an error message, a UI string, or a snippet of code pasted into an English question does not make the question Japanese. A message that carries no prose of its own — a bare paste of a log, a diff, or a stack trace — keeps the language the conversation is already in.

Respond in **English** whenever no user prose has settled the language: a run with no user message at all (a scheduled run, an agent started from CI, an autonomous loop), and a first message that is nothing but quoted output. This repository's own documentation is English, and there is no way to know who reads such a transcript.

Code, identifiers, commit messages, and quoted technical terms stay as-is in either direction; only the explanations, summaries, and questions to the user follow the user's language.

## Documentation, test labels, and GitHub Issues: English

Every Markdown document this repository owns — every `README.md` and `AGENTS.md`, the skills under `skills/`, the pull request template — is written in English, and so are the labels of automated tests: the first argument of Vitest's `describe` / `it`, Playwright's `test` / `test.describe`, Go's `t.Run`, and Flutter's `test` / `group` / `testWidgets`. None of them is kept in a second language: there is no `*.ja.md` or other translated copy anywhere, because a translation nothing checks drifts from its original without anyone noticing.

The user documentation is the one exception, because it is the one translation something checks. `docs/<locale>/` beside `docs/en/` is the documentation in that locale, translated from `docs/en/` and mirroring it page for page; each translated page records the date of the English page it was brought in line with, and a pull request that changes an English page in a way a reader should notice brings its translations in line in the same pull request. `pnpm docs:check` fails on a page missing from either tree and on a translation behind its English page, which is what keeps it from drifting. **Languages** in [`docs/README.md`](docs/README.md#languages) states the rule.

Outside `docs/<locale>/`, Japanese survives only where it is quoted as code rather than written as prose: a UI string inside a code example, and the values in `locales/*.json`. Prose that names a screen element uses its English label — the UI ships `locales/en.json`, so a Japanese label is not a string an English reader can find on screen. Take the wording from `locales/en.json`, or describe the element in English when that screen has no English copy yet. Identifiers, API names, paths, and environment variable names are never translated in either direction.

Test fixtures, development seed rows, and the copy a test asserts are English as well. Non-English text belongs in a test only when the handling of that text is the behaviour under test, which is two cases: a scenario that switches locale, where the Japanese side of the comparison is what proves the screen changed language, and a test of how non-ASCII text is processed — width, collation, normalization, truncation. Everywhere else the language is incidental: the test asserts whatever copy the UI happened to render, and a fixture a contributor cannot type is a test they cannot extend.

No lint covers this. A Japanese README, test label, fixture, or seed row that predates the rule is a leftover, not a precedent: rewrite it in English rather than matching it.

GitHub Issues are written in English too, title and body alike, whether you are filing a new one or rewriting an existing one while triaging. An Issue outlives the session that produced it and is read from a search result or a link by contributors who never saw that conversation, so a Japanese body closes the backlog to exactly the readers this documentation is written for. The user's language governs the replies inside a session and nothing else: what is filed on GitHub — Issue, pull request, commit message — is English.

## Issue references in documentation and code comments

Long-lived documentation — every `AGENTS.md` and `README.md`, and the skills under `skills/` — states its rules and the reasons behind them, and does not cite the Issue it came out of. Such a citation is added every time an Issue is handled, so it accumulates into noise, and it goes stale the moment the work behind it lands. Provenance belongs in the pull request body and the commit message (`Fixes #NNN`), which are a correct snapshot of their moment and are never rewritten afterwards.

A code comment is held to the same rule, for the same reason: what a comment explains is the decision, and the decision does not need a citation. Reword the surrounding sentence so it still reads as an explanation once the number is gone.

A reference to an **open** Issue naming something still to be done — a defect not fixed yet, a lint rule that does not exist yet — stays, because "this is not solved" is information the reader needs; it is the same allowance a TODO comment gets in code. The test is therefore the Issue's state, not the shape of the number, and closing such an Issue includes deleting the reference and whatever sentence was written around it. An issue in another repository (`vercel/next.js#62046`), a non-Issue `#` such as `UTS #35`, and a number shown as an example of a format are not references of this kind.

A comment inside `db/migrations/` keeps whatever it cites. Those files are append-only and CI rejects any edit to one, so the rule cannot reach them and a sweep stops at that directory.

No lint covers this: `git grep` cannot tell an open Issue from a closed one, and a scheduled job asking the GitHub API about every number in every file would cost more upkeep than the rule is worth.

## What a README holds

A `README.md` is reference: what the thing is, what it exports or serves, the environment variables it reads, how to run it, and how its parts fit together. Anything else a README says about the implementation is a second copy of something that has a home closer to the code, and the copy a reader reaches first is the one furthest from what it describes.

Reasoning about one identified code site — why a value is what it is, what a naive alternative would break, what was measured — belongs in a doc comment at that site, where whoever changes the value next reads it.

A behaviour a reader is expected to be able to rely on belongs in a test: a unit test, or an E2E test when the behaviour spans processes. A manual verification procedure written into a README is a test that has not been written yet; write the test and delete the procedure.

A passage that a doc comment or a test already carries is deleted outright rather than moved.

No lint covers this — no tool can tell reference from reasoning. A README section that predates the rule is a leftover, not a precedent: move it to the code or the test rather than writing a neighbour for it.

## User documentation: `docs/`

`docs/en/` and its translations beside it hold the pages the website publishes under `/docs/`, and [`docs/README.md`](docs/README.md) is the contract they are read by: the names, the URLs they map to, the frontmatter, the link rules, and how a translation follows `docs/en/`.

A page there is written for a reader with a task — an operator deploying an install, a publisher's staff configuring a site — and is read in order, without the code beside it. Reference for the code beside it stays in that directory's `README.md`: what a package exports, which variables a process reads, how a part is run during development. When both are needed, the page says what to do and why, and links to the README on GitHub for the full reference rather than copying it. A behaviour change that a page describes updates the page, and every translation of it, in the same pull request. Which languages the documentation is written in, and how a translation is kept in step with its English page, is stated under **Languages** in [`docs/README.md`](docs/README.md#languages).

Enforced by `pnpm docs:check`, which `pnpm preflight` and the `Check` job run, for everything but the choice of where a text belongs, which is a review judgement.

Authoring rules for the pages themselves, including when a change bumps a page's `updated` date: see [`docs/AGENTS.md`](docs/AGENTS.md).

## Git commits

### A change spanning the backend and the web apps: one stacked PR per layer

A change that touches both the backend (`proto/`, `db/`, `server/`) and the web apps (`apps/`, `packages/`) is split into one pull request per layer, the backend at the bottom and the frontend stacked on it with `gh stack`, and each layer's pull request closes its own Issue.

A web edit that only follows from the backend change and has no screen of its own is not a layer, and rides in the backend pull request:

- the label of an audit action or target the server now records, in the console and in every `locales/*.json` catalog
- an entry for a new server value in a table the web apps already keep, such as a reason in `@publira/api-client`'s reason table
- the entry that exposes a new service on an `@publira/api-client` client
- a type or a call site re-fitted to code that `task gen` regenerated under it

The code `task gen` writes into `packages/api-client/src/gen/` travels with the `proto/` change it comes from in the same way. Splitting any of these out leaves the backend layer recording something the console cannot name, or failing to compile on its own, and stacks a frontend pull request with no screen behind it. Anything a user sees or operates as new — a screen, a form, a control, a flow that calls the new RPC — is the frontend layer, however small its diff.

No check enforces this; whether a cross-cutting change had to stay atomic, and whether a web edit has a screen of its own, is a review judgement.

The stack is built with `gh stack` (`gh extension install github/gh-stack`, with `git config rerere.enabled true` so a conflict resolved in one layer replays in the layers above): `gh stack init <backend-branch>` adopts the bottom layer, `gh stack add <frontend-branch>` branches the top from it, and `gh stack rebase` and `gh stack push` take the place of `git rebase origin/main` and `git push --force-with-lease`, layer by layer. Stage by path as everywhere else; `gh stack add -Am` stages the whole tree. Where the vendored `gh-stack` skill and this section disagree, this section wins:

- Open each layer with `gh pr create --base <lower-branch>`, not `gh stack submit --auto`, whose drafts take their title and body from a commit or a branch name rather than from the template. Score each layer's diff on its own (`git diff origin/main...<backend-branch>`, `git diff <backend-branch>...<frontend-branch>`).
- `gh stack link <backend-pr> <frontend-pr>` is not optional: a base branch alone does not make the upper pull request part of a stack, and its `CI` run does not start until it is linked. Confirm with `gh stack view --json`.
- A fix belongs to the layer that owns it: check that layer out (`gh stack down`, `gh stack checkout <branch>`), commit there, replay the layers above with `gh stack rebase --upstack`, return with `gh stack top`, push with `gh stack push`.
- Never `gh stack merge` or `gh pr merge`: `main` is merged through its queue, and a linked stack enters it through its top pull request, which merges every layer beneath it. Queueing the bottom first only adds a wait and a second `CI` run, so never suggest it. When a lower layer has landed on its own, `gh stack sync` rebases the rest onto `main` without replaying the merged commits.

### Verification before a push

Run the checks for what changed, from the repository root, and do not push on a red check or describe an unrun command as passing. The commands for each area:

| Changed area | Command |
| --- | --- |
| `apps/`, `packages/`, other TypeScript | `pnpm preflight` (repository checks / typecheck / check / test) |
| `server/` | `task server:test-short`, then `task server:test` before finishing; the checklist is in `server/AGENTS.md` |
| `proto/`, `db/migrations/`, `db/query/`, `sqlc.yaml`, `buf.gen.yaml` | `task gen`, then `sqlc diff` (must be clean), then the server tests again |
| `mobile/` | `task mobile:check` (integration tests need `task mobile:e2e`, Docker, and an Android emulator) |
| `e2e/`, or app behaviour the suite covers | `pnpm preflight`, plus `task e2e` for the suite itself |
| Documentation, skills, workflows only | `pnpm preflight` still catches formatting |

`pnpm preflight` is the quality gate and stays unit-only. The Playwright suite runs through `task e2e`, which owns the whole lifecycle (build, compose up, migrate and seed, start apps, wait for readiness, run, tear down) and exports the ports and `PUBLIRA_DB_URL` the tests need; `task e2e:test` is only for a stack already started. It needs Docker, so a pull request says plainly when it was skipped rather than implying it passed.

### The review-size label: scored by the author

Every pull request carries one `size/*` label saying how much review it is expected to take, and the author sets it on creation from the diff about to be opened:

```bash
git diff origin/main...HEAD | node scripts/pr-size.ts
```

It prints a weighted score and the bucket it falls into (`size/xs` to `size/xl`); the formula and the coefficients are documented in [`.github/workflows/README.md`](.github/workflows/README.md). Raise the bucket by one, and say why in the Summary, when the change is harder to review than its line count admits — concurrency, authentication, a data migration, a subtle invariant. Never lower it: an agent does not get to talk down the review its own work needs.

Enforced as a backstop by the `Review labels` workflow, which scores a pull request that arrives without a `size/*` label and leaves an author's label alone.

### Screenshots of every changed screen

A pull request that changes what a screen looks like or how it is operated carries a picture of each screen it changes, referenced from the body where it belongs — under **Summary** when one picture carries the change, beside the bullet it illustrates under **Changes** — and never below the `Assisted-by` trailer, with alt text that reads as a sentence, because the body becomes the merge commit message where only the alt text remains. The test is the screen, not the directory: a component restructured so that the rendered result moves or is operated differently is a UI change even when the diff reads as internal. A screen of `mobile/` is photographed with `task mobile:screenshot -- <route>`, against the worktree's selected development profile, so that the covers on it are the seeded ones.

No check enforces this; a reviewer asks for the picture.

### Upgrade notes: written in the pull request that makes the change

A pull request that asks something of an operator upgrading to the release that carries it says what, for that operator, in the **Upgrade notes** section of its description: an environment variable added, renamed, or no longer read, a new database role, a change to what the edge has to do, a process or a service an install has to run, a migration that runs long or locks a busy table. What the edge has to do is stated by the contract in `infra/proxy/README.md` and by **What the edge has to do** in `docs/en/2-deployments/4-edge/index.md`; the sample proxy configurations beside the contract are rewritten by every operator for their own edge, so a change to one alone asks nothing. `None.` says it asks nothing. The section is copied into the notes of the release that ships it, and nobody writes those notes at tagging time, so a change the section leaves out reaches operators unannounced.

Enforced by the `Check upgrade notes` job of the `Release notes` workflow for the changes a diff shows mechanically; whether a migration runs long, or a change asks anything at all, is the author's judgement and the reviewer's.

### The `ai-assisted` label: applied by the author

A pull request whose commits carry an `Assisted-by:` trailer carries the `ai-assisted` label too, and whoever opens it applies the label: `gh pr create --label ai-assisted`, or `gh pr edit --add-label ai-assisted` when an agent's commit is pushed onto a pull request opened without one. The trailer remains the disclosure; the label carries it to the pull request list and the notification, where a reviewer decides how to read the diff — an agent's diff is fluent everywhere, including the places it did not understand. The label follows the trailers and nothing else, so it is never set on a pull request whose commits carry none.

The maintenance bot in publira/agents also keeps the label in step with the trailers, adding it and removing it to match, but it is the backstop for a forgotten label and for a contributor without permission to label, not the way the label is meant to arrive. The author already knows what the commits say when the pull request is opened, so the label goes on in that same request instead of spending a bot run on writing it afterwards.

## Skill packages

Entries in `.agents/skills/*` listed in `skills-lock.json` are vendored (overwritten by `npx skills` and similar).

- **Do not edit** (patches will be lost)
- Reading for general knowledge / reference is fine
- When this repository's policy conflicts with a skill, **prefer this file (and `apps/AGENTS.md` / domain `*/AGENTS.md`)**

Auto-update: the maintenance bot in publira/agents runs `npx skills update -p -y` weekly and opens a pull request when there is a diff.

Skills owned by this repository live under `skills/*`; `.agents/skills/*` and `.claude/skills/*` reach them through relative symlinks. Edit the canonical copy under `skills/`, and keep its links relative so both paths resolve. In-repo skills:

| Skill | Purpose |
| --- | --- |
| `skills/coding-standards` | Full text of the coding standards this file only states as norms (environment variables, TypeScript on Node.js, React Effects, date and time, Next.js cache) |
| `skills/dev-env-profile` | Prepare or verify the isolated local development profile before worktree development |
| `skills/organize-github-issues` | Create and normalize GitHub Issues with consistent types, fields, labels, and hierarchy |
| `skills/release` | Cut a release: choose the version, make the release commit, tag it, and check what the `Release notes` workflow published |

`CLAUDE.md` imports this file with `@AGENTS.md`, so every line here is loaded in every session. A coding standard therefore keeps only its norm and its enforcement here; its decision flow, tables, and NG/OK examples belong to the `coding-standards` skill. Do not link to a skill's files from here — a skill reaches the agent through its own `name` and `description`, and a path in this file only makes the same content get read twice.

## A credited creator: `creator` in code, "Author" on screen

The person credited on a work is a `creator` in every identifier: proto messages, RPCs and enum values, Go files and query names, route segments, module names, catalog key namespaces, and test fixtures. The tables are already named that way, and the identifier stays `creator` whichever word the screen ends up showing.

The word on screen is one per locale — 著者 (`ja`), Author (`en`), 작가 (`ko`), 作者 (`zh-Hans` and `zh-Hant`) — and it is the same word on the storefront and in both consoles. クリエイター, 크리에이터, and 创作者 / 創作者 name the same concept a second time, so they are not used.

The writer of a comment is a reader, not one of these, and every locale gives them a word of their own: 投稿者, Commenter, 작성자, 评论者, 留言者. That concept keeps `author` in its identifiers (`Comment.author_public_id`), which is why the two must stay apart in the copy.

No lint covers this. `git grep` cannot tell which of the two senses an `author` belongs to, and the displayed word is a translation judgement in five catalogs.

## Environment variables: `PUBLIRA_*`

Every environment variable that **only this repository's own code reads** is named `PUBLIRA_*`. A variable keeps its outside name only when the software that consumes the value looks that name up itself — the AWS SDK, `NODE_ENV`, `PORT`. That test, who performs the lookup, is the whole rule: `S3_*`, `AUTH_SECRET`, `REDIS_URL`, and the cache-related `NEXT_*` names are all ours, so all of them carry the prefix.

A variable a GitHub Actions workflow declares only for its own step's inline `run:` script, or only for `${{ env.* }}` expressions, is outside the rule and keeps a plain name: nothing else looks it up. So is the version pin of an outside tool a workflow installs, which keeps its `<TOOL>_VERSION` name whether an expression, an action, or a script reads it: it only says which release of someone else's software to fetch. Any other value a program or script the step runs reads from its environment is `PUBLIRA_*` again.

Nothing fails on a wrong name. `turbo.jsonc` passes `PUBLIRA_*` through and turbo runs in strict env mode, so a non-conforming variable silently does nothing while every service still starts. Do not add a `passThroughEnv` exception to keep such a name — rename the variable. An entry there is for a name that is genuinely someone else's, which is why `PORT` has one.

## Package scripts: always through Turborepo

A package script `turbo.jsonc` defines a task for — `build`, `dev`, `test`, `typecheck`, `typegen` — is run through the repository root's script of the same name, as `pnpm <script> --filter <package>` — except `test`, which is spelled `pnpm run test --filter <package>`: `pnpm test` is one of pnpm's own commands, so it parses `--filter` itself and starts the package's script directly instead of handing the flag to the root script. `pnpm --dir <path> <script>` and `pnpm --filter <package> <script>` start that package's script directly, with the task graph switched off, so nothing the task depends on runs first. `build`, `dev`, `test`, `typecheck`, and `typegen` all declare `dependsOn: ["^build"]`, and that dependency is the only thing that builds the `dist/` of the workspace packages an app imports: `pnpm install` does not, and `dist/` is gitignored. Bypassing turbo in a worktree that has never built them therefore starts an app that exits on `Cannot find module '@publira/…/dist/…'`.

Bypassing turbo is for the case where turbo itself is the problem, a local cache that has gone inconsistent, and even then `--force` or discarding `.turbo/cache` comes first and the direct invocation is the last resort. A script turbo defines no task for is outside the rule altogether: `@publira/email-renderer`'s `start`, and `pnpm --dir e2e exec …`, which runs a binary rather than a package script.

Nothing rejects the bypassing spelling. The failure it causes is not a failure of the command that used it either — the package script runs, and only the process it started reports the missing `dist/`, in a log someone has to go and read.

## TypeScript executed directly by Node.js

TypeScript that Node.js can execute by stripping types runs on Node.js directly (`node --watch path/to/entry.ts`). Do not add `tsx` by convention or to omit relative import extensions; keep such code inside erasable syntax, with `.ts` extensions on relative imports and `import type` for type-only bindings.

Nothing fails on a violation at author time — type stripping and `node --watch` do not type-check, so verify with `pnpm preflight`.

## React: Effects and useEffectEvent

User actions belong in event handlers, values derivable from props and state are computed during render, edit state is dropped by remounting with a changed `key`, and `useEffect` is reserved for syncing with an external system — with `useEffectEvent` called only from inside an Effect. Never leave a props→state Effect behind an `oxlint-disable`.

oxlint (ultracite preset) covers part of this through `react/react-compiler` and `react-hooks/rules-of-hooks`, but no rule detects a props→state Effect, and none detects the render-time `prev*` + `setState` that stands in for one. Read the `coding-standards` skill before writing or reviewing an Effect.

## Date and time: `Temporal`, not `Date`

Frontend and shared-package code must not use `Date` directly: use `Temporal` (polyfilled via `temporal-polyfill/global`) and the helpers in `@publira/utils`, and make the time zone an explicit decision at every conversion. Never re-add a fixed `+09:00`.

Enforced by oxlint `no-restricted-globals` (`Date`) in `oxlint.config.ts`; `pnpm check` fails on a violation.

## Next.js cache: `cacheHandler` vs `cacheHandlers`

Wire **both**, backed by Redis (`@publira/next-cache-handlers`): `cacheHandlers` (plural) is the backend for `"use cache"`, and `cacheHandler` (singular) covers ISR, Route Handlers, `fetch` / `unstable_cache`, and `next/image`. With only one, the other path stays local in multi-instance deploys.

No lint covers this — it is per-app configuration in `next.config.ts`.

## Compatibility between adjacent releases

The processes of a release work with those of the release before it, in either direction: the web apps and `publira server` of the two releases call each other, and the previous release's processes keep working on the schema and the roles that the new release's `db migrate` and `db roles` leave. Operators are told they may replace processes one copy at a time, bring up either side first, and roll one back, so a change is designed and reviewed against the newest release tag, not only against the clients released with it: add rather than change, and take two releases to retire anything the release before sends, reads, or queries. A contract that no release tag carries yet changes freely.

How to change an API contract within this is in [`proto/README.md`](proto/README.md#compatibility-with-the-previous-release), a schema in [`db/AGENTS.md`](db/AGENTS.md#a-migration-leaves-the-previous-release-working), and what the server hands the worker in [`server/AGENTS.md`](server/AGENTS.md#the-worker-handles-what-the-previous-server-writes).

Enforced for the shape of `proto/` by `scripts/check-proto-compat.sh`, which runs `buf breaking` against the newest release tag in the `Check` job. Whether a field still means what it meant, and whether the release before still reads a column, an RPC, or an event a change removes, is a review judgement no lint covers.

## API contracts (proto)

Cross-RPC decisions that live in `proto/` — the compatibility a contract change keeps with the previous release, and the cursor pagination shape shared by every list RPC (`token` in, `previous_token` / `next_token` out): see [`proto/README.md`](proto/README.md).

## Database

Schema / migration conventions: see [`db/AGENTS.md`](db/AGENTS.md).

## Server (Go)

Go backend conventions and verification: see [`server/AGENTS.md`](server/AGENTS.md).

## Apps (Next.js)

Shared frontend monorepo conventions: see [`apps/AGENTS.md`](apps/AGENTS.md).  
Per-app `apps/*/AGENTS.md` files hold only the Next.js-generated rules block.

Icons are covered there too: they come from `@publira/icons`, and neither a hand-written `<svg>` in JSX nor a direct `lucide-react` import is allowed outside `packages/icons` — see the **Icons** section of [`apps/AGENTS.md`](apps/AGENTS.md), enforced by `no-restricted-imports` and `pnpm jsx-svg:check`.

So are the design's two radii, its one shadow, and the face data is set in: `rounded-2xl`, `rounded-3xl`, `rounded-[`, `shadow-(sm|md|lg|xl|2xl)`, `uppercase`, `tracking-[`, and a `font-mono` outside a `<code>` or `<pre>` are refused anywhere under `apps/` or `packages/` by `pnpm design-tokens:check`.

## Edge routing

The edge lives in `infra/proxy/` as reverse proxy configuration files, never as Docker labels: labels reach only containers on the same daemon, while the same routing has to run in the Dev Container, in the E2E stack, and in a deployment. [`infra/proxy/README.md`](infra/proxy/README.md) states the contract once and the proxy directories implement it, so a routing change is made there and nowhere else.

`task e2e:routing` runs the contract against every proxy; a change that only one of them satisfies is not finished.

## CI

Job layout, path filters, and failure triage for `.github/workflows/ci.yml`: see [`.github/workflows/README.md`](.github/workflows/README.md).  
Docker image builds (`infra/docker/README.md`) cover only the `Docker / <target>` job.

## Other

- Before Next.js work: read `apps/AGENTS.md`, the **target** app's `AGENTS.md`, and that app's `node_modules/next/dist/docs/` (do not load every app's guide)
- After a change: the verification table under **Git commits**
