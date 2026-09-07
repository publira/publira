/**
 * The Dart side of the shared catalog.
 *
 * `mobile/lib/l10n/gen/app_messages.dart` is compiled from `locales/*.json`
 * the way `packages/i18n/src/gen/` is: the namespaces the app reads become one
 * abstract class of typed getters and methods, plus a subclass per locale whose
 * bodies are Dart string literals. `messageformat` parses every message here,
 * so the app never reads a message at runtime — a `{$name}` placeholder becomes
 * a required named parameter, an escape is resolved before the literal is
 * written, and a key present in one catalog and not another fails this
 * generator rather than a screen.
 *
 * The output has to come back unchanged from `dart format`, because
 * `pnpm locales:check` compares it byte for byte and CI runs the formatter
 * over `mobile/`. The formatter joins a parameter list or a collection onto
 * one line when the line fits in eighty columns and splits it, one entry per
 * line with a trailing comma, when it does not; a string literal is never
 * split. Everything emitted below follows exactly that rule.
 */

import { simpleMessageParts } from "../packages/i18n/src/mf2.ts";
import type { SimpleMessagePart } from "../packages/i18n/src/mf2.ts";

export interface DartLocale {
  readonly code: string;
  readonly intl: string;
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
  "of",
  "supportedLocales",
]);

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

/**
 * A single-quoted Dart literal rendering `parts`, with each placeholder
 * interpolating the parameter `parameterOf` names for it. The braces of an
 * interpolation are written only where the text after it would otherwise be
 * read as part of the parameter's name, which is also where the `unnecessary_brace_in_string_interps`
 * lint allows them.
 */
export const dartStringLiteral = (
  parts: readonly SimpleMessagePart[],
  parameterOf: (variable: string) => string
): string => {
  let literal = "'";
  for (const [index, part] of parts.entries()) {
    if (typeof part === "string") {
      literal += dartText(part);
      continue;
    }

    const parameter = parameterOf(part.variable);
    const next = parts[index + 1];
    const glued = typeof next === "string" && /^[A-Za-z0-9_]/u.test(next);
    literal += glued ? `\${${parameter}}` : `$${parameter}`;
  }

  return `${literal}'`;
};

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

const subclassName = (code: string): string =>
  `_${CLASS_NAME}${code.split("-").map(capitalize).join("")}`;

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

interface Message {
  readonly key: string;
  readonly identifier: string;
  /** Parameter per placeholder, in placeholder name order. */
  readonly parameters: readonly string[];
  /** The literal each locale renders, keyed by code. */
  readonly literals: ReadonlyMap<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const flatten = (
  node: unknown,
  prefix: string,
  into: Map<string, string>
): void => {
  if (typeof node === "string") {
    into.set(prefix, node);
    return;
  }
  if (!isRecord(node)) {
    throw new Error(`${prefix}: leaves must be strings`);
  }
  for (const [name, child] of Object.entries(node)) {
    flatten(child, `${prefix}.${name}`, into);
  }
};

/** The messages of {@link DART_NAMESPACES} in `catalog`, keyed by full path. */
const compiledLeaves = (
  catalog: unknown,
  code: string
): Map<string, string> => {
  const leaves = new Map<string, string>();
  if (!isRecord(catalog)) {
    throw new Error(`locales/${code}.json is not an object`);
  }
  for (const namespace of DART_NAMESPACES) {
    if (!(namespace in catalog)) {
      throw new Error(`locales/${code}.json has no ${namespace} namespace`);
    }
    flatten(catalog[namespace], namespace, leaves);
  }

  return leaves;
};

const collectMessages = (
  locales: readonly DartLocale[],
  catalogs: ReadonlyMap<string, unknown>
): Message[] => {
  const leavesByCode = new Map(
    locales.map(({ code }) => [code, compiledLeaves(catalogs.get(code), code)])
  );
  const [reference, ...others] = locales.map(({ code }) => code);
  const referenceLeaves = leavesByCode.get(reference);
  if (referenceLeaves === undefined) {
    throw new Error("at least one locale is needed");
  }
  for (const code of others) {
    const leaves = leavesByCode.get(code);
    const missing = [...referenceLeaves.keys()].filter(
      (key) => !leaves?.has(key)
    );
    const extra = [...(leaves?.keys() ?? [])].filter(
      (key) => !referenceLeaves.has(key)
    );
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `locales/${code}.json does not match locales/${reference}.json: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`
      );
    }
  }

  const identifiers = new Map<string, string>();
  const messages: Message[] = [];
  for (const key of [...referenceLeaves.keys()].toSorted()) {
    const identifier = dartIdentifier(key);
    const taken = identifiers.get(identifier);
    if (taken !== undefined) {
      throw new Error(
        `keys ${JSON.stringify(taken)} and ${JSON.stringify(key)} both compile into ${identifier}`
      );
    }
    identifiers.set(identifier, key);

    const partsByCode = new Map<string, SimpleMessagePart[]>();
    const parametersByVariable = new Map<string, string>();
    for (const [code, leaves] of leavesByCode) {
      const parts = simpleMessageParts(leaves.get(key) ?? "");
      partsByCode.set(code, parts);
      for (const part of parts) {
        if (typeof part !== "string") {
          parametersByVariable.set(part.variable, dartParameter(part.variable));
        }
      }
    }
    const variables = [...parametersByVariable.keys()].toSorted();
    const parameters = variables.map((variable) => {
      const parameter = parametersByVariable.get(variable);
      if (parameter === undefined) {
        throw new Error(`${key}: no parameter for ${variable}`);
      }

      return parameter;
    });
    if (new Set(parameters).size !== parameters.length) {
      throw new Error(
        `${key}: two placeholders compile into the same parameter (${variables.join(", ")})`
      );
    }

    messages.push({
      identifier,
      key,
      literals: new Map(
        [...partsByCode].map(([code, parts]) => [
          code,
          dartStringLiteral(parts, (variable) => {
            const parameter = parametersByVariable.get(variable);
            if (parameter === undefined) {
              throw new Error(`${key}: no parameter for ${variable}`);
            }

            return parameter;
          }),
        ])
      ),
      parameters,
    });
  }

  return messages;
};

