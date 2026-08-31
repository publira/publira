import type { AdminAccessTicket } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { FALLBACK_LOCALE } from "./fallback-locale";
import { getAccessToken } from "./session";

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.access_tickets.list_failed");
const issueErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.access_tickets.issue_failed");
const revokeErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.access_tickets.revoke_failed");

export type AccessTicketStatus = "active" | "expired" | "revoked" | string;

export interface AccessTicketItem {
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  note: string;
  publicId: string;
  revokedAt: string;
  seriesPublicId: string;
  seriesTitle: string;
  status: AccessTicketStatus;
  userEmail: string;
  userName: string;
  userPublicId: string;
}

export type ListAccessTicketsOptions = CursorPageOptions & {
  activeOnly?: boolean;
  episodePublicId?: string;
  userPublicId?: string;
};

export type ListAccessTicketsResult = CursorPageTokens & {
  message?: string;
  ok: boolean;
  /** The API rejected the session — the page raises the login redirect. */
  requiresSignIn?: boolean;
  tickets: AccessTicketItem[];
};

export interface IssueAccessTicketInput {
  episodePublicId: string;
  expiresAt?: string;
  note?: string;
  tenantId: string;
  userPublicId: string;
}

export type IssueAccessTicketResult =
  | { ok: true; ticket: AccessTicketItem }
  | { message: string; ok: false };

export type RevokeAccessTicketResult =
  | { ok: true; ticket: AccessTicketItem }
  | { message: string; ok: false };

/**
 * A ticket names both a user and an episode, so the shared `not-found` wording
 * is not actionable. The code says only `not_found`, while the server
 * identifies the missing request field with `google.rpc.BadRequest` details.
 */
const missingTargetMessage = (
  error: unknown,
  messages: SharedMessages
): string => {
  if (rpcErrorHasFieldViolation(error, "user_public_id")) {
    return getMessage(messages, "admin.access_tickets.user_not_found");
  }
  if (rpcErrorHasFieldViolation(error, "episode_public_id")) {
    return getMessage(messages, "admin.access_tickets.episode_not_found");
  }
  return getMessage(messages, "errors.rpc.not-found");
};

const mapErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => {
  const messages = sharedCatalog(locale);

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "not-found": missingTargetMessage(error, messages),
      precondition: getMessage(
        messages,
        "admin.access_tickets.user_not_active"
      ),
    },
  });
};

/** The generated `AdminAccessTicket` fields {@link mapTicket} reads (see `series.ts`). */
type RawAccessTicket = Pick<
  AdminAccessTicket,
  | "createdAt"
  | "episodePublicId"
  | "episodeTitle"
  | "expiresAt"
  | "note"
  | "publicId"
  | "revokedAt"
  | "seriesPublicId"
  | "seriesTitle"
  | "status"
  | "userEmail"
  | "userName"
  | "userPublicId"
>;

const mapTicket = (item: RawAccessTicket): AccessTicketItem => ({
  createdAt: item.createdAt,
  episodePublicId: item.episodePublicId,
  episodeTitle: item.episodeTitle,
  expiresAt: item.expiresAt,
  note: item.note,
  publicId: item.publicId,
  revokedAt: item.revokedAt,
  seriesPublicId: item.seriesPublicId,
  seriesTitle: item.seriesTitle,
  status: item.status,
  userEmail: item.userEmail,
  userName: item.userName,
  userPublicId: item.userPublicId,
});

/**
 * One page of the tenant's access tickets, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listAccessTickets = async (
  tenantId: string,
  options: ListAccessTicketsOptions = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListAccessTicketsResult> => {
  "use cache: private";
  cacheTag(`access-tickets-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
      tickets: [],
    };
  }

  try {
    const response = await apiClient.accessTickets.listAccessTickets(
      {
        ...cursorPageRequest(options),
        activeOnly: options.activeOnly ?? false,
        episodePublicId: options.episodePublicId ?? "",
        tenant: { tenantId },
        userPublicId: options.userPublicId ?? "",
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      ok: true,
      tickets: response.tickets.map(mapTicket),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      message: mapErrorMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      tickets: [],
    };
  }
};

export const issueAccessTicket = async (
  input: IssueAccessTicketInput,
  locale: Locale = FALLBACK_LOCALE
): Promise<IssueAccessTicketResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.accessTickets.issueAccessTicket(
      {
        episodePublicId: input.episodePublicId,
        expiresAt: input.expiresAt ?? "",
        note: input.note ?? "",
        tenant: { tenantId: input.tenantId },
        userPublicId: input.userPublicId,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.ticket) {
      return {
        message: issueErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      ticket: mapTicket(response.ticket),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, issueErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const revokeAccessTicket = async (
  tenantId: string,
  publicId: string,
  locale: Locale = FALLBACK_LOCALE
): Promise<RevokeAccessTicketResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.accessTickets.revokeAccessTicket(
      {
        publicId,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.ticket) {
      return {
        message: revokeErrorMessage(messages),
        ok: false,
      };
    }

    return {
      ok: true,
      ticket: mapTicket(response.ticket),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorMessage(error, revokeErrorMessage(messages), locale),
      ok: false,
    };
  }
};
