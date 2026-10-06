/**
 * MessageFormat 2 formatting for the leaves of `locales/*.json`.
 *
 * The syntax is a Unicode standard, so the implementation is not ours: parsing
 * and formatting are `messageformat` v4, written by a member of the
 * MessageFormat Working Group, current as of LDML 48 and usable as the polyfill
 * for the TC39 `Intl.MessageFormat` proposal. Nothing here re-implements the
 * grammar.
 *
 * What this module adds is the catalog's own policy on top of it:
 *
 * - A message may use any of MF2 — declarations, selection, markup — with the
 *   functions every reader of the catalog implements by default.
 *   {@link catalogMessageError} states the policy, and `pnpm locales:check`
 *   runs it over every leaf of every locale.
 * - A message is formatted in the locale of the catalog it came from, never in
 *   the host's: every formatter is constructed with that locale's BCP 47 tag,
 *   so a number value formats and selects a plural variant the way the
 *   catalog's own language does.
 * - Bidi isolation is off, so a formatted message contains exactly the
 *   characters of the copy. Both catalogs are LTR, and these strings also
 *   become email subjects and `<title>` text, where U+2068 / U+2069 would
 *   travel invisibly. Turning isolation on belongs with the first RTL locale.
 */

import {
  isLiteral,
  isVariableRef,
  MessageFormat,
  MessageResolutionError,
  parseMessage,
  validate,
  visit,
} from "messageformat";
import type { Model } from "messageformat";

/** Values a `{$name}` placeholder can resolve to. */
export type MessageValues = Record<string, number | string>;

const FORMAT_OPTIONS = { bidiIsolation: "none" } as const;

/**
 * Constructing a formatter parses the message, which costs ~1.9µs against
 * ~0.3µs for formatting an already-parsed one, so a formatter is kept for
 * every locale and source a process formats. The cap is there because a
 * template can also arrive from a caller rather than from a catalog.
 */
const MAX_FORMATTERS = 1024;
const formatters = new Map<string, MessageFormat>();

const formatterFor = (locale: string, source: string): MessageFormat => {
  // The same source formats differently in another locale, so the key carries
  // both. A BCP 47 tag holds only letters, digits and hyphens, so the first
  // space ends it whatever the source contains.
  const key = `${locale} ${source}`;
  const cached = formatters.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new MessageFormat(locale, source, FORMAT_OPTIONS);
  if (formatters.size >= MAX_FORMATTERS) {
    formatters.clear();
  }
  formatters.set(key, formatter);

  return formatter;
};

/**
 * The functions a catalog message may call: the ones every reader formats
 * with by default. LDML 48.2 marks `:currency` and `:percent` Stable too, but
 * `messageformat` v4 still files them with its Draft functions, outside its
 * defaults, so a message calling one would format on the server and in the
 * app and fall back in the web apps. The date and time functions are Draft,
 * and a date is formatted against the tenant's display time zone before it
 * reaches a message rather than by MF2.
 */
const CATALOG_FUNCTIONS = new Set(["integer", "number", "offset", "string"]);
const CATALOG_FUNCTION_LIST = [...CATALOG_FUNCTIONS]
  .map((name) => `:${name}`)
  .join(", ");

/**
 * Why `source` is not a message this catalog accepts, or `undefined` when it
 * is: an MF2 syntax or data model error from `messageformat`, a function
 * outside {@link CATALOG_FUNCTIONS}, or a placeholder that is a bare literal.
 *
 * `{name}` is how a placeholder was written before the catalog moved to MF2.
 * In MF2 it is a literal expression that formats to the word `name` without
 * any error, so it is rejected as the likely mistake it is; a literal brace is
 * written `\{` / `\}`.
 */
export const catalogMessageError = (source: string): string | undefined => {
  let message: Model.Message;
  try {
    message = parseMessage(source);
    validate(message);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  let problem: string | undefined;
  visit(message, {
    expression: (expression, context) => {
      if (
        problem === undefined &&
        context === "placeholder" &&
        expression.functionRef === undefined &&
        isLiteral(expression.arg)
      ) {
        problem = `'{${expression.arg.value}}' formats to the literal text '${expression.arg.value}'; write '{$${expression.arg.value}}' for a variable or '\\{' / '\\}' for a brace`;
      }
    },
    functionRef: (functionRef) => {
      if (problem === undefined && !CATALOG_FUNCTIONS.has(functionRef.name)) {
        problem = `':${functionRef.name}' is not one of the catalog's functions (${CATALOG_FUNCTION_LIST})`;
      }
    },
  });

  return problem;
};

/**
 * The Stable functions of LDML 48 whose operand is a number. A variable one of
 * them takes is a number in the values a reader hands the message, so a
 * selector compares it by value and a placeholder formats it in the locale.
 */
const NUMERIC_FUNCTIONS = new Set([
  "currency",
  "integer",
  "number",
  "offset",
  "percent",
]);

/** A variable a message reads from the values it is formatted with. */
export interface MessageVariable {
  readonly name: string;
  /** Whether a numeric function takes the variable as its operand. */
  readonly numeric: boolean;
}

/**
 * The variables `source` reads from the values it is formatted with, in name
 * order. A `.local` declaration names a variable the message defines itself,
 * so it is not one of them; a variable it is defined from is numeric when the
 * local is.
 *
 * This is how a generator that emits typed accessors in another language
 * learns each accessor's parameters, while formatting stays with that
 * language's MF2 implementation. Accepts any valid MF2 message, and throws on
 * a syntax or data model error.
 */
export const messageVariables = (source: string): MessageVariable[] => {
  const message = parseMessage(source);
  validate(message);

  const referenced = new Set<string>();
  const numeric = new Set<string>();
  visit(message, {
    functionRef: (functionRef, _context, argument) => {
      if (
        argument !== undefined &&
        isVariableRef(argument) &&
        NUMERIC_FUNCTIONS.has(functionRef.name)
      ) {
        numeric.add(argument.name);
      }
    },
    value: (value) => {
      if (isVariableRef(value)) {
        referenced.add(value.name);
      }
    },
  });

  // A declaration can only read the ones above it, so walking them bottom up
  // carries a number through any chain of locals in one pass.
  const locals = new Set<string>();
  for (const declaration of message.declarations.toReversed()) {
    if (declaration.type !== "local") {
      continue;
    }
    locals.add(declaration.name);
    const { arg, functionRef } = declaration.value;
    if (
      numeric.has(declaration.name) &&
      functionRef === undefined &&
      arg !== undefined &&
      isVariableRef(arg)
    ) {
      numeric.add(arg.name);
    }
  }

  return [...referenced]
    .filter((name) => !locals.has(name))
    .toSorted()
    .map((name) => ({ name, numeric: numeric.has(name) }));
};

/**
 * Without a handler, `messageformat` reports every resolution error through
 * `process.emitWarning`, which `next dev` shows as a console error.
 */
const reportFormatError = (error: unknown) => {
  if (
    error instanceof MessageResolutionError &&
    error.type === "unresolved-variable"
  ) {
    return;
  }

  console.warn(error);
};

/**
 * Format one message in `locale`, a BCP 47 tag. Throws `MessageSyntaxError`
 * when `source` is not well-formed MF2; an unresolved variable is not an
 * error, and formats to the spec's fallback for it (`{$name}`).
 *
 * Values reach MF2 as they were handed in: a number stays a number, so a
 * selector compares it by value and an unannotated placeholder formats it the
 * way `:number` does in `locale`.
 */
export const formatMessageSource = (
  source: string,
  locale: string,
  values?: MessageValues
): string => formatterFor(locale, source).format(values, reportFormatError);
