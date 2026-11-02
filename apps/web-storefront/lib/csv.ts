/**
 * The CSV the reader downloads, laid out the way the consoles' exports are so
 * it opens the same way in a spreadsheet: UTF-8 with a byte order mark, CRLF
 * line endings, and RFC 4180 quoting.
 */

/** The UTF-8 byte order mark, which is what makes Excel read the text as UTF-8. */
export const CSV_BOM = "\uFEFF";

const NEEDS_QUOTES_RE = /[",\r\n]/u;
const FORMULA_LEAD_RE = /^[=+\-@\t\r]/u;

/** `Number` skips surrounding whitespace, which a number field never has. */
const isNumber = (field: string): boolean =>
  field.trim() === field && Number.isFinite(Number(field));

/**
 * A field a spreadsheet would read as a formula is written with a leading
 * apostrophe, since the titles are written by the tenant's staff rather than
 * by the reader opening the file. A signed number is a value, not a formula,
 * and is left as it is.
 */
const neutralize = (field: string): string =>
  FORMULA_LEAD_RE.test(field) && !isNumber(field) ? `'${field}` : field;

/** RFC 4180 quoting, applied only where the field needs it. */
const encodeField = (raw: string): string => {
  const field = neutralize(raw);

  return NEEDS_QUOTES_RE.test(field)
    ? `"${field.replaceAll('"', '""')}"`
    : field;
};

/** One row, with the CRLF that ends it. */
export const encodeCsvRow = (fields: readonly string[]): string =>
  `${fields.map(encodeField).join(",")}\r\n`;
