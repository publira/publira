import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
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

export interface ListAccessTicketsResult {
  message?: string;
  ok: boolean;
  tickets: AccessTicketItem[];
}

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

const mapErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.toLowerCase();
  if (message.includes("permission_denied")) {
    return "この操作を行う権限がありません。";
  }
  if (message.includes("unauthenticated")) {
    return sessionErrorMessage;
  }
  if (message.includes("not_found")) {
    if (message.includes("user")) {
      return "指定したユーザーが見つかりません。";
    }
    if (message.includes("episode")) {
      return "指定したエピソードが見つかりません。";
    }
    return "対象が見つかりません。";
  }
  if (message.includes("failed_precondition")) {
    return "対象ユーザーが有効ではありません。";
  }
  if (message.includes("invalid_argument")) {
    return "入力内容に誤りがあります。";
  }

  return fallback;
};

const mapTicket = (item: {
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  note: string;
  publicId: string;
  revokedAt: string;
  seriesPublicId: string;
  seriesTitle: string;
  status: string;
  userEmail: string;
  userName: string;
  userPublicId: string;
}): AccessTicketItem => ({
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

export const listAccessTickets = async (
  tenantId: string,
  options?: { activeOnly?: boolean }
): Promise<ListAccessTicketsResult> => {
  "use cache: private";
  cacheTag(`access-tickets-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      tickets: [],
    };
  }

  try {
    const response = await apiClient.accessTickets.listAccessTickets(
      {
        activeOnly: options?.activeOnly ?? false,
        limit: 100,
        offset: 0,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      tickets: response.tickets.map(mapTicket),
    };
  } catch (error) {
    return {
      message: mapErrorMessage(error, listErrorMessage),
      ok: false,
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
    return {
      message: mapErrorMessage(error, revokeErrorMessage),
      ok: false,
    };
  }
};
