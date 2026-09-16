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
