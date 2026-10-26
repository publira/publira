import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { CoinTransactionKind } from "@publira/api-client/public/coin";
import { ClientSurface } from "@publira/api-client/public/types";
import type {
  CoinBalance,
  CoinDisclosures,
  CoinPack,
  CoinSettings,
  CoinTransaction,
} from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantSeriesDetailTag } from "./cache-tags";
import { getMessagesFor } from "./messages";
import { localizedReadFailure } from "./read-failure";
import { servedLocaleFrom } from "./served-locale";

/** A pack of the tenant's coins on sale. */
export interface CoinPackItem {
  /** The primary key, which the checkout names the pack by. */
  id: string;
  publicId: string;
  coins: number;
  /** Coins granted on top of `coins`; 0 on a pack with no bonus. */
  bonusCoins: number;
  /** In the minor unit of `currency`. */
  price: number;
  currency: string;
}

/**
 * What the tenant discloses wherever its coins are sold. `termsUrl` is empty
 * unless it is an http or https URL, so a link is never written to anything
 * else.
 */
export interface CoinDisclosuresItem {
  issuerName: string;
  termsUrl: string;
  contact: string;
  notice: string;
}

/** The tenant's coins, as a reader in one locale sees them. */
export interface CoinSettingsItem {
  /** The tenant's word for its coins in the reader's locale. */
  coinName: string;
  /** How many days after purchase a coin can be spent. */
  expiryDays: number;
  /**
   * Whether the tenant sells packs now. False still leaves the coins readers
   * hold to spend.
   */
  selling: boolean;
  /** Empty while `selling` is false. */
  packs: CoinPackItem[];
  disclosures: CoinDisclosuresItem;
}

/** The signed-in reader's coins. */
export interface CoinBalanceItem {
  coinName: string;
  /** What the reader can spend now. */
  coins: number;
  /** RFC3339; empty, with `nearestExpiryCoins` 0, while `coins` is 0. */
  nearestExpiryAt: string;
  nearestExpiryCoins: number;
  /**
   * Coins of a refunded pack that had already been spent, which the next pack
   * the reader buys pays back before any of its coins can be spent.
   */
  owedCoins: number;
}

export type CoinTransactionItemKind =
  | "expiry"
  | "grant"
  | "revocation"
  | "settlement"
  | "shortfall"
  | "spend";

/** One entry of the reader's coin history. */
export interface CoinTransactionItem {
  id: string;
  kind: CoinTransactionItemKind;
  /** Always positive: `kind` says which way they moved. */
  coins: number;
  /** RFC3339. */
  createdAt: string;
  /** On a grant: when its coins expire. Empty otherwise. */
  expiresAt: string;
  /**
   * On a spend: the episode it paid for and its series. Absent on every other
   * kind, and on a spend of an episode the site no longer shows.
   */
  episode?: {
    locale: Locale;
    orderIndex: number;
    publicId: string;
    seriesPublicId: string;
    seriesTitle: string;
    title: string;
  };
}

/** One page of the reader's coin history, newest first. */
export interface CoinTransactionPage {
  coinName: string;
  nextToken: string;
  previousToken: string;
  transactions: CoinTransactionItem[];
}

/**
 * A read of the signed-in reader's own coins. `ok: true` with a `null` value
 * while the tenant offers no coins, where the screen shows nothing about them.
 */
export type MyCoinsResult<TValue> =
  | { ok: true; value: TValue | null }
  | { message: string; ok: false; requiresSignIn: boolean };

/**
 * The generated `CoinPack` fields {@link toCoinPackItem} reads. Naming them
 * against the message type is what makes a proto rename fail here.
 */
type RawCoinPack = Pick<
  CoinPack,
  "bonusCoins" | "coins" | "currency" | "id" | "price" | "publicId"
>;

type RawCoinDisclosures = Pick<
  CoinDisclosures,
  "contact" | "issuerName" | "notice" | "termsUrl"
>;

type RawCoinSettings = Pick<
  CoinSettings,
  "coinName" | "disclosures" | "expiryDays" | "packs" | "selling"
>;

