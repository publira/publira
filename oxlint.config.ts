import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import jsPlugins, { jsPluginSettings } from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, next, jsPlugins, nextJsPlugins],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/gen/**",
    ".agents/skills/**",
  ],
  overrides: [
    {
      // These name the address ranges themselves: the proxies a request's
      // forwarded chain is believed from, and the addresses a tenant's server
      // container may not be reached on.
      files: [
        "packages/utils/src/client-address.ts",
        "packages/utils/src/client-address.test.ts",
        "apps/web-storefront/lib/public-address.ts",
        "apps/web-storefront/lib/public-address.test.ts",
      ],
      rules: {
        "sonarjs/no-hardcoded-ip": "off",
      },
    },
    {
      // Cursor pagination helpers must await each page sequentially (token
      // depends on the previous response); parallel Promise.all is wrong there.
      files: ["packages/api-client/src/**/*.{ts,tsx}"],
      rules: {
        "no-await-in-loop": "off",
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
        // Exercises the cookie `expires` boundary above.
        "packages/web-session/src/index.test.ts",
        // Login responses become the session cookie's `expires`.
        "apps/*/lib/auth.ts",
        "apps/*/lib/auth.test.ts",
        // Builds the expiry that `writePublicSessionCookie` hands to the same
        // cookie boundary.
        "apps/web-storefront/lib/auth-session.test.ts",
        // web-admin converts an instant to the cookie API's `Date` here and
        // nowhere else: its API timestamps are parsed with `parseInstant`, and
        // both cookie writers reach the boundary through this one function.
        "apps/web-admin/lib/cookie-expiry.ts",
        // The same boundary in web-platform, for the session cookie the second
        // factor earns and the MFA challenge cookie.
        "apps/web-platform/lib/cookie-expiry.ts",
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
       * the first stops reaching the document. See AGENTS.md "Live regions in
       * a form".
       */
      files: ["packages/ui-components/src/form-message/form-message.tsx"],
      rules: {
        "jsx-a11y/prefer-tag-over-role": "off",
      },
    },
    {
      /**
       * `LOCALE_LANG_SCRIPT` and the Google tag's consent defaults ship as
       * JavaScript source, so the only test that proves anything runs it:
       * asserting on the string would still pass on a script the browser
       * cannot execute. The "dynamic" code is built by the module under test,
       * evaluated in a fresh context against a `document` stub.
       */
      files: [
        "packages/i18n/src/i18n.test.ts",
        "apps/web-storefront/lib/google-tag-scripts.test.ts",
      ],
      rules: {
        "sonarjs/code-eval": "off",
      },
    },
    {
      /**
       * A client error boundary resolves its locale from `document.cookie` —
       * the API holding the setting is unreachable by the time it renders, so
       * there is nothing else left to read. Each test has to put the cookies
       * there the way a browser would; a cookie library would only be testing
       * itself.
       */
      files: ["apps/*/components/error-boundary-message.test.tsx"],
      rules: {
        "unicorn/no-document-cookie": "off",
      },
    },
    {
      /**
       * The locale has to reach `<html lang>` before the browser paints, and a
       * root layout cannot read it: an `<html>` attribute has no child
       * `<Suspense>` boundary a read could move into, so awaiting there
       * settles the whole tree before anything below it can flush. So every
       * root layout renders no locale at all and an inline `<head>` script
       * writes one during parsing, which is the pattern Next.js documents for
       * cookie-driven `<html>` attributes.
       *
       * The injected source is `LOCALE_LANG_SCRIPT` in the cookie consoles and
       * `PATH_LOCALE_LANG_SCRIPT` in `web-storefront`, constants built from
       * `getLocales` and the locale cookie names in `@publira/i18n`. No
       * request-derived value reaches either, and the script writes an
       * attribute rather than markup. See AGENTS.md "UI locale".
       *
       * `web-platform` owns `app/layout.tsx`. `web-admin` rewrites onto
       * `/[tenant_id]/...`, so the same document lives at
       * `app/[tenant_id]/layout.tsx` — one directory deep, which `*` matches
       * without also covering `(protected)/layout.tsx`. `web-storefront` adds
       * the locale segment, which puts its own document one directory deeper
       * still, above the `(site)` and `(auth)` layouts.
       */
      files: [
        "apps/*/app/layout.tsx",
        "apps/web-admin/app/*/layout.tsx",
        "apps/web-storefront/app/*/*/layout.tsx",
      ],
      rules: {
        "react/no-danger": "off",
      },
    },
    {
      /**
       * A schema.org document is the text of a
       * `<script type="application/ld+json">`, and a child string there would
       * be escaped as HTML, which is not JSON any more. So the one component
       * that writes such an element sets its content directly, from
       * `serializeJsonLd` in `lib/json-ld.ts`: `JSON.stringify` output with
       * every `<` escaped, so no value in it, tenant-authored or not, can close
       * the element and add markup.
       */
      files: ["apps/web-storefront/components/json-ld.tsx"],
      rules: {
        "react/no-danger": "off",
      },
    },
    {
      /**
       * The inline half of Google's gtag.js snippet is script by definition,
       * so the loader sets it directly, from `gtagInitScript` in
       * `lib/google-tag-scripts.ts`: the tenant's measurement ID and server
       * container origin, which the API stores only in their fixed formats,
       * written as `JSON.stringify` literals with every `<` escaped.
       */
      files: ["apps/web-storefront/app/*/*/_components/google-tag-loader.tsx"],
      rules: {
        "react/no-danger": "off",
      },
    },
    {
      /**
       * All three apps ship their document with no `lang`, and scripts write
       * one once a locale has been read.
       *
       * Every value the attribute could take needs a read — the operator's
       * cookie and the stored default behind it in the consoles, the URL's
       * locale segment in `web-storefront` — and a root layout that awaits
       * blocks the whole tree. An `<html>` attribute is never worth that, so
       * every root layout stays synchronous and the locale reaches the script
       * from what the browser already has: the two cookies in the consoles
       * (`LOCALE_LANG_SCRIPT`), the path and the proxy-published default in
       * `web-storefront` (`PATH_LOCALE_LANG_SCRIPT`).
       *
       * Until it runs the document names no language, and a document that
       * carries neither source keeps naming none. A `lang` the document is not
       * written in tells a screen reader to pronounce the page in the wrong
       * language, which is worse for the reader this rule protects than an
       * absent one, and it is what AGENTS.md means by not misreporting an
       * unresolved locale as a language.
       */
      files: [
        "apps/web-platform/app/layout.tsx",
        "apps/web-admin/app/*/layout.tsx",
        "apps/web-storefront/app/*/*/layout.tsx",
      ],
      rules: {
        "jsx-a11y/html-has-lang": "off",
        "jsx-a11y/lang": "off",
      },
    },
    {
      /**
       * The locale Action writes a UI preference, not privileged state: it
       * stores one value from `getLocales()` in `publira_locale`, and every read parses that
       * cookie again (`parseLocaleCookie`), so a forged or hand-edited value is
       * discarded rather than reaching application code. Requiring a
       * session would tie a display setting to sign-in without protecting
       * anything. Every other cookie write in these apps stays covered — the
       * override names this one file per app. See apps/AGENTS.md "UI locale".
       */
      files: ["apps/*/lib/locale-action.ts"],
      rules: {
        "react-doctor/server-auth-actions": "off",
      },
    },
    {
      /**
       * `packages/icons` is the one place allowed to touch `lucide-react`: it
       * is the wrapper that gives every icon the same props and the same
       * import path. See AGENTS.md "Icons".
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
     * browser and per server. See AGENTS.md "Date and time".
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
     * path across the apps. See AGENTS.md "Icons".
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
    // Repeated UI and error strings are normal; the threshold is too noisy.
    "sonarjs/no-duplicate-string": "off",
    // Flags UI copy that merely mentions a password (false positives).
    "sonarjs/no-hardcoded-passwords": "off",
    // Without type information, which the JS plugin bridge does not give it,
    // this cannot see that `redirect()` returns `never` or that a switch is
    // exhaustive, and it reports an Effect that returns a cleanup on some paths
    // only. TypeScript already rejects a reachable end in a function whose
    // declared return type excludes undefined.
    "sonarjs/no-inconsistent-returns": "off",
    // TypeScript optional fields and API shapes use undefined, not null.
    "sonarjs/no-undefined-assignment": "off",
    // A compound component's parts are reached through one namespace per
    // subpath (`import * as Dialog from "@publira/ui-components/dialog"`),
    // which is the import this rule refuses.
    "sonarjs/no-wildcard-import": "off",
    // Complexity gates are valuable but need dedicated refactors; enable later.
    "sonarjs/too-many-break-or-continue-in-loop": "off",
  },
  settings: jsPluginSettings,
});
