import {
  AudienceGroupBy,
  RevenueGroupBy,
  StatsExportKind,
} from "@publira/api-client/admin/engagement";
import type {
  AudienceStatsRow,
  AudienceStatsTotals,
  EpisodePageReach,
  EpisodeReadThrough,
  RetentionCohort,
  RevenueStatsRow,
  RevenueStatsTotals,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { cursorPageRequest } from "./cursor-page";
import type { CursorPageOptions } from "./cursor-page";
import { getMessagesFor } from "./messages";
import { buildQueryString } from "./query-string";
import { getAccessToken } from "./session";

export interface EpisodeReadThroughItem {
  seriesPublicId: string;
  seriesTitle: string;
  episodePublicId: string;
  episodeTitle: string;
  completeCount: number;
  memberViewCount: number;
}

export type ListEpisodeReadThroughResult =
  | {
      ok: true;
      episodes: EpisodeReadThroughItem[];
      period: StatsPeriod;
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

const mapErrorToMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, t("admin.analytics.episodes.list_failed"), {
    locale,
  });
};

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
    const t = await getMessagesFor(locale);

    return {
      episodes: [],
      message: t("errors.rpc.unauthenticated"),
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
        timeZone: response.timeZone ?? "",
      },
      previousToken: response.previousToken ?? "",
      totalCompleteCount: Number(response.totalCompleteCount ?? 0),
      totalMemberViewCount: Number(response.totalMemberViewCount ?? 0),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return {
      episodes: [],
      message: await mapErrorToMessage(error, locale),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * A period of the tenant's days a statistics read covers, as the server echoed
 * it back: inclusive calendar days (`YYYY-MM-DD`) in {@link StatsPeriod.timeZone},
 * the zone the counting was done in.
 */
export interface StatsPeriod {
  start: string;
  end: string;
  timeZone: string;
}

/** What a statistics read asks for: inclusive calendar days of the tenant. */
export interface StatsPeriodRequest {
  start: string;
  end: string;
}

/** A statistics read that failed, worded for the screen. */
export interface StatsReadFailure {
  ok: false;
  message: string;
  /** The API rejected the session — the page raises the login redirect. */
  requiresSignIn: boolean;
}

/**
 * The page size every breakdown is read at: the largest the API serves, so a
 * breakdown takes as few round trips as it can.
 */
const STATS_PAGE_SIZE = 100;

/**
 * Every row of a paged breakdown, read page after page from `token` on.
 *
 * The screen sorts a breakdown by whichever column the operator picks, and the
 * API orders one by a single figure, so a page of it is no slice of any other
 * order: the rows are read whole before they are sorted.
 */
const readRemainingPages = async <T>(
  token: string,
  readPage: (token: string) => Promise<{ rows: T[]; nextToken: string }>,
  rows: T[] = []
): Promise<T[]> => {
  if (!token) {
    return rows;
  }

  const page = await readPage(token);

  return readRemainingPages(page.nextToken, readPage, [...rows, ...page.rows]);
};

const statsReadFailure = (
  error: unknown,
  fallback: string,
  locale: Locale
): StatsReadFailure => ({
  message: rpcErrorMessage(error, fallback, { locale }),
  ok: false,
  requiresSignIn: isUnauthenticatedError(error),
});

const signInRequired = async (locale: Locale): Promise<StatsReadFailure> => {
  const t = await getMessagesFor(locale);

  return {
    message: t("errors.rpc.unauthenticated"),
    ok: false,
    requiresSignIn: true,
  };
};

export type RevenueGroup = "day" | "episode" | "series";

const revenueGroupBy: Record<RevenueGroup, RevenueGroupBy> = {
  day: RevenueGroupBy.DAY,
  episode: RevenueGroupBy.EPISODE,
  series: RevenueGroupBy.SERIES,
};

/** One row of a revenue report, amounts in the minor unit of its currency. */
export interface RevenueStatsItem {
  /** The tenant day of a day row, empty otherwise. */
  date: string;
  seriesPublicId: string;
  seriesTitle: string;
  episodePublicId: string;
  episodeTitle: string;
  purchaseCount: number;
  grossAmount: number;
  refundedAmount: number;
  netAmount: number;
}

export type RevenueStatsTotalsItem = Pick<
  RevenueStatsItem,
  "grossAmount" | "netAmount" | "purchaseCount" | "refundedAmount"
>;

export type GetRevenueStatsResult =
  | {
      ok: true;
      rows: RevenueStatsItem[];
      totals: RevenueStatsTotalsItem;
      /** The ISO 4217 code every amount is in. */
      currency: string;
      period: StatsPeriod;
    }
  | StatsReadFailure;

/**
 * The generated `RevenueStatsRow` fields {@link mapRevenueStatsRow} reads (see
 * `series.ts`).
 */
type RawRevenueStatsRow = Pick<
  RevenueStatsRow,
  | "date"
  | "episodePublicId"
  | "episodeTitle"
  | "grossAmount"
  | "netAmount"
  | "purchaseCount"
  | "refundedAmount"
  | "seriesPublicId"
  | "seriesTitle"
>;

type RawRevenueStatsTotals = Pick<
  RevenueStatsTotals,
  "grossAmount" | "netAmount" | "purchaseCount" | "refundedAmount"
>;

const mapRevenueStatsTotals = (
  totals: RawRevenueStatsTotals | undefined
): RevenueStatsTotalsItem => ({
  grossAmount: Number(totals?.grossAmount ?? 0),
  netAmount: Number(totals?.netAmount ?? 0),
  purchaseCount: Number(totals?.purchaseCount ?? 0),
  refundedAmount: Number(totals?.refundedAmount ?? 0),
});

const mapRevenueStatsRow = (row: RawRevenueStatsRow): RevenueStatsItem => ({
  ...mapRevenueStatsTotals(row),
  date: row.date ?? "",
  episodePublicId: row.episodePublicId ?? "",
  episodeTitle: row.episodeTitle ?? "",
  seriesPublicId: row.seriesPublicId ?? "",
  seriesTitle: row.seriesTitle ?? "",
});

/**
 * What sold over `period`, cut into rows by `group`. A day report comes back in
 * one response; a series or an episode report is read through every page.
 */
export const getRevenueStats = async (
  tenantId: string,
  locale: Locale,
  input: StatsPeriodRequest & { group: RevenueGroup }
): Promise<GetRevenueStatsResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signInRequired(locale);
  }

  const readPage = (token: string) =>
    apiClient.engagement.getRevenueStats(
      {
        endDate: input.end,
        groupBy: revenueGroupBy[input.group],
        limit: STATS_PAGE_SIZE,
        startDate: input.start,
        tenant: { tenantId },
        token,
      },
      withSessionHeaders(sessionId)
    );

  try {
    const first = await readPage("");

    const rows = await readRemainingPages(
      first.nextToken ?? "",
      async (token) => {
        const page = await readPage(token);

        return { nextToken: page.nextToken ?? "", rows: page.rows ?? [] };
      },
      first.rows ?? []
    );

    return {
      currency: first.currency ?? "",
      ok: true,
      period: {
        end: first.endDate ?? "",
        start: first.startDate ?? "",
        timeZone: first.timeZone ?? "",
      },
      rows: rows.map((row) => mapRevenueStatsRow(row)),
      totals: mapRevenueStatsTotals(first.totals),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return statsReadFailure(
      error,
      t("admin.analytics.revenue.load_failed"),
      locale
    );
  }
};

