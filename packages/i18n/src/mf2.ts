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
 * - Messages are restricted to the *simple message* subset — text, escapes and
 *   `{$name}` variable references. {@link simpleMessageSyntaxError} rejects
 *   selection, functions, markup and declarations, and `pnpm locales:check`
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
  isMarkup,
  isSelectMessage,
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
 * Why `message` uses more of MF2 than the catalog allows, or `undefined` when
 * it stays inside the subset.
 */
const unsupportedConstruct = (
  message: Model.PatternMessage
): string | undefined => {
  if (message.declarations.length > 0) {
    return "declarations ('.input' / '.local') are not part of the catalog's subset";
  }

  for (const part of message.pattern) {
    if (typeof part === "string") {
      continue;
    }

    if (isMarkup(part)) {
      return "markup ('{#tag}') is not part of the catalog's subset";
    }

    if (part.functionRef) {
      return `functions (':${part.functionRef.name}') are not part of the catalog's subset`;
    }

    if (!isVariableRef(part.arg)) {
      return "literal expressions ('{|text|}') are not part of the catalog's subset";
    }
  }

  return undefined;
};

/**
 * The data model of `source` when it is a message this catalog accepts, or
 * the reason it is not: MF2 syntax and data model errors from `messageformat`,
 * then the subset rules above.
 */
const parseSimpleMessage = (
  source: string
): { message: Model.PatternMessage } | { problem: string } => {
  let message: Model.Message;
  try {
    message = parseMessage(source);
    validate(message);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }

  if (isSelectMessage(message)) {
    return {
      problem: "selection ('.match') is not part of the catalog's subset",
    };
  }

  const problem = unsupportedConstruct(message);

  return problem === undefined ? { message } : { problem };
};

/**
 * Why `source` is not a message this catalog accepts, or `undefined` when it
 * is.
 */
export const simpleMessageSyntaxError = (
  source: string
): string | undefined => {
  const parsed = parseSimpleMessage(source);

  return "problem" in parsed ? parsed.problem : undefined;
};

/** One piece of a simple message: literal text, or a `{$name}` placeholder. */
export type SimpleMessagePart = string | { readonly variable: string };

/**
 * The text and placeholders of `source` in order, with MF2 escapes resolved.
 *
 * This is how a generator that compiles the catalog into another language
 * reads a message: `messageformat` does the parsing, and the generator only
 * writes out what it was handed, so no reader of the catalog needs a parser of
 * its own. Throws when `source` is outside the catalog's subset, with the
 * reason {@link simpleMessageSyntaxError} reports.
 */
export const simpleMessageParts = (source: string): SimpleMessagePart[] => {
  const parsed = parseSimpleMessage(source);
  if ("problem" in parsed) {
    throw new Error(parsed.problem);
  }

  return parsed.message.pattern.map((part) => {
    if (typeof part === "string") {
      return part;
    }

    // `unsupportedConstruct` has already rejected markup, functions and
    // literal expressions, so what is left is a variable reference.
    if (isMarkup(part) || !isVariableRef(part.arg)) {
      throw new Error(`unexpected ${part.type} in a simple message`);
    }

    return { variable: part.arg.name };
  });
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
 * language's MF2 implementation. Accepts any valid MF2 message, not only the
 * catalog's subset, and throws on a syntax or data model error.
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
