# vitest-config

The package that provides the Vitest options shared across the workspace.

## What it provides

- `sharedTestOptions` — the `test` options every package applies

## Usage

```ts
import { sharedTestOptions } from "@publira/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...sharedTestOptions,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

A package keeps its own environment, setup files, and anything else specific to it; only the options that have the same reason in every package live here.

## Notes

- A change here reaches every package's test run, so run `pnpm test` for the whole workspace after one.
