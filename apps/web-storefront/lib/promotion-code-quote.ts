import {
  Code,
  isRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { PromotionCodeQuote_Refusal } from "@publira/api-client/public/catalog";
import { PurchaseKind } from "@publira/api-client/public/types";

import { apiClient, buildSessionHeaders } from "./api-client";
import { isPromotionCodeSpelling, NO_PROMOTION_CODE } from "./promotion-code";
import type {
  EpisodeSaleKind,
  PromotionCodeQuote,
  PromotionCodeRefusal,
  PromotionCodeState,
} from "./promotion-code";

const purchaseKinds = {
  purchase: PurchaseKind.PURCHASE,
  rental: PurchaseKind.RENTAL,
} as const satisfies Record<EpisodeSaleKind, PurchaseKind>;

/** Each refusal of the code itself the server words with an ErrorInfo reason. */
const refusalsByReason = [
  [RPC_ERROR_REASON.promotionCodeInvalid, "invalid"],
  [RPC_ERROR_REASON.promotionCodeExpired, "expired"],
  [RPC_ERROR_REASON.promotionCodeExhausted, "exhausted"],
  [RPC_ERROR_REASON.promotionCodeAlreadyRedeemed, "already_redeemed"],
] as const satisfies readonly (readonly [string, PromotionCodeRefusal])[];

/**
 * Why `PreviewPromotionCode` did not quote. A failure the reader can do
 * nothing about, such as the API being unreachable, is `error`; one the
 * storefront cannot account for is rethrown for the error boundary, and an
 * expired session is rethrown for the caller to send the reader to sign in.
 */
const toRefusal = (cause: unknown): PromotionCodeRefusal => {
  if (isRpcError(cause, Code.Unauthenticated)) {
    throw cause;
  }

  rethrowUnclassifiedRpcError(cause);

  if (isRpcError(cause, Code.ResourceExhausted)) {
    return "rate_limited";
  }

  const match = refusalsByReason.find(([reason]) =>
    rpcErrorHasReason(cause, reason)
  );

  return match?.[1] ?? "error";
};

/** One sale to quote, named by `key` in the answer. */
interface PromotionCodeSaleRequest<K extends string> {
  episodeId?: string;
  key: K;
  kind?: EpisodeSaleKind;
  volumeId?: string;
}

/**
 * What `code` makes of each sale in `sales`, quoted in one call: applied to
 * every sale it is quoted for, where at least one is, and otherwise refused.
 * A sale the code takes nothing off keeps its price, so it is left out of the
 * quotes whatever its own refusal, and a code that takes nothing off any of
 * them is `not_applicable`.
 *
 * Not cached: every call spends one of the reader's lookups, and a code's
 * limits move as other readers redeem it. A code no tenant could hold is
 * refused here without asking.
 *
 * An expired session is thrown as the API answered it, for the caller to send
 * the reader to sign in.
 */
const quotePromotionCode = async <K extends string>({
  code: rawCode,
  sales,
  sessionId,
  tenantId,
}: {
  code: string;
  /** At most `PROMOTION_CODE_MAX_SALES`. */
  sales: readonly PromotionCodeSaleRequest<K>[];
  sessionId: string;
  tenantId: string;
}): Promise<PromotionCodeState<K>> => {
  const code = rawCode.trim();

  if (!code || sales.length === 0) {
    return NO_PROMOTION_CODE;
  }

  if (!isPromotionCodeSpelling(code)) {
    return { code, kind: "refused", reason: "invalid" };
  }

  const quotes: Partial<Record<K, PromotionCodeQuote>> = {};

  try {
    const response = await apiClient.purchase.previewPromotionCode(
      {
        code,
        sales: sales.map(({ episodeId, kind, volumeId }) => ({
          episodeId,
          kind: kind ? purchaseKinds[kind] : undefined,
          volumeId,
        })),
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    // One quote per sale, in the order they were asked for.
    for (const [index, { key }] of sales.entries()) {
      const quote = response.quotes[index];

      if (quote?.refusal === PromotionCodeQuote_Refusal.UNSPECIFIED) {
        quotes[key] = { listPrice: quote.listPrice, price: quote.price };
      }
    }
  } catch (error) {
    return { code, kind: "refused", reason: toRefusal(error) };
  }

  return Object.keys(quotes).length > 0
    ? { code, kind: "applied", quotes }
    : { code, kind: "refused", reason: "not_applicable" };
};

/**
 * What `code` makes of each of the episode's sales in `kinds`, the permanent
 * copy and the rental quoted together for one lookup.
 */
export const quoteEpisodePromotionCode = ({
  code,
  episodeId,
  kinds,
  sessionId,
  tenantId,
}: {
  code: string;
  episodeId: string;
  kinds: readonly EpisodeSaleKind[];
  sessionId: string;
  tenantId: string;
}): Promise<PromotionCodeState<EpisodeSaleKind>> =>
  quotePromotionCode({
    code,
    sales: kinds.map((kind) => ({ episodeId, key: kind, kind })),
    sessionId,
    tenantId,
  });

/**
 * What `code` makes of each volume in `volumeIds`, at most
 * `PROMOTION_CODE_MAX_SALES` of them, keyed by volume id and quoted together
 * for one lookup.
 */
export const quoteVolumePromotionCode = ({
  code,
  sessionId,
  tenantId,
  volumeIds,
}: {
  code: string;
  sessionId: string;
  tenantId: string;
  volumeIds: readonly string[];
}): Promise<PromotionCodeState<string>> =>
  quotePromotionCode({
    code,
    sales: volumeIds.map((volumeId) => ({ key: volumeId, volumeId })),
    sessionId,
    tenantId,
  });