export type AudienceGroup = "day" | "series";

const audienceGroupBy: Record<AudienceGroup, AudienceGroupBy> = {
  day: AudienceGroupBy.DAY,
  series: AudienceGroupBy.SERIES,
};

/** One row of an audience report. */
export interface AudienceStatsItem {
  /** The tenant day of a day row, empty otherwise. */
  date: string;
  seriesPublicId: string;
  seriesTitle: string;
  followerCount: number;
  followedCount: number;
  unfollowedCount: number;
  viewCount: number;
  completeCount: number;
  reactionCount: number;
  /**
   * The rating a series row's series stands at, on the 1-5 scale, or `null`
   * for a series no reader has rated yet and for a day.
   */
  ratingAverage: number | null;
  ratingCount: number;
}

export type AudienceStatsTotalsItem = Pick<
  AudienceStatsItem,
  | "completeCount"
  | "followedCount"
  | "followerCount"
  | "reactionCount"
  | "unfollowedCount"
  | "viewCount"
>;

export type GetAudienceStatsResult =
  | {
      ok: true;
      rows: AudienceStatsItem[];
      totals: AudienceStatsTotalsItem;
      period: StatsPeriod;
    }
  | StatsReadFailure;

/**
 * The generated `AudienceStatsRow` fields {@link mapAudienceStatsRow} reads
 * (see `series.ts`).
 */
