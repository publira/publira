# React: Effects and useEffectEvent

Official docs: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) / [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects) / [`useEffectEvent`](https://react.dev/reference/react/useEffectEvent)

Reference skill (vendored; do not edit): `vercel-react-best-practices` derived-state / event-handler rules. Detailed OK/NG below is authoritative for this repo.

oxlint (ultracite preset) enforces this via `react/react-compiler` and `react-hooks/rules-of-hooks`.

## Decision flow

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

## NG (do not)

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

## OK (preferred)

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

## Forbidden

- Do not leave props→state Effects with `oxlint-disable` just to silence lint.
- Render-time `prev*` + bare `setXxx` is an **intermediate form**, not the end state. The end state is a `key` remount or an Action-side `redirect`.
