import { currencyFractionDigits } from "@publira/utils";

import type { PurchaseItem } from "#lib/purchases";

/** The UTF-8 byte order mark, which is what makes Excel read the text as UTF-8. */
const BOM = "\uFEFF";

const NEEDS_QUOTES_RE = /[",\r\n]/u;
const FORMULA_LEAD_RE = /^[=+\-@\t\r]/u;

/** `Number` skips surrounding whitespace, which a number field never has. */
const isNumber = (field: string): boolean =>
  field.trim() === field && Number.isFinite(Number(field));

/**
 * A field a spreadsheet would read as a formula is written with a leading
 * apostrophe, since the titles are written by the tenant's staff rather than
 * by the reader opening the file. A signed number is a value, not a formula,
 * and is left as it is.
 */
const neutralize = (field: string): string =>
  FORMULA_LEAD_RE.test(field) && !isNumber(field) ? `'${field}` : field;

/** RFC 4180 quoting, applied only where the field needs it. */
const encodeField = (raw: string): string => {
  const field = neutralize(raw);

  return NEEDS_QUOTES_RE.test(field)
    ? `"${field.replaceAll('"', '""')}"`
    : field;
};

const encodeRow = (fields: readonly string[]): string =>
  `${fields.map(encodeField).join(",")}\r\n`;

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
 * The reader's purchase history as CSV, laid out the way the consoles' exports
 * are so it opens the same way in a spreadsheet: UTF-8 with a byte order mark,
 * CRLF line endings, and RFC 4180 quoting. A header row, then one row per
 * purchase in the order given. The times are RFC 3339 in UTC as the API
 * answers them, and empty where the purchase has none; `status` is `active`,
 * `expired`, `refunded`, or `canceled`, and `item` is `episode`, `volume`,
 * `remaining_episodes`, or `coin_pack`, whose `coins` are what the pack
 * granted, its `bonus_coins` included. An episode paid with coins has a
 * `price` of 0 and the coins it took in `coins_spent`. The columns that came
 * later are appended, so a sheet that reads the earlier ones by position keeps
 * reading them.
 */
export const renderPurchasesCsv = (
  purchases: readonly PurchaseItem[]
): string =>
  BOM +
  encodeRow(HEADER) +
  purchases
    .map((purchase) =>
      encodeRow([
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
