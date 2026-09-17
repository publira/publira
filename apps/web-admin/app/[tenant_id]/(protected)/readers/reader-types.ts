import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * The three account states a reader can be in, as
 * `proto/publira/admin/v1/user.proto` defines them.
 *
 * Kept as the API's own strings because they are also the filter the list RPC
 * takes, which answers `invalid_argument` for anything else.
 */
export const READER_STATUSES = ["active", "suspended", "inactive"] as const;

export type ReaderStatus = (typeof READER_STATUSES)[number];

export interface ReaderItem {
  /** When the account was created, as an absolute API timestamp. */
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  status: ReaderStatus;
}

export type ListReadersResult = CursorPageTokens &
  (
    | {
        ok: true;
        readers: ReaderItem[];
      }
    | {
        message: string;
        ok: false;
        readers: ReaderItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

/** One reader's account, with the fields only the detail page shows. */
export interface ReaderDetail extends ReaderItem {
  /** When the reader confirmed their address. Empty until they have. */
  emailVerifiedAt: string;
  /** Whether a birth date is recorded; the date itself stays with the reader. */
  hasBirthDate: boolean;
}

/**
 * `notFound` covers a missing account, a staff account, and another tenant's
 * reader alike: the API never tells them apart, so neither does the page.
 */
export type GetReaderResult =
  | { ok: true; reader: ReaderDetail }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };
