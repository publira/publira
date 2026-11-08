import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  RPC_ERROR_REASON,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import {
  ClientSurface,
  CreatorStatementLineSource,
} from "@publira/api-client/public/types";
import type {
  MyCreator,
  MyCreatorEpisodeComment,
  MyCreatorEpisodeStats,
  MyCreatorStatement,
  MyCreatorStatementLine,
} from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  applyCacheTag,
  tenantCreatorCommentsTag,
  tenantCreatorPagesTag,
} from "./cache-tags";
import { toPublicComment } from "./comments";
import type { EpisodeCommentItem } from "./comments";
import { getMessagesFor } from "./messages";
import type { StorefrontMessageKey } from "./messages";

/** An Author the signed-in reader's account is linked to. */
export interface MyCreatorItem {
  /** The primary key, which the other reads and the page's path name it by. */
  id: string;
  /** Empty for an Author with no icon. */
  iconImageUrl: string;
  name: string;
  publicId: string;
}

export interface MyCreators {
  /** Oldest link first, which is the order the tabs show them in. */
  creators: MyCreatorItem[];
  /** Whether the tenant shows its Authors their sales and statements. */
  salesVisible: boolean;
}

export interface MyCreatorEpisodeStatsItem {
  completeCount: bigint;
  episodePublicId: string;
  episodeTitle: string;
  memberViewCount: bigint;
  /** Absent while the tenant does not show its Authors their sales. */
  netAmount?: bigint;
  /** Absent while the tenant does not show its Authors their sales. */
  purchaseCount?: bigint;
  seriesPublicId: string;
  seriesTitle: string;
}

/** How the Author's episodes were read over the tenant's last 28 whole days. */
export interface MyCreatorStats {
  /** ISO 4217 code every `netAmount` is in. */
  currency: string;
  episodes: MyCreatorEpisodeStatsItem[];
  followerCount: bigint;
  nextToken: string;
  /** `YYYY-MM-DD`, in `timeZone`. */
  periodEnd: string;
  /** `YYYY-MM-DD`, in `timeZone`. */
  periodStart: string;
  previousToken: string;
  timeZone: string;
  totalCompleteCount: bigint;
  totalMemberViewCount: bigint;
}

/** The Author's part of one closed month. */
export interface MyCreatorStatementItem {
  /** RFC 3339. */
  closedAt: string;
  /** ISO 4217 code every amount is in: the tenant's at close. */
  currency: string;
  grossAmount: bigint;
  payoutAmount: bigint;
  /** `YYYY-MM`. */
  period: string;
  refundedAmount: bigint;
  saleCount: bigint;
  timeZone: string;
}

export interface MyCreatorStatementPage {
  nextToken: string;
  previousToken: string;
  statements: MyCreatorStatementItem[];
}

export interface MyCreatorStatementLineItem {
  /** `YYYY-MM` of the closed month an adjustment adjusts; empty otherwise. */
  adjustedPeriod: string;
  episodePublicId: string;
  episodeTitle: string;
  grossAmount: bigint;
  lineNumber: number;
  payoutAmount: bigint;
  refundedAmount: bigint;
  /** Empty for a credit that states no role. */
  roleName: string;
  saleCount: number;
  seriesPublicId: string;
  seriesTitle: string;
  /** Basis points, 10000 being all of it. */
  shareBps: number;
  source: "sale" | "subscription" | "tip";
}

export interface MyCreatorStatementDetail {
  lines: MyCreatorStatementLineItem[];
  nextToken: string;
  previousToken: string;
  statement: MyCreatorStatementItem;
}

/** A published comment on one of the Author's episodes, with that episode. */
export interface MyCreatorCommentItem {
  comment: EpisodeCommentItem;
  episodePublicId: string;
  episodeTitle: string;
  seriesPublicId: string;
  seriesTitle: string;
}

export interface MyCreatorCommentPage {
  /** Newest first. */
  comments: MyCreatorCommentItem[];
  nextToken: string;
  previousToken: string;
}

/**
 * A read of an Author page. `missing` is every answer that leaves the page
 * nothing to show: the tenant shows no Author pages, the account is not linked
 * to the Author named, the month is not closed, or the tenant hides the sales a
 * statement is made of. The API does not tell the first two apart from the
 * outside, and neither does the page.
 */
export type CreatorPageRead<TValue> =
  | { ok: true; value: TValue }
  | { missing: true; ok: false }
  | { message: string; missing: false; ok: false; requiresSignIn: boolean };

type CachedCreatorPageRead<TValue> = CreatorPageRead<TValue> & {
  unexpected: boolean;
};

const defaultPageSize = 20;

