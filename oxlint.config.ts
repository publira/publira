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
      // Cursor pagination helpers must await each page sequentially (token
      // depends on the previous response); parallel Promise.all is wrong there.
      files: ["packages/api-client/src/**/*.{ts,tsx}"],
      rules: {
        "no-await-in-loop": "off",
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
        // Cache entry TTL / revalidation timestamps are epoch millis.
        "packages/next-cache-handlers/src/use-cache-handler.ts",
        "packages/next-cache-handlers/src/incremental-cache-handler.ts",
        "packages/next-cache-handlers/src/handlers.integration.test.ts",
        // Login responses become the session cookie's `expires`.
        "apps/*/lib/auth.ts",
        "apps/*/lib/auth.test.ts",
        "apps/web-admin/lib/admin-auth.ts",
      ],
      rules: {
        "no-restricted-globals": "off",
      },
    },
    {
      /**
       * `prefer-tag-over-role` wants `<output>` wherever `role="status"`
       * appears, and for a form message that swap is the bug: `<output>` is a
       * resettable element, so the reset React runs after a form Action
       * settles replaces its children with a single text node. React keeps
       * rendering into the nodes that reset detached, and every message after
       * the first stops reaching the document. See AGENTS.md
       * "Live regions in a form" (#1070).
       */
      files: ["packages/ui-components/src/form-message/form-message.tsx"],
      rules: {
        "jsx-a11y/prefer-tag-over-role": "off",
      },
    },
    {
      /**
       * `packages/icons` is the one place allowed to touch `lucide-react`: it
       * is the wrapper that gives every icon the same props and the same
       * import path. See AGENTS.md "Icons" (#690).
       */
      files: ["packages/icons/src/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": "off",
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
    /**
     * Icons come from `@publira/icons`, never straight from `lucide-react`.
     * The wrapper is what keeps one icon set, one prop shape, and one import
     * path across the apps. See AGENTS.md "Icons" (#690).
     */
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            message:
              "Import icons from @publira/icons instead of lucide-react. Only packages/icons may wrap lucide, via an oxlint.config.ts override.",
            name: "lucide-react",
          },
        ],
        // `paths` is an exact match, so the deep entry points lucide also
        // publishes (`lucide-react/dist/esm/icons/check`) need a pattern.
        patterns: [
          {
            group: ["lucide-react/**"],
            message:
              "Import icons from @publira/icons instead of lucide-react. Only packages/icons may wrap lucide, via an oxlint.config.ts override.",
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
  settings: {
    /**
     * `portedRuleMode` picks the default options for the ~117 rules React
     * Doctor ported from eslint-plugin-react, jsx-a11y, and react-refresh:
     * `curated` is React Doctor's own lower-noise tuning, anything else is
     * the upstream rule's contract. Up to 0.9.11 the curated tuning was the
     * only behavior; 0.9.12 introduced the switch and made upstream the
     * default, so `curated` is what this repository was already linted under.
     *
     * What the upstream contract breaks here is
     * `react-doctor/only-export-components`, which loses the framework
     * allow-list: every App Router route file becomes an error, because
     * `metadata` / `generateMetadata` / `generateStaticParams` are
     * non-component exports Next.js requires to live in `page.tsx` and
     * `layout.tsx`, and so does every component file that co-locates a
     * constant (`buttonVariants`, the email templates' subject and preview).
     * Those are conventions here, not Fast Refresh hazards.
     */
    "react-doctor": { portedRuleMode: "curated" },
  },
});
