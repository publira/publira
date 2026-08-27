/**
 * Unicode MessageFormat 2.0, restricted to *simple messages*.
 *
 * Every leaf of `locales/*.json` is an MF2 simple message as defined by
 * UTS #35 Part 9 (LDML) 48.2 — text, escape sequences, and variable
 * expressions `{$name}`. Declarations (`.input` / `.local`), matchers
 * (`.match`), functions (`:number` / `:datetime`), markup, and quoted
 * patterns are rejected, so the grammar stays small enough for the Go and
 * Flutter readers to implement too: MF2 has no first-party Go implementation
 * and no Dart implementation at all.
 *
 * That is also why this module is hand-written rather than delegating to
 * `messageformat` v4. The subset below formats synchronously, which
 * `sharedRpcErrorMessage` and the zod schemas need, and a full MF2 runtime in
 * the browser bundle would buy selection and function support that the
 * catalog is not allowed to use.
 */

/** Values a `{$name}` placeholder can resolve to. */
export type MessageValues = Record<string, number | string>;

/** A variable reference; anything else in a message is literal text. */
export interface MessageVariable {
  readonly variable: string;
}

export type MessagePart = MessageVariable | string;

/**
 * The `o` production: `ws` (`SP` / `HTAB` / `CR` / `LF` / U+3000 IDEOGRAPHIC
 * SPACE) plus the bidi marks and isolates the grammar treats as ignorable
 * format controls (U+061C, U+200E, U+200F, U+2066–U+2069).
 */
const OPTIONAL_WS = new Set([
  "\t",
  "\n",
  "\r",
  " ",
  "\u3000",
  "\u061C",
  "\u200E",
  "\u200F",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
]);

/** `escaped-char = backslash ( backslash / "{" / "|" / "}" )`. */
const ESCAPABLE = new Set(["\\", "{", "|", "}"]);

/**
 * A deliberate subset of MF2's `name`, which admits most of Unicode. A
 * placeholder name is a key of a TypeScript `Record` and has to be scanned by
 * the Go and Flutter readers as well, so the catalog keeps them ASCII.
 */
const NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/uy;

/** Characters that start something other than plain text. */
const SYNTAX_RE = /[\\{}]/u;

const syntaxError = (source: string, index: number, reason: string): Error =>
  new Error(
    `Invalid MessageFormat 2 simple message at offset ${index}: ${reason} — ${JSON.stringify(source)}`
  );

const skipOptionalWs = (source: string, from: number): number => {
  let index = from;
  while (index < source.length && OPTIONAL_WS.has(source[index])) {
    index += 1;
  }

  return index;
};

/**
 * Read `"{" o "$" name o "}"` starting at `open`, and report the offset just
 * past the closing brace.
 */
const readVariableExpression = (
  source: string,
  open: number
): { end: number; name: string } => {
  let cursor = skipOptionalWs(source, open + 1);
  if (source[cursor] !== "$") {
    throw syntaxError(
      source,
      cursor,
      "only variable expressions ('{$name}') are supported; a literal '{' is written '\\{'"
    );
  }

  cursor += 1;
  NAME_RE.lastIndex = cursor;
  const name = NAME_RE.exec(source)?.[0];
  if (!name) {
    throw syntaxError(source, cursor, "expected a variable name after '$'");
  }

  cursor = skipOptionalWs(source, cursor + name.length);
  if (source[cursor] !== "}") {
    throw syntaxError(
      source,
      cursor,
      "expected '}' to close the variable expression"
    );
  }

  return { end: cursor + 1, name };
};

/**
 * Split a simple message into literal text and variable references, throwing
 * on anything outside the subset.
 *
 * Leading and trailing whitespace is part of the text — the grammar's leading
 * `o` only relaxes the restriction on the first non-whitespace character — so
 * it is preserved verbatim.
 */
export const parseSimpleMessage = (source: string): MessagePart[] => {
  const start = skipOptionalWs(source, 0);
  if (source.startsWith(".", start)) {
    throw syntaxError(
      source,
      start,
      "a message whose first non-whitespace character is '.' is a complex message"
    );
  }
  if (source.startsWith("{{", start)) {
    throw syntaxError(
      source,
      start,
      "quoted patterns ('{{…}}') are complex messages"
    );
  }

  const parts: MessagePart[] = [];
  let text = "";
  let index = 0;

  const flushText = () => {
    if (text) {
      parts.push(text);
      text = "";
    }
  };

  while (index < source.length) {
    const char = source[index];

    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined || !ESCAPABLE.has(escaped)) {
        throw syntaxError(
          source,
          index,
          "a backslash must be followed by '\\\\', '{', '|', or '}'"
        );
      }
      text += escaped;
      index += 2;
      continue;
    }

    if (char === "}") {
      throw syntaxError(source, index, "a literal '}' is written '\\}'");
    }

    if (char === "{") {
      const { end, name } = readVariableExpression(source, index);
      flushText();
      parts.push({ variable: name });
      index = end;
      continue;
    }

    if (char === "\u0000") {
      throw syntaxError(source, index, "U+0000 NULL is not allowed in text");
    }

    text += char;
    index += 1;
  }

  flushText();

  return parts;
};

/** Why `source` is not a well-formed simple message, or `undefined` when it is. */
export const simpleMessageSyntaxError = (
  source: string
): string | undefined => {
  try {
    parseSimpleMessage(source);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * An unresolved variable formats to its fallback value — the name behind a
 * `$`, wrapped in curly brackets (UTS #35 Part 9, "Formatting Fallback
 * Values"). A caller that omitted one value still gets the rest of the
 * sentence instead of an exception.
 */
const resolveVariable = (name: string, values?: MessageValues): string => {
  if (!values || !Object.hasOwn(values, name)) {
    return `{$${name}}`;
  }

  return String(values[name]);
};

/**
 * Format one simple message.
 *
 * Throws on a message the subset does not accept. `pnpm locales:check` parses
 * every catalog leaf, so that can only happen for a message assembled
 * somewhere else.
 */
export const formatSimpleMessage = (
  source: string,
  values?: MessageValues
): string => {
  // Most leaves are plain text, where parsing could only return the input.
  if (!SYNTAX_RE.test(source)) {
    return source;
  }

  let formatted = "";
  for (const part of parseSimpleMessage(source)) {
    formatted +=
      typeof part === "string" ? part : resolveVariable(part.variable, values);
  }

  return formatted;
};
