import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * The two states one message can be in, as
 * `proto/publira/admin/v1/contact.proto` names them.
 *
 * Kept as the API's own strings because they are also the filter the list RPC
 * takes, which answers `invalid_argument` for anything else.
 */
export const CONTACT_MESSAGE_STATUSES = ["unhandled", "handled"] as const;

export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

/**
 * One message a reader sent the tenant.
 *
 * The list carries the whole body already, so the same shape serves the inbox
 * and the message a member of staff opens to answer from.
 */
export interface ContactMessageItem {
  body: string;
  /** When the message arrived, as an absolute API timestamp. */
  createdAt: string;
  /** When staff marked it dealt with. Empty while it is still waiting. */
  handledAt: string;
  publicId: string;
  /** The address staff answer at, as the reader typed it. */
  replyToEmail: string;
  /** Empty for a guest, and for a reader whose account has been deleted. */
  senderName: string;
  /** Empty in the same two cases as {@link ContactMessageItem.senderName}. */
  senderPublicId: string;
  /** Empty for a message the reader gave no subject. */
  subject: string;
}

/** Whether staff have dealt with one message, which is the time they did. */
export const contactMessageStatus = (
  message: Pick<ContactMessageItem, "handledAt">
): ContactMessageStatus => (message.handledAt ? "handled" : "unhandled");

export type ListContactMessagesResult = CursorPageTokens &
  (
    | {
        messages: ContactMessageItem[];
        ok: true;
      }
    | {
        message: string;
        messages: ContactMessageItem[];
        ok: false;
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

/**
 * `notFound` covers a message that never existed and another tenant's alike:
 * the API never tells them apart, so neither does the page.
 */
export type GetContactMessageResult =
  | { contactMessage: ContactMessageItem; ok: true }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };
