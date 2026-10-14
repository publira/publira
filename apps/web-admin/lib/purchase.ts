import { PurchaseRevocationReason } from "@publira/api-client/admin/purchase";
import type { AdminPurchase } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** Why a purchase stopped opening its episode, or `""` while it still does. */
export type PurchaseRevocationReasonValue = "" | "dispute" | "refund" | "staff";

export interface PurchaseItem {
  currency: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  /** The UUID GetPurchase and RefundPurchase address the purchase by. */
  id: string;
  price: number;
  /** The payment provider the reader paid through, or `""`. */
  provider: string;
  purchasedAt: string;
  /** Empty, with the name and the public ID, once the reader deleted their account. */
  readerEmail: string;
  readerName: string;
  readerPublicId: string;
  refundable: boolean;
  refundedAmount: number;
  refundedAt: string;
  revocationReason: PurchaseRevocationReasonValue;
  revokedAt: string;
  seriesPublicId: string;
  seriesTitle: string;
  /** The store that charged the reader (`app_store`, `google_play`), or `""`. */
  store: string;
  test: boolean;
}

export type ListPurchasesOptions = CursorPageOptions & {
  episodePublicId?: string;
  /** An ISO-8601 instant; only purchases made at or after it. */
  purchasedFrom?: string;
  /** An ISO-8601 instant; only purchases made before it. */
  purchasedTo?: string;
  readerEmail?: string;
  seriesPublicId?: string;
};

export type ListPurchasesResult = CursorPageTokens & {
  message?: string;
  ok: boolean;
  purchases: PurchaseItem[];
  /** The API rejected the session — the page raises the login redirect. */
  requiresSignIn?: boolean;
};

export type GetPurchaseResult =
  | {
      ok: true;
      /** `null` when the tenant holds no such purchase. */
      purchase: PurchaseItem | null;
    }
  | { message: string; ok: false; requiresSignIn?: boolean };

export type RefundPurchaseResult =
  | { ok: true; purchase: PurchaseItem }
  | { message: string; ok: false };

const revocationReasons: Record<
  PurchaseRevocationReason,
  PurchaseRevocationReasonValue
> = {
  [PurchaseRevocationReason.UNSPECIFIED]: "",
  [PurchaseRevocationReason.REFUND]: "refund",
  [PurchaseRevocationReason.DISPUTE]: "dispute",
  [PurchaseRevocationReason.STAFF]: "staff",
};

/** The generated `AdminPurchase` fields {@link mapPurchase} reads (see `series.ts`). */
type RawPurchase = Pick<
  AdminPurchase,
  | "currency"
  | "episodePublicId"
  | "episodeTitle"
  | "expiresAt"
  | "id"
  | "price"
  | "provider"
  | "purchasedAt"
  | "readerEmail"
  | "readerName"
  | "readerPublicId"
  | "refundable"
  | "refundedAmount"
  | "refundedAt"
  | "revocationReason"
  | "revokedAt"
  | "seriesPublicId"
  | "seriesTitle"
  | "store"
  | "test"
>;

export const mapPurchase = (item: RawPurchase): PurchaseItem => ({
  currency: item.currency,
  episodePublicId: item.episodePublicId,
  episodeTitle: item.episodeTitle,
  expiresAt: item.expiresAt,
  id: item.id,
  price: Number(item.price),
  provider: item.provider,
  purchasedAt: item.purchasedAt,
  readerEmail: item.readerEmail,
  readerName: item.readerName,
  readerPublicId: item.readerPublicId,
  refundable: item.refundable,
  refundedAmount: Number(item.refundedAmount),
  refundedAt: item.refundedAt,
  revocationReason: revocationReasons[item.revocationReason] ?? "",
  revokedAt: item.revokedAt,
  seriesPublicId: item.seriesPublicId,
  seriesTitle: item.seriesTitle,
  store: item.store,
  test: item.test,
});

/**
 * The tag the purchase list and every purchase read carry. A refund changes
 * the row in the list as well as the purchase it was made from, so one tag
 * reaches both.
 */
export const purchasesCacheTag = (tenantId: string): string =>
  `purchases-${tenantId}`;

const listPurchasesForSession = async (
  tenantId: string,
  locale: Locale,
  options: ListPurchasesOptions,
  sessionId: string
): Promise<CachedRead<ListPurchasesResult>> => {
  "use cache: private";
  cacheTag(purchasesCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      purchases: [],
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.purchases.listPurchases(
      {
        ...cursorPageRequest(options),
        episodePublicId: options.episodePublicId ?? "",
        purchasedFrom: options.purchasedFrom ?? "",
        purchasedTo: options.purchasedTo ?? "",
        readerEmail: options.readerEmail ?? "",
        seriesPublicId: options.seriesPublicId ?? "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      ok: true,
      purchases: response.purchases.map(mapPurchase),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyCursorPageTokens,
      message: rpcErrorMessage(error, t("admin.purchases.list_failed"), {
        locale,
      }),
      ok: false,
      purchases: [],
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * One page of the tenant's purchases, newest first, in the server's keyset
 * order: sorting here would only sort the rows that share a page.
 */
export const listPurchases = async (
  tenantId: string,
  locale: Locale,
  options: ListPurchasesOptions = {}
): Promise<ListPurchasesResult> =>
  settleCachedRead(
    await listPurchasesForSession(
      tenantId,
      locale,
      options,
      await getAccessToken()
    )
  );

const getPurchaseForSession = async (
  tenantId: string,
  purchaseId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetPurchaseResult>> => {
  "use cache: private";
  cacheTag(purchasesCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.purchases.getPurchase(
      { purchaseId, tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );
    return {
      ok: true,
      purchase: response.purchase ? mapPurchase(response.purchase) : null,
    };
  } catch (error) {
    // A purchase another tenant holds, or one that never existed, is an
    // answer rather than a failure: the drawer says so.
    if (isMissingResourceRpcError(error)) {
      return { ok: true, purchase: null };
    }
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(error, t("admin.purchases.detail_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** One purchase of the tenant, for the detail drawer. */
export const getPurchase = async (
  tenantId: string,
  purchaseId: string,
  locale: Locale
): Promise<GetPurchaseResult> =>
  settleCachedRead(
    await getPurchaseForSession(
      tenantId,
      purchaseId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Asks the provider the reader paid through for their money back, and closes
 * the episode to them at once. `reason` is recorded on the audit log entry.
 */
export const refundPurchase = async (
  input: { purchaseId: string; reason: string; tenantId: string },
  locale: Locale
): Promise<RefundPurchaseResult> => {
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
    const response = await apiClient.purchases.refundPurchase(
      {
        purchaseId: input.purchaseId,
        reason: input.reason,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    if (!response.purchase) {
      return { message: t("admin.purchases.refund_failed"), ok: false };
    }
    return { ok: true, purchase: mapPurchase(response.purchase) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.purchases.refund_failed"), {
        locale,
        overrides: {
          precondition: t("admin.purchases.refund_refused"),
        },
      }),
      ok: false,
    };
  }
};
