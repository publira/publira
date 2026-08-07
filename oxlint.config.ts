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
  ],
  rules: {
    // Monorepo test names use `*.integration.test.ts` etc.
    "github/filenames-match-regex": "off",
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
