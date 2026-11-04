import {
  RoyaltyCloseMode as RoyaltyCloseModeProto,
  RoyaltyLineSource,
} from "@publira/api-client/admin/royalty";
import type {
  RoyaltyConfig,
  RoyaltyCreatorSubtotal as RawCreatorSubtotal,
  RoyaltyStatement,
  RoyaltyStatementLine,
  RoyaltyStatementTotals,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { cursorPageRequest, cursorPageTokens } from "./cursor-page";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import { getMessagesFor } from "./messages";
import { readCurrency } from "./price";
import type { RoyaltyCreatorSubtotal, RoyaltyLine } from "./royalty-lines";
import type { RoyaltyCloseMode, RoyaltyClosePolicy } from "./royalty-period";
import { getAccessToken } from "./session";

export interface RoyaltyTotals {
  gross: number;
  refunded: number;
  /**
   * The net sales of earlier closed months that refunds recorded since their
   * close take back: zero, or a negative amount. `payout` already includes the
   * adjustment lines that carry it to the authors.
   */
  adjustment: number;
  payout: number;
  /** The tax the payouts include, `null` where no line has a tax rate. */
  tax: number | null;
  /** What is withheld from the Authors, `null` where nothing is. */
  withholding: number | null;
}

/** A closed month. */
export interface RoyaltyStatementSummary {
  period: string;
  timeZone: string;
  closedAt: string;
  /** Empty for a close no user started, and once the account is deleted. */
  closedByUserName: string;
  /**
   * The currency the totals and lines are in, the tenant's when the month was
   * closed. `null` when the API answered none, and each amount is then a dash.
   */
  currency: string | null;
  totals: RoyaltyTotals;
  /**
   * The withholding rate the month was closed with, in basis points, which
   * the statement keeps after the tenant changes it. `null` where the month
   * withheld nothing.
   */
  withholdingRateBps: number | null;
}

interface ReadFailure {
  ok: false;
  message: string;
  /** The API rejected the session — the page raises the login redirect. */
  requiresSignIn: boolean;
}

export type GetRoyaltyClosePolicyResult =
  | { ok: true; policy: RoyaltyClosePolicy }
  | ReadFailure;

export type PreviewRoyaltyStatementResult =
  | {
      ok: true;
      period: string;
      timeZone: string;
      /**
       * RFC 3339 instants of the half-open range the month counts sales in:
       * its own midnights, except where a closed month beside it already
       * fixed the instant between the two.
       */
      startsAt: string;
      endsAt: string;
      /**
       * The currency the totals and lines are in, the tenant's now. `null`
       * when the API answered none, and each amount is then a dash.
       */
      currency: string | null;
      totals: RoyaltyTotals;
      lines: RoyaltyLine[];
      /** What each Author would be paid, in the order of their first line. */
      creatorSubtotals: RoyaltyCreatorSubtotal[];
      /**
       * The tenant's withholding rate, which closing the month now would
       * record, in basis points. `null` where it withholds nothing.
       */
      withholdingRateBps: number | null;
    }
  | (ReadFailure & {
      /** The month is already closed, or has not started yet. */
      notOpen: boolean;
    });

export type ListRoyaltyStatementsResult =
  | (CursorPageTokens & { ok: true; statements: RoyaltyStatementSummary[] })
  | ReadFailure;

export type GetRoyaltyStatementResult =
  | (CursorPageTokens & {
      ok: true;
      statement: RoyaltyStatementSummary;
      lines: RoyaltyLine[];
      /**
       * What the statement pays each Author, every one of them on every page.
       * Empty for a statement closed before statements carried subtotals.
       */
      creatorSubtotals: RoyaltyCreatorSubtotal[];
    })
  | (ReadFailure & { notFound: boolean });

/**
 * `signedOut` covers both a missing session and one the API rejected; `missing`
 * covers a month that is not closed and one this operator may not see, which
 * the handler answers alike so the response says nothing about which it was.
 */
export type ExportRoyaltyStatementResult =
  | { ok: true; csv: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "missing" | "signedOut" };

export type UpdateRoyaltyClosePolicyResult =
  | { ok: true; policy: RoyaltyClosePolicy }
  | { ok: false; message: string };

export type CloseRoyaltyStatementResult =
  | { ok: true; statement: RoyaltyStatementSummary }
  | { ok: false; message: string };

/** The generated `RoyaltyStatementTotals` fields {@link mapTotals} reads. */
type RawTotals = Pick<
  RoyaltyStatementTotals,
  "adjustment" | "gross" | "payout" | "refunded" | "tax" | "withholding"
>;

/** An optional amount the API leaves unset where it states nothing. */
const optionalAmount = (value: bigint | undefined): number | null =>
  value === undefined ? null : Number(value);

const mapTotals = (totals: RawTotals | undefined): RoyaltyTotals => ({
  adjustment: Number(totals?.adjustment ?? 0),
  gross: Number(totals?.gross ?? 0),
  payout: Number(totals?.payout ?? 0),
  refunded: Number(totals?.refunded ?? 0),
  tax: optionalAmount(totals?.tax),
  withholding: optionalAmount(totals?.withholding),
});

/** The generated `RoyaltyStatementLine` fields {@link mapLine} reads. */
type RawLine = Pick<
  RoyaltyStatementLine,
  | "adjustedPeriod"
  | "creatorName"
  | "creatorPublicId"
  | "episodeTitle"
  | "grossAmount"
  | "lineNumber"
  | "payoutAmount"
  | "refundedAmount"
  | "roleName"
  | "saleCount"
  | "seriesTitle"
  | "shareBps"
  | "source"
  | "taxAmount"
  | "taxRateBps"
>;

const mapLine = (line: RawLine): RoyaltyLine => ({
  adjustedPeriod: line.adjustedPeriod ?? "",
  creatorName: line.creatorName ?? "",
  creatorPublicId: line.creatorPublicId ?? "",
  episodeTitle: line.episodeTitle ?? "",
  grossAmount: Number(line.grossAmount ?? 0),
  lineNumber: line.lineNumber ?? 0,
  payoutAmount: Number(line.payoutAmount ?? 0),
  refundedAmount: Number(line.refundedAmount ?? 0),
  roleName: line.roleName ?? "",
  saleCount: line.saleCount ?? 0,
  seriesTitle: line.seriesTitle ?? "",
  shareBps: line.shareBps ?? 0,
  // A line the release before closed, or a server that predates the field,
  // states no source, and every line it knew was a sale.
  source:
    line.source === RoyaltyLineSource.SUBSCRIPTION ? "subscription" : "sale",
  taxAmount: optionalAmount(line.taxAmount),
  taxRateBps: line.taxRateBps ?? null,
});

/** The generated `RoyaltyCreatorSubtotal` fields {@link mapCreatorSubtotal} reads. */
type RawSubtotal = Pick<
  RawCreatorSubtotal,
  | "creatorName"
  | "creatorPublicId"
  | "payoutAmount"
  | "taxAmount"
  | "withholdingAmount"
>;

const mapCreatorSubtotal = (subtotal: RawSubtotal): RoyaltyCreatorSubtotal => ({
  creatorName: subtotal.creatorName ?? "",
  creatorPublicId: subtotal.creatorPublicId ?? "",
  payoutAmount: Number(subtotal.payoutAmount ?? 0),
  taxAmount: optionalAmount(subtotal.taxAmount),
  withholdingAmount: optionalAmount(subtotal.withholdingAmount),
});

/** The generated `RoyaltyStatement` fields {@link mapStatement} reads. */
type RawStatement = Pick<
  RoyaltyStatement,
  | "closedAt"
  | "closedByUserName"
  | "currency"
  | "period"
  | "timeZone"
  | "totals"
  | "withholdingRateBps"
>;

const mapStatement = (
  statement: RawStatement | undefined
): RoyaltyStatementSummary => ({
  closedAt: statement?.closedAt ?? "",
  closedByUserName: statement?.closedByUserName ?? "",
  currency: readCurrency(statement?.currency),
  period: statement?.period ?? "",
  timeZone: statement?.timeZone ?? "",
  totals: mapTotals(statement?.totals),
  withholdingRateBps: statement?.withholdingRateBps ?? null,
});

/** The generated `RoyaltyConfig` fields {@link mapPolicy} reads. */
type RawConfig = Pick<
  RoyaltyConfig,
  "autoCloseDay" | "automaticSince" | "closeMode"
>;

const toCloseModeProto = (mode: RoyaltyCloseMode): RoyaltyCloseModeProto =>
  mode === "automatic"
    ? RoyaltyCloseModeProto.AUTOMATIC
    : RoyaltyCloseModeProto.MANUAL;

const mapPolicy = (config: RawConfig | undefined): RoyaltyClosePolicy =>
  config?.closeMode === RoyaltyCloseModeProto.AUTOMATIC
    ? {
        autoCloseDay: config.autoCloseDay,
        automaticSince: config.automaticSince ?? "",
        closeMode: "automatic",
      }
    : { automaticSince: config?.automaticSince ?? "", closeMode: "manual" };

const signedOut = async (locale: Locale): Promise<ReadFailure> => {
  const t = await getMessagesFor(locale);

  return {
    message: t("errors.rpc.unauthenticated"),
    ok: false,
    requiresSignIn: true,
  };
};

const readFailure = async (
  cause: unknown,
  locale: Locale
): Promise<ReadFailure> => {
  const t = await getMessagesFor(locale);

  return {
    message: rpcErrorMessage(cause, t("admin.royalties.load_failed"), {
      locale,
    }),
    ok: false,
    requiresSignIn: isUnauthenticatedError(cause),
  };
};

/** The tenant's close policy. A tenant that never chose one reads as manual. */
export const getRoyaltyClosePolicy = async (
  tenantId: string,
  locale: Locale
): Promise<GetRoyaltyClosePolicyResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signedOut(locale);
  }

  try {
    const response = await apiClient.royalties.getRoyaltyConfig(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, policy: mapPolicy(response.config) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return readFailure(error, locale);
  }
};

