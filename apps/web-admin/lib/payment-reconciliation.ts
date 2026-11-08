import {
  PaymentReconciliationFailure,
  PaymentReconciliationFindingKind,
  PaymentReconciliationMode,
  PaymentReconciliationStatus,
} from "@publira/api-client/admin/payment-reconciliation";
import type {
  PaymentReconciliation,
  PaymentReconciliationFinding,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  isRpcError,
  Code,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

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
import { buildQueryString } from "./query-string";
import { getAccessToken } from "./session";

/*
 * Nothing read here is cached, unlike most of this console's reads.
 *
 * A run is written by the console but finished by the worker, which reads the
 * provider's records some seconds later and drops no cache entry web-admin
 * holds. A cached list would keep showing a run as pending for as long as its
 * entry lived, which is the very change the screen refreshes to show.
 */

export type PaymentReconciliationStatusValue =
  | "failed"
  | "pending"
  | "running"
  | "succeeded";

/** Why a run failed, or `""` for one that has not. */
export type PaymentReconciliationFailureValue =
  | ""
  | "credentials"
  | "unavailable";

export const PAYMENT_RECONCILIATION_FINDING_KINDS = [
  "record_unmatched",
  "purchase_unmatched",
  "amount_mismatch",
  "held_refund",
  "held_dispute",
] as const;

/**
 * What a line of a run is. `other` is a kind a newer API names that this
 * build has no words for; it is still listed rather than hidden.
 */
export type PaymentReconciliationFindingKindValue =
  | (typeof PAYMENT_RECONCILIATION_FINDING_KINDS)[number]
  | "other";

export const PAYMENT_RECONCILIATION_MODES = ["live", "test"] as const;

/** Which of a source's modes to list, or `""` for both. */
export type PaymentReconciliationModeValue =
  | ""
  | (typeof PAYMENT_RECONCILIATION_MODES)[number];

export interface PaymentReconciliationItem {
  /** Inclusive, `YYYY-MM-DD`, in the tenant's time zone at the start. */
  endDate: string;
  failure: PaymentReconciliationFailureValue;
  findingCount: bigint;
  /** Empty until the run has finished. */
  finishedAt: string;
  id: string;
  matchedCount: bigint;
  /** The payment provider's id (`stripe`, `payjp`), or `""` for a store. */
  provider: string;
  purchaseCount: bigint;
  recordCount: bigint;
  startDate: string;
  startedAt: string;
  status: PaymentReconciliationStatusValue;
  /** The store (`app_store`, `google_play`), or `""` for the provider. */
  store: string;
}

/**
 * One line of a run. The `purchase*` fields are the install's side and the
 * `record*` fields the source's, each in the minor unit of its own currency,
 * and empty or zero where that side has nothing to say.
 */
export interface PaymentReconciliationFindingItem {
  id: string;
  kind: PaymentReconciliationFindingKindValue;
  occurredAt: string;
  /** The source's own ID of the payment, which finds it in its dashboard. */
  providerPaymentId: string;
  purchaseAmount: bigint;
  purchaseCurrency: string;
  /** The purchase the line is about (`AdminPurchase.id`), or `""`. */
  purchaseId: string;
  purchaseRefundedAmount: bigint;
  recordAmount: bigint;
  recordCurrency: string;
  recordRefundedAmount: bigint;
  test: boolean;
}

export type ListPaymentReconciliationsResult = CursorPageTokens &
  (
    | { ok: true; reconciliations: PaymentReconciliationItem[] }
    | {
        message: string;
        ok: false;
        reconciliations: [];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn?: boolean;
      }
  );

export type ListPaymentReconciliationFindingsOptions = CursorPageOptions & {
  kind?: PaymentReconciliationFindingKindValue | "";
  mode?: PaymentReconciliationModeValue;
  reconciliationId: string;
};

export type ListPaymentReconciliationFindingsResult = CursorPageTokens &
  (
    | { findings: PaymentReconciliationFindingItem[]; ok: true }
    | {
        findings: [];
        message: string;
        ok: false;
        requiresSignIn?: boolean;
      }
  );

export type StartPaymentReconciliationResult =
  | { ok: true; reconciliations: PaymentReconciliationItem[] }
  | { message: string; ok: false };

export type ExportPurchasesResult =
  | { csv: Uint8Array<ArrayBuffer>; ok: true }
  | { ok: false; reason: "refused" | "signedOut" };

const statusValues: Record<
  PaymentReconciliationStatus,
  PaymentReconciliationStatusValue | null
> = {
  [PaymentReconciliationStatus.UNSPECIFIED]: null,
  [PaymentReconciliationStatus.PENDING]: "pending",
  [PaymentReconciliationStatus.RUNNING]: "running",
  [PaymentReconciliationStatus.SUCCEEDED]: "succeeded",
  [PaymentReconciliationStatus.FAILED]: "failed",
};

const failureValues: Record<
  PaymentReconciliationFailure,
  PaymentReconciliationFailureValue
> = {
  [PaymentReconciliationFailure.UNSPECIFIED]: "",
  [PaymentReconciliationFailure.CREDENTIALS]: "credentials",
  [PaymentReconciliationFailure.UNAVAILABLE]: "unavailable",
};

const kindValues: Record<
  PaymentReconciliationFindingKind,
  PaymentReconciliationFindingKindValue
> = {
  [PaymentReconciliationFindingKind.UNSPECIFIED]: "other",
  [PaymentReconciliationFindingKind.RECORD_UNMATCHED]: "record_unmatched",
  [PaymentReconciliationFindingKind.PURCHASE_UNMATCHED]: "purchase_unmatched",
  [PaymentReconciliationFindingKind.AMOUNT_MISMATCH]: "amount_mismatch",
  [PaymentReconciliationFindingKind.HELD_REFUND]: "held_refund",
  [PaymentReconciliationFindingKind.HELD_DISPUTE]: "held_dispute",
};

const kindRequests: Record<
  PaymentReconciliationFindingKindValue | "",
  PaymentReconciliationFindingKind
> = {
  "": PaymentReconciliationFindingKind.UNSPECIFIED,
  amount_mismatch: PaymentReconciliationFindingKind.AMOUNT_MISMATCH,
  held_dispute: PaymentReconciliationFindingKind.HELD_DISPUTE,
  held_refund: PaymentReconciliationFindingKind.HELD_REFUND,
  other: PaymentReconciliationFindingKind.UNSPECIFIED,
  purchase_unmatched: PaymentReconciliationFindingKind.PURCHASE_UNMATCHED,
  record_unmatched: PaymentReconciliationFindingKind.RECORD_UNMATCHED,
};

const modeRequests: Record<
  PaymentReconciliationModeValue,
  PaymentReconciliationMode
> = {
  "": PaymentReconciliationMode.UNSPECIFIED,
  live: PaymentReconciliationMode.LIVE,
  test: PaymentReconciliationMode.TEST,
};

/** The generated `PaymentReconciliation` fields {@link mapReconciliation} reads (see `series.ts`). */
type RawReconciliation = Pick<
  PaymentReconciliation,
  | "endDate"
  | "failure"
  | "findingCount"
  | "finishedAt"
  | "id"
  | "matchedCount"
  | "provider"
  | "purchaseCount"
  | "recordCount"
  | "startDate"
  | "startedAt"
  | "status"
  | "store"
>;

export const mapReconciliation = (
  run: RawReconciliation
): PaymentReconciliationItem => ({
  endDate: run.endDate,
  failure: failureValues[run.failure] ?? "",
  findingCount: run.findingCount,
  finishedAt: run.finishedAt,
  id: run.id,
  matchedCount: run.matchedCount,
  provider: run.provider,
  purchaseCount: run.purchaseCount,
  recordCount: run.recordCount,
  startDate: run.startDate,
  startedAt: run.startedAt,
  // A state a newer API names is read by whether the run has finished, so
  // the screen neither waits on a finished run nor calls an unfinished one
  // done.
  status:
    statusValues[run.status] ?? (run.finishedAt ? "succeeded" : "pending"),
  store: run.store,
});

/** The generated `PaymentReconciliationFinding` fields {@link mapFinding} reads. */
type RawFinding = Pick<
  PaymentReconciliationFinding,
  | "id"
  | "kind"
  | "occurredAt"
  | "providerPaymentId"
  | "purchaseAmount"
  | "purchaseCurrency"
  | "purchaseId"
  | "purchaseRefundedAmount"
  | "recordAmount"
  | "recordCurrency"
  | "recordRefundedAmount"
  | "test"
>;

export const mapFinding = (
  finding: RawFinding
): PaymentReconciliationFindingItem => ({
  id: finding.id,
  kind: kindValues[finding.kind] ?? "other",
  occurredAt: finding.occurredAt,
  providerPaymentId: finding.providerPaymentId,
  purchaseAmount: finding.purchaseAmount,
  purchaseCurrency: finding.purchaseCurrency,
  purchaseId: finding.purchaseId,
  purchaseRefundedAmount: finding.purchaseRefundedAmount,
  recordAmount: finding.recordAmount,
  recordCurrency: finding.recordCurrency,
  recordRefundedAmount: finding.recordRefundedAmount,
  test: finding.test,
});

/** Whether the worker has yet to finish `run`, which the screen waits on. */
export const isReconciliationUnfinished = (
  run: Pick<PaymentReconciliationItem, "status">
): boolean => run.status === "pending" || run.status === "running";

/** One page of the tenant's runs, the one started last first. */
export const listPaymentReconciliations = async (
  tenantId: string,
  locale: Locale,
  options: CursorPageOptions = {}
): Promise<ListPaymentReconciliationsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      reconciliations: [],
      requiresSignIn: true,
    };
  }

  try {
    const response =
      await apiClient.paymentReconciliations.listPaymentReconciliations(
        { ...cursorPageRequest(options), tenant: { tenantId } },
        withSessionHeaders(sessionId)
      );

    return {
      ...cursorPageTokens(response),
      ok: true,
      reconciliations: response.reconciliations.map(mapReconciliation),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return {
      ...emptyCursorPageTokens,
      message: rpcErrorMessage(error, t("admin.reconciliation.list_failed"), {
        locale,
      }),
      ok: false,
      reconciliations: [],
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * One page of a run's lines, in the order they happened. A run that is gone —
 * replaced by a later run of the same period, or another tenant's — is
 * reported, since the link that named it no longer leads anywhere.
 */
export const listPaymentReconciliationFindings = async (
  tenantId: string,
  locale: Locale,
  options: ListPaymentReconciliationFindingsOptions
): Promise<ListPaymentReconciliationFindingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      findings: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response =
      await apiClient.paymentReconciliations.listPaymentReconciliationFindings(
        {
          ...cursorPageRequest(options),
          kind: kindRequests[options.kind ?? ""],
          mode: modeRequests[options.mode ?? ""],
          reconciliationId: options.reconciliationId,
          tenant: { tenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      ...cursorPageTokens(response),
      findings: response.findings.map(mapFinding),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    return {
      ...emptyCursorPageTokens,
      findings: [],
      message: isMissingResourceRpcError(error)
        ? t("admin.reconciliation.findings.not_found")
        : rpcErrorMessage(
            error,
            t("admin.reconciliation.findings.list_failed"),
            { locale }
          ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Starts a run of the period against every source the tenant has ready. A
 * period the API refuses has been checked already by the Action, so the
 * refusal left is a period that runs past today in the tenant's time zone.
 */
export const startPaymentReconciliation = async (
  input: { endDate: string; startDate: string; tenantId: string },
  locale: Locale
): Promise<StartPaymentReconciliationResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.paymentReconciliations.startPaymentReconciliation(
        {
          endDate: input.endDate,
          startDate: input.startDate,
          tenant: { tenantId: input.tenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      ok: true,
      reconciliations: response.reconciliations.map(mapReconciliation),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, t("admin.reconciliation.start_failed"), {
        locale,
        overrides: {
          "invalid-argument": t("admin.reconciliation.period.future"),
          precondition: t("admin.reconciliation.no_source"),
        },
      }),
      ok: false,
    };
  }
};

/** The inclusive calendar days of the tenant a purchases download covers. */
export interface PurchasesExportPeriod {
  endDate: string;
  startDate: string;
}

const purchasesExportQuery = (period: PurchasesExportPeriod): string =>
  buildQueryString({ from: period.startDate, to: period.endDate });

/** **Purchases** over the days a download covers, as its own links spell it. */
export const purchasesHref = (period: PurchasesExportPeriod): string =>
  `/purchases${purchasesExportQuery(period)}`;

/**
 * Where a download is served: the period spelled out rather than left to a
 * default, so the file covers the days the screen named whenever it is opened.
 */
export const purchasesCsvPath = (period: PurchasesExportPeriod): string =>
  `/api/v1/purchases/csv${purchasesExportQuery(period)}`;

/**
 * The purchases and refunds of a period as the CSV the API encodes, byte for
 * byte, which the API records in the audit log. A period it refuses is
 * answered as no such file.
 */
export const exportPurchases = async (
  tenantId: string,
  period: PurchasesExportPeriod
): Promise<ExportPurchasesResult> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return { ok: false, reason: "signedOut" };
  }

  try {
    const response = await apiClient.paymentReconciliations.exportPurchases(
      {
        endDate: period.endDate,
        startDate: period.startDate,
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
      return { ok: false, reason: "refused" };
    }

    throw error;
  }
};
