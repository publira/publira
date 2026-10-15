import 'dart:math';

import 'package:intl/intl.dart';
import 'package:publira/models/my_purchase.dart';

/// The name the purchase history is handed to the share sheet under, the one
/// the site's download saves it as.
const purchaseHistoryCsvName = 'purchases.csv';

/// The UTF-8 byte order mark, which is what makes Excel read the text as UTF-8.
const _bom = '﻿';

final _needsQuotes = RegExp(r'[",\r\n]');
final _formulaLead = RegExp(r'^[=+\-@\t\r]');

/// `double.tryParse` skips surrounding whitespace, which a number field never
/// has.
bool _isNumber(String field) =>
    field.trim() == field && (double.tryParse(field)?.isFinite ?? false);

/// A field a spreadsheet would read as a formula is written with a leading
/// apostrophe, since the titles are written by the tenant's staff rather than
/// by the reader opening the file. A signed number is a value, not a formula,
/// and is left as it is.
String _neutralize(String field) =>
    _formulaLead.hasMatch(field) && !_isNumber(field) ? "'$field" : field;

/// RFC 4180 quoting, applied only where the field needs it.
String _encodeField(String raw) {
  final field = _neutralize(raw);
  return _needsQuotes.hasMatch(field)
      ? '"${field.replaceAll('"', '""')}"'
      : field;
}

String _encodeRow(List<String> fields) =>
    '${fields.map(_encodeField).join(',')}\r\n';

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
];

/// The reader's purchase history as CSV, in the columns and the encoding of
/// the site's download, so the two files open the same way in a spreadsheet:
/// UTF-8 with a byte order mark, CRLF line endings, and RFC 4180 quoting. A
/// header row, then one row per purchase in the order given; `status` is the
/// [MyPurchaseStatus.wireName] the library marks the purchase with.
String renderPurchaseHistoryCsv(List<MyPurchase> purchases) {
  final rows = StringBuffer(_bom)..write(_encodeRow(_header));
  for (final purchase in purchases) {
    rows.write(
      _encodeRow([
        purchase.id,
        _formatInstant(purchase.purchasedAt),
        purchase.seriesTitle,
        '${purchase.orderIndex}',
        purchase.episodeTitle,
        _formatAmount(purchase.price, purchase.currency),
        _formatAmount(purchase.refundedAmount, purchase.currency),
        purchase.currency,
        _formatInstant(purchase.expiresAt),
        _formatInstant(purchase.refundedAt),
        purchase.status.wireName,
      ]),
    );
  }
  return rows.toString();
}