type RawCoinBalance = Pick<
  CoinBalance,
  | "coinName"
  | "coins"
  | "nearestExpiryAt"
  | "nearestExpiryCoins"
  | "shortfallCoins"
>;

type RawCoinTransaction = Pick<
  CoinTransaction,
  "coins" | "createdAt" | "episode" | "expiresAt" | "id" | "kind" | "series"
>;

const transactionKinds: Partial<
  Record<CoinTransactionKind, CoinTransactionItemKind>
> = {
  [CoinTransactionKind.EXPIRY]: "expiry",
  [CoinTransactionKind.GRANT]: "grant",
  [CoinTransactionKind.REVOCATION]: "revocation",
  [CoinTransactionKind.SHORTFALL]: "shortfall",
  [CoinTransactionKind.SHORTFALL_SETTLEMENT]: "settlement",
  [CoinTransactionKind.SPEND]: "spend",
};

const toCoinPackItem = (pack: RawCoinPack): CoinPackItem => ({
  bonusCoins: pack.bonusCoins ?? 0,
  coins: pack.coins ?? 0,
  currency: pack.currency ?? "",
  id: pack.id ?? "",
  price: pack.price ?? 0,
  publicId: pack.publicId ?? "",
});

const httpUrlOrEmpty = (value: string): string => {
  if (!URL.canParse(value)) {
    return "";
  }
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:" ? value : "";
};

const toCoinDisclosuresItem = (
  disclosures: RawCoinDisclosures | undefined
): CoinDisclosuresItem => ({
  contact: disclosures?.contact?.trim() ?? "",
  issuerName: disclosures?.issuerName?.trim() ?? "",
  notice: disclosures?.notice?.trim() ?? "",
  termsUrl: httpUrlOrEmpty(disclosures?.termsUrl?.trim() ?? ""),
});

const toCoinSettingsItem = (settings: RawCoinSettings): CoinSettingsItem => {
  const selling = settings.selling ?? false;
  return {
    coinName: settings.coinName ?? "",
    disclosures: toCoinDisclosuresItem(settings.disclosures),
    expiryDays: settings.expiryDays ?? 0,
    packs: selling
      ? (settings.packs ?? []).flatMap((pack) => {
          const item = toCoinPackItem(pack);
          return item.id ? [item] : [];
        })
      : [],
    selling,
  };
};

const toCoinBalanceItem = (balance: RawCoinBalance): CoinBalanceItem => ({
  coinName: balance.coinName ?? "",
  coins: Number(balance.coins ?? 0),
  nearestExpiryAt: balance.nearestExpiryAt ?? "",
  nearestExpiryCoins: Number(balance.nearestExpiryCoins ?? 0),
  owedCoins: Number(balance.shortfallCoins ?? 0),
});

/**
 * An entry of a kind this build has no name for is dropped: the history could
 * not say which way its coins moved.
 */
const toCoinTransactionItem = (
  transaction: RawCoinTransaction,
  requestedLocale: Locale
): CoinTransactionItem | null => {
  const kind = transactionKinds[transaction.kind];
  if (!kind) {
    return null;
  }
  const { episode, series } = transaction;
  return {
    coins: transaction.coins ?? 0,
    createdAt: transaction.createdAt ?? "",
    episode:
      kind === "spend" && episode?.publicId && series?.publicId
        ? {
            locale: servedLocaleFrom(episode.locale, requestedLocale),
            orderIndex: episode.orderIndex ?? 0,
            publicId: episode.publicId,
            seriesPublicId: series.publicId,
            seriesTitle: series.title ?? "",
            title: episode.title ?? "",
          }
        : undefined,
    expiresAt: transaction.expiresAt ?? "",
    id: transaction.id ?? "",
    kind,
  };
};

/**
 * The tenant's coins in `locale`: their name, the packs on sale, and what the
 * tenant discloses about them. `ok: true` with a `null` value while the
 * platform does not allow tenant coins or the tenant has not turned its own
 * on, and then nothing on the site names them.
 *
 * The read names no reader, so one entry serves every visitor of a tenant.
 * It carries the catalog's detail tag because that is the tag `publira server`
 * drops when the console saves the coin settings, or the platform changes
 * whether tenants may issue coins: the same saves that reprice every episode
 * in coins.
 */
