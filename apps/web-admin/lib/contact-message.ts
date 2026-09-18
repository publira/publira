import type { ContactMessage } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import type {
  ContactMessageItem,
  GetContactMessageResult,
  ListContactMessagesResult,
} from "../app/[tenant_id]/(protected)/contact-messages/contact-message-types";
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
 * Neither read is cached: a message arrives from the storefront, and nothing on
 * that path can drop a cache entry web-admin holds.
 */

/** The generated `ContactMessage` fields {@link mapContactMessage} reads. */
type RawContactMessage = Pick<
  ContactMessage,
  | "body"
  | "createdAt"
  | "handledAt"
  | "publicId"
  | "replyToEmail"
  | "senderName"
  | "senderPublicId"
  | "subject"
>;

const mapContactMessage = (item: RawContactMessage): ContactMessageItem => ({
  body: item.body ?? "",
  createdAt: item.createdAt ?? "",
  handledAt: item.handledAt ?? "",
  publicId: item.publicId ?? "",
  replyToEmail: item.replyToEmail ?? "",
  senderName: item.senderName ?? "",
  senderPublicId: item.senderPublicId ?? "",
  subject: item.subject ?? "",
});

export interface ListContactMessagesFilters extends CursorPageOptions {
  /** Empty lists both states. */
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
  /** True marks the message dealt with, false puts it back among the waiting. */
  handled: boolean;
  publicId: string;
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
        handled: input.handled,
        publicId: input.publicId,
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
