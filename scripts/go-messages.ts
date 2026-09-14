/**
 * The Go side of the shared catalog.
 *
 * `server/internal/locale/gen/messages.go` is compiled from `locales/*.json`
 * the way `mobile/lib/l10n/gen/app_messages.dart` is: `messageformat` parses
 * every message here and the output holds the text and the variable references
 * it was made of, so the server formats a message without a MessageFormat
 * parser of its own.
 */

import { simpleMessageParts } from "../packages/i18n/src/mf2.ts";
import type { SimpleMessagePart } from "../packages/i18n/src/mf2.ts";
import { namespaceLeaves } from "./catalog-leaves.ts";
import { GENERATED_HEADER, goString } from "./go-source.ts";
import type { GoLocale } from "./go-source.ts";

/** The namespace the Go server reads: the copy of the mail it sends. */
export const GO_NAMESPACES = ["email"] as const;

const INDENT = "\t";

const partLiteral = (part: SimpleMessagePart): string =>
  typeof part === "string"
    ? `{Text: ${goString(part)}}`
    : `{Variable: ${goString(part.variable)}}`;

/**
 * Every entry is written across several lines. A single-line `key: value`
 * element would make `gofmt` pad the keys of the block into a column, and the
 * width it pads to is not something this generator can predict.
 */
const messageEntry = (key: string, source: string): string[] => {
  const parts = simpleMessageParts(source);

  return [
    `${INDENT.repeat(2)}${goString(key)}: {`,
    ...parts.map((part) => `${INDENT.repeat(3)}${partLiteral(part)},`),
    `${INDENT.repeat(2)}},`,
  ];
};

/** The whole of `server/internal/locale/gen/messages.go`. */
export const renderGoMessages = (
  locales: readonly GoLocale[],
  catalogs: ReadonlyMap<string, unknown>
): string => {
  const { keys, leavesByCode } = namespaceLeaves(
    locales,
    catalogs,
    GO_NAMESPACES
  );
  const namespaces = GO_NAMESPACES.map((namespace) => `\`${namespace}\``).join(
    " and "
  );
  const lines: string[] = [
    GENERATED_HEADER,
    "",
    "package gen",
    "",
    "// Part is one piece of a message: literal Text, or the value the variable",
    "// Variable names.",
    "type Part struct {",
    `${INDENT}Text     string`,
    `${INDENT}Variable string`,
    "}",
    "",
    `// Messages is the ${namespaces} namespace of every catalog, keyed by locale`,
    "// code and then by the message key.",
    "var Messages = map[string]map[string][]Part{",
  ];
  for (const { code } of locales) {
    const leaves = leavesByCode.get(code);
    if (leaves === undefined) {
      throw new Error(`no catalog for ${code}`);
    }
    lines.push(`${INDENT}${goString(code)}: {`);
    for (const key of keys) {
      const source = leaves.get(key);
      if (source === undefined) {
        throw new Error(`locales/${code}.json has no ${key}`);
      }
      lines.push(...messageEntry(key, source));
    }
    lines.push(`${INDENT}},`);
  }
  lines.push("}");

  return `${lines.join("\n")}\n`;
};
