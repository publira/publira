import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * The three states one message can be in, as
 * `proto/publira/admin/v1/contact.proto` names them, in the order a message
 * moves through them.
 *
 * Kept as the API's own strings because they are also the filter the list RPC
 * takes, which answers `invalid_argument` for anything else.
 */
export const CONTACT_MESSAGE_STATUSES = [
  "unhandled",
  "in_progress",
  "handled",
] as const;

export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

/**
 * The longest staff note `UpdateContactMessageStaffNote` accepts once its
 * surrounding whitespace is trimmed, counted in Unicode code points as the
 * API and PostgreSQL count characters.
 */
export const CONTACT_MESSAGE_STAFF_NOTE_MAX_LENGTH = 4000;

/**
 * One message a reader sent the tenant.
 *
 * The list carries the whole body already, so the same shape serves the inbox
 * and the message a member of staff opens to answer from.
 */
export interface ContactMessageItem {
  /**
   * The member of staff the message is assigned to, which is not who marked it
   * handled. All three are empty while nobody is assigned. `assigneeUserId` is
   * what an assignment names them by.
   */
  assigneeName: string;
  /** Empty in the same case as {@link ContactMessageItem.assigneeName}. */
  assigneePublicId: string;
  /** Empty in the same case as {@link ContactMessageItem.assigneeName}. */
  assigneeUserId: string;
  body: string;
  /** When the message arrived, as an absolute API timestamp. */
  createdAt: string;
  /** When staff marked it dealt with. Empty while it is still waiting. */
  handledAt: string;
  /** The primary key, which the actions on the message address it by. */
  id: string;
  /** The identifier the message's URL carries. */
  publicId: string;
  /** The address staff answer at, as the reader typed it. */
  replyToEmail: string;
  /** Empty for a guest, and for a reader whose account has been deleted. */
  senderName: string;
  /** Empty in the same two cases as {@link ContactMessageItem.senderName}. */
  senderPublicId: string;
  /**
   * The internal note staff keep on the message, one shared current note
   * rather than a thread. Empty when there is none. Readers never see it.
   */
  staffNote: string;
  /** Where the message stands in the inbox, as the API derived it. */
  status: ContactMessageStatus;
  /** Empty for a message the reader gave no subject. */
  subject: string;
}

/**
 * A member of staff a message can be assigned to: an active tenant admin, the
 * only kind of account that can open the inbox.
 */
export interface ContactMessageAssigneeOption {
  /** The account's display name, or its email address when it has none. */
  name: string;
  /** What `GetMe` names the signed-in account by. */
  userPublicId: string;
  /** What an assignment names the account by. */
  userId: string;
}

export type ListContactMessageAssigneesResult =
  | { assignees: ContactMessageAssigneeOption[]; ok: true }
  | {
      assignees: ContactMessageAssigneeOption[];
      message: string;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

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
