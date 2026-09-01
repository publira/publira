import type { EpisodeReadThrough } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { cursorPageRequest } from "./cursor-page";
import type { CursorPageOptions } from "./cursor-page";
import { getAccessToken } from "./session";

export interface EpisodeReadThroughItem {
  seriesPublicId: string;
  seriesTitle: string;
  episodePublicId: string;
  episodeTitle: string;
  completeCount: number;
  memberViewCount: number;
}

export interface EpisodeReadThroughPeriod {
  /** Inclusive UTC calendar days (`YYYY-MM-DD`) the report covers. */
  start: string;
  end: string;
}

export type ListEpisodeReadThroughResult =
  | {
      ok: true;
      episodes: EpisodeReadThroughItem[];
      period: EpisodeReadThroughPeriod;
      totalCompleteCount: number;
      totalMemberViewCount: number;
      nextToken: string;
      previousToken: string;
    }
  | {
      ok: false;
      episodes: EpisodeReadThroughItem[];
      message: string;
      nextToken: string;
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * The generated `EpisodeReadThrough` fields {@link mapEpisodeReadThrough} reads
 * (see `series.ts`).
 */
type RawEpisodeReadThrough = Pick<
  EpisodeReadThrough,
  | "completeCount"
  | "episodePublicId"
  | "episodeTitle"
  | "memberViewCount"
  | "seriesPublicId"
  | "seriesTitle"
>;

const mapEpisodeReadThrough = (
  item: RawEpisodeReadThrough
): EpisodeReadThroughItem => ({
  completeCount: Number(item.completeCount ?? 0),
  episodePublicId: item.episodePublicId,
  episodeTitle: item.episodeTitle,
  memberViewCount: Number(item.memberViewCount ?? 0),
  seriesPublicId: item.seriesPublicId,
  seriesTitle: item.seriesTitle,
});

const mapErrorToMessage = (error: unknown, locale: Locale): string =>
  rpcErrorMessage(
    error,
    getMessage(sharedCatalog(locale), "admin.engagement.list_failed"),
    { locale }
  );

/**
 * The share of member views that ended in a completion, or `null` when nothing
 * was viewed. Kept out of the API on purpose: a rate over a zero denominator is
 * not zero, and only the screen can say what it shows in its place.
 */
export const readThroughRate = (
  completeCount: number,
  memberViewCount: number
): number | null =>
  memberViewCount > 0 ? completeCount / memberViewCount : null;

export const listEpisodeReadThrough = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListEpisodeReadThroughResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      episodes: [],
      message: getMessage(sharedCatalog(locale), "errors.rpc.unauthenticated"),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.engagement.listEpisodeReadThrough(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      episodes: (response.episodes ?? []).map((item) =>
        mapEpisodeReadThrough(item)
      ),
      nextToken: response.nextToken ?? "",
      ok: true,
      period: {
        end: response.periodEnd ?? "",
        start: response.periodStart ?? "",
      },
      previousToken: response.previousToken ?? "",
      totalCompleteCount: Number(response.totalCompleteCount ?? 0),
      totalMemberViewCount: Number(response.totalMemberViewCount ?? 0),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      episodes: [],
      message: mapErrorToMessage(error, locale),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
