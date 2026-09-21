import { RoyaltyCloseMode as RoyaltyCloseModeProto } from "@publira/api-client/admin/royalty";
import type {
  RoyaltyConfig,
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
import type { RoyaltyLine } from "./royalty-lines";
import type { RoyaltyClosePolicy } from "./royalty-period";
import { getAccessToken } from "./session";

export interface RoyaltyTotals {
  gross: number;
  refunded: number;
  payout: number;
}

/** A closed month. */
export interface RoyaltyStatementSummary {
  period: string;
  timeZone: string;
  closedAt: string;
  /** Empty for a close no user started, and once the account is deleted. */
  closedByUserName: string;
  totals: RoyaltyTotals;
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
      totals: RoyaltyTotals;
      lines: RoyaltyLine[];
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
    })
  | (ReadFailure & { notFound: boolean });

export type CloseRoyaltyStatementResult =
  | { ok: true; statement: RoyaltyStatementSummary }
  | { ok: false; message: string };

/** The generated `RoyaltyStatementTotals` fields {@link mapTotals} reads. */
type RawTotals = Pick<RoyaltyStatementTotals, "gross" | "payout" | "refunded">;

const mapTotals = (totals: RawTotals | undefined): RoyaltyTotals => ({
  gross: Number(totals?.gross ?? 0),
  payout: Number(totals?.payout ?? 0),
  refunded: Number(totals?.refunded ?? 0),
});

/** The generated `RoyaltyStatementLine` fields {@link mapLine} reads. */
type RawLine = Pick<
  RoyaltyStatementLine,
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
>;

const mapLine = (line: RawLine): RoyaltyLine => ({
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
});

/** The generated `RoyaltyStatement` fields {@link mapStatement} reads. */
type RawStatement = Pick<
  RoyaltyStatement,
  "closedAt" | "closedByUserName" | "period" | "timeZone" | "totals"
>;

const mapStatement = (
  statement: RawStatement | undefined
): RoyaltyStatementSummary => ({
  closedAt: statement?.closedAt ?? "",
  closedByUserName: statement?.closedByUserName ?? "",
  period: statement?.period ?? "",
  timeZone: statement?.timeZone ?? "",
  totals: mapTotals(statement?.totals),
});

/** The generated `RoyaltyConfig` fields {@link mapPolicy} reads. */
type RawConfig = Pick<
  RoyaltyConfig,
  "autoCloseDay" | "automaticSince" | "closeMode"
>;

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
  error: unknown,
  locale: Locale
): Promise<ReadFailure> => {
  const t = await getMessagesFor(locale);
  return {
    message: rpcErrorMessage(error, t("admin.royalties.load_failed"), {
      locale,
    }),
    ok: false,
    requiresSignIn: isUnauthenticatedError(error),
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
      lines: (response.lines ?? []).map((line) => mapLine(line)),
      ok: true,
      period: response.period ?? period,
      timeZone: response.timeZone ?? "",
      totals: mapTotals(response.totals),
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
