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

/// The supported locale the device asks for, or `null` when it asks for none.
///
/// [deviceLocales] is the reader's ordered preference, the way the browser's
/// `Accept-Language` is for `web-host`. The first entry that names a catalog
/// wins, by its whole tag first and by its language alone second, so a device
/// set to `en-GB` reads the `en` catalog and one set to `fr` then `ja` reads
/// the Japanese one.
Locale? matchDeviceLocale(List<Locale> deviceLocales) {
  for (final device in deviceLocales) {
    final exact = supportedLocaleForCode(device.toLanguageTag());
    if (exact != null) {
      return exact;
    }
    final language = device.languageCode.toLowerCase();
    for (final locale in AppMessages.supportedLocales) {
      if (locale.languageCode.toLowerCase() == language) {
        return locale;
      }
    }
  }
  return null;
}

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
