import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { ClientSurface, PurchaseKind } from "@publira/api-client/public/types";
import type { MyPurchase } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantPurchasesTag } from "./cache-tags";
import { getMessagesFor } from "./messages";

const defaultPurchasePageSize = 20;

/**
 * What one purchase bought: an episode, a volume of the series, the episodes
 * of the series the reader did not hold yet when they bought the rest of it,
 * or a pack of the tenant's coins, with the coins and bonus coins it granted
 * and the tenant's word for them in the reader's locale.
 */
export type PurchasedItem =
  | { kind: "episode"; orderIndex: number; publicId: string; title: string }
  | { kind: "series_bundle"; episodeCount: number }
  | { kind: "volume"; publicId: string; title: string }
  | { bonusCoins: number; coinName: string; coins: number; kind: "coin_pack" };

export interface PurchaseItem {
  /**
   * Set on an episode paid with the tenant's coins: how many were spent, and
   * the tenant's word for them in the reader's locale. Such a purchase took no
   * payment, so `priceAtPurchase` is 0 on it.
   */
  coinsSpent?: { coinName: string; count: number };
  /** ISO 4217 code of the currency the reader paid priceAtPurchase in. */
  currency: string;
  expiresAt: string;
  id: string;
  isActive: boolean;
  item: PurchasedItem;
  /**
   * Which of the episode's sales the reader bought. A rental always carries
   * `expiresAt`, and a volume or the rest of a series is always a purchase.
   */
  kind: "purchase" | "rental";
  priceAtPurchase: number;
  purchasedAt: string;
  /** What has been refunded so far, in the same unit as priceAtPurchase. */
  refundedAmount: number;
  /** Set once the refunds reach the price; empty until then. */
  refundedAt: string;
  /**
   * Set once the purchase stopped opening its episode before its reading
   * period ran out — refunded in full, disputed, or refunded by staff.
   */
  revokedAt: string;
  series: { publicId: string; title: string };
}

export type ListPurchasesResult =
  | {
      nextToken: string;
      ok: true;
      previousToken: string;
      purchases: PurchaseItem[];
    }
  | {
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      purchases: PurchaseItem[];
      requiresSignIn: boolean;
    };

type CachedListPurchasesResult = ListPurchasesResult & {
  unexpected: boolean;
};
export interface ListPurchasesInput {
  limit?: number;
  /** UI locale the failure wording belongs to; part of the cache key. */
  locale: Locale;
  token?: string;
}

const emptyPurchasePage = {
  nextToken: "",
  previousToken: "",
  purchases: [] as PurchaseItem[],
};

/**
 * The generated `MyPurchase` fields {@link mapPurchase} reads. Naming them
 * against the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the purchases list then renders a row
 * with a blank episode title and a zero price with nothing pointing at the
 * cause.
 */
type RawPurchase = Pick<
  MyPurchase,
  | "coinName"
  | "coinPack"
  | "coinsSpent"
  | "currency"
  | "episode"
  | "expiresAt"
  | "id"
  | "isActive"
  | "kind"
  | "priceAtPurchase"
  | "purchasedAt"
  | "refundedAmount"
  | "refundedAt"
  | "revokedAt"
  | "series"
  | "seriesBundle"
  | "volume"
>;

/** Unspecified, which the server never answers, reads as the permanent copy. */
const toPurchaseKind = (
  kind: PurchaseKind | undefined
): PurchaseItem["kind"] =>
  kind === PurchaseKind.RENTAL ? "rental" : "purchase";

/**
 * The API sets exactly one of the four. A purchase that names none reads as
 * an episode, which is what every purchase was before the others existed.
 */
const toPurchasedItem = ({
  coinName,
  coinPack,
  episode,
  seriesBundle,
  volume,
}: Pick<
  RawPurchase,
  "coinName" | "coinPack" | "episode" | "seriesBundle" | "volume"
>): PurchasedItem => {
  if (coinPack) {
    return {
      bonusCoins: coinPack.bonusCoins ?? 0,
      coinName: coinName ?? "",
      coins: coinPack.coins ?? 0,
      kind: "coin_pack",
    };
  }
  if (volume) {
    return {
      kind: "volume",
      publicId: volume.publicId ?? "",
      title: volume.title ?? "",
    };
  }
  if (seriesBundle) {
    return {
      episodeCount: seriesBundle.episodeCount ?? 0,
      kind: "series_bundle",
    };
  }
  return {
    kind: "episode",
    orderIndex: episode?.orderIndex ?? 0,
    publicId: episode?.publicId ?? "",
    title: episode?.title ?? "",
  };
};

