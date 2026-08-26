import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/errors.ts",
    "src/error-messages.ts",
    "src/pagination.ts",
    "src/public/index.ts",
    "src/public/client.ts",
    "src/public/auth.ts",
    "src/public/catalog.ts",
    "src/public/page.ts",
    "src/public/types.ts",
    "src/admin/index.ts",
    "src/admin/client.ts",
    "src/admin/auth.ts",
    "src/admin/access-ticket.ts",
    "src/admin/series.ts",
    "src/admin/tenant.ts",
    "src/admin/theme.ts",
    "src/admin/types.ts",
    "src/email/renderer.ts",
    "src/platform/client.ts",
    "src/platform/types.ts",
  ],
  format: "esm",
});
