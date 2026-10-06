/**
 * The Dart side of the shared catalog.
 *
 * `mobile/lib/l10n/gen/app_messages.dart` is compiled from `locales/*.json`
 * the way `packages/i18n/src/__generated__/` is: the namespaces the app reads
 * become one class of typed getters and methods, and each locale's messages
 * are written out as their MessageFormat 2 source. A member formats its
 * source with `package:messageformat` at runtime, so this generator never
 * renders a message itself. What it does is type them: `messageformat` parses
 * every message here, each variable becomes a required named parameter, and a
 * key present in one catalog and not another fails this generator rather than
 * a screen.
 *
 * The output has to come back unchanged from `dart format`, because
 * `pnpm locales:check` compares it byte for byte and CI runs the formatter
 * over `mobile/`. The formatter joins a parameter list or a collection onto
 * one line when the line fits in eighty columns and splits it, one entry per
 * line with a trailing comma, when it does not; a string literal is never
 * split. Everything emitted below follows exactly that rule.
 */

import { messageVariables } from "../packages/i18n/src/mf2.ts";
import { namespaceLeaves } from "./catalog-leaves.ts";

export interface DartLocale {
  readonly code: string;
  readonly intl: string;
  readonly label: string;
}

/**
 * The namespaces the app compiles in: its own copy, and the error
 * classifications every app shares.
 */
export const DART_NAMESPACES = ["errors", "mobile"] as const;

/**
 * The namespace whose prefix is dropped from identifiers, because every key
 * of the app's own copy carries it and `mobileCatalogEmpty` says nothing
 * `catalogEmpty` does not.
 */
const OWN_NAMESPACE = "mobile";

const CLASS_NAME = "AppMessages";
const LINE_WIDTH = 80;
const INDENT = "  ";

/** Members the class declares itself, which no key may compile into. */
const CLASS_MEMBERS = new Set([
  "forLocale",
  "intlLocale",
  "likelyScripts",
  "localeLabel",
  "of",
  "supportedLocales",
]);

/** The runtime half of the catalog, which formats a member's source. */
const RUNTIME_IMPORT = "package:publira/l10n/message_format.dart";

const DART_RESERVED = new Set([
  "abstract",
  "as",
  "assert",
  "async",
  "await",
  "base",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "covariant",
  "default",
  "deferred",
  "do",
  "dynamic",
  "else",
  "enum",
  "export",
  "extends",
  "extension",
  "external",
  "factory",
  "false",
  "final",
  "finally",
  "for",
  "get",
  "hide",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "is",
  "late",
  "library",
  "mixin",
  "new",
  "null",
  "of",
  "on",
  "operator",
  "part",
  "required",
  "rethrow",
  "return",
  "sealed",
  "set",
  "show",
  "static",
  "super",
  "switch",
  "sync",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "var",
  "void",
  "when",
  "while",
  "with",
  "yield",
]);

const SEGMENT_PATTERN = /^[a-z][a-z0-9]*$/iu;

const capitalize = (segment: string): string =>
  segment.charAt(0).toUpperCase() + segment.slice(1);

/**
 * The segments of a key or a variable name: `series.episode_count` and
 * `not-found` split on `.`, `_` and `-`. Anything else is not something a Dart
 * identifier can be made from.
 */
const segmentsOf = (name: string, what: string): string[] => {
  const segments = name.split(/[._-]+/u);
  if (segments.some((segment) => !SEGMENT_PATTERN.test(segment))) {
    throw new Error(
      `${what} ${JSON.stringify(name)} cannot become a Dart identifier: use letters, digits, '.', '_' and '-'`
    );
  }

  return segments;
};

const camelCase = (segments: string[]): string =>
  segments
    .map((segment, index) => (index === 0 ? segment : capitalize(segment)))
    .join("");

/**
 * The member a key compiles into: `mobile.series.episode_count` is
 * `seriesEpisodeCount`, and `errors.rpc.not-found` keeps its namespace as
 * `errorsRpcNotFound`.
 */
export const dartIdentifier = (key: string): string => {
  const path = key.startsWith(`${OWN_NAMESPACE}.`)
    ? key.slice(OWN_NAMESPACE.length + 1)
    : key;
  const identifier = camelCase(segmentsOf(path, "key"));
  if (!/^[a-z]/u.test(identifier)) {
    throw new Error(
      `key ${JSON.stringify(key)} cannot become a Dart identifier: it has to start with a letter`
    );
  }
  if (DART_RESERVED.has(identifier) || CLASS_MEMBERS.has(identifier)) {
    throw new Error(
      `key ${JSON.stringify(key)} compiles into ${identifier}, which ${CLASS_NAME} cannot declare`
    );
  }

  return identifier;
};

