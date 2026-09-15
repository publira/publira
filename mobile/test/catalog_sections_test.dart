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

/// A screen the height of a phone, so the list holds fewer rows than one page
/// and a test about paging has to scroll the way a reader does.
const phoneSize = Size(400, 900);

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

  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    // Four sections stand above one another, and a screen the height of a
    // phone would leave the ones at the bottom unbuilt — a test about a
    // section the viewport never reached proves nothing about it. A test about
    // paging asks for [phoneSize] instead, because what it is about is the
    // rows a reader has to scroll to reach.
    Size size = const Size(800, 2400),
  }) async {
    tester.view.physicalSize = size;
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

  /// Drags the catalog up until [finder] matches, which is what asks for the
  /// pages between where the list started and what it names.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    for (var drags = 0; drags < 40; drags++) {
      if (finder.evaluate().isNotEmpty) {
        await tester.ensureVisible(finder);
        await tester.pump();
        return;
      }
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
    fail('Timed out scrolling to $finder');
  }

  Finder tileOf(int number) =>
      find.byKey(ValueKey('series-tile-catalog-series-$number'));

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

  testWidgets('the catalog pages on as the reader nears the end of it', (
    tester,
  ) async {
    catalog.series = fixtureCatalog(50);
    await pumpApp(tester, size: phoneSize);
    await pumpUntilFound(tester, tileOf(1));

    await scrollTo(tester, tileOf(50));

    expect(tileOf(50), findsOneWidget);
    // Three pages of twenty, each asked for by the token the one above it
    // answered with.
    expect(catalog.seriesTokens, ['', '20', '40']);
    // The catalog ends there, so nothing stands under its last row.
    expect(find.byKey(const ValueKey('catalog-more-loading')), findsNothing);
  });

  testWidgets('a catalog of one page asks for nothing under it', (
    tester,
  ) async {
    await pumpLoadedApp(tester);

    expect(catalog.seriesTokens, ['']);
    expect(find.byKey(const ValueKey('catalog-more-loading')), findsNothing);
  });

  testWidgets('a page the API could not answer is offered again', (
    tester,
  ) async {
    catalog
      ..series = fixtureCatalog(50)
      ..listMoreError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester, size: phoneSize);
    await pumpUntilFound(tester, tileOf(1));

    await scrollTo(tester, find.byKey(const ValueKey('catalog-more-error')));

    // The rows that did arrive stay where the reader left them, and what went
    // wrong is reported under them.
    expect(tileOf(20), findsOneWidget);
    expect(
      find.textContaining('Could not connect to the server'),
      findsOneWidget,
    );

    catalog.listMoreError = null;
    await tester.tap(find.byKey(const ValueKey('catalog-more-retry')));
    await pumpUntilFound(tester, tileOf(21));

    expect(find.byKey(const ValueKey('catalog-more-error')), findsNothing);
  });

  testWidgets('pulling to refresh reads the catalog from its first page', (
    tester,
  ) async {
    catalog.series = fixtureCatalog(50);
    await pumpApp(tester);
    await pumpUntilFound(tester, tileOf(21));

    // A pull arms the indicator only once it passes a quarter of the viewport,
    // which is what this distance is measured against.
    await tester.fling(
      find.byType(CustomScrollView),
      const Offset(0, 800),
      1000,
    );
    await tester.pump();
    await pumpUntilTrue(
      tester,
      () => catalog.seriesTokens.length > 2,
      description: 'the pull to refresh to read the catalog again',
    );
    await pumpUntilFound(tester, tileOf(1));

    // The pages the reader had scrolled into are dropped: the list asks for
    // the first page again, and then for the page under it from the top.
    expect(catalog.seriesTokens, containsAllInOrder(['', '20', '']));
    // The shelves above the list are read again by the same pull.
    expect(catalog.newestSeriesLimits, [10, 10]);
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
