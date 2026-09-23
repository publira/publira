import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/action-form/index.ts",
    "src/badge/index.ts",
    "src/button/index.ts",
    "src/card/index.ts",
    "src/checkbox/index.ts",
    "src/combobox/index.ts",
    "src/dialog/index.ts",
    "src/empty-state/index.ts",
    "src/field/index.ts",
    // Its own entry, so the bundle keeps the `"use client"` directive: a
    // module tsdown merges into a shared chunk loses it, and `Field`'s
    // `useState` then lands in the server graph.
    "src/field/field.tsx",
    "src/figure-line/index.ts",
    "src/form-actions/index.ts",
    "src/form-message/index.ts",
    "src/identifier/index.ts",
    "src/input/index.ts",
    "src/locale-switcher/index.ts",
    "src/offline-notice/index.ts",
    "src/popover/index.ts",
    "src/qr-code/index.ts",
    "src/radio-group/index.ts",
    "src/section-error/index.ts",
    "src/section-error-fallback/index.ts",
    "src/select/index.ts",
    "src/skeleton/index.ts",
    "src/switch/index.ts",
    "src/table/index.ts",
    "src/tabs/index.ts",
    "src/textarea/index.ts",
  ],
  format: "esm",
});