/** The parameter a `{$name}` placeholder compiles into. */
export const dartParameter = (variable: string): string => {
  const parameter = camelCase(segmentsOf(variable, "variable"));
  if (!/^[a-z]/u.test(parameter) || DART_RESERVED.has(parameter)) {
    throw new Error(
      `variable ${JSON.stringify(variable)} cannot become a Dart parameter`
    );
  }

  return parameter;
};

const dartText = (text: string): string =>
  text
    .replaceAll(/[\\'$]/gu, (character) => `\\${character}`)
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");

/** A single-quoted Dart literal holding `text` as written. */
export const dartStringLiteral = (text: string): string =>
  `'${dartText(text)}'`;

/** The Dart expression for the locale `code` names, as `dart:ui` spells it. */
const dartLocale = (code: string): string => {
  const [language, ...subtags] = code.split("-");
  const script = subtags.find((subtag) => /^[A-Za-z]{4}$/u.test(subtag));
  const country = subtags.find((subtag) =>
    /^(?:[A-Za-z]{2}|\d{3})$/u.test(subtag)
  );
  const recognized = [script, country].filter((subtag) => subtag !== undefined);
  if (recognized.length !== subtags.length) {
    throw new Error(
      `locale ${JSON.stringify(code)} carries a subtag a dart:ui Locale cannot hold`
    );
  }
  if (script === undefined) {
    return country === undefined
      ? `Locale('${language}')`
      : `Locale('${language}', '${country}')`;
  }

  const fields = [
    `languageCode: '${language}'`,
    `scriptCode: '${script}'`,
    ...(country === undefined ? [] : [`countryCode: '${country}'`]),
  ];

  return `Locale.fromSubtags(${fields.join(", ")})`;
};

const REGION_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/**
 * Every region subtag BCP 47 allows: two letters, or the three digits of a
 * UN M.49 area.
 */
const REGION_SUBTAGS: readonly string[] = [
  ...REGION_LETTERS.flatMap((first) =>
    REGION_LETTERS.map((second) => `${first}${second}`)
  ),
  ...Array.from({ length: 999 }, (_unused, index) =>
    String(index + 1).padStart(3, "0")
  ),
];

/**
 * The script each language of `locales` is likeliest written in, keyed by the
 * language alone and, where the answer differs, by the language and a region:
 * Chinese is Simplified as `zh` and Traditional as `zh-TW`, so a device set to
 * `zh-TW` reads the Traditional catalog rather than whichever Chinese one
 * `locales/index.json` lists first.
 *
 * `Intl.Locale.prototype.maximize()` is the BCP 47 likely-subtags derivation,
 * which is why the entries below are computed rather than written by hand.
 * The app cannot perform it at runtime — a `dart:ui` `Locale` holds the
 * subtags it was given and completes none of them — so the answers it needs
 * are compiled in.
 */
const likelyScripts = (
  locales: readonly DartLocale[]
): ReadonlyMap<string, string> => {
  const scripts = new Map<string, string>();
  const seen = new Set<string>();
  for (const { code } of locales) {
    const [language] = code.split("-");
    if (seen.has(language)) {
      continue;
    }
    seen.add(language);

    const languageScript = new Intl.Locale(language).maximize().script;
    if (languageScript === undefined) {
      continue;
    }
    scripts.set(language, languageScript);

    for (const region of REGION_SUBTAGS) {
      const regionScript = new Intl.Locale(`${language}-${region}`).maximize()
        .script;
      if (regionScript !== undefined && regionScript !== languageScript) {
        scripts.set(`${language}-${region}`, regionScript);
      }
    }
  }

  return scripts;
};

/**
 * `head`, `entries` and `tail` on one line when that fits, otherwise one entry
 * per line with a trailing comma — the two shapes `dart format` settles on.
 */
const fitted = (
  indent: string,
  head: string,
  entries: readonly string[],
  tail: string
): string => {
  const line = `${indent}${head}${entries.join(", ")}${tail}`;
  if (line.length <= LINE_WIDTH) {
    return line;
  }

  return [
    `${indent}${head}`,
    ...entries.map((entry) => `${indent}${INDENT}${entry},`),
    `${indent}${tail}`,
  ].join("\n");
};

interface Parameter {
  /** The name the message's source gives the variable. */
  readonly variable: string;
  readonly name: string;
  readonly type: "String" | "num";
}

interface Message {
  readonly key: string;
  readonly identifier: string;
  /** One per variable of any locale's source, in variable name order. */
  readonly parameters: readonly Parameter[];
  /** The MF2 source each locale formats, keyed by code. */
  readonly sources: ReadonlyMap<string, string>;
}

const variablesOf = (key: string, code: string, source: string) => {
  try {
    return messageVariables(source);
  } catch (error) {
    throw new Error(
      `${code}: ${key}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
};

/**
 * A variable is a `num` when a numeric function takes it in any locale, so a
 * selector in one translation still compares it by value; a translation that
 * only inserts it formats the number the way `:number` would.
 */
const parametersOf = (
  key: string,
  sources: ReadonlyMap<string, string>
): Parameter[] => {
  const variables = new Set<string>();
  const numeric = new Set<string>();
  for (const [code, source] of sources) {
    for (const variable of variablesOf(key, code, source)) {
      variables.add(variable.name);
      if (variable.numeric) {
        numeric.add(variable.name);
      }
    }
  }

  const parameters = [...variables].toSorted().map((variable) => ({
    name: dartParameter(variable),
    type: numeric.has(variable) ? ("num" as const) : ("String" as const),
    variable,
  }));
  if (new Set(parameters.map(({ name }) => name)).size !== parameters.length) {
    throw new Error(
      `${key}: two variables compile into the same parameter (${parameters.map(({ variable }) => variable).join(", ")})`
    );
  }

  return parameters;
};

const collectMessages = (
  locales: readonly DartLocale[],
  catalogs: ReadonlyMap<string, unknown>
): Message[] => {
  const { keys, leavesByCode } = namespaceLeaves(
    locales,
    catalogs,
    DART_NAMESPACES
  );

  const identifiers = new Map<string, string>();
  const messages: Message[] = [];
  for (const key of keys) {
    const identifier = dartIdentifier(key);
    const taken = identifiers.get(identifier);
    if (taken !== undefined) {
      throw new Error(
        `keys ${JSON.stringify(taken)} and ${JSON.stringify(key)} both compile into ${identifier}`
      );
    }
    identifiers.set(identifier, key);

    const sources = new Map(
      [...leavesByCode].map(([code, leaves]) => [code, leaves.get(key) ?? ""])
    );
    messages.push({
      identifier,
      key,
      parameters: parametersOf(key, sources),
      sources,
    });
  }

  return messages;
};

const signature = (message: Message): string => {
  if (message.parameters.length === 0) {
    return `${INDENT}String get ${message.identifier} {`;
  }

  return fitted(
    INDENT,
    `String ${message.identifier}({`,
    message.parameters.map(({ name, type }) => `required ${type} ${name}`),
    "}) {"
  );
};

/**
 * The statement a member formats its source with: the key, then the values
 * map as the formatter lays out a trailing collection — on the call's line
 * when the call's head fits there, below the key when it does not.
 */
const formatStatement = (message: Message): string => {
  const indent = INDENT.repeat(2);
  const key = dartStringLiteral(message.key);
  if (message.parameters.length === 0) {
    return fitted(indent, "return _format(", [key], ");");
  }

  const entries = message.parameters.map(
    ({ name, variable }) => `${dartStringLiteral(variable)}: ${name}`
  );
  const line = `${indent}return _format(${key}, {${entries.join(", ")}});`;
  if (line.length <= LINE_WIDTH) {
    return line;
  }

  const head = `${indent}return _format(${key}, {`;
  if (head.length <= LINE_WIDTH) {
    return [
      head,
      ...entries.map((entry) => `${indent}${INDENT}${entry},`),
      `${indent}});`,
    ].join("\n");
  }

  return [
    `${indent}return _format(`,
    `${indent}${INDENT}${key},`,
    fitted(`${indent}${INDENT}`, "{", entries, "},"),
    `${indent});`,
  ].join("\n");
};

/** One entry of a locale's sources map, split after the key when too long. */
const sourceEntry = (key: string, source: string): string => {
  const head = `${INDENT}${dartStringLiteral(key)}:`;
  const value = `${dartStringLiteral(source)},`;
  const line = `${head} ${value}`;

  return line.length <= LINE_WIDTH
    ? line
    : `${head}\n${INDENT.repeat(3)}${value}`;
};

const instanceName = (code: string): string =>
  `_${code
    .split("-")
    .map((subtag, index) =>
      index === 0 ? subtag.toLowerCase() : capitalize(subtag)
    )
    .join("")}`;

const sourcesName = (code: string): string => `${instanceName(code)}Sources`;

/** The whole of `mobile/lib/l10n/gen/app_messages.dart`. */
export const renderDartMessages = (
  locales: readonly DartLocale[],
  catalogs: ReadonlyMap<string, unknown>
): string => {
  const messages = collectMessages(locales, catalogs);
  const namespaces = DART_NAMESPACES.map(
    (namespace) => `\`${namespace}\``
  ).join(" and ");
  const lines: string[] = [
    "// Code generated by scripts/generate-locale-registry.ts; DO NOT EDIT.",
    "",
    "import 'package:flutter/widgets.dart';",
    `import '${RUNTIME_IMPORT}';`,
    "",
    "/// The copy of `locales/*.json` the app shows: one getter or method per key",
    `/// of the ${namespaces} namespaces, each formatting that key's`,
    "/// MessageFormat 2 source with `package:messageformat` in the catalog's",
    "/// locale.",
    "///",
    "/// Each variable of a message is a required named parameter, so a message",
    "/// cannot render with a value missing: a `num` where the message hands it to",
    "/// a numeric function such as `:integer`, and a `String` otherwise. Read the",
    "/// catalog through [of], which answers with the one",
    "/// `MaterialApp.localizationsDelegates` installed for the resolved locale.",
    `final class ${CLASS_NAME} {`,
    fitted(
      INDENT,
      `const ${CLASS_NAME}._({`,
      [
        "required this.intlLocale",
        "required this.localeLabel",
        "required this._sources",
      ],
      "});"
    ),
    "",
    `${INDENT}/// Every locale of \`locales/index.json\`, in its order.`,
    fitted(
      INDENT,
      "static const supportedLocales = <Locale>[",
      locales.map(({ code }) => dartLocale(code)),
      "];"
    ),
    "",
    `${INDENT}/// The script a locale that names none is likeliest written in, keyed`,
    `${INDENT}/// by its language and, where that answer differs, by its language and`,
    `${INDENT}/// region.`,
    `${INDENT}///`,
    `${INDENT}/// \`matchDeviceLocale\` reads it, so a device asking for a language two`,
    `${INDENT}/// catalogs share reaches the one written in the script the device`,
    `${INDENT}/// implies.`,
    fitted(
      INDENT,
      "static const likelyScripts = <String, String>{",
      [...likelyScripts(locales)].map(
        ([tag, script]) => `'${tag}': '${script}'`
      ),
      "};"
    ),
  ];
  for (const { code, intl, label } of locales) {
    lines.push(
      "",
      fitted(
        INDENT,
        `static const ${instanceName(code)} = ${CLASS_NAME}._(`,
        [
          `intlLocale: ${dartStringLiteral(intl)}`,
          `localeLabel: ${dartStringLiteral(label)}`,
          `sources: ${sourcesName(code)}`,
        ],
        ");"
      )
    );
  }
  lines.push(
    "",
    `${INDENT}/// The catalog whose code is [locale]'s language tag, or \`null\` when`,
    `${INDENT}/// no catalog carries it.`,
    `${INDENT}static ${CLASS_NAME}? forLocale(Locale locale) {`,
    `${INDENT}${INDENT}return switch (locale.toLanguageTag()) {`,
    ...locales.map(
      ({ code }) =>
        `${INDENT}${INDENT}${INDENT}'${code}' => ${instanceName(code)},`
    ),
    `${INDENT}${INDENT}${INDENT}_ => null,`,
    `${INDENT}${INDENT}};`,
    `${INDENT}}`,
    "",
    `${INDENT}static ${CLASS_NAME} of(BuildContext context) {`,
    `${INDENT}${INDENT}return Localizations.of<${CLASS_NAME}>(context, ${CLASS_NAME})!;`,
    `${INDENT}}`,
    "",
    `${INDENT}/// The BCP 47 tag \`intl\` formats numbers and dates with for this catalog,`,
    `${INDENT}/// and the locale its messages are formatted in.`,
    `${INDENT}final String intlLocale;`,
    "",
    `${INDENT}/// This catalog's language, named in itself as \`locales/index.json\``,
    `${INDENT}/// labels it.`,
    `${INDENT}final String localeLabel;`,
    "",
    `${INDENT}/// The MessageFormat 2 source of each key, as the catalog writes it.`,
    `${INDENT}final Map<String, String> _sources;`,
    "",
    `${INDENT}String _format(String key, [Map<String, Object> values = const {}]) {`,
    `${INDENT}${INDENT}return formatCatalogMessage(intlLocale, _sources[key]!, values);`,
    `${INDENT}}`
  );
  for (const message of messages) {
    lines.push(
      "",
      `${INDENT}/// \`${message.key}\``,
      signature(message),
      formatStatement(message),
      `${INDENT}}`
    );
  }
  lines.push("}");

  for (const { code } of locales) {
    lines.push(
      "",
      `/// The source of every key in \`locales/${code}.json\` the app compiles in.`,
      `const ${sourcesName(code)} = <String, String>{`,
      ...messages.map(({ key, sources }) =>
        sourceEntry(key, sources.get(code) ?? "")
      ),
      "};"
    );
  }

  return `${lines.join("\n")}\n`;
};
