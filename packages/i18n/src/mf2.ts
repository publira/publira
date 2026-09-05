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
 * - Values are formatted as strings. The catalog's numbers and dates are
 *   already rendered by `@publira/utils` against the tenant's time zone, and
 *   `getMessage` has no locale to give MF2, so a locale-sensitive `:number`
 *   would have to fall back to the host's locale — the accident the repo's
 *   date policy exists to prevent.
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
  parseMessage,
  validate,
} from "messageformat";
import type { Model } from "messageformat";

/** Values a `{$name}` placeholder can resolve to. */
export type MessageValues = Record<string, number | string>;

const FORMAT_OPTIONS = { bidiIsolation: "none" } as const;

/**
 * Constructing a formatter parses the message, which costs ~1.9µs against
 * ~0.3µs for formatting an already-parsed one. The catalogs hold under a
 * thousand leaves, so the whole working set fits; the cap is there because a
 * template can also arrive from a caller rather than from a catalog.
 */
const MAX_FORMATTERS = 1024;
const formatters = new Map<string, MessageFormat>();

const formatterFor = (source: string): MessageFormat => {
  const cached = formatters.get(source);
  if (cached) {
    return cached;
  }

  const formatter = new MessageFormat(undefined, source, FORMAT_OPTIONS);
  if (formatters.size >= MAX_FORMATTERS) {
    formatters.clear();
  }
  formatters.set(source, formatter);

  return formatter;
};

/** Values reach MF2 as strings, for the reason given at the top of this module. */
const toParams = (values: MessageValues): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    params[name] = String(value);
  }

  return params;
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
 * Format one message. Throws `MessageSyntaxError` when `source` is not
 * well-formed MF2; an unresolved variable is not an error, and formats to the
 * spec's fallback for it (`{$name}`).
 */
export const formatSimpleMessage = (
  source: string,
  values?: MessageValues
): string => formatterFor(source).format(values ? toParams(values) : undefined);