export const getCoinSettings = async (
  tenantId: string,
  locale: Locale
): Promise<CachedReadResult<CoinSettingsItem | null>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));

  let response;
  try {
    response = await apiClient.coin.getCoinSettings({
      locale,
      tenant: { tenantId: normalizedTenantId },
    });
  } catch (error) {
    if (rpcErrorHasReason(error, RPC_ERROR_REASON.coinsUnavailable)) {
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "storefront.coins.failed");
  }

  return {
    ok: true,
    value: response.settings ? toCoinSettingsItem(response.settings) : null,
  };
};

/**
 * Turns a failed read of the reader's own coins into what the screen does
 * with it. A session the API rejects is reported as `requiresSignIn`, so a
 * reader is never told they hold nothing.
 */
const myCoinsFailure = async (
  error: unknown,
  locale: Locale,
  key: "storefront.coins.balance_failed" | "storefront.coins.history_failed"
): Promise<MyCoinsResult<never>> => {
  rethrowUnclassifiedRpcError(error);
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.coinsUnavailable)) {
    return { ok: true, value: null };
  }
  const t = await getMessagesFor(locale);
  return {
    message: rpcErrorMessage(error, t(key), { locale }),
    ok: false,
    requiresSignIn: isRpcError(error, Code.Unauthenticated),
  };
};

const signInRequired = async (
  locale: Locale
): Promise<MyCoinsResult<never>> => {
  const t = await getMessagesFor(locale);
  return {
    message: t("errors.rpc.unauthenticated"),
    ok: false,
    requiresSignIn: true,
  };
};

/**
 * The signed-in reader's balance.
 *
 * Uncached, because it is one reader's own answer and a pack's coins are
 * granted when the payment provider's notification reaches the API, which
 * tells this app nothing: a reader coming back from the checkout has to see
 * the balance as it now stands.
 */
export const getMyCoinBalance = async (
  tenantId: string,
  locale: Locale
): Promise<MyCoinsResult<CoinBalanceItem>> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.coin.getCoinBalance(
      { locale, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      value: response.balance ? toCoinBalanceItem(response.balance) : null,
    };
  } catch (error) {
    return myCoinsFailure(error, locale, "storefront.coins.balance_failed");
  }
};

export const defaultCoinTransactionsPageSize = 20;

/**
 * One page of the signed-in reader's coin history, uncached for the reason
 * {@link getMyCoinBalance} is.
 */
export const listMyCoinTransactions = async (
  tenantId: string,
  { locale, token }: { locale: Locale; token: string }
): Promise<MyCoinsResult<CoinTransactionPage>> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return signInRequired(locale);
  }

  try {
    const response = await apiClient.coin.listCoinTransactions(
      {
        limit: defaultCoinTransactionsPageSize,
        locale,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token,
      },
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      value: {
        coinName: response.coinName ?? "",
        nextToken: response.nextToken ?? "",
        previousToken: response.previousToken ?? "",
        transactions: (response.transactions ?? []).flatMap((transaction) => {
          const item = toCoinTransactionItem(transaction, locale);
          return item ? [item] : [];
        }),
      },
    };
  } catch (error) {
    return myCoinsFailure(error, locale, "storefront.coins.history_failed");
  }
};

/** The coins a purchase of `pack` adds to the balance, its bonus included. */
export const coinPackTotal = (
  pack: Pick<CoinPackItem, "bonusCoins" | "coins">
): number => pack.coins + pack.bonusCoins;

/**
 * The smallest pack whose coins cover `needed`, the cheaper of two that grant
 * as many, or `undefined` when none on sale does.
 */
export const coinPackCovering = (
  packs: readonly CoinPackItem[],
  needed: number
): CoinPackItem | undefined =>
  packs
    .filter((pack) => coinPackTotal(pack) >= needed)
    .toSorted(
      (a, b) => coinPackTotal(a) - coinPackTotal(b) || a.price - b.price
    )
    .at(0);
