import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// The package is not built when this runs, so the checker comes from source.
// Node strips the types and resolves `messageformat` from the package the file
// lives in.
import { simpleMessageSyntaxError } from "../packages/i18n/src/mf2.ts";
import { renderDartMessages } from "./dart-messages.ts";

const root = path.resolve(import.meta.dirname, "..");
const indexPath = path.resolve(root, "locales/index.json");
const i18nPackagePath = path.resolve(root, "packages/i18n/package.json");
const newline = "\n";
const check = process.argv.at(2) === "--check";
const catalogTypePath = "./src/gen/locale-message-types.d.ts";

const fail = (message: string): never => {
  throw new Error(`Invalid locales/index.json: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const i18nPackage: unknown = JSON.parse(readFileSync(i18nPackagePath, "utf-8"));
const packageExports =
  isRecord(i18nPackage) && isRecord(i18nPackage.exports)
    ? i18nPackage.exports
    : undefined;
const catalogExport =
  packageExports && isRecord(packageExports["./catalog"])
    ? packageExports["./catalog"]
    : undefined;
if (!catalogExport || catalogExport.types !== catalogTypePath) {
  throw new Error(
    `packages/i18n/package.json must export ${catalogTypePath} as the @publira/i18n/catalog type entry`
  );
}

/**
 * Every leaf is a MessageFormat 2 simple message. `@publira/i18n` formats them
 * at render time, so a leaf `messageformat` rejects — or one that reaches for
 * a feature the catalog does not use — would only fail once the screen that
 * shows it renders. Returns the parsed catalog for the generators that read it.
 */
const checkCatalog = (code: string): unknown => {
  const catalogPath = `locales/${code}.json`;
  const catalog: unknown = JSON.parse(
    readFileSync(path.resolve(root, catalogPath), "utf-8")
  );
  const problems: string[] = [];

  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") {
      const problem = simpleMessageSyntaxError(node);
      if (problem) {
        problems.push(`  ${key}: ${problem}`);
      }
      return;
    }

    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      problems.push(`  ${key}: leaves must be strings`);
      return;
    }

    for (const [name, child] of Object.entries(node)) {
      walk(child, key ? `${key}.${name}` : name);
    }
  };

  walk(catalog, "");

  if (problems.length > 0) {
    throw new Error(`Invalid ${catalogPath}:\n${problems.join("\n")}`);
  }

  return catalog;
};

const index: unknown = JSON.parse(readFileSync(indexPath, "utf-8"));
if (
  typeof index !== "object" ||
  index === null ||
  !("locales" in index) ||
  !Array.isArray(index.locales) ||
  index.locales.length === 0
) {
  fail("locales must be a non-empty array");
}

const localeCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const locales = index.locales.map(
  (locale): { code: string; intl: string; label: string } => {
    if (
      typeof locale !== "object" ||
      locale === null ||
      !("code" in locale) ||
      !("intl" in locale) ||
      !("label" in locale) ||
      typeof locale.code !== "string" ||
      !localeCode.test(locale.code) ||
      typeof locale.intl !== "string" ||
      !locale.intl ||
      typeof locale.label !== "string" ||
      !locale.label
    ) {
      return fail("each locale needs a valid code, intl value, and label");
    }

    return locale;
  }
);

const codes = new Set<string>();
const catalogs = new Map<string, unknown>();
for (const locale of locales) {
  if (codes.has(locale.code)) {
    fail(`locale code ${JSON.stringify(locale.code)} is duplicated`);
  }
  codes.add(locale.code);
  if (!existsSync(path.resolve(root, `locales/${locale.code}.json`))) {
    fail(`catalog locales/${locale.code}.json does not exist`);
  }
  catalogs.set(locale.code, checkCatalog(locale.code));
}

const catalogCodes = new Set(
  readdirSync(path.resolve(root, "locales"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((code) => code !== "index")
);
for (const code of codes) {
  catalogCodes.delete(code);
}
if (catalogCodes.size > 0) {
  fail(`catalogs missing from locales: ${[...catalogCodes].join(", ")}`);
}

const quote = (value: string) => JSON.stringify(value);
const imports = locales
  .map(
    ({ code }) =>
      `import ${code} from "../../../../locales/${code}.json" with { type: "json" };`
  )
  .join(newline);
const typeImports = locales
  .map(
    ({ code }) => `import type ${code} from "../../../../locales/${code}.json";`
  )
  .join(newline);
const dynamicImports = locales
  .map(
    ({ code }) =>
      `  ${code}: () => import("../../../../locales/${code}.json", { with: { type: "json" } }),`
  )
  .join(newline);
const catalogTypes = locales.map(({ code }) => `typeof ${code}`).join(" | ");
const codesLiteral = locales.map(({ code }) => quote(code)).join(", ");
const localeDetails = locales
  .map(
    ({ code, intl, label }) =>
      `  ${code}: { intl: ${quote(intl)}, label: ${quote(label)} },`
  )
  .join(newline);
const catalogEntries = locales
  .map(({ code }) => `  ${code}: ${code}MatchesCatalogs,`)
  .join(newline);
const exactCatalogs = locales
  .map(
    ({ code }) =>
      `const ${code}MatchesCatalogs: ExactCatalog<typeof ${code}, LocaleMessages> = ${code};`
  )
  .join(newline);
const goCodes = locales.map(({ code }) => quote(code)).join(", ");
const generatedHeader =
  "// Code generated by scripts/generate-locale-registry.ts; DO NOT EDIT.";

const files = new Map([
  [
    "packages/i18n/src/gen/locale-registry.ts",
    `${generatedHeader}${newline}${newline}const localeCodes = [${codesLiteral}] as const;${newline}${newline}export type Locale = (typeof localeCodes)[number];${newline}${newline}export const getLocales = (): readonly [Locale, ...Locale[]] =>${newline}  [...localeCodes] as [Locale, ...Locale[]];${newline}${newline}const localeDetails = {${newline}${localeDetails}${newline}} as const satisfies Record<Locale, { intl: string; label: string }>;${newline}${newline}export const getIntlLocale = (locale: Locale): string =>${newline}  localeDetails[locale].intl;${newline}${newline}export const getLocaleLabel = (locale: Locale): string =>${newline}  localeDetails[locale].label;${newline}`,
  ],
  [
    "packages/i18n/src/gen/locale-catalogs.ts",
    `${generatedHeader}${newline}${newline}${imports}${newline}${newline}import type { ExactCatalog } from "../i18n";${newline}import type { Locale } from "./locale-registry";${newline}${newline}export type LocaleMessages = ${catalogTypes};${newline}${newline}${exactCatalogs}${newline}${newline}export const CATALOGS = {${newline}${catalogEntries}${newline}} as const satisfies Record<Locale, LocaleMessages>;${newline}`,
  ],
  [
    "packages/i18n/src/gen/locale-message-types.d.ts",
    `${generatedHeader}${newline}${newline}import type { Locale, MessageKey } from "../../dist/index.mjs";${newline}${newline}${typeImports}${newline}${newline}export type SharedMessages = ${catalogTypes};${newline}${newline}export declare const sharedCatalog: (locale: Locale) => SharedMessages;${newline}${newline}export declare const sharedMessage: (${newline}  key: MessageKey<SharedMessages>,${newline}  locale: Locale${newline}) => string;${newline}${newline}export { sharedRpcErrorMessage } from "../../dist/catalog.mjs";${newline}export type { SharedRpcDisposition } from "../../dist/catalog.mjs";${newline}`,
  ],
  [
    "packages/i18n/src/gen/locale-messages.ts",
    `${generatedHeader}${newline}${newline}import { loadMessages } from "../i18n";${newline}import type {${newline}  Locale,${newline}  LocaleCatalogImporters,${newline}  MessageTree,${newline}} from "../i18n";${newline}import type { LocaleMessages } from "./locale-catalogs";${newline}${newline}const importers = {${newline}${dynamicImports}${newline}} satisfies LocaleCatalogImporters<LocaleMessages>;${newline}${newline}export const loadLocaleMessages = (${newline}  locale: Locale${newline}): Promise<MessageTree> => loadMessages(locale, importers);${newline}`,
  ],
  [
    "server/internal/locale/gen/locales.go",
    `${generatedHeader}${newline}${newline}package gen${newline}${newline}var Supported = []string{${goCodes}}${newline}`,
  ],
  [
    "mobile/lib/l10n/gen/app_messages.dart",
    renderDartMessages(locales, catalogs),
  ],
]);

for (const [outputPath, content] of files) {
  const absolutePath = path.resolve(root, outputPath);
  if (check) {
    if (
      !existsSync(absolutePath) ||
      readFileSync(absolutePath, "utf-8") !== content
    ) {
      fail(`${outputPath} is out of date; run pnpm locales:generate`);
    }
    continue;
  }

  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
