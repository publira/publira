/**
 * The date and time format the Go server displays an instant in.
 *
 * `@publira/utils` formats one with `Intl.DateTimeFormat` at
 * `dateStyle: "medium"` and `timeStyle: "short"`, and the server has no CLDR
 * data to reach the same answer with. So the pattern of each locale is read
 * out of `Intl` here — the separators, the month names, and the hour and day
 * period each hour is written as — and compiled into
 * `server/internal/locale/gen/datetime.go`.
 */

import { Temporal } from "temporal-polyfill";

import { GENERATED_HEADER, goString } from "./go-source.ts";
import type { GoLocale } from "./go-source.ts";

const INDENT = "\t";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HOURS = Array.from({ length: 24 }, (_unused, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_unused, minute) => minute);

/** The field kinds the Go renderer knows, as `Intl` names them. */
const KINDS = new Map([
  ["year", "FieldYear"],
  ["month", "FieldMonth"],
  ["day", "FieldDay"],
  ["hour", "FieldHour"],
  ["minute", "FieldMinute"],
  ["dayPeriod", "FieldDayPeriod"],
]);

/** The kinds whose every possible value is written out as a table. */
const TABLE_KINDS = new Set(["month", "hour", "dayPeriod"]);

interface Instant {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
}

/** The year every probe is read at. Any four-digit one would do. */
const PROBE_YEAR = 2024;

const epoch = ({ day, hour, minute, month }: Instant): number =>
  Temporal.ZonedDateTime.from({
    day,
    hour,
    minute,
    month,
    timeZone: "UTC",
    year: PROBE_YEAR,
  }).epochMilliseconds;

const formatterFor = (intl: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(intl, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

/**
 * Every moment the pattern is read at: each hour against several minutes, and
 * both a one-digit and a two-digit month and day, so a separator or a padding
 * that is not constant is seen here rather than in a sent email.
 */
const probes = (): Instant[] =>
  [
    { day: 2, month: 1 },
    { day: 25, month: 11 },
  ].flatMap(({ day, month }) =>
    HOURS.flatMap((hour) =>
      [0, 1, 30, 59].map((minute) => ({ day, hour, minute, month }))
    )
  );

const partsOf = (
  formatter: Intl.DateTimeFormat,
  instant: Instant
): Intl.DateTimeFormatPart[] => formatter.formatToParts(epoch(instant));

/** The part types and the literal text between them, as one comparable line. */
const shapeOf = (parts: readonly Intl.DateTimeFormatPart[]): string =>
  parts
    .map((part) =>
      part.type === "literal" ? `literal(${part.value})` : part.type
    )
    .join(" ");

const partValue = (
  parts: readonly Intl.DateTimeFormatPart[],
  type: string
): string => {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`the formatted value has no ${type}`);
  }

  return part.value;
};

/**
 * The pattern `intl` writes, after checking that it is the same one at every
 * moment of {@link probes}.
 */
const patternOf = (
  intl: string,
  formatter: Intl.DateTimeFormat
): Intl.DateTimeFormatPart[] => {
  const moments = probes();
  const [first, ...rest] = moments.map((instant) =>
    partsOf(formatter, instant)
  );
  if (first === undefined) {
    throw new Error("at least one probe is needed");
  }
  for (const [index, parts] of rest.entries()) {
    if (shapeOf(parts) !== shapeOf(first)) {
      throw new Error(
        `${intl} formats ${JSON.stringify(moments[index + 1])} as "${shapeOf(parts)}", not as "${shapeOf(first)}"`
      );
    }
  }
  for (const part of first) {
    if (part.type !== "literal" && !KINDS.has(part.type)) {
      throw new Error(`${intl} formats a ${part.type}, which Go cannot render`);
    }
  }

  return first;
};

/**
 * How many digits a numeric field is padded to, after checking that every
 * value it takes is that decimal and nothing else.
 */
