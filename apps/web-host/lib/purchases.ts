import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { MyPurchase } from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { loadHostMessages } from "./messages";

/**
 * `locale` reaches the read as an argument rather than being resolved inside
 * the cached scope, so the failure wording belongs to the cache key instead of
 * to whichever request filled the entry.
 */
const purchaseMessage = async (
  locale: Locale,
  key: "errors.rpc.unauthenticated" | "host.library.list_failed"
): Promise<string> => getMessage(await loadHostMessages(locale), key);

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
  input: ListPurchasesInput
): Promise<CachedListPurchasesResult> => {
  "use cache: private";

  const { locale } = input;
  const [messages, sessionId] = await Promise.all([
    loadHostMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyPurchasePage,
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
      message: rpcErrorMessage(
        error,
        getMessage(messages, "host.library.list_failed"),
        { locale }
      ),
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
  const { unexpected, ...result } = await readPurchaseList(tenantId, input);
  if (unexpected) {
    throw new Error(
      result.ok
        ? await purchaseMessage(input.locale, "host.library.list_failed")
        : result.message
    );
  }
  return result;
};
