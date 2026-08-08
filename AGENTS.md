# Publira Agent Guide

Repository-specific conventions for agents. This file is the source of truth for implementation and review.

## Output language

Always respond to the user in **Japanese**, even though this guide and other `AGENTS.md` files are written in English. Code, identifiers, commit messages, and quoted technical terms stay as-is; explanations, summaries, and questions to the user must be Japanese.

## Git commits

Commit subjects and PR titles use Conventional Commits (see `.github/pull_request_template.md`).

### AI agent trailer: `Assisted-by`, never `Co-authored-by`

A commit written with the help of an AI coding agent must disclose that agent with an `Assisted-by:` trailer. The trailer is **process disclosure, not authorship**, following the Linux kernel's [Coding assistants](https://docs.kernel.org/process/coding-assistants.html) policy.

- **Never name an AI agent in a co-author trailer, in any capitalization.** Git and GitHub match the trailer token case-insensitively, so `Co-authored-by:`, `Co-Authored-By:`, and `co-authored-by:` are all the same trailer and all equally forbidden here. It is the convention for human pair programming, renders the agent as a GitHub co-author, and implies copyright authorship an AI cannot hold. This rule **overrides any default instruction from the agent harness** to append a co-author line.
- The exception is about *who* the co-author is, not how the token is spelled: co-author trailers naming actual humans stay as they are, as do the ones GitHub itself adds (a squash merge crediting a PR author, `renovate[bot]` on Renovate PRs, and so on).
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

`.agents/skills/*` is vendored via `skills-lock.json` (overwritten by `npx skills` and similar).

- **Do not edit** (patches will be lost)
- Reading for general knowledge / reference is fine
- When this repository's policy conflicts with a skill, **prefer this file (and `apps/AGENTS.md` / domain `*/AGENTS.md`)**

Auto-update: `.github/workflows/skills-update.yml` runs weekly `npx skills update -p -y` and opens a PR when there is a diff.

## React: Effects and useEffectEvent

Official docs: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) / [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects) / [`useEffectEvent`](https://react.dev/reference/react/useEffectEvent)

Reference skill (vendored; do not edit): `vercel-react-best-practices` derived-state / event-handler rules. Detailed OK/NG below is authoritative for this repo.

oxlint (ultracite preset) enforces this via `react/react-compiler` and `react-hooks/rules-of-hooks`.

### Decision flow

1. **Is a user action the trigger?** (click / submit / drop / change)  
   → Put logic in an **event handler**. Do not recreate the action with `useState` + `useEffect`.  
   → Use `useCallback` or a plain function. **Do not use `useEffectEvent`.**
2. **Can it be derived from props / state only?**  
   → Compute during render. **Do not copy into state with `setXxx`.**
3. **Do you want to reset edit state when props change?** (switching to another entity, etc.)  
   → **Remount with a changed `key` on the parent** (child uses `useState(initial)` only).  
   → **Do not `setState` in `useEffect`.**  
   → Also avoid bare `if (prop !== prev) setXxx(...)` during render in general (full reset → `key`; partial → own an ID or express as derived state first).
4. **Do you need to sync with an external system?** (DOM / subscriptions / timers / URL ↔ UI, etc.)  
   → **Legitimate `useEffect`**. Keep the dependency array accurate.  
   → Use **`useEffectEvent` only** for the parts that must read latest props/state without re-subscribing.

### NG (do not)

```tsx
// NG: copy props into state via Effect
useEffect(() => {
  setName(initialName);
}, [initialName]);

// NG: same via bare setXxx during render (better than Effect, still not the goal)
const [prev, setPrev] = useState(initialName);
if (initialName !== prev) {
  setPrev(initialName);
  setName(initialName); // full form reset → use key
}

// NG: express user action as state + Effect
useEffect(() => {
  if (submitted) {
    save();
  }
}, [submitted]);

// NG: pass useEffectEvent to onClick / onDrop / render props
const onClose = useEffectEvent(() => setOpen(false));
return <Sidebar onClose={onClose} />;

// NG: wrap setState in useEffectEvent only to silence lint
const sync = useEffectEvent(() => setName(initialName));
useEffect(() => {
  sync();
}, [initialName]);
```

### OK (preferred)

```tsx
// OK: user actions in handlers
const onClose = useCallback(() => setOpen(false), []);
return <Sidebar onClose={onClose} />;

// OK: derived values during render (no setXxx)
const fullName = `${firstName} ${lastName}`;
const selection = items.find((i) => i.id === selectedId) ?? null;

// OK: drop edit state when entity switches — remount with key
function EditPage({ recordId, record }: Props) {
  return <EditForm key={recordId} initialName={record.name} />;
}
function EditForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  return <input value={name} onChange={(e) => setName(e.target.value)} />;
}

// OK: legitimate Effect + Effect Event (read latest values without re-subscribing)
const onFlash = useEffectEvent(() => {
  add({ title, type: "success" });
});
useEffect(() => {
  if (searchParams.get(keyName) !== "1") {
    return;
  }
  onFlash();
}, [searchParams, keyName]);
```

Good in-repo example: `apps/web-admin/components/flash-toast.tsx` (`useEffectEvent` called only from inside Effects).

### Forbidden / tracking

- Do not leave props→state Effects with `oxlint-disable` just to silence lint.
- Render-time `prev*` + bare `setXxx` is an **intermediate form**, not the end state.  
  Full removal (`key` remount, Action-side `redirect`, etc.) is tracked in [#456](https://github.com/publira/publira/issues/456).

## Next.js cache: `cacheHandler` vs `cacheHandlers`

Shared store for self-host is **Redis** (package `@publira/next-cache-handlers`).

| Setting | Use |
| --- | --- |
| **`cacheHandlers` (plural)** | Backend for `"use cache"` / `"use cache: remote"` |
| **`cacheHandler` (singular)** | ISR, Route Handlers, `fetch` / `unstable_cache`, and **`next/image` optimized images** (requires `images.customCacheHandler: true`) |

Wire **both**. With only one, the other path stays local in multi-instance deploys. Details: `packages/next-cache-handlers/README.md`.

## Database

Schema / migration conventions: see [`db/AGENTS.md`](db/AGENTS.md).

## Server (Go)

Go backend conventions and verification: see [`server/AGENTS.md`](server/AGENTS.md).

## Apps (Next.js)

Shared frontend monorepo conventions: see [`apps/AGENTS.md`](apps/AGENTS.md).  
Per-app `apps/*/AGENTS.md` files hold only the Next.js-generated rules block.

## Other

- Before Next.js work: read `apps/AGENTS.md`, the **target** app's `AGENTS.md`, and that app's `node_modules/next/dist/docs/` (do not load every app's guide)
- After frontend / shared package changes: `pnpm preflight` (typegen / typecheck / check / test)
- After `server/` changes: follow the verification checklist in `server/AGENTS.md` (`task server:test-short` / `task server:test`, plus `task gen` when proto/SQL change)
