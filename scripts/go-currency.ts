/**
 * The way the Go server writes an amount of money.
 *
 * `@publira/utils` formats a price with `Intl.NumberFormat` at
 * `style: "currency"`, and the server has no CLDR data to reach the same answer
 * with. So what each locale writes around the number for each currency, the
 * separators it groups and divides the number with, and how many digits each
 * currency's minor unit has are read out of `Intl` here and compiled into
 * `server/internal/locale/gen/currency.go`.
 */

import { GENERATED_HEADER, goLocaleEntries, goString } from "./go-source.ts";
import type { GoLocale } from "./go-source.ts";

const INDENT = "\t";

/** How many digits the integer part is grouped by, in every locale compiled. */
const GROUP_SIZE = 3;

/**
 * The amounts every pattern is checked against, in the minor unit: nothing, a
 * fraction alone, one of each group size, and more groups than a price has.
 */
const PROBES = [
  0, 1, 5, 99, 100, 500, 1234, 98_765, 123_456, 1_000_000, 1_234_567_890_123,
];

interface Symbols {
  readonly decimal: string;
  readonly group: string;
}

interface Affixes {
  readonly prefix: string;
  readonly suffix: string;
}

const formatterFor = (intl: string, currency: string): Intl.NumberFormat =>
  new Intl.NumberFormat(intl, { currency, style: "currency" });

const digitsOf = (formatter: Intl.NumberFormat): number =>
  formatter.resolvedOptions().maximumFractionDigits ?? 0;

const textOf = (parts: readonly Intl.NumberFormatPart[]): string =>
  parts.map((part) => part.value).join("");

/**
 * The text before and after the number, as one locale writes one currency.
 * Every part outside the run of integer, group, decimal, and fraction parts is
 * that text, and there must be no part inside the run that is not one of them.
 */
const affixesOf = (
  intl: string,
  currency: string,
  formatter: Intl.NumberFormat
): Affixes => {
  const parts = formatter.formatToParts(1234.5);
  const numeric = new Set(["decimal", "fraction", "group", "integer"]);
  const first = parts.findIndex((part) => numeric.has(part.type));
  const last = parts.findLastIndex((part) => numeric.has(part.type));
  if (first === -1) {
    throw new Error(`${intl} writes ${currency} with no number`);
  }
  for (const part of parts.slice(first, last + 1)) {
    if (!numeric.has(part.type)) {
      throw new Error(
        `${intl} writes a ${part.type} inside a ${currency} amount, which Go cannot render`
      );
    }
  }
  return {
    prefix: textOf(parts.slice(0, first)),
    suffix: textOf(parts.slice(last + 1)),
  };
};

/** The separators of `intl`, read from a currency with a minor unit. */
const symbolsOf = (intl: string): Symbols => {
  const parts = formatterFor(intl, "USD").formatToParts(1_234_567.5);
  const value = (type: string): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`${intl} writes no ${type} in a USD amount`);
    }

    return part.value;
  };

  return { decimal: value("decimal"), group: value("group") };
};

/**
 * `amount`, in the minor unit, written the way `server/internal/locale`
 * writes it from the compiled tables. The generator compares it with `Intl`,
 * so a locale whose numbers this cannot write fails here rather than in a mail.
 */
export const writeAmount = (
  amount: number,
  digits: number,
  symbols: Symbols,
  affixes: Affixes
): string => {
  const scale = 10 ** digits;
  const integer = String(Math.floor(amount / scale));
  const groups: string[] = [];
  for (let end = integer.length; end > 0; end -= GROUP_SIZE) {
    groups.unshift(integer.slice(Math.max(0, end - GROUP_SIZE), end));
  }
  const fraction =
    digits > 0
      ? `${symbols.decimal}${String(amount % scale).padStart(digits, "0")}`
      : "";

  return `${affixes.prefix}${groups.join(symbols.group)}${fraction}${affixes.suffix}`;
};

