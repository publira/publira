/**
 * Reading `Forwarded` (RFC 7239) and the switch that turns it off, shared by
 * `request-host` and `client-address`, which read the same headers the way
 * `publira server` does.
 */

/**
 * Turned to `false` for an install whose edge writes the `X-Forwarded-*`
 * headers and passes on a `Forwarded` header the caller sent, as
 * `publira server` reads the same variable for the client address. The web
 * apps then take the host and the client address from those headers alone.
 */
export const FORWARDED_HEADER_ENABLED_ENV = "PUBLIRA_FORWARDED_HEADER_ENABLED";

/**
 * Exactly the values Go's `strconv.ParseBool` reads, so that a value
 * `publira server` accepts for the same variable is accepted here too, and
 * one it refuses is refused.
 */
const TRUE_VALUES = new Set(["1", "t", "T", "true", "TRUE", "True"]);
const FALSE_VALUES = new Set(["0", "f", "F", "false", "FALSE", "False"]);

export const isForwardedHeaderEnabled = (): boolean => {
  const value = (process.env[FORWARDED_HEADER_ENABLED_ENV] ?? "").trim();

  if (value === "" || TRUE_VALUES.has(value)) {
    return true;
  }

  if (FALSE_VALUES.has(value)) {
    return false;
  }

  throw new Error(
    `${FORWARDED_HEADER_ENABLED_ENV} must be a boolean such as true or false, not ${JSON.stringify(value)}`
  );
};

/** Splits `value` at every `separator` outside a quoted string. */
export const splitUnquoted = (value: string, separator: string): string[] => {
  const parts: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));

  return parts;
};

export const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll(/\\(?<escaped>.)/gu, "$<escaped>")
    : value;

/**
 * The values of every `name=` parameter across the elements of `Forwarded`,
 * in order, unquoted and trimmed.
 */
export const forwardedParameters = (
  forwarded: string,
  name: string
): string[] => {
  const values: string[] = [];

  for (const element of splitUnquoted(forwarded, ",")) {
    for (const pair of splitUnquoted(element, ";")) {
      const separator = pair.indexOf("=");

      if (
        separator !== -1 &&
        pair.slice(0, separator).trim().toLowerCase() === name
      ) {
        values.push(unquote(pair.slice(separator + 1).trim()));
      }
    }
  }

  return values;
};
