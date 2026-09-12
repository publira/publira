import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/settings/age_rating_confirmation.dart';

void main() {
  test('an unrestricted series needs no confirmation', () {
    expect(ageRatingMeetsConfirmation(null, null), isTrue);
    expect(ageRatingMeetsConfirmation(SeriesAgeRating.all, null), isTrue);
  });

  test('a restricted series stays closed until it is confirmed', () {
    expect(ageRatingMeetsConfirmation(SeriesAgeRating.r15, null), isFalse);
    expect(ageRatingMeetsConfirmation(SeriesAgeRating.r18, null), isFalse);
    expect(
      ageRatingMeetsConfirmation(SeriesAgeRating.r15, SeriesAgeRating.r15),
      isTrue,
    );
    expect(
      ageRatingMeetsConfirmation(SeriesAgeRating.r18, SeriesAgeRating.r15),
      isFalse,
    );
    expect(
      ageRatingMeetsConfirmation(SeriesAgeRating.r15, SeriesAgeRating.r18),
      isTrue,
    );
    expect(
      ageRatingMeetsConfirmation(SeriesAgeRating.r18, SeriesAgeRating.r18),
      isTrue,
    );
  });

  test('confirming r18 keeps covering r15', () {
    expect(
      maxRestrictedAgeRating(SeriesAgeRating.r18, SeriesAgeRating.r15),
      SeriesAgeRating.r18,
    );
    expect(
      maxRestrictedAgeRating(SeriesAgeRating.r15, SeriesAgeRating.r18),
      SeriesAgeRating.r18,
    );
  });

  test('a file store remembers the highest confirmed rating', () async {
    final root = await Directory.systemTemp.createTemp('publira-age-rating-');
    addTearDown(() => root.delete(recursive: true));
    final store = FileAgeRatingConfirmationStore(root: () async => root);

    expect(await store.read(), isNull);
    expect(await store.write(SeriesAgeRating.r15), SeriesAgeRating.r15);
    expect(await store.read(), SeriesAgeRating.r15);
    expect(await store.write(SeriesAgeRating.r18), SeriesAgeRating.r18);
    expect(await store.read(), SeriesAgeRating.r18);
    expect(await store.write(SeriesAgeRating.r15), SeriesAgeRating.r18);
    expect(await store.read(), SeriesAgeRating.r18);
  });
}
