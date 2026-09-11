import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_item.dart';
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
      newestSeries: fixtureSeries,
      rankedSeries: fixtureRankedSeries(),
      details: fixtureDetails(),
      recentSeries: fixtureRecentSeries(),
    );
    offline = InMemoryOfflineLibrary();
  });

  Future<void> pumpApp(WidgetTester tester, {AuthSession? session}) async {
    // Four sections stand above one another, and a screen the height of a
    // phone would leave the ones at the bottom unbuilt — a test about a
    // section the viewport never reached proves nothing about it.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        offline: offline,
      ),
    );
  }

  Future<void> pumpLoadedApp(
    WidgetTester tester, {
    AuthSession? session,
  }) async {
    await pumpApp(tester, session: session);
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
    );
  }

  testWidgets('the ranking shelf shows the week in the snapshot positions', (
    tester,
  ) async {
    await pumpLoadedApp(tester);

    expect(find.byKey(const ValueKey('catalog-ranking')), findsOneWidget);
    expect(find.text('Top 10 this week'), findsOneWidget);
    for (final ranked in fixtureRankedSeries()) {
      final card = find.byKey(ValueKey('catalog-ranking-${ranked.series.id}'));
      expect(card, findsOneWidget);
      expect(
        find.descendant(of: card, matching: find.text('${ranked.rank}')),
        findsOneWidget,
      );
    }
    expect(catalog.rankedSeriesPeriods, [RankingPeriod.weekly]);
  });

  testWidgets('a tenant the ranking batch has not run for is shown no chart', (
    tester,
  ) async {
    catalog.rankedSeries = const [];
    await pumpLoadedApp(tester);

    expect(find.byKey(const ValueKey('catalog-ranking')), findsNothing);
    expect(find.text('Top 10 this week'), findsNothing);
  });

  testWidgets('the new-arrivals shelf shows the series published last', (
    tester,
  ) async {
    await pumpLoadedApp(tester);

    expect(find.byKey(const ValueKey('catalog-new-arrivals')), findsOneWidget);
    expect(find.text('New arrivals'), findsOneWidget);
    for (final series in fixtureSeries) {
      expect(
        find.byKey(ValueKey('catalog-new-arrivals-${series.id}')),
        findsOneWidget,
      );
    }
    expect(catalog.newestSeriesLimits, [10]);
  });

  testWidgets('the whole catalog is listed under its own heading', (
    tester,
  ) async {
    await pumpLoadedApp(tester);

    expect(find.text('All series'), findsOneWidget);
    for (final series in fixtureSeries) {
      expect(find.byKey(ValueKey('series-tile-${series.id}')), findsOneWidget);
    }
  });

  testWidgets('a card on a shelf opens the series behind it', (tester) async {
    await pumpLoadedApp(tester);

    final first = fixtureSeries.first;
    await tester.tap(find.byKey(ValueKey('catalog-new-arrivals-${first.id}')));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(first.id));
  });

  testWidgets('a shelf reserves its row while the page is in flight', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(
      find.byKey(const ValueKey('catalog-ranking-loading')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('catalog-new-arrivals-loading')),
      findsOneWidget,
    );

    await pumpUntilFound(tester, find.byKey(const ValueKey('catalog-ranking')));
    expect(find.byKey(const ValueKey('catalog-ranking-loading')), findsNothing);
  });

  testWidgets('a shelf the API could not answer retries where it stands', (
    tester,
  ) async {
    catalog.rankedSeriesError = const CatalogFailure(
      CatalogFailureKind.network,
    );
    await pumpLoadedApp(tester);

    expect(find.byKey(const ValueKey('catalog-ranking-error')), findsOneWidget);
    expect(
      find.textContaining('Could not connect to the server'),
      findsOneWidget,
    );
    // The sections either side of it are untouched.
    expect(find.byKey(const ValueKey('catalog-new-arrivals')), findsOneWidget);
    expect(
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      findsOneWidget,
    );

    catalog.rankedSeriesError = null;
    await tester.tap(find.byKey(const ValueKey('catalog-ranking-retry')));
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('catalog-ranking-${fixtureSeries.first.id}')),
    );

    expect(find.byKey(const ValueKey('catalog-ranking-error')), findsNothing);
  });

  testWidgets('the whole-catalog list failing leaves the shelves standing', (
    tester,
  ) async {
    catalog.listError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('catalog-ranking')));

    expect(find.byKey(const ValueKey('catalog-error')), findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-new-arrivals')), findsOneWidget);
  });

  testWidgets('a signed-in reader is offered all four sections at once', (
    tester,
  ) async {
    await pumpLoadedApp(tester, session: fakeSession);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('continue-reading')),
    );

    expect(find.byKey(const ValueKey('continue-reading')), findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-ranking')), findsOneWidget);
    expect(find.byKey(const ValueKey('catalog-new-arrivals')), findsOneWidget);
    expect(
      find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      findsOneWidget,
    );
  });
}