/** The whole of `server/internal/locale/gen/currency.go`. */
export const renderGoCurrencyFormats = (
  locales: readonly GoLocale[],
  currencies: readonly string[] = Intl.supportedValuesOf("currency")
): string => {
  const digits = new Map<string, number>();
  const symbols = new Map<string, Symbols>();
  const affixes = new Map<string, Map<string, Affixes>>();

  for (const { code, intl } of locales) {
    const localeSymbols = symbolsOf(intl);
    symbols.set(code, localeSymbols);
    const localeAffixes = new Map<string, Affixes>();
    affixes.set(code, localeAffixes);

    for (const currency of currencies) {
      const formatter = formatterFor(intl, currency);
      const currencyDigits = digitsOf(formatter);
      const known = digits.get(currency);
      if (known !== undefined && known !== currencyDigits) {
        throw new Error(
          `${intl} gives ${currency} ${currencyDigits} fraction digits, not ${known}`
        );
      }
      digits.set(currency, currencyDigits);

      const currencyAffixes = affixesOf(intl, currency, formatter);
      localeAffixes.set(currency, currencyAffixes);
      for (const amount of PROBES) {
        const expected = formatter.format(amount / 10 ** currencyDigits);
        const written = writeAmount(
          amount,
          currencyDigits,
          localeSymbols,
          currencyAffixes
        );
        if (written !== expected) {
          throw new Error(
            `${intl} writes ${amount} in the minor unit of ${currency} as ${JSON.stringify(expected)}, but the compiled pattern gives ${JSON.stringify(written)}`
          );
        }
      }
    }
  }

  const affixLiteral = ({ prefix, suffix }: Affixes): string => {
    const fields = [
      prefix === "" ? undefined : `Prefix: ${goString(prefix)}`,
      suffix === "" ? undefined : `Suffix: ${goString(suffix)}`,
    ].filter((field) => field !== undefined);

    return `{${fields.join(", ")}}`;
  };

  const lines: string[] = [
    GENERATED_HEADER,
    "",
    "package gen",
    "",
    "// NumberSymbols are the separators a locale writes a number with. Every",
    `// locale groups the integer part by ${GROUP_SIZE} digits.`,
    "type NumberSymbols struct {",
    `${INDENT}Group   string`,
    `${INDENT}Decimal string`,
    "}",
    "",
    "// CurrencyAffixes are the text a locale writes before and after the number",
    "// of an amount in one currency.",
    "type CurrencyAffixes struct {",
    `${INDENT}Prefix string`,
    `${INDENT}Suffix string`,
    "}",
    "",
    "// GroupSize is how many digits each group of the integer part holds.",
    `const GroupSize = ${GROUP_SIZE}`,
    "",
    "// LocaleNumberSymbols are the separators of each locale, keyed by locale",
    "// code.",
    "var LocaleNumberSymbols = map[string]NumberSymbols{",
    ...goLocaleEntries(
      [...symbols].map(([code, { decimal, group }]) => [
        code,
        `{Group: ${goString(group)}, Decimal: ${goString(decimal)}}`,
      ]),
      INDENT
    ),
    "}",
    "",
    "// CurrencyDigits is how many digits the minor unit of each currency has,",
    "// which is how far below the currency every amount the server stores is.",
    "var CurrencyDigits = map[string]int{",
    ...[...digits].map(
      ([currency, count]) => `${INDENT}${goString(currency)}: ${count},`
    ),
    "}",
    "",
    "// CurrencyFormats writes an amount the way Intl.NumberFormat does at style",
    '// "currency", keyed by locale code and then by currency, so the server and',
    "// the web apps word the same price the same way.",
    "var CurrencyFormats = map[string]map[string]CurrencyAffixes{",
  ];
  for (const [code, localeAffixes] of affixes) {
    lines.push(`${INDENT}${goString(code)}: {`);
    for (const [currency, currencyAffixes] of localeAffixes) {
      lines.push(
        `${INDENT.repeat(2)}${goString(currency)}: ${affixLiteral(currencyAffixes)},`
      );
    }
    lines.push(`${INDENT}},`);
  }
  lines.push("}");

  return `${lines.join("\n")}\n`;
};
