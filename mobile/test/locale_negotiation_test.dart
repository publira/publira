import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';

/// A catalog set of the shape the script rules exist for: two catalogs that
/// share a language and differ only in the script they are written in. The
/// rules show nothing on a set where every language has one catalog, which is
/// what `locales/index.json` holds.
const chineseCatalogs = <Locale>[
  Locale('ja'),
  Locale('en'),
  Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
  Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
  Locale('ko'),
];

/// What `scripts/dart-messages.ts` derives from BCP 47 likely subtags for
/// [chineseCatalogs]: the script of each language, and of every region that
/// is written in another one.
const chineseScripts = <String, String>{
  'ja': 'Jpan',
  'en': 'Latn',
  'zh': 'Hans',
  'zh-HK': 'Hant',
  'zh-MO': 'Hant',
  'zh-TW': 'Hant',
  'ko': 'Kore',
};

const zhHans = Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans');
const zhHant = Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant');

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
      expect(matchDeviceLocale(const [Locale('ko', 'KR')]), const Locale('ko'));
    });

    test('answers null when no device locale names a catalog', () {
      expect(
        matchDeviceLocale(const [Locale('fr'), Locale('de', 'DE')]),
        isNull,
      );
      expect(matchDeviceLocale(const []), isNull);
    });
  });

  group('matchLocale', () {
    test('takes the catalog the device names outright', () {
      expect(
        matchLocale(const [zhHant], chineseCatalogs, chineseScripts),
        zhHant,
      );
      expect(
        matchLocale(const [Locale('ja')], chineseCatalogs, chineseScripts),
        const Locale('ja'),
      );
    });

    test('reads the script a device that names only a region implies', () {
      expect(
        matchLocale(
          const [Locale('zh', 'TW')],
          chineseCatalogs,
          chineseScripts,
        ),
        zhHant,
      );
      expect(
        matchLocale(
          const [Locale('zh', 'CN')],
          chineseCatalogs,
          chineseScripts,
        ),
        zhHans,
      );
    });

    test('answers the same whichever order the catalogs are listed in', () {
      const reversed = <Locale>[
        Locale('ko'),
        zhHant,
        zhHans,
        Locale('en'),
        Locale('ja'),
      ];

      expect(
        matchLocale(const [Locale('zh', 'TW')], reversed, chineseScripts),
        zhHant,
      );
      expect(
        matchLocale(const [Locale('zh', 'CN')], reversed, chineseScripts),
        zhHans,
      );
      expect(
        matchLocale(const [Locale('zh')], reversed, chineseScripts),
        zhHans,
      );
    });

    test('keeps the region a device spells its script out with', () {
      expect(
        matchLocale(
          const [
            Locale.fromSubtags(
              languageCode: 'zh',
              scriptCode: 'Hant',
              countryCode: 'TW',
            ),
          ],
          chineseCatalogs,
          chineseScripts,
        ),
        zhHant,
      );
      expect(
        matchLocale(
          const [
            Locale.fromSubtags(
              languageCode: 'zh',
              scriptCode: 'Hans',
              countryCode: 'CN',
            ),
          ],
          chineseCatalogs,
          chineseScripts,
        ),
        zhHans,
      );
    });

    test('reads a regional device locale as the language it belongs to', () {
      expect(
        matchLocale(
          const [Locale('ko', 'KR')],
          chineseCatalogs,
          chineseScripts,
        ),
        const Locale('ko'),
      );
      expect(
        matchLocale(
          const [Locale('en', 'GB')],
          chineseCatalogs,
          chineseScripts,
        ),
        const Locale('en'),
      );
    });

    test('takes the first device locale that names a catalog', () {
      expect(
        matchLocale(
          const [Locale('fr'), Locale('zh', 'TW'), Locale('en')],
          chineseCatalogs,
          chineseScripts,
        ),
        zhHant,
      );
    });

    test('answers null when no device locale names a catalog', () {
      expect(
        matchLocale(const [Locale('fr')], chineseCatalogs, chineseScripts),
        isNull,
      );
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
