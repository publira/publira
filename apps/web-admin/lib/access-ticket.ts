import type { AdminAccessTicket } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
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
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export type AccessTicketStatus = "active" | "expired" | "revoked" | string;

export interface AccessTicketItem {
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  id: string;
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
  episodeId: string;
  expiresAt?: string;
  note?: string;
  tenantId: string;
  userId: string;
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
const missingTargetMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasFieldViolation(error, "user_id")) {
    return t("admin.access_tickets.user_not_found");
  }
  if (rpcErrorHasFieldViolation(error, "episode_id")) {
    return t("admin.access_tickets.episode_not_found");
  }
  return t("errors.rpc.not-found");
};

const mapErrorMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "not-found": await missingTargetMessage(error, locale),
      precondition: t("admin.access_tickets.user_not_active"),
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
  | "id"
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
  id: item.id,
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
 * The tag the access ticket list is cached under. Its rows name the episode
 * each ticket opens, so renaming an episode clears it as well as issuing or
 * revoking a ticket does.
 */
export const accessTicketsCacheTag = (tenantId: string): string =>
  `access-tickets-${tenantId}`;

const listAccessTicketsForSession = async (
  tenantId: string,
  locale: Locale,
  options: ListAccessTicketsOptions,
  sessionId: string
): Promise<ListAccessTicketsResult> => {
  "use cache: private";
  cacheTag(accessTicketsCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
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
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: await mapErrorMessage(
        error,
        t("admin.access_tickets.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      tickets: [],
    };
  }
};

/**
 * One page of the tenant's access tickets, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listAccessTickets = async (
  tenantId: string,
  locale: Locale,
  options: ListAccessTicketsOptions = {}
): Promise<ListAccessTicketsResult> =>
  listAccessTicketsForSession(
    tenantId,
    locale,
    options,
    await getAccessToken()
  );

export const issueAccessTicket = async (
  input: IssueAccessTicketInput,
  locale: Locale
): Promise<IssueAccessTicketResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.accessTickets.issueAccessTicket(
      {
        episodeId: input.episodeId,
        expiresAt: input.expiresAt ?? "",
        note: input.note ?? "",
        tenant: { tenantId: input.tenantId },
        userId: input.userId,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.ticket) {
      return {
        message: t("admin.access_tickets.issue_failed"),
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
      message: await mapErrorMessage(
        error,
        t("admin.access_tickets.issue_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const revokeAccessTicket = async (
  tenantId: string,
  ticketId: string,
  locale: Locale
): Promise<RevokeAccessTicketResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.accessTickets.revokeAccessTicket(
      {
        accessTicketId: ticketId,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.ticket) {
      return {
        message: t("admin.access_tickets.revoke_failed"),
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
      message: await mapErrorMessage(
        error,
        t("admin.access_tickets.revoke_failed"),
        locale
      ),
      ok: false,
    };
  }
};
