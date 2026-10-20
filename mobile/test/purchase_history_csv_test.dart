import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/purchase_history_csv.dart';

MyPurchase _purchase({
  String id = 'purchase-1',
  String seriesTitle = 'Series',
  String episodeTitle = 'Episode',
  int orderIndex = 3,
  int price = 500,
  String currency = 'JPY',
  bool isActive = true,
  int refundedAmount = 0,
  DateTime? purchasedAt,
  DateTime? expiresAt,
  DateTime? refundedAt,
  DateTime? revokedAt,
}) => MyPurchase(
  id: id,
  seriesId: 'series-1',
  seriesTitle: seriesTitle,
  episodeId: 'episode-1',
  episodeTitle: episodeTitle,
  orderIndex: orderIndex,
  price: price,
  currency: currency,
  isActive: isActive,
  refundedAmount: refundedAmount,
  purchasedAt: purchasedAt ?? DateTime.utc(2026, 1, 10, 12),
  expiresAt: expiresAt,
  refundedAt: refundedAt,
  revokedAt: revokedAt,
);

/// The rows after the header, without the empty string the final CRLF leaves.
List<String> _rows(String csv) {
  final lines = csv.split('\r\n');
  expect(lines.last, isEmpty);
  return lines.sublist(1, lines.length - 1);
}

void main() {
  test('starts with a byte order mark and the header the site writes', () {
    final csv = renderPurchaseHistoryCsv(const []);

    expect(utf8.encode(csv).take(3), [0xEF, 0xBB, 0xBF]);
    expect(
      csv,
      '﻿purchase_id,purchased_at,series_title,episode_number,'
      'episode_title,price,refunded_amount,currency,expires_at,refunded_at,'
      'status,item,volume_title\r\n',
    );
  });

  test('writes the times in UTC as the API sends them', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(
          purchasedAt: DateTime.utc(2026, 1, 10, 12).toLocal(),
          expiresAt: DateTime.utc(2026, 1, 13, 12, 0, 0, 250),
          isActive: false,
        ),
      ]),
    );

    expect(rows, [
      'purchase-1,2026-01-10T12:00:00Z,Series,3,Episode,500,0,JPY,'
          '2026-01-13T12:00:00Z,,expired,episode,',
    ]);
  });

  test('writes an amount in the currency itself, with no symbol', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(price: 500),
        _purchase(price: 499, currency: 'USD', refundedAmount: 100),
      ]),
    );

    expect(rows[0], contains(',500,0,JPY,'));
    expect(rows[1], contains(',4.99,1.00,USD,'));
  });

  test('marks each purchase the way the library does', () {
    final refundedAt = DateTime.utc(2026, 1, 11, 12);
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(),
        _purchase(isActive: false, expiresAt: DateTime.utc(2026, 1, 13)),
        _purchase(
          isActive: false,
          refundedAmount: 500,
          refundedAt: refundedAt,
          revokedAt: refundedAt,
        ),
        _purchase(isActive: false, revokedAt: refundedAt),
      ]),
    );

    expect(
      [for (final row in rows) row.split(',')[10]],
      ['active', 'expired', 'refunded', 'canceled'],
    );
    expect(rows[2], endsWith(',2026-01-11T12:00:00Z,refunded,episode,'));
  });

  test('quotes a field that holds a comma, a quote, or a line break', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(
          seriesTitle: 'Night, Again',
          episodeTitle: 'The "last" one\nand after',
        ),
      ]),
    );

    expect(
      rows.join('\r\n'),
      'purchase-1,2026-01-10T12:00:00Z,"Night, Again",3,'
      '"The ""last"" one\nand after",500,0,JPY,,,active,episode,',
    );
  });

  test('keeps a spreadsheet from running a title as a formula', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(seriesTitle: '=HYPERLINK("x")', episodeTitle: '-1'),
        _purchase(seriesTitle: '@SUM(A1)', episodeTitle: '+ plus'),
      ]),
    );

    expect(rows[0], contains(',"\'=HYPERLINK(""x"")",3,-1,'));
    expect(rows[1], contains(",'@SUM(A1),3,'+ plus,"));
  });

  test('names a volume and the rest of a series, with no episode', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        const MyPurchase(
          id: 'purchase-volume',
          seriesId: 'series-1',
          seriesTitle: 'Series',
          item: PurchasedItem.volume,
          volumeTitle: 'Volume 1',
          price: 350,
          currency: 'JPY',
          isActive: true,
        ),
        const MyPurchase(
          id: 'purchase-rest',
          seriesId: 'series-1',
          seriesTitle: 'Series',
          item: PurchasedItem.remainingEpisodes,
          remainingEpisodeCount: 4,
          price: 810,
          currency: 'JPY',
          isActive: true,
        ),
      ]),
    );

    expect(rows, [
      'purchase-volume,,Series,,,350,0,JPY,,,active,volume,Volume 1',
      'purchase-rest,,Series,,,810,0,JPY,,,active,remaining_episodes,',
    ]);
  });
}
