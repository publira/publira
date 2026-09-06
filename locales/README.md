# locales

This is the shared message catalog read from the same files by the server (Go), web apps (Next.js), and mobile app (Flutter).

The format is JSON. Every locale has the same set of keys; both missing and extra keys are compilation errors.

## Files

| File | Role |
| --- | --- |
| `index.json` | The sole hand-maintained registry of supported languages, display names, and BCP 47 tags for `Intl` |
| `ja.json` | Japanese catalog |
| `en.json` | English catalog |
| `ko.json` | Korean catalog |

Every leaf must be a string.

```json
{
  "errors": {
    "validation": "入力内容を確認してください。"
  }
}
```

The key `"errors.validation"` refers to the nested `errors.validation`. If a top-level string key has the same name, that exact match takes precedence.

## Message syntax

Leaves use a **simple message** from Unicode MessageFormat 2.0 ([UTS #35 Part 9](https://www.unicode.org/reports/tr35/tr35-messageFormat.html) 48.2, Stable). This is a Unicode standard rather than a vendor-specific format, so Go and Flutter can refer to the same definition when reading a shared catalog.

Only message text, escaping, and variable references are allowed.

| Intent | Syntax | Message text | In JSON |
| --- | --- | --- | --- |
| Insert a value | `{$name}` | `通知、未読{$count}件` | `"通知、未読{$count}件"` |
| A literal brace | `\{` / `\}` | `検索構文は \{query\} です` | `"検索構文は \\{query\\} です"` |
| A literal backslash | `\\` | `C:\\Users` | `"C:\\\\Users"` |

The final two columns differ because backslashes are also escape characters in JSON strings. For every MF2 escape, write two backslashes in the file.

Variable names follow MF2's `name` rule (by convention, use ASCII identifiers such as `{$series_title}`). The name becomes a key in the `Record` passed to `getMessage`.

When no value is passed for a variable, MF2's fallback renders it as `{$name}`. The rest of the message is not lost. `@publira/utils` formats dates and numbers with `formatDateTime` / `formatDate`, which receive the display time zone, then passes the formatted strings as `{$name}` values.

### Implementation

The npm package [`messageformat` v4](https://www.npmjs.com/package/messageformat) parses and formats the syntax. It is maintained by a member of the MessageFormat Working Group, follows the specification as of LDML 48 (2025-10), and can also serve as a polyfill for the TC39 `Intl.MessageFormat` proposal. `@publira/i18n` contains only the catalog-specific policies layered on top of it.

- Convert values to strings before passing them. `getMessage` does not receive a locale, so locale-dependent formatting such as `:number` here would leak the host locale. `@publira/utils` formats numbers and dates first, then inserts the resulting strings
- Bidirectional isolation is disabled. This prevents the formatter from adding bidi controls such as U+2068 / U+2069. Every catalog here is LTR, and these strings can also become email subjects and `<title>` values, so this avoids invisibly transporting those controls. Enable it when adding the first RTL locale

### Unsupported features

Do not use selection (`.match`), functions (`:number` / `:datetime`), markup, or declarations (`.input` / `.local`). `pnpm locales:check` rejects leaves that contain them.

- Functions are not used because MF2 does not know the tenant's display time zone (see “Date and time” in the root `AGENTS.md`). Keep formatting in `@publira/utils`
- Selection is not enabled in the first phase. Enable it in a separate issue when pluralization is actually needed

Consequently, a message cannot begin with `.` (MF2 must distinguish it from a declaration in a complex message). Begin with a word, punctuation, or another symbol instead.

The legacy `{name}` is syntactically valid in MF2 as a **literal expression** and formats to the string `name`. It does not cause an error, so `pnpm locales:check` rejects it as an expression that is not a variable reference.

### Validation

`pnpm locales:check` parses and validates every leaf of every locale with `messageformat`, reporting invalid leaves and leaves that use the unsupported features above along with their keys.

## Reading catalogs

Each screen's issue adds catalog content. This directory only defines its location and format. Web/TypeScript readers do not build dynamic paths; they share a static import map generated from `index.json`.

Put shared copy used across apps (RPC error classifications, form validation summaries, and `searchParamEnum` rejection messages) under `errors.*`. `@publira/i18n/catalog` and `@publira/api-client/error-messages` read it.

Top-level keys are separated by reader. Copy appearing in only one app belongs under that app's namespace.

| Top-level key | Reader |
| --- | --- |
| `errors` | Error copy shared by all three apps |
| `locale` | Display-language switcher UI (shared by `web-platform` and `web-admin`) |
| `email` | Emails rendered by the Go server and `@publira/email-templates` |
| `platform` | Screen copy for `web-platform` (the platform console) |
| `admin` | Screen copy for `web-admin` (the tenant administration console) |
| `host` | Screen copy for `web-host` (the tenant-facing public site) |
| `mobile` | Screen copy for the Flutter app under `mobile/` |

Within an app namespace, separate keys by screen (or a cohesive area). Promote copy to that area's shared section (such as `platform.auth.fields`) only when multiple screens use it.

### TypeScript (`@publira/i18n`)

```ts
import { loadLocaleMessages } from "@publira/i18n/messages";
import type { Locale } from "@publira/i18n";

export const loadCatalog = (locale: Locale) => loadLocaleMessages(locale);
```

Use import attributes (`with { type: "json" }`) for JSON imports in generated files. Do not make the `import()` path a template string. The `ExactCatalog` tests in `@publira/i18n` check the complete root catalog for missing and extra keys.

### Go

```go
//go:embed ja.json en.json ko.json
var files embed.FS

raw, err := files.ReadFile(locale + ".json")
```

The embedded files originate in the repository-root `locales/` directory. The server makes this directory visible from its build context.

### Flutter

The app reads no catalog file at runtime. `scripts/generate-locale-registry.ts` compiles the `mobile` and `errors` namespaces into `mobile/lib/l10n/gen/app_messages.dart`: a typed class whose members are the keys, whose parameters are the `{$name}` placeholders, and whose subclasses are the locales. `messageformat` parses every message during generation, so the app ships no message parser. `pnpm locales:check` fails when that file is behind the catalogs. The Localization section of `mobile/README.md` covers how the app reads it and resolves its locale.

## Adding a key

1. Add the same key to every locale JSON file (do not use an empty string even when a translation is not ready)
2. Run `pnpm locales:generate` when the key is under `mobile` or `errors`, which the Flutter catalog is compiled from
3. Confirm that `pnpm locales:check` passes (it checks that leaves are valid simple messages and that generated files are current)
4. Confirm that `pnpm --filter @publira/i18n typecheck` passes (the `ExactCatalog` tests run from the `packages/i18n` tests)

## Adding a locale

`index.json` is the only hand-maintained list. The TypeScript static import map, the Go allowlist, and the Flutter catalog are generated, so do not edit them individually.

1. Add `<code>.json` to this directory with the same keys as every existing catalog
2. Add `{ "code": "<code>", "label": "…", "intl": "…" }` to `locales` in `index.json`
3. Run `pnpm locales:generate` to update generated files
4. Run `pnpm preflight`, `task server:test-short`, and `task mobile:check`
