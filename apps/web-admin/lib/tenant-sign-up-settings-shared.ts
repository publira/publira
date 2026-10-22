/**
 * The longest message, in characters, the sign-up card takes, mirroring the
 * bound the Go server enforces (`signupsettings.MaxClosedMessageLength`).
 * The form checks it only so an operator is told before a round trip; the
 * server stays the authority.
 */
export const MAX_SIGN_UP_CLOSED_MESSAGE_LENGTH = 1000;

/**
 * The length the server measures a message by: Unicode characters of the
 * trimmed text, not the UTF-16 code units `String.length` counts, so a message
 * with emoji in it is not refused short of the bound.
 */
export const signUpClosedMessageLength = (value: string): number =>
  [...value.trim()].length;
