import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/ranking_screen.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A screen the height of a phone, so a page of the chart holds more rows than
/// fit and a test about paging has to scroll the way a reader does.
const phoneSize = Size(400, 900);

/// A chart of [count] positions, more than one page holds, each held by a
/// series of its own named after the chart.
List<RankedSeriesItem> _chart(String name, {int count = 30}) => [
  for (var rank = 1; rank <= count; rank++)
    RankedSeriesItem(
      rank: rank,
      series: SeriesItem(
        id: '$name-$rank',
        title: '${name[0].toUpperCase()}${name.substring(1)} series $rank',
        description: '',
        creators: rank == 1 ? fixtureCreators : const [],
      ),
    ),
];

const fantasy = PublishedGenre(
  id: 'SeedGENRAAA1',
  name: 'Fantasy',
  seriesCount: 30,
);

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    final weekly = _chart('weekly');
    final fantasyWeek = _chart('fantasy');
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: {
        ...fixtureDetails(),
        weekly.last.series.id: fixtureDetail(weekly.last.series),
        fantasyWeek.last.series.id: fixtureDetail(fantasyWeek.last.series),
      },
      rankedSeries: weekly,
      dailyRankedSeries: _chart('daily'),
      genres: const [fantasy],
      genreRankedSeries: {fantasy.id: fantasyWeek},
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String location = AppRoutes.catalog,
    // The ranking shelf stands under two others, and a screen the height of a
    // phone would leave it unbuilt.
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
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await tester.pump();
  }

  /// Drags the chart up until [finder] matches, which is what asks for the
  /// pages between where the chart started and what it names.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    for (var drags = 0; drags < 40; drags++) {
      if (finder.evaluate().isNotEmpty) {
        await tester.ensureVisible(finder);
        await tester.pump();
        return;
      }
      await tester.drag(
        find.byKey(const ValueKey('ranking-results')),
        const Offset(0, -400),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
    fail('Timed out scrolling to $finder');
  }

  /// The pages the ranking screen asked for, told apart from the reads of the
  /// catalog shelf under it by how many positions they ask for.
  List<({RankingPeriod period, String token})> chartReads() => [
    for (final request in catalog.rankedSeriesRequests)
      if (request.limit == rankingPageLimit)
        (period: request.period, token: request.token),
  ];

  /// The genre each of [chartReads] was narrowed to, in order, empty for the
  /// tenant-wide chart.
  List<String> chartGenres() => [
    for (final (index, request) in catalog.rankedSeriesRequests.indexed)
      if (request.limit == rankingPageLimit) catalog.rankedSeriesGenres[index],
  ];

  /// The tokens of [chartReads], in order.
  List<String> chartTokens() => [for (final read in chartReads()) read.token];

  Finder rowOf(String id) => find.byKey(ValueKey('ranking-tile-$id'));

  /// Whether the period control has [period] selected.
  bool isSelected(WidgetTester tester, RankingPeriod period) => tester
      .widget<SegmentedButton<RankingPeriod>>(
        find.byKey(const ValueKey('ranking-period')),
      )
      .selected
      .contains(period);

  group('the catalog shelf', () {
    testWidgets('leads to the whole of the week it is the top of', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-ranking')),
      );
      // The shelf holds its ten, and the chart behind it is read on its own.
      expect(catalog.rankedSeriesRequests, [
        (period: RankingPeriod.weekly, limit: 10, token: ''),
      ]);

      await tester.tap(find.byKey(const ValueKey('catalog-ranking-all')));
      await pumpUntilRouteSettled(tester, rowOf('weekly-1'));

      expect(router.state.uri.toString(), '/ranking?period=weekly');
      expect(find.text('Ranking'), findsOneWidget);
      expect(isSelected(tester, RankingPeriod.weekly), isTrue);
      expect(chartReads().first, (period: RankingPeriod.weekly, token: ''));
      // The app offers no rated chart, so the whole one is all-ages too.
      expect(catalog.rankedSeriesAgeRatings.toSet(), {SeriesAgeRating.all});
    });
  });

  group('the ranking', () {
    testWidgets('opens on the daily chart, as the storefront does', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.rankingPath(), size: phoneSize);
      await pumpUntilFound(tester, rowOf('daily-1'));

      expect(AppRoutes.rankingPath(), '/ranking');
      expect(find.text('Ranking'), findsOneWidget);
      expect(isSelected(tester, RankingPeriod.daily), isTrue);
      expect(chartReads().first, (period: RankingPeriod.daily, token: ''));
      // Without a genre the chart is the tenant's.
      expect(chartGenres().toSet(), {''});
    });

    testWidgets('draws each position beside its series', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpApp(tester, location: AppRoutes.rankingPath());
      await pumpUntilFound(tester, rowOf('daily-1'));

      final first = rowOf('daily-1');
      expect(
        find.descendant(of: first, matching: find.text('1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: first, matching: find.text('Daily series 1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: first, matching: find.textContaining('Seed')),
        findsWidgets,
      );
      // The figure alone is drawn, and a screen reader is told what it is.
      expect(find.bySemanticsLabel(RegExp(r'^No\. 1\n')), findsOneWidget);
      semantics.dispose();
    });

    testWidgets('pages through the chart and opens a series', (tester) async {
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(period: RankingPeriod.weekly),
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('weekly-1'));

      final last = rowOf('weekly-30');
      await scrollTo(tester, last);
      expect(chartTokens(), ['', '$rankingPageLimit']);
      expect(find.byKey(const ValueKey('ranking-more-loading')), findsNothing);

      await tester.tap(last);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('series-detail-body')),
      );
      expect(router.state.uri.path, AppRoutes.seriesDetailPath('weekly-30'));
    });

    testWidgets('switches to the other period from its first position', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(period: RankingPeriod.weekly),
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('weekly-1'));
      await scrollTo(tester, rowOf('weekly-30'));

      await tester.tap(find.byKey(const ValueKey('ranking-period-daily')));
      await pumpUntilFound(tester, rowOf('daily-1'));

      expect(isSelected(tester, RankingPeriod.daily), isTrue);
      expect(rowOf('weekly-1'), findsNothing);
      // The route holds the period, so it names the chart on screen.
      expect(router.state.uri.toString(), AppRoutes.rankingPath());
      // A token belongs to the chart it was issued for, so the switch starts
      // the daily one from the top rather than carrying the weekly one over.
      expect(
        chartReads().firstWhere((read) => read.period == RankingPeriod.daily),
        (period: RankingPeriod.daily, token: ''),
      );
    });

    testWidgets('follows a link to the other period while it is open', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(period: RankingPeriod.weekly),
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('weekly-1'));
      // Switched on the screen first, so the link names the period the screen
      // opened on rather than one it has never shown.
      await tester.tap(find.byKey(const ValueKey('ranking-period-daily')));
      await pumpUntilFound(tester, rowOf('daily-1'));

      // What an incoming tenant link does.
      router.go(AppRoutes.rankingPath(period: RankingPeriod.weekly));
      await pumpUntilFound(tester, rowOf('weekly-1'));

      expect(isSelected(tester, RankingPeriod.weekly), isTrue);
      expect(rowOf('daily-1'), findsNothing);
      final reads = chartReads();
      final afterDaily = reads.skip(
        reads.lastIndexWhere((read) => read.period == RankingPeriod.daily) + 1,
      );
      expect(afterDaily.first, (period: RankingPeriod.weekly, token: ''));
    });

    testWidgets('says so when no ranking has been computed', (tester) async {
      catalog
        ..rankedSeries = const []
        ..dailyRankedSeries = const [];
      await pumpApp(tester, location: AppRoutes.rankingPath());

      await pumpUntilFound(tester, find.byKey(const ValueKey('ranking-empty')));
      expect(find.text('No ranking has been computed yet.'), findsOneWidget);
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.rankedSeriesError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.rankingPath());
      await pumpUntilFound(tester, find.byKey(const ValueKey('ranking-retry')));
      expect(
        find.text('Could not show the ranking. Try again.'),
        findsOneWidget,
      );

      catalog.rankedSeriesError = null;
      await tester.tap(find.byKey(const ValueKey('ranking-retry')));

      await pumpUntilFound(tester, rowOf('daily-1'));
    });

    testWidgets('asks again for a page the API could not reach', (
      tester,
    ) async {
      catalog.rankedSeriesMoreError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpApp(tester, location: AppRoutes.rankingPath(), size: phoneSize);
      await pumpUntilFound(tester, rowOf('daily-1'));

      final retry = find.byKey(const ValueKey('ranking-more-retry'));
      await scrollTo(tester, retry);
      // The rows that did arrive stay where the reader is.
      expect(rowOf('daily-20'), findsOneWidget);

      catalog.rankedSeriesMoreError = null;
      await tester.tap(retry);
      await scrollTo(tester, rowOf('daily-30'));
      expect(chartTokens(), ['', '20', '20']);
    });

    testWidgets('starts again at the top once a later page is refused', (
      tester,
    ) async {
      // What the API answers a token whose snapshot has since been purged.
      catalog.rankedSeriesMoreError = const CatalogFailure(
        CatalogFailureKind.unexpected,
        refused: true,
      );
      await pumpApp(tester, location: AppRoutes.rankingPath(), size: phoneSize);
      await pumpUntilFound(tester, rowOf('daily-1'));

      final retry = find.byKey(const ValueKey('ranking-more-retry'));
      await scrollTo(tester, retry);

      catalog.rankedSeriesMoreError = null;
      await tester.tap(retry);
      await pumpUntilFound(tester, rowOf('daily-1'));

      // The page after the refused one is asked for afresh, and the top of the
      // chart is read again first.
      expect(chartTokens().take(3), ['', '20', '']);
    });
  });

  group("a genre's chart", () {
    testWidgets('writes the genre beside the period, as the storefront does', (
      tester,
    ) async {
      expect(
        AppRoutes.rankingPath(genreId: fantasy.id),
        '/ranking?genre=${fantasy.id}',
      );
      expect(
        AppRoutes.rankingPath(
          period: RankingPeriod.weekly,
          genreId: fantasy.id,
        ),
        '/ranking?genre=${fantasy.id}&period=weekly',
      );
      expect(
        AppRoutes.rankingPath(period: RankingPeriod.weekly),
        '/ranking?period=weekly',
      );
    });

    testWidgets('opens on the week of the genre a link names, and pages it', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: '/ranking?genre=${fantasy.id}&period=weekly',
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('fantasy-1'));

      expect(find.text('Fantasy ranking'), findsOneWidget);
      expect(isSelected(tester, RankingPeriod.weekly), isTrue);
      expect(rowOf('weekly-1'), findsNothing);

      final last = rowOf('fantasy-30');
      await scrollTo(tester, last);
      expect(chartReads(), [
        (period: RankingPeriod.weekly, token: ''),
        (period: RankingPeriod.weekly, token: '$rankingPageLimit'),
      ]);
      // Every page is the genre's, including the ones past the first.
      expect(chartGenres(), [fantasy.id, fantasy.id]);
      // A genre is ranked among all-ages series alone.
      expect(catalog.rankedSeriesAgeRatings.toSet(), {SeriesAgeRating.all});

      await tester.tap(last);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('series-detail-body')),
      );
      expect(router.state.uri.path, AppRoutes.seriesDetailPath('fantasy-30'));
    });

    testWidgets('keeps the genre across a switch of period', (tester) async {
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(
          period: RankingPeriod.weekly,
          genreId: fantasy.id,
        ),
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('fantasy-1'));
      final genresReads = catalog.genresReads;

      await tester.tap(find.byKey(const ValueKey('ranking-period-daily')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('ranking-results')),
      );
      await tester.pump();

      expect(router.state.uri.toString(), '/ranking?genre=${fantasy.id}');
      expect(isSelected(tester, RankingPeriod.daily), isTrue);
      expect(find.text('Fantasy ranking'), findsOneWidget);
      expect(chartReads().last, (period: RankingPeriod.daily, token: ''));
      expect(chartGenres(), [fantasy.id, fantasy.id]);
      // The genre is not looked up again: a switch of period changes only the
      // positions under it.
      expect(catalog.genresReads, genresReads);
    });

    testWidgets('follows a link to the tenant-wide chart while it is open', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(
          period: RankingPeriod.weekly,
          genreId: fantasy.id,
        ),
        size: phoneSize,
      );
      await pumpUntilFound(tester, rowOf('fantasy-1'));

      router.go(AppRoutes.rankingPath(period: RankingPeriod.weekly));
      await pumpUntilFound(tester, rowOf('weekly-1'));

      expect(find.text('Ranking'), findsOneWidget);
      expect(find.text('Fantasy ranking'), findsNothing);
      expect(rowOf('fantasy-1'), findsNothing);
      expect(chartGenres().last, '');
    });

    testWidgets('says so when the tenant curates no such genre', (
      tester,
    ) async {
      await pumpApp(tester, location: '/ranking?genre=SeedGENRZZZ9');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('ranking-not-found')),
      );

      expect(find.text('Genre not found (SeedGENRZZZ9)'), findsOneWidget);
      expect(find.text('Ranking'), findsOneWidget);
      // A value no genre carries is not the tenant-wide chart either, and it
      // never reaches the API as a genre.
      expect(chartReads(), isEmpty);
    });

    testWidgets('reads a genre named twice over as no genre at all', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: '/ranking?genre=${fantasy.id}&genre=SeedGENRAAA2',
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('ranking-not-found')),
      );

      expect(chartReads(), isEmpty);
    });

    testWidgets('offers a retry when the genres could not be read', (
      tester,
    ) async {
      catalog.genresError = const CatalogFailure(CatalogFailureKind.network);
      await pumpApp(
        tester,
        location: AppRoutes.rankingPath(genreId: fantasy.id),
      );
      await pumpUntilFound(tester, find.byKey(const ValueKey('ranking-retry')));

      catalog.genresError = null;
      await tester.tap(find.byKey(const ValueKey('ranking-retry')));
      await pumpUntilFound(tester, rowOf('fantasy-1'));

      expect(find.text('Fantasy ranking'), findsOneWidget);
    });
  });
}
