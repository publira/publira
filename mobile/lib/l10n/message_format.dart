import 'package:flutter/foundation.dart';
import 'package:messageformat/messageformat.dart';

/// Bidi isolation is off, so a formatted message holds exactly the characters
/// of the copy: every catalog is left-to-right, and a screen or a test that
/// compares the text would otherwise meet U+2068 and U+2069 around each value.
/// Turning isolation on belongs with the first right-to-left locale.
const _options = MessageFormatOptions(bidiIsolation: BidiIsolation.none);

/// One formatter per locale and source, because constructing one parses and
/// validates the message. Only the compiled catalog formats through here, so
/// the cache is bounded by its keys times the locales the app switches to.
final _formatters = <(String, String), MessageFormat>{};

/// [source], a catalog message in MessageFormat 2 syntax, formatted in
/// [locale] with [values].
///
/// [locale] is a catalog's `intl` tag, the one its numbers and dates are
/// formatted in elsewhere, so a `:integer` in a message groups digits the way
/// `formatInteger` does and selects the plural category of that locale.
///
/// A message with an error still formats, with the specification's fallback
/// in place of the expression that failed, and the error is reported through
/// [FlutterError.reportError], which fails the test that rendered it.
String formatCatalogMessage(
  String locale,
  String source, [
  Map<String, Object> values = const {},
]) {
  final formatter = _formatters[(locale, source)] ??= MessageFormat(
    locale,
    source,
    options: _options,
  );
  return formatter.format(values, _report);
}

void _report(MessageError error) {
  FlutterError.reportError(
    FlutterErrorDetails(
      exception: error,
      library: 'publira localization',
      context: ErrorDescription('while formatting a catalog message'),
    ),
  );
}