/** The largest page `GetMyCreatorStatement` answers. */
const maxPageSize = 100;

const isRefusal = (cause: unknown): boolean =>
  isMissingResourceRpcError(cause) ||
  rpcErrorHasReason(cause, RPC_ERROR_REASON.creatorPagesDisabled) ||
  rpcErrorHasReason(cause, RPC_ERROR_REASON.creatorSalesHidden);

const signInRequired = async (
  locale: Locale
): Promise<CachedCreatorPageRead<never>> => {
  const t = await getMessagesFor(locale);

  return {
    message: t("errors.rpc.unauthenticated"),
    missing: false,
    ok: false,
    requiresSignIn: true,
    unexpected: false,
  };
};

/**
 * Turns a failed read into what the page does with it. It runs inside a
 * `"use cache: private"` scope, where a throw fails the whole request, so an
 * error nothing classifies is carried out as `unexpected` for
 * {@link settle} to throw.
 */
const readFailure = async (
  cause: unknown,
  locale: Locale,
  key: StorefrontMessageKey
): Promise<CachedCreatorPageRead<never>> => {
  dropFailedCacheEntry();

  if (isRefusal(cause)) {
    return { missing: true, ok: false, unexpected: false };
  }

  const t = await getMessagesFor(locale);

  return {
    message: rpcErrorMessage(cause, t(key), { locale }),
    missing: false,
    ok: false,
    requiresSignIn: isRpcError(cause, Code.Unauthenticated),
    unexpected: rpcErrorDisposition(cause) === "unexpected",
  };
};

/** Throws what the cached read could not, and hands the rest to the page. */
const settle = async <TValue>(
  read: Promise<CachedCreatorPageRead<TValue>>
): Promise<CreatorPageRead<TValue>> => {
  const { unexpected, ...result } = await read;

  if (unexpected && !result.ok && !result.missing) {
    throw new Error(result.message);
  }

  return result;
};

type RawMyCreator = Pick<
  MyCreator,
  "iconImageUrl" | "id" | "name" | "publicId"
>;

const toMyCreatorItem = (creator: RawMyCreator): MyCreatorItem => ({
  iconImageUrl: creator.iconImageUrl.trim(),
  id: creator.id,
  name: creator.name,
  publicId: creator.publicId,
});

type RawEpisodeStats = Pick<
  MyCreatorEpisodeStats,
  | "completeCount"
  | "episodePublicId"
  | "episodeTitle"
  | "memberViewCount"
  | "netAmount"
  | "purchaseCount"
  | "seriesPublicId"
  | "seriesTitle"
>;

const toEpisodeStatsItem = (
  episode: RawEpisodeStats
): MyCreatorEpisodeStatsItem => ({
  completeCount: episode.completeCount,
  episodePublicId: episode.episodePublicId,
  episodeTitle: episode.episodeTitle,
  memberViewCount: episode.memberViewCount,
  netAmount: episode.netAmount,
  purchaseCount: episode.purchaseCount,
  seriesPublicId: episode.seriesPublicId,
  seriesTitle: episode.seriesTitle,
});

type RawStatement = Pick<
  MyCreatorStatement,
  | "closedAt"
  | "currency"
  | "grossAmount"
  | "payoutAmount"
  | "period"
  | "refundedAmount"
  | "saleCount"
  | "timeZone"
>;

const toStatementItem = (statement: RawStatement): MyCreatorStatementItem => ({
  closedAt: statement.closedAt,
  currency: statement.currency,
  grossAmount: statement.grossAmount,
  payoutAmount: statement.payoutAmount,
  period: statement.period,
  refundedAmount: statement.refundedAmount,
  saleCount: statement.saleCount,
  timeZone: statement.timeZone,
});

type RawStatementLine = Pick<
  MyCreatorStatementLine,
  | "adjustedPeriod"
  | "episodePublicId"
  | "episodeTitle"
  | "grossAmount"
  | "lineNumber"
  | "payoutAmount"
  | "refundedAmount"
  | "roleName"
  | "saleCount"
  | "seriesPublicId"
  | "seriesTitle"
  | "shareBps"
  | "source"
>;

/** Unspecified, which the server never answers, reads as a line of sales. */
const toLineSource = (
  source: CreatorStatementLineSource
): MyCreatorStatementLineItem["source"] => {
  switch (source) {
    case CreatorStatementLineSource.SUBSCRIPTION: {
      return "subscription";
    }

    case CreatorStatementLineSource.TIP: {
      return "tip";
    }

    default: {
      return "sale";
    }
  }
};

