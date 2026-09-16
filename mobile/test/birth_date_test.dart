import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeAuthRepository repository;
  late AuthController auth;

  final addRow = find.byKey(const ValueKey('account-birth-date-add'));
  final storedRow = find.byKey(const ValueKey('account-birth-date'));
  final gate = find.byKey(const ValueKey('age-rating-gate'));

  setUp(() {
    router = createAppRouter(initialLocation: AppRoutes.account);
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    repository = FakeAuthRepository();
  });

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: auth = fakeAuthController(
          session: fakeSession,
          repository: repository,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Gives [typed] to the date picker the row opens, then saves it.
  Future<void> recordBirthDate(WidgetTester tester, String typed) async {
    await tester.tap(addRow);
    await pumpUntilFound(tester, find.byType(DatePickerDialog));
    await tester.enterText(
      find.descendant(
        of: find.byType(DatePickerDialog),
        matching: find.byType(TextField),
      ),
      typed,
    );
    await tester.tap(find.text('OK'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('account-birth-date-confirm')),
    );
    await tester.tap(find.byKey(const ValueKey('account-birth-date-save')));
    await tester.pumpAndSettle();
  }

  group('account screen', () {
    testWidgets('records a birth date and then shows it for good', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, addRow);

      expect(
        find.text(
          'Your age is checked before age-rated works open. '
          'It cannot be changed once given.',
        ),
        findsOneWidget,
      );

      await recordBirthDate(tester, '02/03/2001');

      expect(repository.birthDate, '2001-02-03');
      expect(addRow, findsNothing);
      expect(storedRow, findsOneWidget);
      expect(
        find.text(
          'Feb 3, 2001\n'
          'Your date of birth cannot be changed. '
          'Contact this site if it is wrong.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('asks again before saving, and cancelling saves nothing', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, addRow);

      await tester.tap(addRow);
      await pumpUntilFound(tester, find.byType(DatePickerDialog));
      await tester.enterText(
        find.descendant(
          of: find.byType(DatePickerDialog),
          matching: find.byType(TextField),
        ),
        '02/03/2001',
      );
      await tester.tap(find.text('OK'));
      await pumpUntilFound(
        tester,
        find.text('Save Feb 3, 2001 as your date of birth?'),
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(repository.birthDate, isEmpty);
      expect(addRow, findsOneWidget);
    });

    testWidgets('shows a stored date without offering to change it', (
      tester,
    ) async {
      repository.birthDate = '1990-04-02';
      await pumpApp(tester);
      await pumpUntilFound(tester, storedRow);

      expect(addRow, findsNothing);
      expect(find.textContaining('Apr 2, 1990'), findsOneWidget);
    });

    testWidgets('offers nothing where the tenant checks no ages', (
      tester,
    ) async {
      repository.verification = AgeVerification.none;
      await pumpApp(tester);
      await pumpUntilFound(tester, find.byKey(const ValueKey('account-name')));
      await tester.pumpAndSettle();

      expect(addRow, findsNothing);
      expect(storedRow, findsNothing);
      expect(find.text('Date of birth'), findsNothing);
    });

    testWidgets('tells the reader a date the API refused', (tester) async {
      repository.recordFailure = const AuthFailure(
        AuthFailureKind.birthDateInvalid,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, addRow);

      await recordBirthDate(tester, '02/03/2001');

      expect(
        find.text('Enter your date of birth as a past calendar date.'),
        findsOneWidget,
      );
      expect(addRow, findsOneWidget);
    });

    testWidgets('shows the date another device recorded first', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, addRow);
      repository.birthDate = '1990-04-02';

      await recordBirthDate(tester, '02/03/2001');

      expect(storedRow, findsOneWidget);
      expect(find.textContaining('Apr 2, 1990'), findsOneWidget);
    });

    testWidgets('offers a retry when the account cannot be read', (
      tester,
    ) async {
      repository.birthDateFailure = const AuthFailure(AuthFailureKind.network);
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('account-birth-date-error')),
      );

      repository.birthDateFailure = null;
      await tester.tap(find.text('Retry'));
      await pumpUntilFound(tester, addRow);
    });
  });

  group('age gate', () {
    const series = fixtureR18Series;
    final episode = fixtureDetail(series).episodes.first;
    final episodePath = AppRoutes.episodeViewerPath(series.id, episode.id);
    final pages = find.byKey(const ValueKey('episode-page-view'));

    EpisodeDetail ratedEpisode(EpisodeAccess access) {
      return EpisodeDetail(
        episode: episode,
        seriesId: series.id,
        seriesTitle: series.title,
        access: access,
        images: [
          if (access == EpisodeAccess.free)
            EpisodeImageItem(
              id: '${episode.id}-page-1',
              url: Uri.parse('http://127.0.0.1:8200/images/episodes/p1'),
              displayOrder: 1,
              width: 800,
              height: 1200,
            ),
        ],
        ageRating: SeriesAgeRating.r18,
      );
    }

    setUp(() {
      catalog = FakeCatalogRepository(
        series: [series],
        details: {series.id: fixtureDetail(series)},
        episodes: {
          episodeKey(series.id, episode.id): ratedEpisode(EpisodeAccess.free),
        },
      );
    });

    testWidgets('a series opens on the rating a stored date proves', (
      tester,
    ) async {
      repository.birthDate = '1990-04-02';
      router = createAppRouter(
        initialLocation: AppRoutes.seriesDetailPath(series.id),
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, find.text('Episodes'));

      expect(gate, findsNothing);
    });

    testWidgets('signing out closes a series the stored date had opened', (
      tester,
    ) async {
      repository.birthDate = '1990-04-02';
      router = createAppRouter(
        initialLocation: AppRoutes.seriesDetailPath(series.id),
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, find.text('Episodes'));

      await auth.signOut();
      await pumpUntilFound(tester, gate);

      expect(find.text('Episodes'), findsNothing);
    });

    testWidgets('a date proving only R15 still asks for an R18 series', (
      tester,
    ) async {
      final now = DateTime.now();
      repository.birthDate = formatBirthDate(
        DateTime.utc(now.year - 16, now.month, 1),
      );
      router = createAppRouter(
        initialLocation: AppRoutes.seriesDetailPath(series.id),
      );
      await pumpApp(tester);

      await pumpUntilFound(tester, gate);
    });

    testWidgets('an episode opens on the rating a stored date proves', (
      tester,
    ) async {
      repository.birthDate = '1990-04-02';
      router = createAppRouter(initialLocation: episodePath);
      await pumpApp(tester);
      await pumpUntilFound(tester, pages);

      expect(gate, findsNothing);
    });

    testWidgets('a reader who records a date in the app reads the episode', (
      tester,
    ) async {
      catalog.episodes = {
        episodeKey(series.id, episode.id): ratedEpisode(
          EpisodeAccess.ageRestricted,
        ),
      };
      router = createAppRouter(initialLocation: episodePath);
      await pumpApp(tester);
      await pumpUntilFound(tester, gate);
      await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-age-restricted')),
      );

      await tester.tap(find.text('Add your date of birth'));
      await pumpUntilFound(tester, addRow);
      await recordBirthDate(tester, '02/03/2001');
      // The API opens the body once the account holds a date old enough.
      catalog.episodes = {
        episodeKey(series.id, episode.id): ratedEpisode(EpisodeAccess.free),
      };
      router.pop();
      await pumpUntilFound(tester, pages);

      expect(router.state.uri.path, episodePath);
    });
  });
}