/**
 * Chooses how the tenant's months are closed. The day is sent only in
 * automatic mode, which is the one mode the API accepts it in.
 */
export const updateRoyaltyClosePolicy = async (
  input: {
    tenantId: string;
    closeMode: RoyaltyCloseMode;
    autoCloseDay?: number;
  },
  locale: Locale
): Promise<UpdateRoyaltyClosePolicyResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.royalties.updateRoyaltyConfig(
      {
        autoCloseDay:
          input.closeMode === "automatic" ? input.autoCloseDay : undefined,
        closeMode: toCloseModeProto(input.closeMode),
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, policy: mapPolicy(response.config) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.royalties.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/** A month that is not closed, computed exactly as closing it now would. */
export const previewRoyaltyStatement = async (
  tenantId: string,
  locale: Locale,
  period: string
): Promise<PreviewRoyaltyStatementResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ...(await signedOut(locale)), notOpen: false };
  }

  try {
    const response = await apiClient.royalties.previewRoyaltyStatement(
      { period, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      creatorSubtotals: (response.creatorSubtotals ?? []).map((subtotal) =>
        mapCreatorSubtotal(subtotal)
      ),
      currency: readCurrency(response.currency),
      endsAt: response.endsAt ?? "",
      lines: (response.lines ?? []).map((line) => mapLine(line)),
      ok: true,
      period: response.period ?? period,
      startsAt: response.startsAt ?? "",
      timeZone: response.timeZone ?? "",
      totals: mapTotals(response.totals),
      withholdingRateBps: response.withholdingRateBps ?? null,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return {
      ...(await readFailure(error, locale)),
      notOpen: isRpcError(error, Code.FailedPrecondition),
    };
  }
};

/** One page of the closed months, newest first. */
export const listRoyaltyStatements = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListRoyaltyStatementsResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return signedOut(locale);
  }

  try {
    const response = await apiClient.royalties.listRoyaltyStatements(
      { ...cursorPageRequest(options), tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      ok: true,
      statements: (response.statements ?? []).map((statement) =>
        mapStatement(statement)
      ),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return readFailure(error, locale);
  }
};

/** A closed month and one page of its lines. */
export const getRoyaltyStatement = async (
  tenantId: string,
  locale: Locale,
  period: string,
  options: CursorPageOptions = {}
): Promise<GetRoyaltyStatementResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ...(await signedOut(locale)), notFound: false };
  }

  try {
    const response = await apiClient.royalties.getRoyaltyStatement(
      { ...cursorPageRequest(options), period, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      creatorSubtotals: (response.creatorSubtotals ?? []).map((subtotal) =>
        mapCreatorSubtotal(subtotal)
      ),
      lines: (response.lines ?? []).map((line) => mapLine(line)),
      ok: true,
      statement: mapStatement(response.statement),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return {
      ...(await readFailure(error, locale)),
      notFound: isMissingResourceRpcError(error),
    };
  }
};

/** A closed month as the CSV the API encodes, byte for byte. */
export const exportRoyaltyStatement = async (
  tenantId: string,
  period: string
): Promise<ExportRoyaltyStatementResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ok: false, reason: "signedOut" };
  }

  try {
    const response = await apiClient.royalties.exportRoyaltyStatement(
      { period, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return { csv: new Uint8Array(response.csv), ok: true };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { ok: false, reason: "signedOut" };
    }

    if (
      isMissingResourceRpcError(error) ||
      isRpcError(error, Code.FailedPrecondition)
    ) {
      return { ok: false, reason: "missing" };
    }

    throw error;
  }
};

/** Closes a month that is over into a statement that never changes again. */
export const closeRoyaltyStatement = async (
  input: { tenantId: string; period: string },
  locale: Locale
): Promise<CloseRoyaltyStatementResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.royalties.closeRoyaltyStatement(
      { period: input.period, tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, statement: mapStatement(response.statement) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, t("admin.royalties.close_failed"), {
        locale,
        overrides: {
          conflict: t("admin.royalties.already_closed"),
          precondition: t("admin.royalties.not_over"),
        },
      }),
      ok: false,
    };
  }
};
