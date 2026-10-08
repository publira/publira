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
| `zh-Hans.json` | Simplified Chinese catalog |
| `zh-Hant.json` | Traditional Chinese catalog |

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

Leaves are messages in Unicode MessageFormat 2.0 ([UTS #35 Part 9](https://www.unicode.org/reports/tr35/tr35-messageFormat.html) 48.2, Stable). This is a Unicode standard rather than a vendor-specific format, so the web apps, the Go server, and the Flutter app each format the catalog with their own implementation of the same specification.

| Intent | Syntax | Message text | In JSON |
| --- | --- | --- | --- |
| Insert a value | `{$name}` | `{$name}さんのページ` | `"{$name}さんのページ"` |
| Insert a count | `{$count :integer}` | `通知、未読{$count :integer}件` | `"通知、未読{$count :integer}件"` |
| A literal brace | `\{` / `\}` | `検索構文は \{query\} です` | `"検索構文は \\{query\\} です"` |
| A literal backslash | `\\` | `C:\\Users` | `"C:\\\\Users"` |

The final two columns differ because backslashes are also escape characters in JSON strings. For every MF2 escape, write two backslashes in the file.

Variable names follow MF2's `name` rule (by convention, use ASCII identifiers such as `{$series_title}`). The name becomes a key in the `Record` passed to `getMessage`.

When no value is passed for a variable, MF2's fallback renders it as `{$name}`. The rest of the message is not lost.

### Counts

Copy that depends on a number selects a variant with `.match`, on a variable an `.input` declaration gives a numeric function:

```
.input {$count :integer}
.match $count
0   {{No episodes selected.}}
one {{{$count} episode selected.}}
*   {{{$count} episodes selected.}}
```

```json
".input {$count :integer}\n.match $count\n0 {{No episodes selected.}}\none {{{$count} episode selected.}}\n* {{{$count} episodes selected.}}"
```

A key is an exact number or one of the CLDR plural categories of the catalog's own language, and `*` is the catch-all every `.match` needs. English has `one`; Japanese, Korean, and Chinese have no category but the catch-all, so their translation of the same key is usually one pattern with no `.match` at all (`{$count :integer}話を選択中です。`). The choice stays in the message: code that picks between two keys by count (`count === 1 ? "…_one" : "…"`) is right for English and wrong for the next language whose plural rules differ.

A message that is not a `.match` and has no declarations cannot begin with `.`, which starts a declaration. Wrap one that has to in a quoted pattern: `{{.htaccess is ignored}}`.

### Catalog policy

`pnpm locales:check` accepts any valid MF2 message — declarations, selection, and markup included — except for the rules below. They are choices this catalog makes, not limits of a reader.

- **Functions are `:integer`, `:number`, `:offset`, and `:string`.** Any other function is rejected, the date and time functions included. `CATALOG_FUNCTIONS` in `packages/i18n/src/mf2.ts` records why the list is what it is
- **A number is formatted by the message.** A count or any other quantity is passed as a number and written out by `:integer` (or `:number` for a fraction), so the digits a reader sees and the variant `.match` selects come from the same value, in the catalog's locale. A number that is an identifier rather than a quantity, such as a version, is passed as a string. A percentage, a duration, or a byte size needs a function not every reader has, so it arrives formatted, the way a date does
- **A date is formatted before it reaches a message.** `formatDateTime` / `formatDate` from `@publira/utils` on the web and `locale.FormatDateTime` on the server render it against the display time zone, and the message receives the string. Every conversion to a wall clock names its time zone explicitly (see “Date and time” in the root `AGENTS.md`), and keeping the conversion out of the message keeps that decision at the call site
- **A placeholder is never a bare literal.** Write `{$name}` for a variable and `\{` / `\}` for a brace, never the legacy `{name}`. A literal a function takes (`{|1| :integer}`) or a `.local` declares is allowed
- **Every locale reads the same variables.** A translation with no use for a value still reads it, with `.input {$name}`

Markup (`{#strong}…{/strong}`) is valid and formats to nothing: every reader formats a message to a plain string.

### Implementation

The npm package [`messageformat` v4](https://www.npmjs.com/package/messageformat) parses and formats the syntax. It is maintained by a member of the MessageFormat Working Group, follows the specification as of LDML 48 (2025-10), and can also serve as a polyfill for the TC39 `Intl.MessageFormat` proposal. `@publira/i18n` contains only the catalog-specific policies layered on top of it.

- A message is formatted in the locale of the catalog it was read from. `getMessage`, `bindMessages`, and `formatMessage` take that locale and hand MF2 its `intl` tag from `index.json`, so nothing falls back to the host's locale
- A number value stays a number, so `:integer` and `:number` write it, and `.match` selects on it, the way that locale writes and counts numbers: `{$count :integer}` with `12345` is `12,345` in `en`
- Bidirectional isolation is disabled. This prevents the formatter from adding bidi controls such as U+2068 / U+2069. Every catalog here is LTR, and these strings can also become email subjects and `<title>` values, so this avoids invisibly transporting those controls. Enable it when adding the first RTL locale

### Validation

`pnpm locales:check` parses and validates every leaf of every locale with `messageformat`, reports each leaf that is not valid MF2 or breaks the policy above along with its key, and names each key whose locales read different variables.

## Reading catalogs

Each screen's issue adds catalog content. This directory only defines its location and format. Web/TypeScript readers do not build dynamic paths; they share a static import map generated from `index.json`.

Put shared copy used across apps (RPC error classifications, form validation summaries, and `searchParamEnum` rejection messages) under `errors.*`. `@publira/i18n/catalog` and `@publira/api-client/error-messages` read it.

Top-level keys are separated by reader. Copy appearing in only one app belongs under that app's namespace.

| Top-level key | Reader |
| --- | --- |
| `errors` | Error copy shared by all three apps |
| `locale` | Display-language switcher UI (shared by `web-platform` and `web-admin`) |
| `email` | The mail the Go server words and sends, laid out as HTML by `@publira/email-templates` |
| `platform` | Screen copy for `web-platform` (the platform console) |
| `admin` | Screen copy for `web-admin` (the tenant administration console) |
| `host` | Screen copy for `web-host` (the tenant-facing public site) |
| `mobile` | Screen copy for the Flutter app under `mobile/` |

Within an app namespace, separate keys by screen (or a cohesive area). Promote copy to that area's shared section (such as `platform.auth.fields`) only when multiple screens use it.

### TypeScript (`@publira/i18n`)

```ts
import type { Locale } from "@publira/i18n";
import { loadLocaleMessages } from "@publira/i18n/messages";

export const loadCatalog = (locale: Locale) => loadLocaleMessages(locale);
```

Use import attributes (`with { type: "json" }`) for JSON imports in generated files. Do not make the `import()` path a template string. The `ExactCatalog` tests in `@publira/i18n` check the complete root catalog for missing and extra keys.

### Go

The server reads no catalog file at runtime. `scripts/generate-locale-registry.ts` compiles the `email` namespace into `server/internal/locale/gen/messages.go`, which holds every locale's messages as their MessageFormat 2 source, and writes each locale's `intl` tag into `server/internal/locale/gen/locales.go`. `locale.Message` formats a message with [`github.com/kaptinlin/messageformat-go`](https://pkg.go.dev/github.com/kaptinlin/messageformat-go) in that tag. A variable with no value, or any other error the library reports, is an error rather than the fallback text MessageFormat would write in its place.

```go
subject, err := locale.Message(code, "email.reader_password_reset.subject", map[string]any{
	"tenant_name": tenantName,
})
```

The same generator writes `server/internal/locale/gen/datetime.go`, the pattern `Intl.DateTimeFormat` uses at `dateStyle: "medium"` and `timeStyle: "short"` in each locale — its separators, month names, and the hour and day period each hour of the day is written as. `locale.FormatDateTime` renders an instant with it, in the display time zone it is given, so the server words a moment the way the web apps do.

### Flutter

The app reads no catalog file at runtime. `scripts/generate-locale-registry.ts` compiles the `mobile` and `errors` namespaces into `mobile/lib/l10n/gen/app_messages.dart`: a typed class whose members are the keys, whose parameters are the variables of each message, and which holds every locale's messages as their MessageFormat 2 source. Each member formats its source with [`package:messageformat`](https://pub.dev/packages/messageformat) in the catalog's `intl` locale. `pnpm locales:check` fails when that file is behind the catalogs. The Localization section of `mobile/README.md` covers how the app reads it and resolves its locale.

## Adding a key

1. Add the same key to every locale JSON file (do not use an empty string even when a translation is not ready)
2. Run `pnpm locales:generate` when the key is under `email`, `mobile` or `errors`, which the Go and Flutter catalogs are compiled from
3. Confirm that `pnpm locales:check` passes (it checks every leaf against the message syntax and policy above, and that generated files are current)
4. Confirm that `pnpm typecheck --filter @publira/i18n` passes (the `ExactCatalog` tests run from the `packages/i18n` tests)

## Adding a locale

`index.json` is the only hand-maintained list. The TypeScript static import map, the Go allowlist, the Go catalog and date format, and the Flutter catalog are generated, so do not edit them individually.

1. Add `<code>.json` to this directory with the same keys as every existing catalog
2. Add `{ "code": "<code>", "label": "…", "intl": "…" }` to `locales` in `index.json`
3. Run `pnpm locales:generate` to update generated files
4. Run `pnpm preflight`, `task server:test-short`, and `task mobile:check`
