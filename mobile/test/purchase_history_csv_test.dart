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
  int coinsSpent = 0,
  String currency = 'JPY',
  bool isActive = true,
  int refundedAmount = 0,
  DateTime? purchasedAt,
  DateTime? expiresAt,
  DateTime? refundedAt,
  DateTime? revokedAt,
  PurchaseTax? tax,
}) => MyPurchase(
  id: id,
  seriesId: 'series-1',
  seriesTitle: seriesTitle,
  episodeId: 'episode-1',
  episodeTitle: episodeTitle,
  orderIndex: orderIndex,
  price: price,
  coinsSpent: coinsSpent,
  coinName: coinsSpent > 0 ? 'Points' : '',
  currency: currency,
  isActive: isActive,
  refundedAmount: refundedAmount,
  purchasedAt: purchasedAt ?? DateTime.utc(2026, 1, 10, 12),
  expiresAt: expiresAt,
  refundedAt: refundedAt,
  revokedAt: revokedAt,
  tax: tax,
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
      'status,item,volume_title,coins,bonus_coins,coins_spent\r\n',
    );
  });

  group('a file holding a purchase that recorded tax', () {
    const taxHeader =
        '﻿purchase_id,purchased_at,series_title,episode_number,'
        'episode_title,price,refunded_amount,currency,expires_at,refunded_at,'
        'status,item,volume_title,coins,bonus_coins,coins_spent,'
        'tax_rate_percent,tax_amount';

    test('appends the rate and the tax after the columns of the site', () {
      final csv = renderPurchaseHistoryCsv([
        _purchase(tax: const PurchaseTax(amount: 46, rateBps: 1000)),
      ]);

      expect(csv.split('\r\n').first, taxHeader);
      expect(_rows(csv).single, endsWith(',10.00,46'));
    });

    test('writes a reduced rate and an amount in cents', () {
      final csv = renderPurchaseHistoryCsv([
        _purchase(
          currency: 'USD',
          tax: const PurchaseTax(amount: 37, rateBps: 750),
        ),
      ]);

      expect(_rows(csv).single, endsWith(',7.50,0.37'));
    });

    test('leaves both columns empty on a purchase that recorded none', () {
      final csv = renderPurchaseHistoryCsv([
        _purchase(tax: const PurchaseTax(amount: 46, rateBps: 1000)),
        _purchase(id: 'purchase-2'),
      ]);

      expect(_rows(csv).last, endsWith(',,'));
      expect(_rows(csv).last.split(','), hasLength(18));
    });

    test('keeps the columns it always had without one', () {
      final csv = renderPurchaseHistoryCsv([_purchase()]);

      expect(csv, isNot(contains('tax_amount')));
    });
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
          '2026-01-13T12:00:00Z,,expired,episode,,,,',
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
    expect(rows[2], endsWith(',2026-01-11T12:00:00Z,refunded,episode,,,,'));
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
      '"The ""last"" one\nand after",500,0,JPY,,,active,episode,,,,',
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
      'purchase-volume,,Series,,,350,0,JPY,,,active,volume,Volume 1,,,',
      'purchase-rest,,Series,,,810,0,JPY,,,active,remaining_episodes,,,,',
    ]);
  });

  test('counts the coins of a pack, its bonus among them, with no series', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        const MyPurchase(
          id: 'purchase-pack',
          seriesId: '',
          seriesTitle: '',
          item: PurchasedItem.coinPack,
          coins: 1000,
          bonusCoins: 100,
          coinName: 'Points',
          price: 1000,
          currency: 'JPY',
          isActive: true,
        ),
      ]),
    );

    expect(rows, [
      'purchase-pack,,,,,1000,0,JPY,,,active,coin_pack,,1100,100,',
    ]);
  });

  test('names a tip as a tip, with the episode it was given on', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        // A tip opens nothing, so the API never answers it active.
        const MyPurchase(
          id: 'purchase-tip',
          seriesId: 'series-1',
          seriesTitle: 'Series',
          item: PurchasedItem.tip,
          episodeId: 'episode-1',
          episodeTitle: 'Episode',
          orderIndex: 3,
          price: 300,
          currency: 'JPY',
          isActive: false,
        ),
        MyPurchase(
          id: 'purchase-tip-refunded',
          seriesId: 'series-1',
          seriesTitle: 'Series',
          item: PurchasedItem.tip,
          episodeId: 'episode-1',
          episodeTitle: 'Episode',
          orderIndex: 3,
          price: 300,
          currency: 'JPY',
          isActive: false,
          refundedAmount: 300,
          refundedAt: DateTime.utc(2026, 1, 11),
          revokedAt: DateTime.utc(2026, 1, 11),
        ),
      ]),
    );

    expect(rows, [
      'purchase-tip,,Series,3,Episode,300,0,JPY,,,active,tip,,,,',
      'purchase-tip-refunded,,Series,3,Episode,300,300,JPY,,'
          '2026-01-11T00:00:00Z,refunded,tip,,,,',
    ]);
  });

  test('counts the coins an episode was paid with, at a price of 0', () {
    final rows = _rows(
      renderPurchaseHistoryCsv([
        _purchase(id: 'purchase-coins', price: 0, coinsSpent: 50),
        _purchase(id: 'purchase-paid'),
      ]),
    );

    expect(rows, [
      'purchase-coins,2026-01-10T12:00:00Z,Series,3,Episode,0,0,JPY,,,'
          'active,episode,,,,50',
      'purchase-paid,2026-01-10T12:00:00Z,Series,3,Episode,500,0,JPY,,,'
          'active,episode,,,,',
    ]);
  });
}