const signature = (message: Message, tail: string): string => {
  if (message.parameters.length === 0) {
    return `${INDENT}String get ${message.identifier}${tail}`;
  }

  return fitted(
    INDENT,
    `String ${message.identifier}({`,
    message.parameters.map((parameter) => `required String ${parameter}`),
    `})${tail}`
  );
};

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
    "",
    "/// The copy of `locales/*.json` the app shows: one getter or method per key",
    `/// of the ${namespaces} namespaces, and one subclass per locale.`,
    "///",
    "/// A `{$name}` placeholder is a required named parameter, so a message cannot",
    "/// render with a value missing. Read the catalog through [of], which answers",
    "/// with the subclass `MaterialApp.localizationsDelegates` installed for the",
    "/// resolved locale.",
    `abstract class ${CLASS_NAME} {`,
    `${INDENT}const ${CLASS_NAME}();`,
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
    "",
    `${INDENT}/// The catalog whose code is [locale]'s language tag, or \`null\` when`,
    `${INDENT}/// no catalog carries it.`,
    `${INDENT}static ${CLASS_NAME}? forLocale(Locale locale) {`,
    `${INDENT}${INDENT}return switch (locale.toLanguageTag()) {`,
    ...locales.map(
      ({ code }) =>
        `${INDENT}${INDENT}${INDENT}'${code}' => const ${subclassName(code)}(),`
    ),
    `${INDENT}${INDENT}${INDENT}_ => null,`,
    `${INDENT}${INDENT}};`,
    `${INDENT}}`,
    "",
    `${INDENT}static ${CLASS_NAME} of(BuildContext context) {`,
    `${INDENT}${INDENT}return Localizations.of<${CLASS_NAME}>(context, ${CLASS_NAME})!;`,
    `${INDENT}}`,
    "",
    `${INDENT}/// The BCP 47 tag \`intl\` formats numbers and dates with for this catalog.`,
    `${INDENT}String get intlLocale;`,
  ];
  for (const message of messages) {
    lines.push("", `${INDENT}/// \`${message.key}\``, signature(message, ";"));
  }
  lines.push("}");

  for (const { code, intl } of locales) {
    lines.push(
      "",
      `class ${subclassName(code)} extends ${CLASS_NAME} {`,
      `${INDENT}const ${subclassName(code)}();`,
      "",
      `${INDENT}@override`,
      `${INDENT}String get intlLocale {`,
      `${INDENT}${INDENT}return '${intl}';`,
      `${INDENT}}`
    );
    for (const message of messages) {
      lines.push(
        "",
        `${INDENT}@override`,
        signature(message, " {"),
        `${INDENT}${INDENT}return ${message.literals.get(code)};`,
        `${INDENT}}`
      );
    }
    lines.push("}");
  }

  return `${lines.join("\n")}\n`;
};