type RawAudienceStatsRow = Pick<
  AudienceStatsRow,
  | "completeCount"
  | "date"
  | "followedCount"
  | "followerCount"
  | "ratingAverage"
  | "ratingCount"
  | "reactionCount"
  | "seriesPublicId"
  | "seriesTitle"
  | "unfollowedCount"
  | "viewCount"
>;

type RawAudienceStatsTotals = Pick<
  AudienceStatsTotals,
  | "completeCount"
  | "followedCount"
  | "followerCount"
  | "reactionCount"
  | "unfollowedCount"
  | "viewCount"
>;

const mapAudienceStatsTotals = (
  totals: RawAudienceStatsTotals | undefined
): AudienceStatsTotalsItem => ({
  completeCount: Number(totals?.completeCount ?? 0),
  followedCount: Number(totals?.followedCount ?? 0),
  followerCount: Number(totals?.followerCount ?? 0),
  reactionCount: Number(totals?.reactionCount ?? 0),
  unfollowedCount: Number(totals?.unfollowedCount ?? 0),
  viewCount: Number(totals?.viewCount ?? 0),
});

const mapAudienceStatsRow = (row: RawAudienceStatsRow): AudienceStatsItem => {
  const ratingCount = Number(row.ratingCount ?? 0);

  return {
    ...mapAudienceStatsTotals(row),
    date: row.date ?? "",
    // The API sends 0 for a series nobody has rated, which is no rating
    // rather than the bottom of the scale.
    ratingAverage: ratingCount > 0 ? (row.ratingAverage ?? 0) : null,
    ratingCount,
    seriesPublicId: row.seriesPublicId ?? "",
    seriesTitle: row.seriesTitle ?? "",
  };
};

/**
 * How the tenant's series were followed, read, and reacted to over `period`,
 * cut into rows by `group`. A day report comes back in one response; a series
 * report is read through every page.
 */
export const getAudienceStats = async (
  tenantId: string,
  locale: Locale,
  input: StatsPeriodRequest & { group: AudienceGroup }
): Promise<GetAudienceStatsResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signInRequired(locale);
  }

  const readPage = (token: string) =>
    apiClient.engagement.getAudienceStats(
      {
        endDate: input.end,
        groupBy: audienceGroupBy[input.group],
        limit: STATS_PAGE_SIZE,
        startDate: input.start,
        tenant: { tenantId },
        token,
      },
      withSessionHeaders(sessionId)
    );

  try {
    const first = await readPage("");

    const rows = await readRemainingPages(
      first.nextToken ?? "",
      async (token) => {
        const page = await readPage(token);

        return { nextToken: page.nextToken ?? "", rows: page.rows ?? [] };
      },
      first.rows ?? []
    );

    return {
      ok: true,
      period: {
        end: first.endDate ?? "",
        start: first.startDate ?? "",
        timeZone: first.timeZone ?? "",
      },
      rows: rows.map((row) => mapAudienceStatsRow(row)),
      totals: mapAudienceStatsTotals(first.totals),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return statsReadFailure(
      error,
      t("admin.analytics.audience.load_failed"),
      locale
    );
  }
};

/** How many readers stopped at one page of an episode or after it. */
export interface EpisodePageReachItem {
  /** Zero-based. */
  pageIndex: number;
  readerCount: number;
}

export type GetEpisodeDropOffResult =
  | {
      ok: true;
      pages: EpisodePageReachItem[];
      /** The pages the episode has now. */
      pageCount: number;
      period: StatsPeriod;
    }
  /** The episode is not the tenant's, or does not exist. */
  | { ok: false; notFound: true }
  | (StatsReadFailure & { notFound?: false });

/**
 * The generated `EpisodePageReach` fields {@link getEpisodeDropOff} reads (see
 * `series.ts`).
 */
