import 'package:publira/models/series_item.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Whether the tenant asks its readers to prove an age for any rating, as
/// `publira.types.v1.AgeVerification` names its rungs.
enum AgeVerification {
  /// Nothing is proven, which is also what a tenant that never chose gets.
  none,

  /// Some rating is proven against a birth date. A rung this build does not
  /// know lands here too, so a stricter future rule still asks for the date.
  checked;

  static AgeVerification fromWire(Object? raw) {
    return switch (raw) {
      null ||
      '' ||
      'AGE_VERIFICATION_UNSPECIFIED' ||
      'AGE_VERIFICATION_NONE' => AgeVerification.none,
      _ => AgeVerification.checked,
    };
  }
}

/// What the account and the tenant say about the signed-in reader's age: the
/// birth date they gave, and the tenant calendar it is counted on.
class ReaderAge {
  const ReaderAge({
    required this.birthDate,
    required this.timeZone,
    required this.verification,
  });

  /// `YYYY-MM-DD`, empty while the reader has given none.
  final String birthDate;

  /// The tenant's IANA zone, whose calendar day an age is counted on.
  final String timeZone;

  final AgeVerification verification;

  bool get hasBirthDate => birthDate.isNotEmpty;

  /// The highest rating [birthDate] proves at [now], or `null` when it proves
  /// none.
  ///
  /// The day is the tenant's, as on the server, so the gate opens on the
  /// birthday the API itself would accept. A zone this build cannot resolve
  /// proves nothing, which leaves the confirmation standing.
  SeriesAgeRating? provenAgeRating(DateTime now) {
    final born = parseBirthDate(birthDate);
    if (born == null) {
      return null;
    }
    final tz.Location location;
    try {
      location = _location(timeZone);
    } on tz.LocationNotFoundException {
      return null;
    }
    final today = tz.TZDateTime.from(now, location);
    final years = ageOn(born, DateTime.utc(today.year, today.month, today.day));
    if (years >= 18) {
      return SeriesAgeRating.r18;
    }
    if (years >= 15) {
      return SeriesAgeRating.r15;
    }
    return null;
  }
}

var _timeZonesLoaded = false;

/// The full data set rather than `latest_10y`, which drops link names such as
/// `UTC` and `Japan` that the server's `time.LoadLocation` accepts.
tz.Location _location(String name) {
  if (!_timeZonesLoaded) {
    tzdata.initializeTimeZones();
    _timeZonesLoaded = true;
  }
  return tz.getLocation(name);
}

/// [raw] as a UTC midnight, or `null` for anything but `YYYY-MM-DD`.
DateTime? parseBirthDate(String raw) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(raw.trim());
  if (match == null) {
    return null;
  }
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final date = DateTime.utc(year, month, day);
  // DateTime rolls 02-30 over into March rather than refusing it.
  if (date.month != month || date.day != day) {
    return null;
  }
  return date;
}

/// [date] the way the API writes a birth date.
String formatBirthDate(DateTime date) {
  String pad(int value, int width) => value.toString().padLeft(width, '0');
  return '${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}';
}

/// Completed years between two calendar dates, counted the way the server's
/// `ageverification.AgeOn` does: a 29 February birthday arrives on 1 March.
int ageOn(DateTime born, DateTime day) {
  var years = day.year - born.year;
  if (day.month < born.month ||
      (day.month == born.month && day.day < born.day)) {
    years--;
  }
  return years;
}