const widthOf = (
  intl: string,
  formatter: Intl.DateTimeFormat,
  type: "day" | "minute" | "year"
): number => {
  const numberOf = (instant: Instant): number =>
    type === "year" ? PROBE_YEAR : instant[type];
  const moments = probes();
  const [first] = moments;
  if (first === undefined) {
    throw new Error("at least one probe is needed");
  }
  const width = partValue(partsOf(formatter, first), type).length;
  for (const instant of moments) {
    const rendered = partValue(partsOf(formatter, instant), type);
    if (rendered !== String(numberOf(instant)).padStart(width, "0")) {
      throw new Error(
        `${intl} writes the ${type} of ${JSON.stringify(instant)} as ${JSON.stringify(rendered)}, which is not a padded decimal`
      );
    }
  }

  return width;
};

/** What a field reads for each month, or for each hour of the day. */
const tableOf = (
  intl: string,
  formatter: Intl.DateTimeFormat,
  type: "dayPeriod" | "hour" | "month"
): string[] => {
  if (type === "month") {
    return MONTHS.map((month) =>
      partValue(partsOf(formatter, { day: 2, hour: 3, minute: 4, month }), type)
    );
  }

  return HOURS.map((hour) => {
    const rendered = partValue(
      partsOf(formatter, { day: 2, hour, minute: 0, month: 1 }),
      type
    );
    for (const minute of MINUTES) {
      const other = partValue(
        partsOf(formatter, { day: 2, hour, minute, month: 1 }),
        type
      );
      if (other !== rendered) {
        throw new Error(
          `${intl} writes the ${type} of ${hour}:${minute} as ${JSON.stringify(other)} but of ${hour}:00 as ${JSON.stringify(rendered)}`
        );
      }
    }

    return rendered;
  });
};

const fieldLiteral = (
  intl: string,
  formatter: Intl.DateTimeFormat,
  part: Intl.DateTimeFormatPart
): string => {
  if (part.type === "literal") {
    return `{Kind: FieldLiteral, Text: ${goString(part.value)}}`;
  }

  const kind = KINDS.get(part.type);
  if (kind === undefined) {
    throw new Error(`${intl} formats a ${part.type}, which Go cannot render`);
  }
  if (TABLE_KINDS.has(part.type)) {
    const table = tableOf(
      intl,
      formatter,
      part.type as "dayPeriod" | "hour" | "month"
    );
    const values = table.map((value) => goString(value)).join(", ");

    return `{Kind: ${kind}, Values: []string{${values}}}`;
  }

  const width = widthOf(
    intl,
    formatter,
    part.type as "day" | "minute" | "year"
  );

  return `{Kind: ${kind}, Width: ${width}}`;
};

/** The whole of `server/internal/locale/gen/datetime.go`. */
export const renderGoDateTimeFormats = (
  locales: readonly GoLocale[]
): string => {
  const lines: string[] = [
    GENERATED_HEADER,
    "",
    "package gen",
    "",
    "// FieldKind names what one piece of a date and time pattern writes.",
    "type FieldKind int",
    "",
    "const (",
    `${INDENT}FieldLiteral FieldKind = iota`,
    ...[...KINDS.values()].map((kind) => `${INDENT}${kind}`),
    ")",
    "",
    "// Field is one piece of a pattern. A literal writes Text, a field with",
    "// Values writes the entry its month or its hour selects, and the rest write",
    "// a decimal padded to Width digits.",
    "type Field struct {",
    `${INDENT}Kind   FieldKind`,
    `${INDENT}Text   string`,
    `${INDENT}Values []string`,
    `${INDENT}Width  int`,
    "}",
    "",
    "// DateTimeFormats writes an instant the way Intl.DateTimeFormat does at",
    '// dateStyle "medium" and timeStyle "short", keyed by locale code, so the',
    "// server and the web apps word the same moment the same way.",
    "var DateTimeFormats = map[string][]Field{",
  ];
  for (const { code, intl } of locales) {
    const formatter = formatterFor(intl);
    lines.push(`${INDENT}${goString(code)}: {`);
    for (const part of patternOf(intl, formatter)) {
      lines.push(`${INDENT.repeat(2)}${fieldLiteral(intl, formatter, part)},`);
    }
    lines.push(`${INDENT}},`);
  }
  lines.push("}");

  return `${lines.join("\n")}\n`;
};