type RawEpisodePageReach = Pick<EpisodePageReach, "pageIndex" | "readerCount">;

const mapEpisodePageReach = (
  page: RawEpisodePageReach
): EpisodePageReachItem => ({
  pageIndex: page.pageIndex ?? 0,
  readerCount: Number(page.readerCount ?? 0),
});

/** How far into one episode its readers got over `period`, page by page. */
export const getEpisodeDropOff = async (
  tenantId: string,
  locale: Locale,
  input: StatsPeriodRequest & { episodePublicId: string }
): Promise<GetEpisodeDropOffResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.engagement.getEpisodeDropOff(
      {
        endDate: input.end,
        episodePublicId: input.episodePublicId,
        startDate: input.start,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      pageCount: response.pageCount ?? 0,
      pages: (response.pages ?? []).map((page) => mapEpisodePageReach(page)),
      period: {
        end: response.endDate ?? "",
        start: response.startDate ?? "",
        timeZone: response.timeZone ?? "",
      },
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }

    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return statsReadFailure(
      error,
      t("admin.analytics.drop_off.load_failed"),
      locale
    );
  }
};

/** One week's sign-ups, and how many of them were active in each week after. */
export interface RetentionCohortItem {
  /** The Monday the cohort's week begins on, a tenant day. */
  weekStart: string;
  cohortSize: number;
  /**
   * The readers active in each week from the sign-up week on, as far as the
   * last week that has ended: a week still in progress has no entry.
   */
  activeCounts: number[];
}

export type GetRetentionCohortsResult =
  | { ok: true; cohorts: RetentionCohortItem[]; period: StatsPeriod }
  | StatsReadFailure;

/**
 * The generated `RetentionCohort` fields {@link mapRetentionCohort} reads (see
 * `series.ts`).
 */
type RawRetentionCohort = Pick<
  RetentionCohort,
  "activeCounts" | "cohortSize" | "weekStart"
>;

const mapRetentionCohort = (
  cohort: RawRetentionCohort
): RetentionCohortItem => ({
  activeCounts: (cohort.activeCounts ?? []).map(Number),
  cohortSize: Number(cohort.cohortSize ?? 0),
  weekStart: cohort.weekStart ?? "",
});

/**
 * The readers who signed up in each week of `period`, and how many of them
 * were active in each week after it. `seriesPublicId` narrows the activity,
 * never the cohorts; empty counts activity anywhere in the tenant.
 */
