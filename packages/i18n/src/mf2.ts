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
const unsupportedConstruct = (message: Model.Message): string | undefined => {
  if (isSelectMessage(message)) {
    return "selection ('.match') is not part of the catalog's subset";
  }

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
 * Why `source` is not a message this catalog accepts, or `undefined` when it
 * is. Reports MF2 syntax and data model errors from `messageformat`, then the
 * subset rules above.
 */
export const simpleMessageSyntaxError = (
  source: string
): string | undefined => {
  let message: Model.Message;
  try {
    message = parseMessage(source);
    validate(message);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return unsupportedConstruct(message);
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
