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

  test('a formatted value reaches the message as its placeholder', () {
    final messages = AppMessages.forLocale(const Locale('en'))!;
    expect(
      messages.seriesEpisodeCount(count: messages.formatInteger(1200)),
      '1,200 episodes',
    );
  });
}
