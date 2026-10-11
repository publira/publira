import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';

void main() {
  test('an integer takes the digit grouping of the catalog locale', () {
    expect(
      AppMessages.forLocale(const Locale('en'))!.formatInteger(1234567),
      '1,234,567',
    );
    expect(
      AppMessages.forLocale(const Locale('ja'))!.formatInteger(1234567),
      '1,234,567',
    );
    expect(AppMessages.forLocale(const Locale('en'))!.formatInteger(0), '0');
  });

  test('a price is written in its currency from its minor unit', () {
    final en = AppMessages.forLocale(const Locale('en'))!;
    expect(en.formatPrice(500, 'JPY'), '¥500');
    expect(en.formatPrice(1234567, 'JPY'), '¥1,234,567');
    expect(en.formatPrice(499, 'USD'), r'$4.99');
    expect(en.formatPrice(500, 'USD'), r'$5.00');
  });

  // Every dollar but the US one says whose it is, and a currency with no
  // symbol of its own is written with its code, as the site writes them.
  test('a price is never written with a symbol another currency has', () {
    final en = AppMessages.forLocale(const Locale('en'))!;
    expect(en.formatPrice(500, 'CAD'), r'CA$5.00');
    expect(en.formatPrice(500, 'AUD'), r'A$5.00');
    expect(en.formatPrice(500, 'CHF'), 'CHF\u00a05.00');
    expect(en.formatPrice(500, 'SEK'), 'SEK\u00a05.00');
    final ja = AppMessages.forLocale(const Locale('ja'))!;
    expect(ja.formatPrice(500, 'JPY'), '¥500');
    expect(ja.formatPrice(500, 'CAD'), r'CA$5.00');
  });

  test('a byte count takes the largest unit that keeps it whole', () {
    final en = AppMessages.forLocale(const Locale('en'))!;
    expect(en.formatByteSize(0), '0 B');
    expect(en.formatByteSize(1536), '2 KB');
    expect(en.formatByteSize(12897485), '12.3 MB');
    expect(en.formatByteSize(512 * 1024 * 1024), '512 MB');
    expect(en.formatByteSize(3 * 1024 * 1024 * 1024 ~/ 2), '1.5 GB');
  });

  test('a list of names is joined the way the locale writes one', () {
    final en = AppMessages.forLocale(const Locale('en'))!;
    expect(en.formatList(const []), '');
    expect(en.formatList(const ['Alice']), 'Alice');
    expect(en.formatList(const ['Alice', 'Bob']), 'Alice and Bob');
    expect(
      en.formatList(const ['Alice', 'Bob', 'Carol']),
      'Alice, Bob, and Carol',
    );
    expect(
      en.formatList(const ['Alice', 'Bob', 'Carol', 'Dave']),
      'Alice, Bob, Carol, and Dave',
    );

    final ja = AppMessages.forLocale(const Locale('ja'))!;
    expect(ja.formatList(const ['Alice', 'Bob']), 'Alice、Bob');
    expect(ja.formatList(const ['Alice', 'Bob', 'Carol']), 'Alice、Bob、Carol');

    final ko = AppMessages.forLocale(const Locale('ko'))!;
    expect(ko.formatList(const ['Alice', 'Bob']), 'Alice 및 Bob');
    expect(
      ko.formatList(const ['Alice', 'Bob', 'Carol']),
      'Alice, Bob 및 Carol',
    );
  });

  test('a formatted value reaches the message as its placeholder', () {
    final messages = AppMessages.forLocale(const Locale('en'))!;
    expect(
      messages.commonSeriesCount(count: messages.formatInteger(1200)),
      '1,200 published series',
    );
  });

  test('a weekday is named in the catalog locale', () {
    final en = AppMessages.forLocale(const Locale('en'))!;
    expect(en.formatWeekday(0), 'Sunday');
    expect(en.formatWeekday(1), 'Monday');
    expect(en.formatWeekday(6), 'Saturday');
    expect(en.formatWeekday(9), '9');
  });
}
