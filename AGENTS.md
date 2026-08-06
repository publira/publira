# Publira Agent Guide

エージェント向けの**リポジトリ固有**の規約です。実装・レビュー時の正本はここです。

## スキルパッケージについて

`.agents/skills/*` は `skills-lock.json` 経由で外部から取り込む成果物です（`npx skills` 等で上書きされる）。

- **編集しない**（パッチは消える）
- 一般知識・参考として読むのは可
- このリポジトリの方針と食い違う場合は **本ファイル（および app 配下の `AGENTS.md`）を優先**

自動更新: `.github/workflows/skills-update.yml` が週次で `npx skills update -p -y` を実行し、差分があれば PR を開きます。

## React: Effect と useEffectEvent

公式: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) / [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects) / [`useEffectEvent`](https://react.dev/reference/react/useEffectEvent)

参考スキル（上書き対象・編集禁止）: `vercel-react-best-practices` の derived-state / event-handler 系ルール。詳細な OK/NG は下記を正とする。

このリポジトリでは oxlint（ultracite プリセット）の `react/react-compiler` と `react-hooks/rules-of-hooks` が上記方針を機械的に強制します。

### 判断フロー

1. **ユーザー操作が起点か？**（click / submit / drop / change）  
   → **イベントハンドラ**に書く。`useState` + `useEffect` で「操作を再現」しない。  
   → `useCallback` や通常の関数。**`useEffectEvent` は使わない**。
2. **props / state から計算できるだけか？**  
   → レンダー中に算出する。**state にコピーして `setXxx` しない**。
3. **props 変更で編集中 state をリセットしたいか？**（別エンティティの編集に切り替わる等）  
   → **親で `key` を変えて載せ替える**（子は `useState(initial)` だけ）。  
   → **`useEffect` で `setState` しない**。  
   → レンダー中に `if (prop !== prev) setXxx(...)` するのも原則避ける（全リセットなら `key`、一部だけなら ID を持つ・派生で表せないか先に検討）。
4. **外部システムとの同期が必要か？**（DOM / 購読 / タイマー / URL と UI の同期など）  
   → **正当な `useEffect`**。依存配列は正確に。  
   → その中で「最新 props/state は読みたいが、それで再購読したくない」部分だけ **`useEffectEvent`**。

### NG（やらない）

```tsx
// NG: props を Effect で state に写す
useEffect(() => {
  setName(initialName);
}, [initialName]);

// NG: 同上をレンダー中の裸の setXxx でやる（Effect よりマシだが本筋ではない）
const [prev, setPrev] = useState(initialName);
if (initialName !== prev) {
  setPrev(initialName);
  setName(initialName); // フォーム丸ごとリセットなら key を使う
}

// NG: ユーザー操作を state + Effect で表現する
useEffect(() => {
  if (submitted) {
    save();
  }
}, [submitted]);

// NG: useEffectEvent を onClick / onDrop / render props に渡す
const onClose = useEffectEvent(() => setOpen(false));
return <Sidebar onClose={onClose} />;

// NG: setState を「免罪」するために useEffectEvent で包むだけ
const sync = useEffectEvent(() => setName(initialName));
useEffect(() => {
  sync();
}, [initialName]);
```

### OK（推奨）

```tsx
// OK: ユーザー操作はハンドラへ
const onClose = useCallback(() => setOpen(false), []);
return <Sidebar onClose={onClose} />;

// OK: 派生値はレンダー中（setXxx 不要）
const fullName = `${firstName} ${lastName}`;
const selection = items.find((i) => i.id === selectedId) ?? null;

// OK: エンティティ切り替えで編集 state を捨てる — key で載せ替え
function EditPage({ recordId, record }: Props) {
  return <EditForm key={recordId} initialName={record.name} />;
}
function EditForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  return <input value={name} onChange={(e) => setName(e.target.value)} />;
}

// OK: 正当な Effect + Effect Event（最新値を読みつつ再購読しない）
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

リポジトリ内の良い例: `apps/web-admin/components/flash-toast.tsx`（`useEffectEvent` は Effect 内からのみ呼び出し）。

### 禁止・追跡

- lint を黙らせるために `oxlint-disable` で props→state の Effect を残さない。
- レンダー中の `prev*` + 裸の `setXxx` は **中間形**でありゴールではない。  
  本廃止（`key` 載せ替え・Action 側 `redirect` 等）は [#456](https://github.com/publira/publira/issues/456)。

## Next.js キャッシュ: `cacheHandler` vs `cacheHandlers`

self-host の共有ストアは **Redis**（パッケージ `@publira/next-cache-handlers`）。

| 設定 | 用途 |
| --- | --- |
| **`cacheHandlers`（複数形）** | `"use cache"` / `"use cache: remote"` のバックエンド |
| **`cacheHandler`（単数）** | ISR・Route Handler・`fetch` / `unstable_cache`、および **`next/image` 最適化画像**（要 `images.customCacheHandler: true`） |

両方を配線すること。片方だけだと multi-instance で片系統がローカルのまま残る。詳細は `packages/next-cache-handlers/README.md`。

## その他

- Next.js 作業前: 各 app の `AGENTS.md` / `node_modules/next/dist/docs/` を確認する
- 変更後の品質確認: `pnpm preflight`（typegen / typecheck / check / test）
