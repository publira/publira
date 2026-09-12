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
      messages.seriesEpisodeCount(count: messages.formatInteger(1200)),
      '1,200 episodes',
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
