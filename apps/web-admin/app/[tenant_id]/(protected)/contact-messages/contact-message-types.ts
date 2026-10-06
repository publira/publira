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
 * The longest answer `ReplyToContactMessage` accepts once its surrounding
 * whitespace is trimmed, counted in Unicode code points: the bounds of the
 * reader's own message, which the contact form on the public site enforces.
 */
export const CONTACT_MESSAGE_REPLY_MAX_LENGTH = 4000;

/**
 * Who wrote one entry of the exchange, as `ContactMessageEntry.direction` names
 * it: an answer sent from the console, or a reply the reader mailed back.
 */
export type ContactMessageEntryDirection = "reader" | "staff";

/** One turn of the exchange that followed a message. */
export interface ContactMessageEntryItem {
  /**
   * The member of staff who wrote a staff entry. Both are empty on a reader
   * entry, and on a staff entry whose author's account has been deleted since.
   */
  authorName: string;
  /** Empty in the same cases as {@link ContactMessageEntryItem.authorName}. */
  authorPublicId: string;
  body: string;
  /** When it was written, as an absolute API timestamp. */
  createdAt: string;
  direction: ContactMessageEntryDirection;
  /**
   * The address a reader entry was mailed from, which need not be the
   * message's reply-to address. Empty on a staff entry.
   */
  fromEmail: string;
  id: string;
}

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
  /**
   * The exchange under the message, oldest first, so the newest is last. Only
   * a read of one message fills it; the inbox leaves it empty and says how
   * long it is in {@link ContactMessageItem.entryCount}.
   */
  entries: ContactMessageEntryItem[];
  /**
   * How many entries the message has, on the inbox and the detail alike. Zero
   * until somebody answers it, because the reader can only write back to an
   * answer.
   */
  entryCount: number;
  /** When the message arrived, as an absolute API timestamp. */
  createdAt: string;
  /** When staff marked it dealt with. Empty while it is still waiting. */
  handledAt: string;
  /** The primary key, which the actions on the message address it by. */
  id: string;
  /** The identifier the message's URL carries. */
  publicId: string;
  /** The address an answer goes to, as the reader typed it. */
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