export const getRetentionCohorts = async (
  tenantId: string,
  locale: Locale,
  input: StatsPeriodRequest & { seriesPublicId: string }
): Promise<GetRetentionCohortsResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.engagement.getRetentionCohorts(
      {
        endDate: input.end,
        seriesPublicId: input.seriesPublicId,
        startDate: input.start,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      cohorts: (response.cohorts ?? []).map((cohort) =>
        mapRetentionCohort(cohort)
      ),
      ok: true,
      period: {
        end: response.endDate ?? "",
        start: response.startDate ?? "",
        timeZone: response.timeZone ?? "",
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return statsReadFailure(
      error,
      t("admin.analytics.cohorts.load_failed"),
      locale
    );
  }
};

/** How far the readers who signed up in a period got, each count of them all. */
export interface SignUpFunnelItem {
  signedUpCount: number;
  activeCount: number;
  purchasedWithinSevenDaysCount: number;
  purchasedWithinThirtyDaysCount: number;
  purchasedCount: number;
  /** Fractional days, or `null` when nobody has bought. */
  medianDaysToFirstPurchase: number | null;
}

export type GetSignUpFunnelResult =
  | { ok: true; funnel: SignUpFunnelItem; period: StatsPeriod }
  | StatsReadFailure;

/** How many of the readers who signed up in `period` were active and bought. */
export const getSignUpFunnel = async (
  tenantId: string,
  locale: Locale,
  input: StatsPeriodRequest
): Promise<GetSignUpFunnelResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.engagement.getSignUpFunnel(
      {
        endDate: input.end,
        startDate: input.start,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const purchasedCount = Number(response.purchasedCount ?? 0);

    return {
      funnel: {
        activeCount: Number(response.activeCount ?? 0),
        // The API sends 0 when nobody has bought, which is no median rather
        // than a purchase at the moment of sign-up.
        medianDaysToFirstPurchase:
          purchasedCount > 0 ? (response.medianDaysToFirstPurchase ?? 0) : null,
        purchasedCount,
        purchasedWithinSevenDaysCount: Number(
          response.purchasedWithinSevenDaysCount ?? 0
        ),
        purchasedWithinThirtyDaysCount: Number(
          response.purchasedWithinThirtyDaysCount ?? 0
        ),
        signedUpCount: Number(response.signedUpCount ?? 0),
      },
      ok: true,
      period: {
        end: response.endDate ?? "",
        start: response.startDate ?? "",
        timeZone: response.timeZone ?? "",
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return statsReadFailure(
      error,
      t("admin.analytics.funnel.load_failed"),
      locale
    );
  }
};

/** The report a CSV download writes: one of the screens, as its table shows it. */
export type StatsExportReport =
  | { kind: "audience"; group: AudienceGroup }
  | { kind: "drop_off"; seriesPublicId: string; episodePublicId: string }
  | { kind: "revenue"; group: RevenueGroup };

export type ExportStatsResult =
  | { ok: true; csv: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "missing" | "signedOut" };

const revenueExportKind: Record<RevenueGroup, StatsExportKind> = {
  day: StatsExportKind.REVENUE_BY_DAY,
  episode: StatsExportKind.REVENUE_BY_EPISODE,
  series: StatsExportKind.REVENUE_BY_SERIES,
};

const audienceExportKind: Record<AudienceGroup, StatsExportKind> = {
  day: StatsExportKind.AUDIENCE_BY_DAY,
  series: StatsExportKind.AUDIENCE_BY_SERIES,
};

const statsExportFields = (
  report: StatsExportReport
): { kind: StatsExportKind; episodePublicId?: string } => {
  switch (report.kind) {
    case "audience": {
      return { kind: audienceExportKind[report.group] };
    }

    case "drop_off": {
      return {
        episodePublicId: report.episodePublicId,
        kind: StatsExportKind.EPISODE_DROP_OFF,
      };
    }

    case "revenue": {
      return { kind: revenueExportKind[report.group] };
    }

    default: {
      return report satisfies never;
    }
  }
};

const statsReportQuery = (
  report: StatsExportReport,
  period: StatsPeriodRequest
): string =>
  buildQueryString({
    from: period.start,
    group:
      report.kind === "drop_off" || report.group === "day" ? "" : report.group,
    to: period.end,
  });

const statsReportPath = (report: StatsExportReport): string =>
  report.kind === "drop_off"
    ? `/analytics/episodes/${report.seriesPublicId}/${report.episodePublicId}`
    : `/analytics/${report.kind}`;

/** The screen that shows a report over `period`, as its own links spell it. */
export const statsReportHref = (
  report: StatsExportReport,
  period: StatsPeriodRequest
): string => `${statsReportPath(report)}${statsReportQuery(report, period)}`;

/**
 * Where a report downloads as CSV: the screen's own path under the API, with
 * the period spelled out rather than left to a default, so the file covers the
 * days the screen showed whenever it is opened.
 */
export const statsCsvPath = (
  report: StatsExportReport,
  period: StatsPeriodRequest
): string =>
  `/api/v1${statsReportPath(report)}/csv${statsReportQuery(report, period)}`;

/**
 * A report as the CSV the API encodes, byte for byte. A period the API refuses
 * is answered like an episode the tenant does not have: there is no such file.
 */
export const exportStats = async (
  tenantId: string,
  report: StatsExportReport,
  period: StatsPeriodRequest
): Promise<ExportStatsResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ok: false, reason: "signedOut" };
  }

  try {
    const response = await apiClient.engagement.exportStats(
      {
        ...statsExportFields(report),
        endDate: period.end,
        startDate: period.start,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { csv: new Uint8Array(response.csv), ok: true };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { ok: false, reason: "signedOut" };
    }

    if (
      isMissingResourceRpcError(error) ||
      isRpcError(error, Code.InvalidArgument)
    ) {
      return { ok: false, reason: "missing" };
    }

    throw error;
  }
};
