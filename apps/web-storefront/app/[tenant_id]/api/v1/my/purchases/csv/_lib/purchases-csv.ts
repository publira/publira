import { currencyFractionDigits } from "@publira/utils";

import { CSV_BOM, encodeCsvRow } from "#lib/csv";
import type { PurchaseItem } from "#lib/purchases";

/**
 * An amount the API sends, an integer in the minor unit of `currency`, written
 * in the currency itself with no symbol and no grouping: `500` is `500` in JPY
 * and `5.00` in USD.
 */
const formatAmount = (amount: number, currency: string): string => {
  const digits = currencyFractionDigits(currency);

  return (amount / 10 ** digits).toFixed(digits);
};

/** The badge the library shows the purchase under, decided the same way. */
const purchaseStatus = (purchase: PurchaseItem): string => {
  if (purchase.refundedAt) {
    return "refunded";
  }

  if (purchase.revokedAt) {
    return "canceled";
  }

  return purchase.isActive ? "active" : "expired";
};

/**
 * The episode columns of a row: filled for a purchase of an episode, and empty
 * for a volume and the rest of a series, which name no one episode.
 */
const episodeFields = ({ item }: PurchaseItem): [string, string] =>
  item.kind === "episode" ? [String(item.orderIndex), item.title] : ["", ""];

/**
 * What the purchase bought, as the `item` column names it. The rest of a
 * series is `remaining_episodes`, which is what the reader bought it as, and a
 * pack of coins is `coin_pack`.
 */
const itemType = ({ item }: PurchaseItem): string =>
  item.kind === "series_bundle" ? "remaining_episodes" : item.kind;

const HEADER = [
  "purchase_id",
  "purchased_at",
  "series_title",
  "episode_number",
  "episode_title",
  "price",
  "refunded_amount",
  "currency",
  "expires_at",
  "refunded_at",
  "status",
  "item",
  "volume_title",
  "coins",
  "bonus_coins",
  "coins_spent",
] as const;

/** The coins a pack granted, its bonus coins among them, and the bonus. */
const coinFields = ({ item }: PurchaseItem): [string, string] =>
  item.kind === "coin_pack"
    ? [String(item.coins + item.bonusCoins), String(item.bonusCoins)]
    : ["", ""];

/**
 * The reader's purchase history as CSV, laid out as `#lib/csv` describes. A
 * header row, then one row per purchase in the order given. The times are RFC
 * 3339 in UTC as the API answers them, and empty where the purchase has none;
 * `status` is `active`, `expired`, `refunded`, or `canceled`, and `item` is
 * `episode`, `volume`, `remaining_episodes`, or `coin_pack`, whose `coins` are
 * what the pack granted, its `bonus_coins` included. An episode paid with
 * coins has a `price` of 0 and the coins it took in `coins_spent`. The columns
 * that came later are appended, so a sheet that reads the earlier ones by
 * position keeps reading them.
 */
export const renderPurchasesCsv = (
  purchases: readonly PurchaseItem[]
): string =>
  CSV_BOM +
  encodeCsvRow(HEADER) +
  purchases
    .map((purchase) =>
      encodeCsvRow([
        purchase.id,
        purchase.purchasedAt,
        purchase.series.title,
        ...episodeFields(purchase),
        formatAmount(purchase.priceAtPurchase, purchase.currency),
        formatAmount(purchase.refundedAmount, purchase.currency),
        purchase.currency,
        purchase.expiresAt,
        purchase.refundedAt,
        purchaseStatus(purchase),
        itemType(purchase),
        purchase.item.kind === "volume" ? purchase.item.title : "",
        ...coinFields(purchase),
        purchase.coinsSpent ? String(purchase.coinsSpent.count) : "",
      ])
    )
    .join("");
