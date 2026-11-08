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
  completeCount: bigint;
  memberViewCount: bigint;
}

export type ListEpisodeReadThroughResult =
  | {
      ok: true;
      episodes: EpisodeReadThroughItem[];
      period: StatsPeriod;
      totalCompleteCount: bigint;
      totalMemberViewCount: bigint;
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
  completeCount: item.completeCount ?? 0n,
  episodePublicId: item.episodePublicId,
  episodeTitle: item.episodeTitle,
  memberViewCount: item.memberViewCount ?? 0n,
  seriesPublicId: item.seriesPublicId,
  seriesTitle: item.seriesTitle,
});

const mapErrorToMessage = async (
  cause: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, t("admin.analytics.episodes.list_failed"), {
    locale,
  });
};

/**
 * The share of member views that ended in a completion, or `null` when nothing
 * was viewed. Kept out of the API on purpose: a rate over a zero denominator is
 * not zero, and only the screen can say what it shows in its place.
 */
export const readThroughRate = (
  completeCount: bigint,
  memberViewCount: bigint
): number | null =>
  memberViewCount > 0n ? Number(completeCount) / Number(memberViewCount) : null;

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
      totalCompleteCount: response.totalCompleteCount ?? 0n,
      totalMemberViewCount: response.totalMemberViewCount ?? 0n,
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
  cause: unknown,
  fallback: string,
  locale: Locale
): StatsReadFailure => ({
  message: rpcErrorMessage(cause, fallback, { locale }),
  ok: false,
  requiresSignIn: isUnauthenticatedError(cause),
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
  purchaseCount: bigint;
  grossAmount: bigint;
  refundedAmount: bigint;
  /** `grossAmount` less `refundedAmount`: the purchases alone. */
  netAmount: bigint;
  /**
   * What subscribers paid for the tenant's plans on a day row, zero on a
   * series or an episode row, which no payment belongs to.
   */
  subscriptionAmount: bigint;
  /** What went back on those payments, taken off the day they were paid. */
  subscriptionRefundedAmount: bigint;
  /**
   * The tax `netAmount` includes, at the rate each purchase recorded when it
   * was made; zero for the purchases made while the tenant had no rate.
   */
  taxAmount: bigint;
  /** The same of what the tenant kept of the subscription payments. */
  subscriptionTaxAmount: bigint;
}

export type RevenueStatsTotalsItem = Pick<
  RevenueStatsItem,
  | "grossAmount"
  | "netAmount"
  | "purchaseCount"
  | "refundedAmount"
  | "subscriptionAmount"
  | "subscriptionRefundedAmount"
  | "subscriptionTaxAmount"
  | "taxAmount"
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
  | "subscriptionAmount"
  | "subscriptionRefundedAmount"
  | "subscriptionTaxAmount"
  | "taxAmount"
>;

type RawRevenueStatsTotals = Pick<
  RevenueStatsTotals,
  | "grossAmount"
  | "netAmount"
  | "purchaseCount"
  | "refundedAmount"
  | "subscriptionAmount"
  | "subscriptionRefundedAmount"
  | "subscriptionTaxAmount"
  | "taxAmount"
>;

const mapRevenueStatsTotals = (
  totals: RawRevenueStatsTotals | undefined
): RevenueStatsTotalsItem => ({
  grossAmount: totals?.grossAmount ?? 0n,
  netAmount: totals?.netAmount ?? 0n,
  purchaseCount: totals?.purchaseCount ?? 0n,
  refundedAmount: totals?.refundedAmount ?? 0n,
  subscriptionAmount: totals?.subscriptionAmount ?? 0n,
  subscriptionRefundedAmount: totals?.subscriptionRefundedAmount ?? 0n,
  subscriptionTaxAmount: totals?.subscriptionTaxAmount ?? 0n,
  taxAmount: totals?.taxAmount ?? 0n,
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
  followerCount: bigint;
  followedCount: bigint;
  unfollowedCount: bigint;
  viewCount: bigint;
  completeCount: bigint;
  reactionCount: bigint;
  /**
   * The rating a series row's series stands at, on the 1-5 scale, or `null`
   * for a series no reader has rated yet and for a day.
   */
  ratingAverage: number | null;
  ratingCount: bigint;
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
  completeCount: totals?.completeCount ?? 0n,
  followedCount: totals?.followedCount ?? 0n,
  followerCount: totals?.followerCount ?? 0n,
  reactionCount: totals?.reactionCount ?? 0n,
  unfollowedCount: totals?.unfollowedCount ?? 0n,
  viewCount: totals?.viewCount ?? 0n,
});

const mapAudienceStatsRow = (row: RawAudienceStatsRow): AudienceStatsItem => {
  const ratingCount = row.ratingCount ?? 0n;

  return {
    ...mapAudienceStatsTotals(row),
    date: row.date ?? "",
    // The API sends 0 for a series nobody has rated, which is no rating
    // rather than the bottom of the scale.
    ratingAverage: ratingCount > 0n ? (row.ratingAverage ?? 0) : null,
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
  readerCount: bigint;
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
  readerCount: page.readerCount ?? 0n,
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
  cohortSize: bigint;
  /**
   * The readers active in each week from the sign-up week on, as far as the
   * last week that has ended: a week still in progress has no entry.
   */
  activeCounts: bigint[];
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
  activeCounts: cohort.activeCounts ?? [],
  cohortSize: cohort.cohortSize ?? 0n,
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
  signedUpCount: bigint;
  activeCount: bigint;
  purchasedWithinSevenDaysCount: bigint;
  purchasedWithinThirtyDaysCount: bigint;
  purchasedCount: bigint;
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

    const purchasedCount = response.purchasedCount ?? 0n;

    return {
      funnel: {
        activeCount: response.activeCount ?? 0n,
        // The API sends 0 when nobody has bought, which is no median rather
        // than a purchase at the moment of sign-up.
        medianDaysToFirstPurchase:
          purchasedCount > 0n
            ? (response.medianDaysToFirstPurchase ?? 0)
            : null,
        purchasedCount,
        purchasedWithinSevenDaysCount:
          response.purchasedWithinSevenDaysCount ?? 0n,
        purchasedWithinThirtyDaysCount:
          response.purchasedWithinThirtyDaysCount ?? 0n,
        signedUpCount: response.signedUpCount ?? 0n,
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

/** The fields of an export request that name the report. */
interface StatsExportFields {
  episodePublicId?: string;
  kind: StatsExportKind;
}

const statsExportFields = (report: StatsExportReport): StatsExportFields => {
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
