import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';

void main() {
  group('supportedLocaleForCode', () {
    test('answers the catalog locale for its code, whatever the case', () {
      expect(supportedLocaleForCode('ja'), const Locale('ja'));
      expect(supportedLocaleForCode('EN'), const Locale('en'));
      expect(supportedLocaleForCode(' en '), const Locale('en'));
    });

    test('answers null for a code no catalog carries', () {
      expect(supportedLocaleForCode('fr'), isNull);
      expect(supportedLocaleForCode('en-US'), isNull);
      expect(supportedLocaleForCode(''), isNull);
    });
  });

  group('matchDeviceLocale', () {
    test('takes the first device locale that names a catalog', () {
      expect(
        matchDeviceLocale(const [Locale('fr'), Locale('ja'), Locale('en')]),
        const Locale('ja'),
      );
    });

    test('reads a regional variant as its language', () {
      expect(matchDeviceLocale(const [Locale('en', 'GB')]), const Locale('en'));
      expect(matchDeviceLocale(const [Locale('ja', 'JP')]), const Locale('ja'));
    });

    test('answers null when no device locale names a catalog', () {
      expect(
        matchDeviceLocale(const [Locale('fr'), Locale('de', 'DE')]),
        isNull,
      );
      expect(matchDeviceLocale(const []), isNull);
    });
  });

  group('resolveAppLocale', () {
    test('the device wins over the tenant default', () {
      expect(
        resolveAppLocale(
          deviceLocales: const [Locale('en', 'US')],
          tenantDefaultLocale: 'ja',
        ),
        const Locale('en'),
      );
    });

    test('a device with no supported language takes the tenant default', () {
      expect(
        resolveAppLocale(
          deviceLocales: const [Locale('fr')],
          tenantDefaultLocale: 'ja',
        ),
        const Locale('ja'),
      );
    });

    test('falls back while the tenant default is unknown or unsupported', () {
      expect(
        resolveAppLocale(
          deviceLocales: const [Locale('fr')],
          tenantDefaultLocale: null,
        ),
        fallbackLocale,
      );
      expect(
        resolveAppLocale(
          deviceLocales: const [Locale('fr')],
          tenantDefaultLocale: 'de',
        ),
        fallbackLocale,
      );
    });

    test('the fallback is a locale a catalog exists for', () {
      expect(AppMessages.forLocale(fallbackLocale), isNotNull);
    });
  });
}