const toStatementLineItem = (
  line: RawStatementLine
): MyCreatorStatementLineItem => ({
  adjustedPeriod: line.adjustedPeriod,
  episodePublicId: line.episodePublicId,
  episodeTitle: line.episodeTitle,
  grossAmount: line.grossAmount,
  lineNumber: line.lineNumber,
  payoutAmount: line.payoutAmount,
  refundedAmount: line.refundedAmount,
  roleName: line.roleName,
  saleCount: line.saleCount,
  seriesPublicId: line.seriesPublicId,
  seriesTitle: line.seriesTitle,
  shareBps: line.shareBps,
  source: toLineSource(line.source),
});

type RawCreatorComment = Pick<
  MyCreatorEpisodeComment,
  | "comment"
  | "episodePublicId"
  | "episodeTitle"
  | "seriesPublicId"
  | "seriesTitle"
>;

/**
 * `null` for a row with no comment, which the server never answers and which
 * leaves the page nothing to show.
 */
const toCreatorCommentItem = (
  row: RawCreatorComment
): MyCreatorCommentItem | null =>
  row.comment
    ? {
        comment: toPublicComment(row.comment),
        episodePublicId: row.episodePublicId,
        episodeTitle: row.episodeTitle,
        seriesPublicId: row.seriesPublicId,
        seriesTitle: row.seriesTitle,
      }
    : null;

const readMyCreators = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedCreatorPageRead<MyCreators>> => {
  "use cache: private";

  applyCacheTag(tenantCreatorPagesTag(tenantId));

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.creator.listMyCreators(
      { surface: ClientSurface.WEB, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      unexpected: false,
      value: {
        creators: response.creators.map(toMyCreatorItem),
        salesVisible: response.salesVisible,
      },
    };
  } catch (error) {
    return readFailure(error, locale, "storefront.my_creator.load_failed");
  }
};

/**
 * The Authors the signed-in reader is linked to, and whether the tenant shows
 * them their sales. `missing` while the tenant shows no Author pages.
 */
export const listMyCreators = async (
  tenantId: string,
  locale: Locale
): Promise<CreatorPageRead<MyCreators>> =>
  settle(readMyCreators(tenantId, locale, await resolveAccessToken()));

const readMyCreatorStats = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string },
  sessionId: string
): Promise<CachedCreatorPageRead<MyCreatorStats>> => {
  "use cache: private";

  applyCacheTag(tenantCreatorPagesTag(tenantId));

  const { creatorId, locale, token } = input;

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.creator.getMyCreatorStats(
      {
        creatorId,
        limit: defaultPageSize,
        locale,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token,
      },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      unexpected: false,
      value: {
        currency: response.currency,
        episodes: response.episodes.map(toEpisodeStatsItem),
        followerCount: response.followerCount,
        nextToken: response.nextToken,
        periodEnd: response.periodEnd,
        periodStart: response.periodStart,
        previousToken: response.previousToken,
        timeZone: response.timeZone,
        totalCompleteCount: response.totalCompleteCount,
        totalMemberViewCount: response.totalMemberViewCount,
      },
    };
  } catch (error) {
    return readFailure(error, locale, "storefront.my_creator.stats_failed");
  }
};

/** One page of the Author's episodes with their figures, titled in `locale`. */
export const getMyCreatorStats = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string }
): Promise<CreatorPageRead<MyCreatorStats>> =>
  settle(readMyCreatorStats(tenantId, input, await resolveAccessToken()));

const readMyCreatorStatements = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string },
  sessionId: string
): Promise<CachedCreatorPageRead<MyCreatorStatementPage>> => {
  "use cache: private";

  applyCacheTag(tenantCreatorPagesTag(tenantId));

  const { creatorId, locale, token } = input;

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.creator.listMyCreatorStatements(
      {
        creatorId,
        limit: defaultPageSize,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token,
      },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      unexpected: false,
      value: {
        nextToken: response.nextToken,
        previousToken: response.previousToken,
        statements: response.statements.map(toStatementItem),
      },
    };
  } catch (error) {
    return readFailure(
      error,
      locale,
      "storefront.my_creator.statements_failed"
    );
  }
};

/**
 * One page of the Author's closed months, newest first. `missing` while the
 * tenant hides its Authors' sales.
 */
export const listMyCreatorStatements = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string }
): Promise<CreatorPageRead<MyCreatorStatementPage>> =>
  settle(readMyCreatorStatements(tenantId, input, await resolveAccessToken()));

