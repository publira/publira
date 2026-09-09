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

  /// [value] as the date and time this locale writes them, in the zone the
  /// device is set to.
  ///
  /// The site renders the same timestamp in the tenant's display zone, because
  /// a visitor of a tenant's site is reading that tenant's clock. A phone is
  /// somewhere, and every other time on it reads in the zone its holder set,
  /// so the app follows the device instead.
  ///
  /// The symbols come from `flutter_localizations`, whose delegates load them
  /// for every locale it ships; the app installs those alongside its own
  /// catalog (`lib/l10n/localizations.dart`).
  String formatDateTime(DateTime value) =>
      DateFormat.yMMMd(intlLocale).add_jm().format(value.toLocal());

  /// [values] read as one list in this locale — `Alice, Bob, and Carol` under
  /// `en-US`, `Alice、Bob、Carol` under `ja-JP`.
  ///
  /// `intl` carries no list formatter, so the four CLDR list patterns are
  /// catalog copy, applied here the way `Intl.ListFormat` applies them. That
  /// is what makes a list of names read on these screens the way the same
  /// names read on the site.
  String formatList(List<String> values) {
    if (values.length < 2) {
      return values.isEmpty ? '' : values.first;
    }
    if (values.length == 2) {
      return commonListTwo(first: values.first, rest: values.last);
    }
    var rest = commonListEnd(
      first: values[values.length - 2],
      rest: values.last,
    );
    for (var index = values.length - 3; index >= 1; index--) {
      rest = commonListMiddle(first: values[index], rest: rest);
    }
    return commonListStart(first: values.first, rest: rest);
  }
}
