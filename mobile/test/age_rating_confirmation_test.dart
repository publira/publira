import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/settings/age_rating_confirmation.dart';

void main() {
  test('an unrestricted series needs no confirmation', () {
    expect(
      ageRatingMeetsConfirmation(null, AgeRatingConfirmation.empty),
      isTrue,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.all,
        AgeRatingConfirmation.empty,
      ),
      isTrue,
    );
  });

  test('a restricted series stays closed until it is confirmed', () {
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r15,
        AgeRatingConfirmation.empty,
      ),
      isFalse,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r18,
        AgeRatingConfirmation.empty,
      ),
      isFalse,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r15,
        const AgeRatingConfirmation(named: SeriesAgeRating.r15),
      ),
      isTrue,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r18,
        const AgeRatingConfirmation(named: SeriesAgeRating.r15),
      ),
      isFalse,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r15,
        const AgeRatingConfirmation(named: SeriesAgeRating.r18),
      ),
      isTrue,
    );
    expect(
      ageRatingMeetsConfirmation(
        SeriesAgeRating.r18,
        const AgeRatingConfirmation(named: SeriesAgeRating.r18),
      ),
      isTrue,
    );
  });

  test(
    'an unrecognized rating stays closed until it is confirmed on its own',
    () {
      expect(
        ageRatingMeetsConfirmation(
          SeriesAgeRating.unknown,
          AgeRatingConfirmation.empty,
        ),
        isFalse,
      );
      expect(
        ageRatingMeetsConfirmation(
          SeriesAgeRating.unknown,
          const AgeRatingConfirmation(named: SeriesAgeRating.r18),
        ),
        isFalse,
      );
      expect(
        ageRatingMeetsConfirmation(
          SeriesAgeRating.r15,
          const AgeRatingConfirmation(unknown: true),
        ),
        isFalse,
      );
      expect(
        ageRatingMeetsConfirmation(
          SeriesAgeRating.unknown,
          const AgeRatingConfirmation(unknown: true),
        ),
        isTrue,
      );
    },
  );

  test('confirming r18 keeps covering r15', () {
    expect(
      maxRestrictedAgeRating(SeriesAgeRating.r18, SeriesAgeRating.r15),
      SeriesAgeRating.r18,
    );
    expect(
      maxRestrictedAgeRating(SeriesAgeRating.r15, SeriesAgeRating.r18),
      SeriesAgeRating.r18,
    );
    expect(
      maxRestrictedAgeRating(SeriesAgeRating.r15, SeriesAgeRating.unknown),
      SeriesAgeRating.r15,
    );
  });

  test(
    'a file store remembers named ratings and unrecognized ones separately',
    () async {
      final root = await Directory.systemTemp.createTemp('publira-age-rating-');
      addTearDown(() => root.delete(recursive: true));
      final store = FileAgeRatingConfirmationStore(root: () async => root);

      expect(await store.read(), AgeRatingConfirmation.empty);
      expect(
        await store.write(SeriesAgeRating.r15),
        const AgeRatingConfirmation(named: SeriesAgeRating.r15),
      );
      expect(
        await store.write(SeriesAgeRating.unknown),
        const AgeRatingConfirmation(named: SeriesAgeRating.r15, unknown: true),
      );
      expect(
        await store.write(SeriesAgeRating.r18),
        const AgeRatingConfirmation(named: SeriesAgeRating.r18, unknown: true),
      );
      expect(
        await store.write(SeriesAgeRating.r15),
        const AgeRatingConfirmation(named: SeriesAgeRating.r18, unknown: true),
      );
      expect(
        await store.read(),
        const AgeRatingConfirmation(named: SeriesAgeRating.r18, unknown: true),
      );
    },
  );

  test(
    'a write that fails leaves the previous confirmation in place',
    () async {
      final store = MemoryAgeRatingConfirmationStore(
        confirmed: const AgeRatingConfirmation(named: SeriesAgeRating.r15),
        writeError: Exception('disk full'),
      );
      final controller = AgeRatingConfirmationController(store: store);
      await controller.restore();

      await expectLater(
        controller.confirm(SeriesAgeRating.r18),
        throwsA(isA<Exception>()),
      );
      expect(
        controller.confirmed,
        const AgeRatingConfirmation(named: SeriesAgeRating.r15),
      );
    },
  );
}
