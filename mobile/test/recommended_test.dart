import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_follow_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// [count] published series, each with an id starting [prefix].
List<SeriesItem> seriesNamed(String prefix, int count) => [
  for (var index = 1; index <= count; index++)
    SeriesItem(
      id: '$prefix-$index',
      title: 'Series $prefix $index',
      description: '',
    ),
];

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  /// The order every guest is recommended, and the one a reader the batch has
  /// computed features for is recommended instead.
  final tenantOrder = seriesNamed('tenant', 3);
  final readerOrder = seriesNamed('reader', 3);

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      newestSeries: fixtureSeries,
      details: fixtureDetails(),
      recommendedSeries: tenantOrder,
      myRecommendedSeries: readerOrder,
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    required String location,
    AuthSession? session,
    Size size = const Size(800, 2400),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: location);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        follows: FakeFollowRepository(),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await tester.pump();
  }

  Finder shelfCardOf(SeriesItem series) =>
      find.byKey(ValueKey('catalog-recommended-${series.id}'));

  Finder tileOf(SeriesItem series) =>
      find.byKey(ValueKey('series-tile-${series.id}'));

  group('the catalog on a tenant with no chart', () {
    setUp(() {
      catalog.rankedSeries = const [];
    });

    testWidgets('shows a guest the tenant order in place of the chart', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(tester, shelfCardOf(tenantOrder.first));

      final shelf = find.byKey(const ValueKey('catalog-ranking'));
      expect(
        find.descendant(of: shelf, matching: find.text('Recommended')),
        findsOneWidget,
      );
      expect(find.text('Top 10 this week'), findsNothing);
      for (final series in tenantOrder) {
        expect(shelfCardOf(series), findsOneWidget);
      }
      // No card carries a position: the order is not a chart.
      expect(
        find.descendant(of: shelf, matching: find.text('1')),
        findsNothing,
      );
      expect(catalog.recommendedSeriesRequests, [
        (mine: false, limit: 10, token: ''),
      ]);
    });

    testWidgets('shows a signed-in reader the order recommended to them', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.catalog, session: fakeSession);
      await pumpUntilFound(tester, shelfCardOf(readerOrder.first));

      for (final series in readerOrder) {
        expect(shelfCardOf(series), findsOneWidget);
      }
      expect(shelfCardOf(tenantOrder.first), findsNothing);
      expect(catalog.recommendedSeriesRequests, [
        (mine: true, limit: 10, token: ''),
      ]);
    });

    testWidgets('leads to the whole of the order rather than the ranking', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(tester, shelfCardOf(tenantOrder.first));

      expect(find.byKey(const ValueKey('catalog-ranking-all')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('catalog-recommended-all')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('recommended-results')),
      );

      expect(router.state.uri.path, AppRoutes.recommendedPath);
      for (final series in tenantOrder) {
        expect(tileOf(series), findsOneWidget);
      }
    });

    testWidgets('opens the series a card stands for', (tester) async {
      final series = fixtureSeries.first;
      catalog.recommendedSeries = [series];
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(tester, shelfCardOf(series));

      await tester.tap(shelfCardOf(series));
      await pumpUntilRouteSettled(tester, find.text(series.title));

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(series.id));
    });

    testWidgets('reports a failed read of the order as a recommendation', (
      tester,
    ) async {
      catalog.recommendedSeriesError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-ranking-error')),
      );

      // The chart answered that there is none, so what failed is the order
      // standing in for it, and the row says so in that order's words.
      expect(find.text('Recommended'), findsOneWidget);
      expect(
        find.text('Could not show the recommended works. Try again.'),
        findsOneWidget,
      );
      expect(find.text('Top 10 this week'), findsNothing);

      catalog.recommendedSeriesError = null;
      await tester.tap(find.byKey(const ValueKey('catalog-ranking-retry')));
      await pumpUntilFound(tester, shelfCardOf(tenantOrder.first));
    });

    testWidgets('reports a failed read of the chart as the chart', (
      tester,
    ) async {
      catalog.rankedSeriesError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-ranking-error')),
      );

      expect(find.text('Top 10 this week'), findsOneWidget);
      expect(
        find.text("Could not show this week's ranking. Try again."),
        findsOneWidget,
      );
      expect(catalog.recommendedSeriesRequests, isEmpty);
    });

    testWidgets('shows no row when nothing is published to recommend', (
      tester,
    ) async {
      catalog.recommendedSeries = const [];
      await pumpApp(tester, location: AppRoutes.catalog);
      await pumpUntilFound(tester, tileOf(fixtureSeries.first));
      await pumpUntilTrue(
        tester,
        () => catalog.recommendedSeriesRequests.isNotEmpty,
        description: 'the shelf to ask for the recommendation order',
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('catalog-ranking')), findsNothing);
      expect(find.text('Recommended'), findsNothing);
    });
  });

  testWidgets('the catalog on a ranked tenant reads no recommendation', (
    tester,
  ) async {
    catalog.rankedSeries = fixtureRankedSeries();
    await pumpApp(tester, location: AppRoutes.catalog, session: fakeSession);
    await pumpUntilFound(tester, find.byKey(const ValueKey('catalog-ranking')));

    expect(find.text('Top 10 this week'), findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-ranking-all')), findsOneWidget);
    expect(catalog.recommendedSeriesRequests, isEmpty);
  });

  group('the library', () {
    Future<void> openRecommended(WidgetTester tester) async {
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('library-tab-recommended')),
      );
      await tester.tap(find.byKey(const ValueKey('library-tab-recommended')));
      // The tab view slides the list in.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('library-recommended-results')),
      );
    }

    testWidgets('recommends a guest the tenant order', (tester) async {
      await pumpApp(tester, location: AppRoutes.library);
      await openRecommended(tester);

      for (final series in tenantOrder) {
        expect(tileOf(series), findsOneWidget);
      }
      expect(catalog.recommendedSeriesRequests.map((read) => read.mine), [
        false,
      ]);
    });

    testWidgets('recommends a signed-in reader their own order', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.library, session: fakeSession);
      await openRecommended(tester);

      for (final series in readerOrder) {
        expect(tileOf(series), findsOneWidget);
      }
      expect(tileOf(tenantOrder.first), findsNothing);
      expect(catalog.recommendedSeriesRequests.map((read) => read.mine), [
        true,
      ]);
    });

    testWidgets('opens a series on the library tab', (tester) async {
      final series = fixtureSeries.first;
      catalog.myRecommendedSeries = [series];
      await pumpApp(tester, location: AppRoutes.library, session: fakeSession);
      await openRecommended(tester);

      await tester.tap(tileOf(series));
      await pumpUntilRouteSettled(tester, find.text(series.title));

      expect(
        router.state.uri.path,
        AppTab.library.locate(AppRoutes.seriesDetailPath(series.id)),
      );
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.recommendedSeriesError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.library, session: fakeSession);
      await tester.tap(find.byKey(const ValueKey('library-tab-recommended')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('library-recommended-error')),
      );

      expect(
        find.text('Could not show the recommended works. Try again.'),
        findsOneWidget,
      );

      catalog.recommendedSeriesError = null;
      await tester.tap(find.byKey(const ValueKey('library-recommended-retry')));
      await pumpUntilFound(tester, tileOf(readerOrder.first));
    });
  });

  testWidgets('the whole order starts again at the top once a later page is '
      'refused', (tester) async {
    catalog
      ..myRecommendedSeries = seriesNamed('reader', 30)
      ..recommendedSeriesPageSize = 20
      // What the API answers a token from the order that stood before the
      // batch wrote the reader's features.
      ..recommendedSeriesMoreError = const CatalogFailure(
        CatalogFailureKind.unexpected,
        refused: true,
      );
    await pumpApp(
      tester,
      location: AppRoutes.recommendedPath,
      session: fakeSession,
      size: const Size(400, 900),
    );
    final retry = find.byKey(const ValueKey('recommended-more-retry'));
    for (var drags = 0; drags < 40 && retry.evaluate().isEmpty; drags++) {
      await tester.drag(find.byType(ListView), const Offset(0, -400));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.ensureVisible(retry);
    await tester.pump();

    catalog.recommendedSeriesMoreError = null;
    await tester.tap(retry);
    await pumpUntilTrue(
      tester,
      () => catalog.recommendedSeriesRequests.length > 2,
      description: 'the retry to read the order again',
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('recommended-results')),
    );

    // The refused page is not asked for again: the first page of the order
    // standing now is read instead.
    // The home tab's shelf beneath reads ten of the order; this list reads
    // pages of twenty.
    expect(
      catalog.recommendedSeriesRequests
          .where((read) => read.limit == 20)
          .take(3)
          .map((read) => read.token),
      ['', '20', ''],
    );
  });
}
