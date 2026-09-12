import 'package:intl/intl.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

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

  /// One weekday, given as the number Postgres `EXTRACT(DOW)` uses: 0 is
  /// Sunday and 6 is Saturday.
  ///
  /// The name comes from `intl` rather than from the message catalog, for the
  /// reason the month names in [formatDateTime] do — a weekday is calendar
  /// data every locale already carries. There is no instant behind a weekday,
  /// so the number is resolved against a reference Sunday purely to reach a
  /// formatter.
  String formatWeekday(int weekday) {
    if (weekday < 0 || weekday > 6) {
      return '$weekday';
    }
    // 2024-01-07 was a Sunday. Constructed in the local calendar, not as UTC,
    // so a zone west of Greenwich cannot pull the name back onto Saturday.
    return DateFormat.EEEE(intlLocale).format(DateTime(2024, 1, 7 + weekday));
  }

  /// The catalog copy for [status], which a screen shows as-is.
  String seriesStatusLabel(SeriesStatus status) {
    return switch (status) {
      SeriesStatus.ongoing => seriesStatusOngoing,
      SeriesStatus.completed => seriesStatusCompleted,
      SeriesStatus.hiatus => seriesStatusHiatus,
    };
  }

  /// The badge for a restricted [rating], or `null` when there is nothing to
  /// show: unspecified and all-ages carry no mark.
  String? seriesAgeRatingLabel(SeriesAgeRating? rating) {
    return switch (rating) {
      SeriesAgeRating.r15 => seriesAgeRatingR15,
      SeriesAgeRating.r18 => seriesAgeRatingR18,
      SeriesAgeRating.all || SeriesAgeRating.unknown || null => null,
    };
  }

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
