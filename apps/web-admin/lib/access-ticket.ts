import type { AdminAccessTicket } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
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
import { getAccessToken } from "./session";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "アクセスチケット一覧の取得に失敗しました。時間をおいて再試行してください。";
const issueErrorMessage =
  "アクセスチケットの発行に失敗しました。時間をおいて再試行してください。";
const revokeErrorMessage =
  "アクセスチケットの失効に失敗しました。時間をおいて再試行してください。";

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
 * A ticket names both a user and an episode, so "対象が見つかりません。" is not
 * actionable. The code says only `not_found`, while the server identifies the
 * missing request field with `google.rpc.BadRequest` details.
 */
const missingTargetMessage = (error: unknown): string => {
  if (rpcErrorHasFieldViolation(error, "user_public_id")) {
    return "指定したユーザーが見つかりません。";
  }
  if (rpcErrorHasFieldViolation(error, "episode_public_id")) {
    return "指定したエピソードが見つかりません。";
  }
  return "対象が見つかりません。";
};

const mapErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(error, fallback, {
    "not-found": missingTargetMessage(error),
    precondition: "対象ユーザーが有効ではありません。",
  });

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
  options: ListAccessTicketsOptions = {}
): Promise<ListAccessTicketsResult> => {
  "use cache: private";
  cacheTag(`access-tickets-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: sessionErrorMessage,
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
      message: mapErrorMessage(error, listErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      tickets: [],
    };
  }
};

export const issueAccessTicket = async (
  input: IssueAccessTicketInput
): Promise<IssueAccessTicketResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
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
        message: issueErrorMessage,
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
      message: mapErrorMessage(error, issueErrorMessage),
      ok: false,
    };
  }
};

export const revokeAccessTicket = async (
  tenantId: string,
  publicId: string
): Promise<RevokeAccessTicketResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
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
        message: revokeErrorMessage,
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
      message: mapErrorMessage(error, revokeErrorMessage),
      ok: false,
    };
  }
};
