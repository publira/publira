# @publira/icons

The package that provides the SVG icon components shared across the frontend. It is a thin wrapper around [`lucide-react`](https://lucide.dev/), and **this package is the only one allowed to import `lucide-react` directly**. For the rule the apps and the other packages follow, see Icons in [`apps/AGENTS.md`](../../apps/AGENTS.md).

## What it provides

`BellIcon` / `CheckIcon` / `ChevronDownIcon` / `ChevronLeftIcon` / `ChevronRightIcon` / `CloseIcon` / `CollectionIcon` / `DashboardIcon` / `ImageIcon` / `LogoutIcon` / `MaximizeIcon` / `MenuIcon` / `MinimizeIcon` / `SettingsIcon` / `UserIcon`, plus the `IconProps` props type.

`IconProps` is exactly `SVGProps<SVGSVGElement>`, and every component passes the props it receives straight through to the wrapped icon. Size, color, and `aria-*` are the caller's decision.

## Usage

```tsx
// An app imports from the barrel
import { ImageIcon, UserIcon } from "@publira/icons";

// packages/ui-components uses a subpath import, as it already does elsewhere
import { CheckIcon } from "@publira/icons/check-icon";

<UserIcon className="h-6 w-6" />;
```

Which form to use is not a new rule but existing variation, so follow the files around you.

A lucide icon is fixed at `viewBox="0 0 24 24"` and `strokeWidth={2}`. Set the size with the `size-*` / `h-* w-*` classes that fit the layout, and leave everything else at lucide's defaults.

## Adding an icon

Wrap an icon that lucide already has. It takes five changes, and copying an existing icon (`check-icon`, for example) is enough.

1. **The component** — add `src/<kebab-name>-icon.tsx`.

   ```tsx
   import { ChevronDown } from "lucide-react";

   import type { IconProps } from "./types";

   export const ChevronDownIcon = (props: IconProps) => (
     <ChevronDown {...props} />
   );
   ```

   Name it `<Name>Icon`, following the existing icons. The name may differ from lucide's, and sometimes it should: `Image` collides with `next/image`'s `Image`, so it is exported as `ImageIcon`, and the person icon is lucide's `UserRound` exported as `UserIcon`.

2. **The test** — add `src/<kebab-name>-icon.test.tsx`. Match the two cases the existing tests use: that it renders as an SVG, and that `className` / `width` / `height` / `strokeWidth` are passed through. Do not forget the `// @vitest-environment jsdom` on the first line.

3. **The barrel** — add `export { XxxIcon } from "./xxx-icon";` to `src/index.ts` (in alphabetical order).

4. **The build entry** — add `src/xxx-icon.tsx` to `entry` in `tsdown.config.ts`.

5. **The `exports` subpath** — add it to `exports` in `package.json`.

   ```json
   "./xxx-icon": {
     "types": "./dist/xxx-icon.d.mts",
     "default": "./dist/xxx-icon.mjs"
   }
   ```

Forgetting either 4 or 5 breaks only the subpath import, which a barrel import will not reveal. Run `pnpm preflight` at the repository root once you are done.

## How hand-written SVG is kept out

- Importing `lucide-react` directly: forbidden by `no-restricted-imports` in `oxlint.config.ts`, with an `overrides` exemption for `packages/icons/src/**` alone.
- Writing `<svg>` into JSX: caught by the `git grep` step of CI's `Check` job.

If you ever need a legitimate SVG that is not an icon, add it to the grep's exclusions in `.github/workflows/ci.yml` with a reason.
