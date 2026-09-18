import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/models/series_item.dart';

void main() {
  ReaderAge bornOn(String birthDate, {String timeZone = 'Asia/Seoul'}) {
    return ReaderAge(
      birthDate: birthDate,
      timeZone: timeZone,
      verification: AgeVerification.checked,
    );
  }

  group('provenAgeRating', () {
    test(
      'an eighteenth birthday counts from midnight on the tenant calendar',
      () {
        final age = bornOn('2008-09-16');

        // 15:00 UTC is midnight in Seoul, where the birthday has arrived while
        // it has not yet in UTC.
        expect(
          age.provenAgeRating(DateTime.utc(2026, 9, 15, 14, 59)),
          SeriesAgeRating.r15,
        );
        expect(
          age.provenAgeRating(DateTime.utc(2026, 9, 15, 15)),
          SeriesAgeRating.r18,
        );
      },
    );

    test('a zone west of UTC holds the birthday back', () {
      final age = bornOn('2008-09-16', timeZone: 'America/Los_Angeles');

      expect(
        age.provenAgeRating(DateTime.utc(2026, 9, 16, 6)),
        SeriesAgeRating.r15,
      );
      expect(
        age.provenAgeRating(DateTime.utc(2026, 9, 16, 7)),
        SeriesAgeRating.r18,
      );
    });

    test('a 29 February birthday arrives on 1 March', () {
      final age = bornOn('2008-02-29', timeZone: 'UTC');

      expect(
        age.provenAgeRating(DateTime.utc(2026, 2, 28)),
        SeriesAgeRating.r15,
      );
      expect(age.provenAgeRating(DateTime.utc(2026, 3)), SeriesAgeRating.r18);
    });

    test('a reader younger than fifteen proves nothing', () {
      expect(
        bornOn('2012-01-01').provenAgeRating(DateTime.utc(2026, 9, 16)),
        isNull,
      );
    });

    test('an account without a date proves nothing', () {
      expect(bornOn('').provenAgeRating(DateTime.utc(2026, 9, 16)), isNull);
    });

    test('a zone this build cannot resolve proves nothing', () {
      final age = bornOn('1990-01-01', timeZone: 'Nowhere/Unknown');

      expect(age.provenAgeRating(DateTime.utc(2026, 9, 16)), isNull);
    });
  });

  test('parseBirthDate refuses a day the month does not have', () {
    expect(parseBirthDate('2001-02-03'), DateTime.utc(2001, 2, 3));
    expect(parseBirthDate('2001-02-30'), isNull);
    expect(parseBirthDate('2001-2-3'), isNull);
  });

  test('formatBirthDate writes the shape the API reads', () {
    expect(formatBirthDate(DateTime.utc(987, 6, 5)), '0987-06-05');
  });

  test('AgeVerification reads an unknown rung as checked', () {
    expect(AgeVerification.fromWire(null), AgeVerification.none);
    expect(
      AgeVerification.fromWire('AGE_VERIFICATION_NONE'),
      AgeVerification.none,
    );
    expect(
      AgeVerification.fromWire('AGE_VERIFICATION_R15_AND_R18'),
      AgeVerification.checked,
    );
    expect(
      AgeVerification.fromWire('AGE_VERIFICATION_SOMETHING_NEW'),
      AgeVerification.checked,
    );
  });
}
