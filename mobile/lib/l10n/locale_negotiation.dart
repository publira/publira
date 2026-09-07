import 'dart:ui';

import 'package:publira/l10n/gen/app_messages.dart';

/// The locale the app opens in when neither the device nor the tenant names
/// a supported one: before the tenant lookup has answered, and for good when
/// it cannot, such as a first launch without a network.
///
/// English is the decision this repository already made for "no usable
/// preference" — `negotiateInitialLocale` in `@publira/i18n` answers the same
/// for a browser whose `Accept-Language` names nothing the catalogs cover.
const fallbackLocale = Locale('en');

/// The supported locale whose catalog code is [code], or `null` when no
/// catalog carries it. Tags compare case-insensitively; the catalog's own
/// spelling is what comes back.
Locale? supportedLocaleForCode(String code) {
  final wanted = code.trim().toLowerCase();
  for (final locale in AppMessages.supportedLocales) {
    if (locale.toLanguageTag().toLowerCase() == wanted) {
      return locale;
    }
  }
  return null;
}

/// The language and script [locale] stands for once BCP 47 likely subtags
/// have filled in what it leaves out, or `null` when [likelyScripts] knows no
/// script for its language.
///
/// A locale that spells its script out keeps it; one that names only a region
/// takes the script that region implies, so `zh-TW` is `zh-hant` where a bare
/// `zh` is `zh-hans`. `dart:ui` completes no subtags itself, so the answers
/// come from the table `AppMessages` compiles in.
String? _languageAndScript(Locale locale, Map<String, String> likelyScripts) {
  final language = locale.languageCode.toLowerCase();
  final region = locale.countryCode?.toUpperCase();
  final script =
      locale.scriptCode ??
      (region == null ? null : likelyScripts['$language-$region']) ??
      likelyScripts[language];
  return script == null ? null : '$language-${script.toLowerCase()}';
}

/// The locale of [supportedLocales] that [deviceLocales] asks for, or `null`
/// when it asks for none.
///
/// [deviceLocales] is the reader's ordered preference, the way the browser's
/// `Accept-Language` is for `web-host`, so the first entry that names a
/// catalog wins outright. That entry is matched from the most specific answer
/// to the least, the order `basicLocaleListResolution` of
/// `package:flutter/widgets` matches in: its whole tag, then a catalog written
/// in the same language and script, then any catalog in the same language.
/// A device set to `en-GB` therefore reads the `en` catalog, one set to
/// `zh-TW` the Traditional Chinese one rather than whichever Chinese catalog
/// is listed first, and one set to `fr` then `ja` the Japanese one.
Locale? matchLocale(
  List<Locale> deviceLocales,
  List<Locale> supportedLocales,
  Map<String, String> likelyScripts,
) {
  for (final device in deviceLocales) {
    final wanted = device.toLanguageTag().toLowerCase();
    for (final locale in supportedLocales) {
      if (locale.toLanguageTag().toLowerCase() == wanted) {
        return locale;
      }
    }

    final wantedScript = _languageAndScript(device, likelyScripts);
    if (wantedScript != null) {
      for (final locale in supportedLocales) {
        if (_languageAndScript(locale, likelyScripts) == wantedScript) {
          return locale;
        }
      }
    }

    final language = device.languageCode.toLowerCase();
    for (final locale in supportedLocales) {
      if (locale.languageCode.toLowerCase() == language) {
        return locale;
      }
    }
  }
  return null;
}

/// The catalog the device asks for, or `null` when it asks for none:
/// [matchLocale] over the catalogs `locales/index.json` carries.
Locale? matchDeviceLocale(List<Locale> deviceLocales) => matchLocale(
  deviceLocales,
  AppMessages.supportedLocales,
  AppMessages.likelyScripts,
);

/// The locale the app renders in.
///
/// The device's languages are the reader's own preference, so the first
/// supported one wins outright. A device set to nothing the catalogs cover
/// takes the tenant's default instead, the same setting `web-host` serves a
/// visitor who chose no language; [tenantDefaultLocale] is that code once
/// `GetTenantByDomain` has answered, and `null` until then. With neither,
/// the app opens in [fallbackLocale].
Locale resolveAppLocale({
  required List<Locale> deviceLocales,
  required String? tenantDefaultLocale,
}) {
  final device = matchDeviceLocale(deviceLocales);
  if (device != null) {
    return device;
  }
  if (tenantDefaultLocale != null) {
    final tenant = supportedLocaleForCode(tenantDefaultLocale);
    if (tenant != null) {
      return tenant;
    }
  }
  return fallbackLocale;
}
