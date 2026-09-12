import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
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

  Future<void> pumpApp(WidgetTester tester, {AuthSession? session}) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        offline: offline,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('catalog shows series titles from the repository', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.text('Publira'), findsOneWidget);
    for (final series in fixtureSeries) {
      expect(find.text(series.title), findsOneWidget);
    }
  });

  testWidgets('a catalog tile names the creators of its series', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(
      find.text('Seed Author 001, Seed Author 002, and Seed Author 003'),
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
      tester.widget<Text>(find.byKey(const ValueKey('series-creators'))).data,
      'Seed Author 001, Seed Author 002, and Seed Author 003',
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
    await pumpUntilFound(tester, find.text('Publira'));

    expect(find.text('Episodes'), findsNothing);
    expect(router.state.uri.path, AppRoutes.catalog);
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
    await pumpUntilFound(tester, find.text('Publira'));
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
    await pumpUntilFound(tester, find.text('Publira'));
    await tester.tap(
      find.byKey(ValueKey('series-tile-${fixtureR18Series.id}')),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.text('“Midnight” is rated R18'), findsOneWidget);
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
    await pumpUntilFound(tester, find.text('Publira'));

    expect(find.text('Publira'), findsOneWidget);
    expect(find.byKey(ValueKey('series-tile-${first.id}')), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown series id shows not-found message', (tester) async {
    router = createAppRouter(initialLocation: '/series/does-not-exist');
    await pumpApp(tester);

    expect(find.textContaining('Series not found'), findsOneWidget);

    await tester.tap(find.text('Back to the catalog'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text('Publira'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown route shows not-found screen', (tester) async {
    router = createAppRouter(initialLocation: '/no-such-page');
    await pumpApp(tester);

    expect(find.text('Page not found'), findsOneWidget);
    expect(find.textContaining('does not exist'), findsOneWidget);

    await tester.tap(find.text('Back to the catalog'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text('Publira'), findsOneWidget);
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
