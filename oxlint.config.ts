import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import jsPlugins from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, next, jsPlugins, nextJsPlugins],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/src/gen/**",
    ".agents/skills/**",
  ],
  overrides: [
    {
      // Generated protobuf re-exports intentionally use `export *`.
      files: ["packages/api-client/src/**/*.{ts,tsx}"],
      rules: {
        "sonarjs/no-wildcard-import": "off",
      },
    },
    {
      /**
       * `Date` exemptions. Two kinds, both narrow:
       *
       * 1. An external API is typed `Date` and will not take an instant —
       *    cookie `expires`.
       * 2. Epoch-millisecond arithmetic against an interface that defines its
       *    timestamps that way (the Next.js cache handler's TTLs). `Date.now()`
       *    carries no zone or wall-clock semantics, so the hazard the rule
       *    exists for does not apply.
       *
       * Listed per file, not per package, so a new file in these packages is
       * still covered. Adding a path is a deliberate decision and needs the
       * reason recorded here; "Temporal was inconvenient" is not one.
       *
       * `packages/web-session/src/index.ts` also parses an RFC3339 expiry with
       * `Date.parse`, which is not a boundary and should move to Temporal —
       * it needs the polyfill wired into that package first. See AGENTS.md
       * "Date and time".
       */
      files: [
        // Sets cookie `expires`, typed `Date` by the Next.js cookie API.
        "packages/web-session/src/index.ts",
        "packages/web-session/src/index.test.ts",
        // Cache entry TTL / revalidation timestamps are epoch millis.
        "packages/next-cache-handlers/src/use-cache-handler.ts",
        "packages/next-cache-handlers/src/incremental-cache-handler.ts",
        "packages/next-cache-handlers/src/handlers.integration.test.ts",
        // Login responses become the session cookie's `expires`.
        "apps/*/lib/auth.ts",
        "apps/*/lib/auth.test.ts",
        "apps/web-admin/lib/admin-auth.ts",
        // Cookie clearing uses `new Date(0)`.
        "apps/*/app/**/logout/route.ts",
        "apps/web-host/app/**/settings/page.tsx",
      ],
      rules: {
        "no-restricted-globals": "off",
      },
    },
  ],
  rules: {
    // Monorepo test names use `*.integration.test.ts` etc.
    "github/filenames-match-regex": "off",
    /**
     * Date/time must go through Temporal (`@publira/utils`), not `Date`.
     * `new Date(str)` reads zone-less input in the host zone and `getTime()`
     * comparisons hide that, so the same value means different instants per
     * browser and per server. See AGENTS.md "Date and time" (#575).
     */
    "no-restricted-globals": [
      "error",
      {
        // Also catches `globalThis.Date` / `window.Date` / `self.Date`, which
        // the bare `name` form lets through.
        checkGlobalObject: true,
        globals: [
          {
            message:
              "Use Temporal and the @publira/utils date helpers instead of Date (see AGENTS.md). Only modules feeding an external API that requires a Date are exempt, via an oxlint.config.ts override.",
            name: "Date",
          },
        ],
      },
    ],
    // Fires on non-route modules whose path/name contains "page".
    "react-doctor/nextjs-missing-metadata": "off",
    // Large form/workspace components are known debt; not for this enablement.
    "react-doctor/no-giant-component": "off",
    // React Compiler is not enabled in next.config; keep useCallback intentional.
    "react-doctor/react-compiler-no-manual-memoization": "off",
    // Complexity gates are valuable but need dedicated refactors; enable later.
    "sonarjs/cognitive-complexity": "off",
    // Complexity gates are valuable but need dedicated refactors; enable later.
    "sonarjs/expression-complexity": "off",
    // React components use PascalCase; sonarjs only allows camelCase.
    "sonarjs/function-name": "off",
    // Domain unions routinely have 3+ members (status, role, tab keys, …).
    "sonarjs/max-union-size": "off",
    // Repeated Japanese UI/error strings are normal; threshold is too noisy.
    "sonarjs/no-duplicate-string": "off",
    // Flags Japanese UI copy that merely mentions パスワード (false positives).
    "sonarjs/no-hardcoded-passwords": "off",
    // TypeScript optional fields and API shapes use undefined, not null.
    "sonarjs/no-undefined-assignment": "off",
    // Complexity gates are valuable but need dedicated refactors; enable later.
    "sonarjs/too-many-break-or-continue-in-loop": "off",
  },
});
