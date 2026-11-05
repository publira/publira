import 'dart:math';

import 'package:intl/intl.dart';
import 'package:publira/csv/csv.dart';
import 'package:publira/models/my_purchase.dart';

/// The name the purchase history is handed to the share sheet under, the one
/// the site's download saves it as.
const purchaseHistoryCsvName = 'purchases.csv';

/// An amount the API sends, an integer in the minor unit of [currency],
/// written in the currency itself with no symbol and no grouping: `500` is
/// `500` in JPY and `5.00` in USD.
String _formatAmount(int amount, String currency) {
  final digits = NumberFormat.currency(name: currency).decimalDigits ?? 0;
  return (amount / pow(10, digits)).toStringAsFixed(digits);
}

/// [value] in UTC as RFC 3339 to the second, which is how the API sends every
/// timestamp, and empty where the purchase has none.
String _formatInstant(DateTime? value) {
  if (value == null) {
    return '';
  }
  // `2026-01-10T12:00:00.000Z` without its fraction.
  return '${value.toUtc().toIso8601String().substring(0, 19)}Z';
}

const _header = [
  'purchase_id',
  'purchased_at',
  'series_title',
  'episode_number',
  'episode_title',
  'price',
  'refunded_amount',
  'currency',
  'expires_at',
  'refunded_at',
  'status',
  'item',
  'volume_title',
  'coins',
  'bonus_coins',
  'coins_spent',
];

/// The columns a file gains when a purchase in it recorded tax, written the
/// way the site's download writes them.
const _taxHeader = ['tax_rate_percent', 'tax_amount'];

/// The reader's purchase history as CSV, in the columns and the encoding of
/// the site's download, so the two files open the same way in a spreadsheet:
/// UTF-8 with a byte order mark, CRLF line endings, and RFC 4180 quoting. A
/// header row, then one row per purchase in the order given; `status` is the
/// [MyPurchaseStatus.wireName] the library marks the purchase with, and `item`
/// the [PurchasedItem.wireName] of what it bought, `tip` for a tip to the
/// Authors of the episode its episode columns name. The episode columns are
/// empty for a volume and for the rest of a series, which name no one
/// episode, and `coins`, every coin a pack granted, and `bonus_coins` are
/// empty for anything but a pack. An episode paid with coins has a `price` of
/// 0 and the coins it took in `coins_spent`, which is empty on every other
/// purchase. The columns that came later are appended, so a sheet that reads
/// the earlier ones by position keeps reading them.
///
/// The tax columns are appended only to a file holding a purchase that
/// recorded tax: `tax_rate_percent` with two decimals, `10.00` for 10%, and
/// `tax_amount`, the tax the price includes, both empty on a purchase that
/// recorded none.
String renderPurchaseHistoryCsv(List<MyPurchase> purchases) {
  final taxed = purchases.any((purchase) => purchase.tax != null);
  final rows = StringBuffer(csvBom)
    ..write(encodeCsvRow([..._header, if (taxed) ..._taxHeader]));
  for (final purchase in purchases) {
    final episode =
        purchase.item == PurchasedItem.episode ||
        purchase.item == PurchasedItem.tip;
    final coinPack = purchase.item == PurchasedItem.coinPack;
    rows.write(
      encodeCsvRow([
        purchase.id,
        _formatInstant(purchase.purchasedAt),
        purchase.seriesTitle,
        if (episode) '${purchase.orderIndex}' else '',
        if (episode) purchase.episodeTitle else '',
        _formatAmount(purchase.price, purchase.currency),
        _formatAmount(purchase.refundedAmount, purchase.currency),
        purchase.currency,
        _formatInstant(purchase.expiresAt),
        _formatInstant(purchase.refundedAt),
        purchase.status.wireName,
        purchase.item.wireName,
        if (purchase.item == PurchasedItem.volume) purchase.volumeTitle else '',
        if (coinPack) '${purchase.grantedCoins}' else '',
        if (coinPack) '${purchase.bonusCoins}' else '',
        if (purchase.paidWithCoins) '${purchase.coinsSpent}' else '',
        if (taxed)
          ...switch (purchase.tax) {
            final tax? => [
              (tax.rateBps / 100).toStringAsFixed(2),
              _formatAmount(tax.amount, purchase.currency),
            ],
            null => const ['', ''],
          },
      ]),
    );
  }
  return rows.toString();
}
