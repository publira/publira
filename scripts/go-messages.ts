/**
 * The Go side of the shared catalog.
 *
 * `server/internal/locale/gen/messages.go` is compiled from `locales/*.json`
 * because `go:embed` cannot reach `locales/` from `server/`. It carries every
 * message as the MessageFormat 2 source the catalog holds, not a parse of it:
 * `locale.Message` formats that source with a MessageFormat 2 library, so this
 * generator interprets none of the syntax.
 */

import { namespaceLeaves } from "./catalog-leaves.ts";
import { GENERATED_HEADER, goLocaleEntries, goString } from "./go-source.ts";
import type { GoLocale } from "./go-source.ts";

/** The namespace the Go server reads: the copy of the mail it sends. */
export const GO_NAMESPACES = ["email"] as const;

const INDENT = "\t";

/**
 * The whole of `server/internal/locale/gen/locales.go`: the supported codes,
 * and the BCP 47 tag each one's messages are formatted in.
 */
export const renderGoLocales = (locales: readonly GoLocale[]): string =>
  [
    GENERATED_HEADER,
    "",
    "package gen",
    "",
    `var Supported = []string{${locales.map(({ code }) => goString(code)).join(", ")}}`,
    "",
    "// Intl is the `intl` value of each locale code in locales/index.json.",
    "var Intl = map[string]string{",
    ...goLocaleEntries(
      locales.map(({ code, intl }) => [code, goString(intl)]),
      INDENT
    ),
    "}",
    "",
  ].join("\n");

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
    `// Messages is the MessageFormat 2 source of every message in the ${namespaces}`,
    "// namespace, keyed by the message key and then by locale code.",
    "var Messages = map[string]map[string]string{",
  ];
  for (const key of keys) {
    const sources = locales.map(({ code }): [string, string] => {
      const source = leavesByCode.get(code)?.get(key);
      if (source === undefined) {
        throw new Error(`locales/${code}.json has no ${key}`);
      }
      return [code, goString(source)];
    });
    lines.push(
      `${INDENT}${goString(key)}: {`,
      ...goLocaleEntries(sources, INDENT.repeat(2)),
      `${INDENT}},`
    );
  }
  lines.push("}");

  return `${lines.join("\n")}\n`;
};
