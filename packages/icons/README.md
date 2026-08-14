# @publira/icons

フロントエンド共通の SVG アイコンコンポーネントを提供するパッケージです。実体は [`lucide-react`](https://lucide.dev/) の薄いラッパーで、**`lucide-react` を直接 import してよいのはこのパッケージだけ**です。アプリ・他パッケージ側の規約は [`apps/AGENTS.md`](../../apps/AGENTS.md) の Icons を参照してください。

## 提供物

`BellIcon` / `CheckIcon` / `ChevronDownIcon` / `CloseIcon` / `CollectionIcon` / `DashboardIcon` / `ImageIcon` / `MenuIcon` / `SettingsIcon` / `UserIcon`、および props 型の `IconProps`。

`IconProps` は `SVGProps<SVGSVGElement>` そのもので、各コンポーネントは受け取った props をラップ先へ透過します。サイズ・色・`aria-*` は呼び出し側が決めます。

## 使い方

```tsx
// アプリはバレル import
import { ImageIcon, UserIcon } from "@publira/icons";

// packages/ui-components は既存の慣習どおりサブパス import
import { CheckIcon } from "@publira/icons/check-icon";

<UserIcon className="h-6 w-6" />;
```

どちらの形式を使うかは新しい規約ではなく既存の揺れなので、周囲のファイルに合わせてください。

lucide のアイコンは `viewBox="0 0 24 24"` / `strokeWidth={2}` 固定です。サイズはレイアウトに合う `size-*` / `h-* w-*` クラスで指定し、それ以外は lucide の既定のままにしてください。

## アイコンを追加する

lucide にあるアイコンをラップします。必要な変更は 5 箇所で、既存アイコン（`check-icon` など）をそのまま真似れば足ります。

1. **コンポーネント** — `src/<kebab-name>-icon.tsx` を追加する。

   ```tsx
   import { ChevronDown } from "lucide-react";

   import type { IconProps } from "./types";

   export const ChevronDownIcon = (props: IconProps) => (
     <ChevronDown {...props} />
   );
   ```

   命名は既存に合わせて `<Name>Icon`。lucide 側の名前とずらしてよく、むしろずらすべき場合があります（`Image` は `next/image` の `Image` と衝突するため `ImageIcon`、人物アイコンは lucide の `UserRound` を `UserIcon` として公開しています）。

2. **テスト** — `src/<kebab-name>-icon.test.tsx` を追加する。既存テストと同じ 2 ケース（SVG として描画されること、`className` / `width` / `height` / `strokeWidth` が透過されること）で揃えます。ファイル先頭の `// @vitest-environment jsdom` を忘れないでください。

3. **バレル** — `src/index.ts` に `export { XxxIcon } from "./xxx-icon";` を追加する（アルファベット順）。

4. **ビルド entry** — `tsdown.config.ts` の `entry` に `src/xxx-icon.tsx` を追加する。

5. **`exports` サブパス** — `package.json` の `exports` に追加する。

   ```json
   "./xxx-icon": {
     "types": "./dist/xxx-icon.d.mts",
     "default": "./dist/xxx-icon.mjs"
   }
   ```

4 と 5 のどちらかを忘れるとサブパス import だけが壊れ、バレル import では気付けません。追加後はリポジトリルートで `pnpm preflight` を実行してください。

## 手書き SVG を禁止する仕組み

- `lucide-react` の直接 import: `oxlint.config.ts` の `no-restricted-imports` で禁止。`packages/icons/src/**` だけ `overrides` で除外しています。
- JSX への `<svg>` べた書き: CI の `Check` ジョブの `git grep` ステップで検出。

アイコン以外の正当な SVG が必要になった場合は、`.github/workflows/ci.yml` の grep の除外に理由つきで追加します。