const mapPurchase = (purchase: RawPurchase): PurchaseItem => ({
  coinsSpent: purchase.coinsSpent
    ? { coinName: purchase.coinName ?? "", count: purchase.coinsSpent }
    : undefined,
  currency: purchase.currency ?? "",
  expiresAt: purchase.expiresAt ?? "",
  id: purchase.id ?? "",
  isActive: purchase.isActive ?? false,
  item: toPurchasedItem(purchase),
  kind: toPurchaseKind(purchase.kind),
  priceAtPurchase: purchase.priceAtPurchase ?? 0,
  purchasedAt: purchase.purchasedAt ?? "",
  refundedAmount: purchase.refundedAmount ?? 0,
  refundedAt: purchase.refundedAt ?? "",
  revokedAt: purchase.revokedAt ?? "",
  series: {
    publicId: purchase.series?.publicId ?? "",
    title: purchase.series?.title ?? "",
  },
});

/**
 * A private, paged list of the signed-in reader's purchases.
 *
 * The one purchase this app records itself is an episode paid with coins,
 * and the Action that pays clears {@link tenantPurchasesTag}. Every other
 * checkout Action only hands the reader to the payment provider, and the
 * purchase is recorded when the provider's notification reaches the API, so
 * such a purchase shows in the library once the private entry goes stale, or
 * on a reload.
 */
const readPurchaseList = async (
  tenantId: string,
  input: ListPurchasesInput,
  sessionId: string
): Promise<CachedListPurchasesResult> => {
  "use cache: private";

  applyCacheTag(tenantPurchasesTag(tenantId));

  const { locale } = input;
  const t = await getMessagesFor(locale);
  if (!sessionId) {
    return {
      ...emptyPurchasePage,
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.purchase.listMyPurchases(
      {
        limit: input.limit ?? defaultPurchasePageSize,
        locale,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token: input.token ?? "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      purchases: (response.purchases ?? []).map(mapPurchase),
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyPurchasePage,
      message: rpcErrorMessage(error, t("storefront.library.list_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isRpcError(error, Code.Unauthenticated),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listMyPurchases = async (
  tenantId: string,
  input: ListPurchasesInput
): Promise<ListPurchasesResult> => {
  const { unexpected, ...result } = await readPurchaseList(
    tenantId,
    input,
    await resolveAccessToken()
  );
  if (unexpected) {
    const t = await getMessagesFor(input.locale);

    throw new Error(
      result.ok ? t("storefront.library.list_failed") : result.message
    );
  }
  return result;
};

/** The largest page `ListMyPurchases` answers. */
const maxPurchasePageSize = 100;

/**
 * Every purchase the library lists for the reader `accessToken` belongs to,
 * newest first, read page by page for the purchase history download. Like the
 * library, it leaves out an episode the storefront may not show, and names each
 * work in `locale`.
 *
 * Uncached: a download is asked for once and should report the purchases as
 * they stand, a refund recorded a moment ago included. An RPC error is thrown
 * as it is, for the caller to turn a rejected session into the sign-in flow.
 */
export const listAllMyPurchases = async (
  tenantId: string,
  accessToken: string,
  locale: Locale,
  token = ""
): Promise<PurchaseItem[]> => {
  const response = await apiClient.purchase.listMyPurchases(
    {
      limit: maxPurchasePageSize,
      locale,
      surface: ClientSurface.WEB,
      tenant: { tenantId },
      token,
    },
    buildSessionHeaders(accessToken)
  );
  const purchases = (response.purchases ?? []).map(mapPurchase);
  const nextToken = response.nextToken ?? "";
  return nextToken
    ? [
        ...purchases,
        ...(await listAllMyPurchases(tenantId, accessToken, locale, nextToken)),
      ]
    : purchases;
};
