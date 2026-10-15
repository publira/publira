import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
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

export interface PurchaseItem {
  /** ISO 4217 code of the currency the reader paid priceAtPurchase in. */
  currency: string;
  episode: { orderIndex: number; publicId: string; title: string };
  expiresAt: string;
  id: string;
  isActive: boolean;
  priceAtPurchase: number;
  purchasedAt: string;
  /** What has been refunded so far, in the same unit as priceAtPurchase. */
  refundedAmount: number;
  /** Set once the refunds reach the price; empty until then. */
  refundedAt: string;
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
  | "currency"
  | "episode"
  | "expiresAt"
  | "id"
  | "isActive"
  | "priceAtPurchase"
  | "purchasedAt"
  | "refundedAmount"
  | "refundedAt"
  | "series"
>;

const mapPurchase = (purchase: RawPurchase): PurchaseItem => ({
  currency: purchase.currency ?? "",
  episode: {
    orderIndex: purchase.episode?.orderIndex ?? 0,
    publicId: purchase.episode?.publicId ?? "",
    title: purchase.episode?.title ?? "",
  },
  expiresAt: purchase.expiresAt ?? "",
  id: purchase.id ?? "",
  isActive: purchase.isActive ?? false,
  priceAtPurchase: purchase.priceAtPurchase ?? 0,
  purchasedAt: purchase.purchasedAt ?? "",
  refundedAmount: purchase.refundedAmount ?? 0,
  refundedAt: purchase.refundedAt ?? "",
  series: {
    publicId: purchase.series?.publicId ?? "",
    title: purchase.series?.title ?? "",
  },
});

/**
 * A private, paged list of the signed-in reader's purchases.
 *
 * Nothing in this app writes what it lists, so no Action clears
 * {@link tenantPurchasesTag}: the checkout Action only hands the reader to the
 * payment provider, and the purchase is recorded when the provider's
 * notification reaches the API. A new purchase shows in the library once the
 * private entry goes stale, or on a reload.
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
 * Every purchase of the reader `accessToken` belongs to, newest first, read
 * page by page for the purchase history download.
 *
 * Uncached: a download is asked for once and should report the purchases as
 * they stand, a refund recorded a moment ago included. An RPC error is thrown
 * as it is, for the caller to turn a rejected session into the sign-in flow.
 */
export const listAllMyPurchases = async (
  tenantId: string,
  accessToken: string,
  token = ""
): Promise<PurchaseItem[]> => {
  const response = await apiClient.purchase.listMyPurchases(
    {
      limit: maxPurchasePageSize,
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
        ...(await listAllMyPurchases(tenantId, accessToken, nextToken)),
      ]
    : purchases;
};
