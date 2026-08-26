import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { MyPurchase } from "@publira/api-client/public/types";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const listErrorMessage =
  "購入済み一覧を取得できませんでした。時間をおいて再試行してください。";
const defaultPurchasePageSize = 20;

export interface PurchaseItem {
  episode: { orderIndex: number; publicId: string; title: string };
  expiresAt: string;
  id: string;
  isActive: boolean;
  priceAtPurchase: number;
  purchasedAt: string;
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
  | "episode"
  | "expiresAt"
  | "id"
  | "isActive"
  | "priceAtPurchase"
  | "purchasedAt"
  | "series"
>;

const mapPurchase = (purchase: RawPurchase): PurchaseItem => ({
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
  series: {
    publicId: purchase.series?.publicId ?? "",
    title: purchase.series?.title ?? "",
  },
});

/** A private, paged list of the signed-in reader's purchases. */
const readPurchaseList = async (
  tenantId: string,
  input: ListPurchasesInput = {}
): Promise<CachedListPurchasesResult> => {
  "use cache: private";

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      ...emptyPurchasePage,
      message: sessionErrorMessage,
      ok: false,
      requiresSignIn: true,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.purchase.listMyPurchases(
      {
        limit: input.limit ?? defaultPurchasePageSize,
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
      message: rpcErrorMessage(error, listErrorMessage),
      ok: false,
      requiresSignIn: isRpcError(error, Code.Unauthenticated),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listMyPurchases = async (
  tenantId: string,
  input: ListPurchasesInput = {}
): Promise<ListPurchasesResult> => {
  const { unexpected, ...result } = await readPurchaseList(tenantId, input);
  if (unexpected) {
    throw new Error(result.ok ? listErrorMessage : result.message);
  }
  return result;
};
