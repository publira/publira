import 'package:intl/intl.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// Values rendered the way the catalog's locale writes them.
///
/// A placeholder takes an already formatted string, because MF2 functions such
/// as `:number` are outside the subset the catalog allows, so a screen formats
/// a number here and hands the result to the message.
extension AppMessagesFormatting on AppMessages {
  /// [value] with the digit grouping of this locale — `1,234` under `en-US`.
  String formatInteger(int value) =>
      NumberFormat.decimalPattern(intlLocale).format(value);
}