const readMyCreatorStatement = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; period: string; token: string },
  sessionId: string
): Promise<CachedCreatorPageRead<MyCreatorStatementDetail>> => {
  "use cache: private";

  applyCacheTag(tenantCreatorPagesTag(tenantId));

  const { creatorId, locale, period, token } = input;

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.creator.getMyCreatorStatement(
      {
        creatorId,
        limit: defaultPageSize,
        period,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token,
      },
      buildSessionHeaders(sessionId)
    );

    if (!response.statement) {
      return { missing: true, ok: false, unexpected: false };
    }

    return {
      ok: true,
      unexpected: false,
      value: {
        lines: response.lines.map(toStatementLineItem),
        nextToken: response.nextToken,
        previousToken: response.previousToken,
        statement: toStatementItem(response.statement),
      },
    };
  } catch (error) {
    return readFailure(error, locale, "storefront.my_creator.statement_failed");
  }
};

/**
 * One page of the Author's lines of the closed month `period`. `missing` for a
 * month that is not closed, and while the tenant hides its Authors' sales.
 */
export const getMyCreatorStatement = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; period: string; token: string }
): Promise<CreatorPageRead<MyCreatorStatementDetail>> =>
  settle(readMyCreatorStatement(tenantId, input, await resolveAccessToken()));

const readMyCreatorComments = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string },
  sessionId: string
): Promise<CachedCreatorPageRead<MyCreatorCommentPage>> => {
  "use cache: private";

  applyCacheTag(tenantCreatorPagesTag(tenantId));
  applyCacheTag(tenantCreatorCommentsTag(tenantId));

  const { creatorId, locale, token } = input;

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.creator.listMyCreatorEpisodeComments(
      {
        creatorId,
        limit: defaultPageSize,
        locale,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token,
      },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      unexpected: false,
      value: {
        comments: response.comments
          .map(toCreatorCommentItem)
          .filter((item) => item !== null),
        nextToken: response.nextToken,
        previousToken: response.previousToken,
      },
    };
  } catch (error) {
    return readFailure(
      error,
      locale,
      "storefront.my_creator.comments.load_failed"
    );
  }
};

/**
 * One page of the published comments on the Author's episodes, newest first,
 * each with its episode titled in `locale`.
 */
export const listMyCreatorComments = async (
  tenantId: string,
  input: { creatorId: string; locale: Locale; token: string }
): Promise<CreatorPageRead<MyCreatorCommentPage>> =>
  settle(readMyCreatorComments(tenantId, input, await resolveAccessToken()));

/** The Author's part of one closed month, with every one of its lines. */
export interface MyCreatorStatementExport {
  creator: MyCreatorItem;
  lines: MyCreatorStatementLineItem[];
  statement: MyCreatorStatementItem;
}

type StatementLinesExport = Omit<MyCreatorStatementExport, "creator">;

/** Every line of the month, read page by page from `token` on. */
const readAllStatementLines = async (
  tenantId: string,
  accessToken: string,
  input: { creatorId: string; period: string },
  token = ""
): Promise<StatementLinesExport | null> => {
  const response = await apiClient.creator.getMyCreatorStatement(
    {
      creatorId: input.creatorId,
      limit: maxPageSize,
      period: input.period,
      surface: ClientSurface.WEB,
      tenant: { tenantId },
      token,
    },
    buildSessionHeaders(accessToken)
  );

  if (!response.statement) {
    return null;
  }

  const lines = response.lines.map(toStatementLineItem);

  const rest = response.nextToken
    ? await readAllStatementLines(
        tenantId,
        accessToken,
        input,
        response.nextToken
      )
    : null;

  return {
    lines: rest ? [...lines, ...rest.lines] : lines,
    statement: toStatementItem(response.statement),
  };
};

/**
 * The Author `creatorId` and their part of the closed month `period` with
 * every one of its lines, for the statement download, or `null` when the API
 * has nothing to answer: a month not closed, an Author the account is not
 * linked to, a tenant that shows no Author pages or hides their sales.
 *
 * Uncached, as the purchase history download is, and an RPC error other than
 * those is thrown as it is, for the caller to turn a rejected session into the
 * sign-in flow.
 */
export const getMyCreatorStatementExport = async (
  tenantId: string,
  accessToken: string,
  input: { creatorId: string; period: string }
): Promise<MyCreatorStatementExport | null> => {
  try {
    const [creators, statement] = await Promise.all([
      apiClient.creator.listMyCreators(
        { surface: ClientSurface.WEB, tenant: { tenantId } },
        buildSessionHeaders(accessToken)
      ),
      readAllStatementLines(tenantId, accessToken, input),
    ]);

    const creator = creators.creators.find(({ id }) => id === input.creatorId);

    return creator && statement
      ? { ...statement, creator: toMyCreatorItem(creator) }
      : null;
  } catch (error) {
    if (isRefusal(error)) {
      return null;
    }

    throw error;
  }
};
