/**
 * The rule an entry of the tenant's refused email addresses is held to, as the
 * Go server writes it in `server/internal/emailrejection`: an entry with an @
 * is an address, any other a domain of two labels or more. The settings card
 * checks each field once the operator leaves it and the Server Action checks
 * the list again before it is sent, so an operator is told which entry is
 * wrong without a round trip. The server stays the authority, and a refusal from it is still worded
 * by the card.
 *
 * Kept apart from `tenant-email-rejection-settings.ts` because the settings
 * card is a Client Component: importing from the module that reads the session
 * would pull `next/headers` into the browser graph.
 */

/** The longest list the server accepts, after blank lines and duplicates are dropped. */
export const MAX_EMAIL_REJECTION_ENTRIES = 1000;

/** The longest address SMTP carries, and so the longest entry that could match one. */
const MAX_ENTRY_BYTES = 254;
/** The longest local part SMTP carries. */
const MAX_LOCAL_BYTES = 64;
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/** The ASCII characters RFC 5322 allows in a dot-atom besides letters and digits. */
const ATEXT_SYMBOLS = new Set("!#$%&'*+-/=?^_`{|}~");

/** Characters a host cannot hold, which `URL` would read as the end of one. */
const HOST_DELIMITER = /[\s#%/:?@[\\\]]/u;

const LABEL = /^[\da-z-]+$/u;

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).length;

const isAscii = (value: string): boolean =>
  [...value].every((character) => (character.codePointAt(0) ?? 0) <= 0x7f);

/**
 * A dot-atom: atext characters, or any non-ASCII character, separated by single
 * dots. A local part that is only a `+` tag names no mailbox.
 */
const isValidLocal = (local: string): boolean => {
  if (
    local === "" ||
    !local.isWellFormed() ||
    utf8Length(local) > MAX_LOCAL_BYTES ||
    local.startsWith("+")
  ) {
    return false;
  }
  return local
    .split(".")
    .every(
      (atom) =>
        atom !== "" &&
        [...atom].every(
          (character) =>
            (character.codePointAt(0) ?? 0) > 0x7f ||
            /^[\da-z]$/iu.test(character) ||
            ATEXT_SYMBOLS.has(character)
        )
    );
};

/**
 * `disposabledomains.IsDomain`: an ASCII host name of two labels or more, each
 * of letters, digits, and hyphens and neither starting nor ending with one.
 *
 * The server reads a domain through IDNA's lookup profile first, which also
 * refuses a label with hyphens in its third and fourth places unless it is an
 * `xn--` label. Whether an `xn--` label decodes is left to the server.
 */
const isAsciiDomain = (name: string): boolean => {
  if (name.length > MAX_DOMAIN_LENGTH) {
    return false;
  }
  const labels = name.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= MAX_LABEL_LENGTH &&
        LABEL.test(label) &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        (label.slice(2, 4) !== "--" || label.startsWith("xn--"))
    )
  );
};

/**
 * The ASCII form of a lowercased domain, or `null` when it is not one. A
 * domain written in Unicode is converted the way a browser converts a host,
 * which applies the same UTS #46 mapping the server's IDNA profile does.
 */
const toAsciiDomain = (domain: string): string | null => {
  const name = domain.endsWith(".") ? domain.slice(0, -1) : domain;
  if (isAscii(name)) {
    return isAsciiDomain(name) ? name : null;
  }
  if (HOST_DELIMITER.test(name) || !name.isWellFormed()) {
    return null;
  }
  let host: string;
  try {
    ({ hostname: host } = new URL(`http://${name}/`));
  } catch {
    return null;
  }
  return isAsciiDomain(host) ? host : null;
};

/**
 * One entry as the server compares it — the address or domain with the domain
 * in ASCII — or `null` when it is neither.
 */
const toEntryKey = (entry: string): string | null => {
  const value = entry.trim().toLowerCase();
  if (utf8Length(value.replace(/\.$/u, "")) > MAX_ENTRY_BYTES) {
    return null;
  }
  // The last @, as the server splits: a quoted local part may hold one of its
  // own, and it is refused below as a local part rather than read as a domain.
  const at = value.lastIndexOf("@");
  if (at === -1) {
    return toAsciiDomain(value);
  }
  const local = value.slice(0, at);
  const host = toAsciiDomain(value.slice(at + 1));
  return host !== null && isValidLocal(local) ? `${local}@${host}` : null;
};

/** Whether the server would store `entry`, which must not be blank. */
export const isEmailRejectionEntry = (entry: string): boolean =>
  toEntryKey(entry) !== null;

export type EmailRejectionEntriesResult =
  | {
      ok: true;
      /** The non-blank entries, trimmed, for the server to normalize. */
      entries: string[];
    }
  | { ok: false; reason: "entry_invalid"; entry: string }
  | { ok: false; reason: "too_many" };

/** The entries as the server would take them; blank ones are dropped. */
export const parseEmailRejectionEntries = (
  values: readonly string[]
): EmailRejectionEntriesResult => {
  const entries: string[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const entry = value.trim();
    if (entry === "") {
      continue;
    }
    const key = toEntryKey(entry);
    if (key === null) {
      return { entry, ok: false, reason: "entry_invalid" };
    }
    entries.push(entry);
    keys.add(key);
  }
  // Counted after duplicates are dropped, as the server counts.
  if (keys.size > MAX_EMAIL_REJECTION_ENTRIES) {
    return { ok: false, reason: "too_many" };
  }
  return { entries, ok: true };
};

/** The entries a pasted text names, one a line, trimmed, blank lines dropped. */
export const splitPastedEmailRejectionEntries = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
