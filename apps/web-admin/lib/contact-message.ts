import type {
  ContactMessage,
  ContactMessageEntry,
  TenantMember,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";

import type {
  ContactMessageAssigneeOption,
  ContactMessageEntryDirection,
  ContactMessageEntryItem,
  ContactMessageItem,
  ContactMessageStatus,
  GetContactMessageResult,
  ListContactMessageAssigneesResult,
  ListContactMessagesResult,
} from "../app/[tenant_id]/(protected)/contact-messages/contact-message-types";
import { CONTACT_MESSAGE_STATUSES } from "../app/[tenant_id]/(protected)/contact-messages/contact-message-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/*
 * None of the reads is cached: a message arrives from the storefront, and nothing on
 * that path can drop a cache entry web-admin holds.
 */

/** The generated `ContactMessageEntry` fields {@link mapContactMessageEntry} reads. */
type RawContactMessageEntry = Pick<
  ContactMessageEntry,
  | "authorName"
  | "authorPublicId"
  | "body"
  | "createdAt"
  | "direction"
  | "fromEmail"
  | "id"
>;

/** The generated `ContactMessage` fields {@link mapContactMessage} reads. */
type RawContactMessage = Pick<
  ContactMessage,
  | "assigneeName"
  | "assigneePublicId"
  | "assigneeUserId"
  | "body"
  | "createdAt"
  | "entries"
  | "entryCount"
  | "handledAt"
  | "id"
  | "publicId"
  | "replyToEmail"
  | "senderName"
  | "senderPublicId"
  | "staffNote"
  | "status"
  | "subject"
>;

const knownStatuses: ReadonlySet<string> = new Set(CONTACT_MESSAGE_STATUSES);

const isContactMessageStatus = (value: string): value is ContactMessageStatus =>
  knownStatuses.has(value);

/**
 * The status the API derived, or the same derivation made here when it sent
 * none: a message is `handled` once somebody dealt with it, and otherwise
 * `in_progress` while somebody is assigned and `unhandled` while nobody is.
 */
const contactMessageStatus = (
  item: RawContactMessage
): ContactMessageStatus => {
  const status = item.status ?? "";
  if (isContactMessageStatus(status)) {
    return status;
  }
  if (item.handledAt) {
    return "handled";
  }
  return item.assigneeUserId ? "in_progress" : "unhandled";
};

/**
 * The API names only two directions; anything else is read as the reader's,
 * so an entry is never shown under a member of staff it does not name.
 */
const contactMessageEntryDirection = (
  direction: string | undefined
): ContactMessageEntryDirection => (direction === "staff" ? "staff" : "reader");

const mapContactMessageEntry = (
  entry: RawContactMessageEntry
): ContactMessageEntryItem => ({
  authorName: entry.authorName ?? "",
  authorPublicId: entry.authorPublicId ?? "",
  body: entry.body ?? "",
  createdAt: entry.createdAt ?? "",
  direction: contactMessageEntryDirection(entry.direction),
  fromEmail: entry.fromEmail ?? "",
  id: entry.id ?? "",
});

const mapContactMessage = (item: RawContactMessage): ContactMessageItem => ({
  assigneeName: item.assigneeName ?? "",
  assigneePublicId: item.assigneePublicId ?? "",
  assigneeUserId: item.assigneeUserId ?? "",
  body: item.body ?? "",
  createdAt: item.createdAt ?? "",
  entries: (item.entries ?? []).map((entry) => mapContactMessageEntry(entry)),
  entryCount: item.entryCount ?? 0,
  handledAt: item.handledAt ?? "",
  id: item.id ?? "",
  publicId: item.publicId ?? "",
  replyToEmail: item.replyToEmail ?? "",
  senderName: item.senderName ?? "",
  senderPublicId: item.senderPublicId ?? "",
  staffNote: item.staffNote ?? "",
  status: contactMessageStatus(item),
  subject: item.subject ?? "",
});

export interface ListContactMessagesFilters extends CursorPageOptions {
  /** Empty lists every state. */
  status?: string;
}

/** One page of the messages readers sent the tenant, newest first. */
export const listContactMessages = async (
  tenantId: string,
  locale: Locale,
  filters: ListContactMessagesFilters = {}
): Promise<ListContactMessagesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      messages: [],
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.contact.listContactMessages(
      {
        ...cursorPageRequest(filters),
        status: filters.status?.trim() ?? "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      messages: (response.messages ?? []).map((item) =>
        mapContactMessage(item)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      message: rpcErrorMessage(error, t("admin.contact_messages.list_failed"), {
        locale,
      }),
      messages: [],
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/** One message in full. */
export const getContactMessage = async (
  tenantId: string,
  locale: Locale,
  publicId: string
): Promise<GetContactMessageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.contact.getContactMessage(
      { publicId, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );
    if (!response.message?.publicId) {
      return {
        message: t("admin.contact_messages.detail_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { contactMessage: mapContactMessage(response.message), ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.contact_messages.detail_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export interface MarkContactMessageHandledInput {
  contactMessageId: string;
  /** True marks the message dealt with, false puts it back among the waiting. */
  handled: boolean;
  tenantId: string;
}

export type MarkContactMessageHandledResult =
  | { message: string; ok: false }
  | { ok: true };

/**
 * Marks one message dealt with, or puts it back among the ones still waiting.
 * A rejected session leaves as a throw so the Action can send the staff member
 * to sign in again.
 */
export const markContactMessageHandled = async (
  input: MarkContactMessageHandledInput,
  locale: Locale
): Promise<MarkContactMessageHandledResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.contact.markContactMessageHandled(
      {
        contactMessageId: input.contactMessageId,
        handled: input.handled,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const failed = input.handled
      ? t("admin.contact_messages.mark_handled_failed")
      : t("admin.contact_messages.reopen_failed");
    return {
      message: rpcErrorMessage(error, failed, { locale }),
      ok: false,
    };
  }
};

export interface AssignContactMessageInput {
  /** The `userId` of the member of staff to assign. Empty clears it. */
  assigneeUserId: string;
  contactMessageId: string;
  tenantId: string;
}

export type AssignContactMessageResult =
  | { message: string; ok: false }
  | { ok: true };

/**
 * Assigns one message to a member of staff, moves it to another, or clears the
 * assignment. A rejected session leaves as a throw so the Action can send the
 * staff member to sign in again.
 */
export const assignContactMessage = async (
  input: AssignContactMessageInput,
  locale: Locale
): Promise<AssignContactMessageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.contact.assignContactMessage(
      {
        assigneeUserId: input.assigneeUserId,
        contactMessageId: input.contactMessageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const failed = input.assigneeUserId
      ? t("admin.contact_messages.assign_failed")
      : t("admin.contact_messages.unassign_failed");
    return {
      message: rpcErrorMessage(error, failed, { locale }),
      ok: false,
    };
  }
};

export interface UpdateContactMessageStaffNoteInput {
  contactMessageId: string;
  /** The whole note, replacing the one stored. Empty clears it. */
  staffNote: string;
  tenantId: string;
}

export type UpdateContactMessageStaffNoteResult =
  | { message: string; ok: false }
  | { ok: true };

/**
 * Saves, replaces, or clears the internal note on one message. A rejected
 * session leaves as a throw so the Action can send the staff member to sign in
 * again.
 */
export const updateContactMessageStaffNote = async (
  input: UpdateContactMessageStaffNoteInput,
  locale: Locale
): Promise<UpdateContactMessageStaffNoteResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.contact.updateContactMessageStaffNote(
      {
        contactMessageId: input.contactMessageId,
        staffNote: input.staffNote,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.contact_messages.staff_note_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

export interface ReplyToContactMessageInput {
  /** The answer, already trimmed and bounded. */
  body: string;
  contactMessageId: string;
  tenantId: string;
}

export type ReplyToContactMessageResult =
  | { message: string; ok: false }
  | { ok: true };

/**
 * Answers one message: the API stores the answer under it, marks it handled,
 * and queues the mail to the reader. A rejected session leaves as a throw so
 * the Action can send the staff member to sign in again.
 */
export const replyToContactMessage = async (
  input: ReplyToContactMessageInput,
  locale: Locale
): Promise<ReplyToContactMessageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.contact.replyToContactMessage(
      {
        body: input.body,
        contactMessageId: input.contactMessageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.contact_messages.reply.failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

type RawTenantMember = Pick<
  TenantMember,
  "email" | "name" | "role" | "status" | "userId" | "userPublicId"
>;

/**
 * The account `AssignContactMessage` accepts: an active tenant admin, because
 * the inbox is theirs alone.
 */
const isAssignableMember = (member: RawTenantMember): boolean =>
  member.role === "tenant_admin" &&
  member.status === "active" &&
  Boolean(member.userId);

/**
 * Every member of staff a message can be assigned to, for the assignment
 * picker.
 *
 * Walks every page of the member list, and fails rather than handing back the
 * part it read: a picker missing somebody looks complete.
 */
export const listContactMessageAssignees = async (
  tenantId: string,
  locale: Locale
): Promise<ListContactMessageAssigneesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      assignees: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const assignees: ContactMessageAssigneeOption[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.members.listTenantMembers(
          { limit, tenant: { tenantId }, token },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.members ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (members) => {
        for (const member of members) {
          if (isAssignableMember(member)) {
            assignees.push({
              name: member.name?.trim() || (member.email ?? ""),
              userId: member.userId ?? "",
              userPublicId: member.userPublicId ?? "",
            });
          }
        }
      }
    );
    if (walkStop !== "completed") {
      return {
        assignees: [],
        message: t("admin.contact_messages.assignees_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { assignees, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      assignees: [],
      message: rpcErrorMessage(
        error,
        t("admin.contact_messages.assignees_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
