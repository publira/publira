import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:messageformat/messageformat.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/message_format.dart';

/// The shape `.match` gives a count, with an exact key, a plural category,
/// and the catch-all.
const _episodes = r'''
.input {$count :integer}
.match $count
0   {{No episodes}}
one {{{$count} episode}}
*   {{{$count} episodes}}
''';

void main() {
  final en = AppMessages.forLocale(const Locale('en'))!.intlLocale;
  final ja = AppMessages.forLocale(const Locale('ja'))!.intlLocale;

  test('a count selects by the plural rules of the catalog locale', () {
    expect(formatCatalogMessage(en, _episodes, {'count': 0}), 'No episodes');
    expect(formatCatalogMessage(en, _episodes, {'count': 1}), '1 episode');
    expect(formatCatalogMessage(en, _episodes, {'count': 2}), '2 episodes');

    // Japanese has no `one` category, so only the exact key and the
    // catch-all can match.
    expect(formatCatalogMessage(ja, _episodes, {'count': 0}), 'No episodes');
    expect(formatCatalogMessage(ja, _episodes, {'count': 1}), '1 episodes');
  });

  test(':integer groups digits the way formatInteger does', () {
    expect(
      formatCatalogMessage(en, _episodes, {'count': 1234567}),
      '1,234,567 episodes',
    );
    expect(
      formatCatalogMessage(ja, _episodes, {'count': 1234567}),
      '1,234,567 episodes',
    );
  });

  test('a formatted message carries no bidi isolation marks', () {
    expect(
      formatCatalogMessage(en, r'Hello, {$name}!', {'name': 'World'}),
      'Hello, World!',
    );
  });

  test('an error is reported and the message still formats', () {
    final reported = <FlutterErrorDetails>[];
    final previous = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = previous);

    expect(formatCatalogMessage(en, r'Hello, {$name}!'), r'Hello, {$name}!');
    expect(reported, hasLength(1));
    expect(
      (reported.single.exception as MessageError).type,
      'unresolved-variable',
    );
  });
}
