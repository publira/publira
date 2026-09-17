import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/router.dart';
import 'package:publira/settings/age_rating_confirmation.dart';
import 'package:publira/tenant/tenant_brand_controller.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/fake_tenant_brand.dart';
import 'support/pump_until.dart';

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;
  late InMemoryOfflineLibrary offline;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
    );
    offline = InMemoryOfflineLibrary();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    AgeRatingConfirmationController? ageRatingConfirmation,
  }) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        offline: offline,
        ageRatingConfirmation: ageRatingConfirmation,
        tenantBrand: TenantBrandController(
          tenantHost: 'localhost',
          repository: FakeTenantBrandRepository(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('catalog shows series titles from the repository', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.text(fixtureTenantBrand.name), findsOneWidget);
    for (final series in fixtureSeries) {
      expect(find.text(series.title), findsOneWidget);
    }
  });

  testWidgets('a catalog tile names the creators of its series with their '
      'roles', (tester) async {
    await pumpApp(tester);

    expect(
      find.byKey(ValueKey('series-tile-credits-${fixtureSeries.first.id}')),
      findsOneWidget,
    );
    expect(
      find.text(
        'Story Seed Author 001 / Art Seed Author 002 and Seed Author 003',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a catalog tile shows the status and the first genre', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(
      tester
          .widget<Text>(
            find.byKey(
              ValueKey('series-tile-classification-${fixtureSeries.first.id}'),
            ),
          )
          .data,
      'Ongoing · Fantasy',
    );
  });

  testWidgets('a catalog tile of a series with no classification shows no '
      'classification line', (tester) async {
    catalog.series = [fixtureSeries.last];
    await pumpApp(tester);

    expect(
      find.byKey(
        ValueKey('series-tile-classification-${fixtureSeries.last.id}'),
      ),
      findsNothing,
    );
  });

  testWidgets('a catalog tile of a series credited to nobody shows no '
      'credit line', (tester) async {
    catalog.series = [fixtureSeries.last];
    await pumpApp(tester);

    final tile = find.byKey(ValueKey('series-tile-${fixtureSeries.last.id}'));
    expect(
      find.descendant(of: tile, matching: find.byType(Text)),
      findsNWidgets(2),
    );
    expect(find.text(fixtureSeries.last.description), findsOneWidget);
  });

  testWidgets('the series detail screen names the creators under the title', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('series-creators')),
        matching: find.text(
          'Story Seed Author 001 / Art Seed Author 002 and Seed Author 003',
        ),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the series detail screen keeps the credits in the order the '
      'API sent', (tester) async {
    // Art ahead of Story is the tenant's priority, and a role that comes back
    // after another is written again rather than gathered into the first.
    catalog.details = {
      fixtureSeries.first.id: SeriesDetail(
        series: SeriesItem(
          id: fixtureSeries.first.id,
          title: fixtureSeries.first.title,
          description: fixtureSeries.first.description,
          creators: const [
            SeriesCreator(id: 'A1', name: 'Seed Author 002', roleName: 'Art'),
            SeriesCreator(id: 'A2', name: 'Seed Author 001', roleName: 'Story'),
            SeriesCreator(id: 'A3', name: 'Seed Author 003', roleName: 'Art'),
          ],
        ),
        episodes: fixtureDetail(fixtureSeries.first).episodes,
      ),
    };
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(
      find.text(
        'Art Seed Author 002 / Story Seed Author 001 / Art Seed Author 003',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a credit with no role is the name on its own', (tester) async {
    catalog.series = [
      SeriesItem(
        id: fixtureSeries.first.id,
        title: fixtureSeries.first.title,
        description: fixtureSeries.first.description,
        creators: const [
          SeriesCreator(id: 'A1', name: 'Seed Author 001'),
          SeriesCreator(id: 'A2', name: 'Seed Author 002', roleName: 'Art'),
        ],
      ),
    ];
    await pumpApp(tester);

    expect(find.text('Seed Author 001 / Art Seed Author 002'), findsOneWidget);
  });

  testWidgets('the series detail screen names the label of its series', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('series-classification')),
        matching: find.text('Seed Label 01'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the series detail screen of an unlabelled series shows no '
      'label', (tester) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.last.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.byKey(const ValueKey('series-label')), findsNothing);
  });

  testWidgets('a series saved before the label id was kept names its label '
      'and leads nowhere', (tester) async {
    const series = SeriesItem(
      id: 'series-saved-label',
      title: 'Saved Before the Label Id',
      description: 'A copy read from this device.',
      episodeCount: 1,
      labelName: 'Seed Label 01',
    );
    catalog.details = {series.id: fixtureDetail(series)};
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    // The name stands as text: what would open the label screen is the id
    // this copy does not carry.
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('series-label'))).data,
      'Seed Label 01',
    );
  });

  testWidgets('the series detail screen shows status, schedule, and genres', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(
      tester.widget<Text>(find.byKey(const ValueKey('series-status'))).data,
      'Ongoing',
    );
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('series-schedule'))).data,
      'Updates on Monday and Thursday',
    );
    expect(
      find.byKey(const ValueKey('series-genre-SeedGENRAAA1')),
      findsOneWidget,
    );
    expect(find.text('Fantasy'), findsOneWidget);
    expect(find.byKey(const ValueKey('series-age-rating')), findsNothing);
  });

  testWidgets('a rated series is not opened without the confirmation', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      series: [fixtureRatedSeries],
      details: {fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries)},
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureRatedSeries.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.text('Episodes'), findsNothing);
    expect(find.text(fixtureRatedSeries.description), findsNothing);
    expect(find.text('“After Dark” is rated R15'), findsOneWidget);
  });

  testWidgets('cancelling the rating confirmation leaves the series unopened', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      series: [fixtureRatedSeries],
      details: {fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries)},
    );
    await pumpApp(tester);
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureRatedSeries.id}')),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    await tester.tap(find.byKey(const ValueKey('age-rating-cancel')));
    await pumpUntilFound(tester, find.text(fixtureTenantBrand.name));

    expect(find.text('Episodes'), findsNothing);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets(
    'a series displays its derived rating only when readers reacted',
    (tester) async {
      const rated = SeriesItem(
        id: 'series-with-reactions',
        title: 'Rated series',
        description: '',
        ratingAverage: 3.25,
        ratingCount: 12,
      );
      catalog = FakeCatalogRepository(
        series: [rated],
        details: {rated.id: const SeriesDetail(series: rated, episodes: [])},
      );
      router = createAppRouter(
        initialLocation: AppRoutes.seriesDetailPath(rated.id),
      );

      await pumpApp(tester);
      await pumpUntilFound(tester, find.byKey(const ValueKey('series-rating')));

      expect(find.text('Rating: 3.3 · 12 readers'), findsOneWidget);
    },
  );

  testWidgets('a series uses the singular rating count for one reader', (
    tester,
  ) async {
    const rated = SeriesItem(
      id: 'series-with-one-reaction',
      title: 'Rated series',
      description: '',
      ratingAverage: 5,
      ratingCount: 1,
    );
    catalog = FakeCatalogRepository(
      series: [rated],
      details: {rated.id: const SeriesDetail(series: rated, episodes: [])},
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(rated.id),
    );

    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('series-rating')));

    expect(find.text('Rating: 5.0 · 1 reader'), findsOneWidget);
  });

  testWidgets('confirming the rating opens the series and is remembered', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      series: [fixtureRatedSeries],
      details: {fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries)},
    );
    await pumpApp(tester);
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureRatedSeries.id}')),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.text(fixtureRatedSeries.description), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('series-age-rating'))).data,
      'R15',
    );

    await tester.pageBack();
    await pumpUntilFound(tester, find.text(fixtureTenantBrand.name));
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureRatedSeries.id}')),
    );
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.byKey(const ValueKey('age-rating-gate')), findsNothing);
  });

  testWidgets('an R15 confirmation does not open an R18 series', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      series: [fixtureRatedSeries, fixtureR18Series],
      details: {
        fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries),
        fixtureR18Series.id: fixtureDetail(fixtureR18Series),
      },
    );
    await pumpApp(tester);
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureRatedSeries.id}')),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));
    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await pumpUntilFound(tester, find.text('Episodes'));

    await tester.pageBack();
    await pumpUntilFound(tester, find.text(fixtureTenantBrand.name));
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureR18Series.id}')),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.text('“Midnight” is rated R18'), findsOneWidget);
    expect(find.text('Episodes'), findsNothing);
  });

  testWidgets('an unrecognized rating is not opened as R15', (tester) async {
    catalog = FakeCatalogRepository(
      series: [fixtureUnknownRatedSeries],
      details: {
        fixtureUnknownRatedSeries.id: fixtureDetail(fixtureUnknownRatedSeries),
      },
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureUnknownRatedSeries.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.text('“Uncharted” has an age rating'), findsOneWidget);
    expect(find.text('I am allowed to open this series'), findsOneWidget);
    expect(find.text('“Uncharted” is rated R15'), findsNothing);
    expect(find.text('Episodes'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await pumpUntilFound(tester, find.text('Episodes'));
  });

  testWidgets('a failed confirmation write leaves the series unopened', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      series: [fixtureRatedSeries],
      details: {fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries)},
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureRatedSeries.id),
    );
    await pumpApp(
      tester,
      ageRatingConfirmation: AgeRatingConfirmationController(
        store: MemoryAgeRatingConfirmationStore(
          writeError: Exception('disk full'),
        ),
      ),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byKey(const ValueKey('age-rating-gate')), findsOneWidget);
    expect(find.text('Episodes'), findsNothing);
  });

  testWidgets('a series credited to nobody shows no credit line', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.last.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.byKey(const ValueKey('series-creators')), findsNothing);
  });

  testWidgets('tapping a series opens its detail screen', (tester) async {
    await pumpApp(tester);

    final first = fixtureSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.text(first.title), findsWidgets);
    expect(find.text(first.description), findsWidgets);
    expect(find.text('${first.episodeCount} episodes'), findsOneWidget);
    expect(find.text('Episodes'), findsOneWidget);
    expect(find.text('${first.title} #1'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.seriesDetailPath(first.id));
  });

  testWidgets('back from detail returns to catalog', (tester) async {
    await pumpApp(tester);

    final first = fixtureSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await pumpUntilFound(tester, find.text('Episodes'));

    await tester.pageBack();
    await pumpUntilFound(tester, find.text(fixtureTenantBrand.name));

    expect(find.text(fixtureTenantBrand.name), findsOneWidget);
    expect(find.byKey(ValueKey('series-tile-${first.id}')), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown series id shows not-found message', (tester) async {
    router = createAppRouter(initialLocation: '/series/does-not-exist');
    await pumpApp(tester);

    expect(find.textContaining('Series not found'), findsOneWidget);

    await tester.tap(find.text('Back to the catalog'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text(fixtureTenantBrand.name), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown route shows not-found screen', (tester) async {
    router = createAppRouter(initialLocation: '/no-such-page');
    await pumpApp(tester);

    expect(find.text('Page not found'), findsOneWidget);
    expect(find.textContaining('does not exist'), findsOneWidget);

    await tester.tap(find.text('Back to the catalog'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text(fixtureTenantBrand.name), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('empty catalog shows an empty-state message', (tester) async {
    catalog = FakeCatalogRepository();
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('catalog-empty')), findsOneWidget);
    expect(find.text('No series have been published yet.'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('catalog network error offers retry', (tester) async {
    catalog = FakeCatalogRepository(
      listError: const CatalogFailure(CatalogFailureKind.network),
    );
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('catalog-error')), findsOneWidget);
    expect(
      find.textContaining('Could not connect to the server'),
      findsOneWidget,
    );

    catalog
      ..listError = null
      ..series = fixtureSeries
      ..details = fixtureDetails();
    await tester.tap(find.byKey(const ValueKey('catalog-retry')));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text(fixtureSeries.first.title), findsOneWidget);
  });

  testWidgets('series detail network error offers retry', (tester) async {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      detailError: const CatalogFailure(CatalogFailureKind.network),
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('series-detail-error')), findsOneWidget);
    expect(
      find.textContaining('Could not connect to the server'),
      findsOneWidget,
    );

    catalog.detailError = null;
    await tester.tap(find.text('Retry'));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(find.text(fixtureSeries.first.title), findsWidgets);
  });

  testWidgets('a saved episode is marked on the series detail screen', (
    tester,
  ) async {
    final series = fixtureSeries.first;
    final saved = fixtureDetail(series).episodes.first;
    await offline.writeEpisode(
      SavedEpisode(
        ownerId: '',
        checkedAt: DateTime.now(),
        detail: EpisodeDetail(
          episode: saved,
          seriesId: series.id,
          seriesTitle: series.title,
          access: EpisodeAccess.free,
          images: const [],
        ),
      ),
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );

    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-saved-offline')),
    );

    expect(find.byKey(const ValueKey('episode-saved-offline')), findsOneWidget);
  });

  testWidgets('the continue-reading row offers what the reader was reading', (
    tester,
  ) async {
    catalog.recentSeries = fixtureRecentSeries();
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('continue-reading')),
    );

    expect(find.text('Continue reading'), findsOneWidget);
    expect(find.text('${fixtureSeries.first.title} #1'), findsOneWidget);
    expect(catalog.recentSeriesLimits, isNotEmpty);
  });

  testWidgets('tapping an offer opens the episode it points at', (
    tester,
  ) async {
    final series = fixtureSeries.first;
    catalog
      ..recentSeries = fixtureRecentSeries()
      ..episodes = fixtureEpisodes();
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('continue-reading-${series.id}')),
    );

    await tester.tap(find.byKey(ValueKey('continue-reading-${series.id}')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeViewerPath(series.id, '${series.id}-ep-1'),
    );
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a signed-out reader is offered no continue-reading row', (
    tester,
  ) async {
    catalog.recentSeries = fixtureRecentSeries();
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
    );

    expect(find.byKey(const ValueKey('continue-reading')), findsNothing);
  });

  testWidgets('a row the API could not answer leaves the catalog alone', (
    tester,
  ) async {
    catalog
      ..recentSeries = fixtureRecentSeries()
      ..recentSeriesError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
    );

    expect(
      find.byKey(const ValueKey('continue-reading-error')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('catalog-error')), findsNothing);
  });

  testWidgets('a catalog with nothing saved says the device is offline', (
    tester,
  ) async {
    catalog = FakeCatalogRepository(
      listError: const CatalogFailure(CatalogFailureKind.notSaved),
    );
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('catalog-error')), findsOneWidget);
    expect(find.textContaining('You are offline'), findsOneWidget);
  });
}
