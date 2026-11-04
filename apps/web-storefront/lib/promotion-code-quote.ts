import {
  Code,
  isRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
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

/** Each refusal the server words with an ErrorInfo reason. */
const refusalsByReason = [
  [RPC_ERROR_REASON.promotionCodeInvalid, "invalid"],
  [RPC_ERROR_REASON.promotionCodeExpired, "expired"],
  [RPC_ERROR_REASON.promotionCodeExhausted, "exhausted"],
  [RPC_ERROR_REASON.promotionCodeAlreadyRedeemed, "already_redeemed"],
  [RPC_ERROR_REASON.promotionCodeNotApplicable, "not_applicable"],
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

type SaleQuote =
  | { ok: true; quote: PromotionCodeQuote }
  | { ok: false; reason: PromotionCodeRefusal };

/**
 * Quotes `code` against the permanent copy or the rental of an episode. Every
 * call spends one of the reader's lookups, whatever it answers.
 */
const quoteEpisodeSale = async ({
  code,
  episodeId,
  kind,
  sessionId,
  tenantId,
}: {
  code: string;
  episodeId: string;
  kind: EpisodeSaleKind;
  sessionId: string;
  tenantId: string;
}): Promise<SaleQuote> => {
  try {
    const response = await apiClient.purchase.previewPromotionCode(
      {
        code,
        episodeId,
        kind: purchaseKinds[kind],
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      quote: { listPrice: response.listPrice, price: response.price },
    };
  } catch (error) {
    return { ok: false, reason: toRefusal(error) };
  }
};

/**
 * What `code` makes of each of the episode's sales in `kinds`: applied to
 * every sale it is quoted for, where at least one is, and otherwise refused
 * for the reason the first sale gave, which is the permanent copy wherever
 * the episode sells one.
 *
 * Not cached: every quote spends one of the reader's lookups, and a code's
 * limits move as other readers redeem it. A code no tenant could hold is
 * refused here without asking.
 *
 * An expired session is thrown as the API answered it, for the caller to send
 * the reader to sign in.
 */
export const quoteEpisodePromotionCode = async ({
  code: rawCode,
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
}): Promise<PromotionCodeState<EpisodeSaleKind>> => {
  const code = rawCode.trim();

  if (!code || kinds.length === 0) {
    return NO_PROMOTION_CODE;
  }

  if (!isPromotionCodeSpelling(code)) {
    return { code, kind: "refused", reason: "invalid" };
  }

  const results = await Promise.all(
    kinds.map(
      async (kind) =>
        [
          kind,
          await quoteEpisodeSale({
            code,
            episodeId,
            kind,
            sessionId,
            tenantId,
          }),
        ] as const
    )
  );

  const quotes: Partial<Record<EpisodeSaleKind, PromotionCodeQuote>> = {};

  for (const [kind, result] of results) {
    if (result.ok) {
      quotes[kind] = result.quote;
    }
  }

  if (Object.keys(quotes).length > 0) {
    return { code, kind: "applied", quotes };
  }

  const [[, first]] = results;

  return {
    code,
    kind: "refused",
    reason: first.ok ? "error" : first.reason,
  };
};
