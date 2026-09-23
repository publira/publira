import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

const fantasy = PublishedGenre(
  id: 'SeedGENRAAA1',
  name: 'Fantasy',
  seriesCount: 2,
);
const romance = PublishedGenre(
  id: 'SeedGENRAAA2',
  name: 'Romance',
  seriesCount: 0,
);
const timeTravel = PublishedTag(
  slug: 'time-travel',
  name: 'Time travel',
  seriesCount: 1,
);

/// A series wearing both a genre and a tag, the way the series screen offers
/// a way into each.
const taggedSeries = SeriesItem(
  id: 'series-tagged',
  title: 'Clockwork Garden',
  description: 'A garden that keeps its own time.',
  episodeCount: 2,
  status: SeriesStatus.completed,
  genres: [SeriesGenre(id: 'SeedGENRAAA1', name: 'Fantasy')],
  tags: [SeriesTag(slug: 'time-travel', name: 'Time travel')],
);

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: {
        ...fixtureDetails(),
        taggedSeries.id: fixtureDetail(taggedSeries),
      },
      genres: const [fantasy, romance],
      tags: const [timeTravel],
      detailSeries: {
        fantasy.id: [fixtureSeries.first, taggedSeries],
        timeTravel.slug: [taggedSeries],
      },
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String location = AppRoutes.catalog,
  }) async {
    tester.view.physicalSize = const Size(800, 2400);
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

  Finder tileOf(String seriesId) =>
      find.byKey(ValueKey('series-tile-$seriesId'));

  group('the catalog', () {
    testWidgets('offers the genres, each opening its series', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-genres')),
      );

      expect(find.text('Browse by genre'), findsOneWidget);
      await tester.tap(find.byKey(ValueKey('genre-chip-${romance.id}')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('genre-body')),
      );

      expect(router.state.uri.path, AppRoutes.genreDetailPath(romance.id));
      expect(find.byKey(const ValueKey('genre-series-empty')), findsOneWidget);
    });

    testWidgets('leads to the list of every genre', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-genres')),
      );

      await tester.tap(find.byKey(const ValueKey('catalog-genres-all')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('genres-body')),
      );

      expect(router.state.uri.path, AppRoutes.genresPath);
      expect(find.byKey(ValueKey('genre-chip-${fantasy.id}')), findsOneWidget);
      expect(find.byKey(ValueKey('genre-chip-${romance.id}')), findsOneWidget);
    });

    testWidgets('shows no genre row for a tenant that curates none', (
      tester,
    ) async {
      catalog.genres = const [];
      await pumpApp(tester);
      await pumpUntilFound(tester, tileOf(fixtureSeries.first.id));

      expect(find.byKey(const ValueKey('catalog-genres')), findsNothing);
      expect(find.text('Browse by genre'), findsNothing);
    });

    testWidgets('offers a retry where the genres could not be read', (
      tester,
    ) async {
      catalog.genresError = const CatalogFailure(CatalogFailureKind.unexpected);
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-genres-retry')),
      );
      expect(
        find.text('Could not show the genres. Try again.'),
        findsOneWidget,
      );
      expect(tileOf(fixtureSeries.first.id), findsOneWidget);

      catalog.genresError = null;
      await tester.tap(find.byKey(const ValueKey('catalog-genres-retry')));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-genres')),
      );
    });
  });

  group('the list of genres', () {
    testWidgets('says so when the tenant curates none', (tester) async {
      catalog.genres = const [];
      await pumpApp(tester, location: AppRoutes.genresPath);

      await pumpUntilFound(tester, find.byKey(const ValueKey('genres-empty')));
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.genresError = const CatalogFailure(CatalogFailureKind.network);
      await pumpApp(tester, location: AppRoutes.genresPath);
      await pumpUntilFound(tester, find.byKey(const ValueKey('genres-retry')));

      catalog.genresError = null;
      await tester.tap(find.byKey(const ValueKey('genres-retry')));

      await pumpUntilFound(tester, find.byKey(const ValueKey('genres-body')));
    });
  });

  group('a genre', () {
    testWidgets('shows its name, its count, and its series', (tester) async {
      await pumpApp(tester, location: AppRoutes.genreDetailPath(fantasy.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('genre-body')));

      expect(find.text('Fantasy'), findsWidgets);
      expect(find.text('2 published series'), findsOneWidget);
      expect(tileOf(fixtureSeries.first.id), findsOneWidget);
      expect(tileOf(taggedSeries.id), findsOneWidget);
      expect(
        catalog.classifiedSeriesRequests.single.filter,
        const SeriesListFilter(),
      );
    });

    testWidgets('reads its series again from the top under a changed filter', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.genreDetailPath(fantasy.id));
      await pumpUntilFound(tester, tileOf(taggedSeries.id));

      await tester.tap(find.byKey(const ValueKey('series-filter-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Completed').last);
      await pumpUntilRouteSettled(tester, tileOf(taggedSeries.id));

      expect(tileOf(fixtureSeries.first.id), findsNothing);
      expect(catalog.classifiedSeriesRequests.last, (
        id: fantasy.id,
        filter: const SeriesListFilter(status: SeriesStatus.completed),
        token: '',
      ));

      await tester.tap(find.byKey(const ValueKey('series-filter-free')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('series-filter-order')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Title').last);
      await tester.pumpAndSettle();

      expect(
        catalog.classifiedSeriesRequests.last.filter,
        const SeriesListFilter(
          order: SeriesListOrder.title,
          status: SeriesStatus.completed,
          freeOnly: true,
        ),
      );
      // The name was read once: a filter narrows the series, not the genre.
      expect(find.text('2 published series'), findsOneWidget);
    });

    testWidgets('says a filter matched nothing and offers to clear it', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.genreDetailPath(fantasy.id));
      await pumpUntilFound(tester, tileOf(taggedSeries.id));

      await tester.tap(find.byKey(const ValueKey('series-filter-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('On hiatus').last);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('genre-series-filter-clear')),
      );
      expect(find.text('No series match these filters.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('genre-series-filter-clear')));
      await pumpUntilFound(tester, tileOf(taggedSeries.id));

      expect(catalog.classifiedSeriesRequests.last.filter.status, isNull);
    });

    testWidgets('says so for a genre the tenant does not curate', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.genreDetailPath('missing'));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('genre-not-found')),
      );
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.classifiedSeriesError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpApp(tester, location: AppRoutes.genreDetailPath(fantasy.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('genre-retry')));

      catalog.classifiedSeriesError = null;
      await tester.tap(find.byKey(const ValueKey('genre-retry')));

      await pumpUntilFound(tester, tileOf(taggedSeries.id));
    });

    testWidgets('opens a rated series behind the same confirmation', (
      tester,
    ) async {
      catalog
        ..detailSeries = {
          fantasy.id: [fixtureRatedSeries],
        }
        ..details = {fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries)};
      await pumpApp(tester, location: AppRoutes.genreDetailPath(fantasy.id));
      await pumpUntilFound(tester, tileOf(fixtureRatedSeries.id));

      await tester.tap(tileOf(fixtureRatedSeries.id));

      await pumpUntilRouteSettled(
        tester,
        find.text('“After Dark” is rated R15'),
      );
      expect(find.text('Episodes', skipOffstage: false), findsNothing);
    });
  });

  group('a tag', () {
    testWidgets('shows its name and the series carrying it', (tester) async {
      await pumpApp(tester, location: AppRoutes.tagDetailPath(timeTravel.slug));
      await pumpUntilFound(tester, find.byKey(const ValueKey('tag-body')));

      expect(find.text('Time travel'), findsWidgets);
      expect(find.text('1 published series'), findsOneWidget);
      expect(tileOf(taggedSeries.id), findsOneWidget);
    });

    testWidgets('says so for a tag nothing published carries', (tester) async {
      await pumpApp(tester, location: AppRoutes.tagDetailPath('missing'));

      await pumpUntilFound(tester, find.byKey(const ValueKey('tag-not-found')));
    });

    testWidgets('offers a retry when the tag could not be read', (
      tester,
    ) async {
      catalog.tagError = const CatalogFailure(CatalogFailureKind.network);
      await pumpApp(tester, location: AppRoutes.tagDetailPath(timeTravel.slug));
      await pumpUntilFound(tester, find.byKey(const ValueKey('tag-retry')));

      catalog.tagError = null;
      await tester.tap(find.byKey(const ValueKey('tag-retry')));

      await pumpUntilFound(tester, tileOf(taggedSeries.id));
    });
  });

  group('the series screen', () {
    testWidgets('leads from a genre it carries to that genre', (tester) async {
      await pumpApp(
        tester,
        location: AppRoutes.seriesDetailPath(taggedSeries.id),
      );
      final chip = find.byKey(ValueKey('series-genre-${fantasy.id}'));
      await pumpUntilRouteSettled(tester, chip);

      await tester.tap(chip);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('genre-body')),
      );

      expect(router.state.uri.path, AppRoutes.genreDetailPath(fantasy.id));
    });

    testWidgets('leads from a tag it carries to that tag', (tester) async {
      await pumpApp(
        tester,
        location: AppRoutes.seriesDetailPath(taggedSeries.id),
      );
      final chip = find.byKey(ValueKey('series-tag-${timeTravel.slug}'));
      await pumpUntilRouteSettled(tester, chip);

      await tester.tap(chip);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('tag-body')),
      );

      expect(router.state.uri.path, AppRoutes.tagDetailPath(timeTravel.slug));
      await tester.pageBack();
      await pumpUntilRouteSettled(tester, chip);
      expect(
        router.state.uri.path,
        AppRoutes.seriesDetailPath(taggedSeries.id),
      );
    });
  });
}
