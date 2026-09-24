# tsdown-config

The tsdown plugins shared by the workspace packages that tsdown builds. The modules are TypeScript that `tsdown.config.ts` loads directly, so the package has no build step.

## What it provides

- `@publira/tsdown-config/require-client-directives`: `requireClientDirectives()`, a plugin that fails the build when an emitted chunk holds a module whose source starts with `"use client"` but the chunk does not

## Usage

```ts
import { requireClientDirectives } from "@publira/tsdown-config/require-client-directives";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [requireClientDirectives()],
  unbundle: true,
});
```

A package that ships client components builds with `unbundle: true`, so every source module is emitted as a file of its own and keeps its directive; the plugin catches a configuration that merges one into a chunk.
