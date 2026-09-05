import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// Installs the compiled catalog for the locale `MaterialApp` resolved.
///
/// The catalogs are compiled into the binary, so [load] answers synchronously
/// and the first frame already carries the copy rather than waiting on an
/// asset read.
class AppMessagesDelegate extends LocalizationsDelegate<AppMessages> {
  const AppMessagesDelegate();

  @override
  bool isSupported(Locale locale) => AppMessages.forLocale(locale) != null;

  @override
  Future<AppMessages> load(Locale locale) {
    final messages = AppMessages.forLocale(locale);
    if (messages == null) {
      throw ArgumentError.value(locale, 'locale', 'no catalog carries it');
    }
    return SynchronousFuture(messages);
  }

  @override
  bool shouldReload(AppMessagesDelegate old) => false;
}

/// What `MaterialApp.localizationsDelegates` takes: the app's own copy, and
/// the strings Material, the widgets layer, and Cupertino ship themselves —
/// the back button's tooltip, a date picker's labels — for the same locale.
const appLocalizationsDelegates = <LocalizationsDelegate<Object?>>[
  AppMessagesDelegate(),
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];
