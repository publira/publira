import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A screen the height of a phone, so the results hold fewer rows than one
/// page and a test about paging has to scroll the way a reader does.
const phoneSize = Size(400, 900);

/// Long enough for the field to stand still, which is what starts the search.
const pastDebounce = Duration(milliseconds: 400);

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;
  late InMemoryOfflineLibrary offline;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      newestSeries: fixtureSeries,
      details: fixtureDetails(),
      searchResults: fixtureSeries,
      creatorSearchResults: const [fixturePublishedCreator],
      labelSearchResults: const [fixturePublishedLabel],
      publishedCreators: const {'SeedAUTHAAA1': fixturePublishedCreator},
      publishedLabels: const {'SeedLABLAAA1': fixturePublishedLabel},
      detailSeries: {
        'SeedAUTHAAA1': [fixtureSeries.first],
        'SeedLABLAAA1': [fixtureSeries.first],
      },
    );
    offline = InMemoryOfflineLibrary();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String location = AppRoutes.search,
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
        offline: offline,
      ),
    );
    await tester.pump();
  }

  /// Types [keyword] and waits out the debounce, the way a reader who has
  /// stopped typing does.
  Future<void> type(WidgetTester tester, String keyword) async {
    await tester.enterText(find.byKey(const ValueKey('search-field')), keyword);
    await tester.pump(pastDebounce);
  }

  Finder tileOf(String seriesId) =>
      find.byKey(ValueKey('series-tile-$seriesId'));

  /// Drags [list] until [finder] is on screen, the way a reader scrolls a
  /// phone-sized list to a row further down it.
  Future<void> dragUntilFound(
    WidgetTester tester,
    Finder list,
    Finder finder,
  ) async {
    for (var drags = 0; drags < 40; drags++) {
      if (finder.evaluate().isNotEmpty) {
        break;
      }
      await tester.drag(list, const Offset(0, -400));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  bool fieldHasFocus(WidgetTester tester) => tester
      .widget<TextField>(
        find.byKey(const ValueKey('search-field'), skipOffstage: false),
      )
      .focusNode!
      .hasFocus;

  testWidgets('the search tab opens the search screen with the field focused', (
    tester,
  ) async {
    await pumpApp(tester, location: AppRoutes.catalog);

    await tester.tap(find.byKey(const ValueKey('tab-search')));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('search-field')),
    );
    await tester.pump();

    expect(find.byKey(const ValueKey('search-prompt')), findsOneWidget);
    expect(fieldHasFocus(tester), isTrue);
  });

  testWidgets(
    'leaving the search tab takes the focus off the field, and coming back '
    'to a keyword leaves it off',
    (tester) async {
      await pumpApp(tester);
      await tester.pump();
      await type(tester, 'Kitchen');
      await pumpUntilFound(tester, tileOf('series-kitchen'));
      expect(fieldHasFocus(tester), isTrue);

      await tester.tap(find.byKey(const ValueKey('tab-home')));
      await tester.pump();
      await tester.pump();

      expect(fieldHasFocus(tester), isFalse);

      await tester.tap(find.byKey(const ValueKey('tab-search')));
      await tester.pump();
      await tester.pump();

      expect(tileOf('series-kitchen'), findsOneWidget);
      expect(fieldHasFocus(tester), isFalse);
    },
  );

  testWidgets('an empty field asks for a keyword instead of searching', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('search-prompt')), findsOneWidget);
    expect(catalog.searchRequests, isEmpty);
  });

  testWidgets('typing part of a title lists the series', (tester) async {
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    expect(catalog.searchRequests.single.query, 'Kitchen');
    expect(catalog.searchRequests.single.token, isEmpty);
  });

  testWidgets('a keyword typed letter by letter is searched for once', (
    tester,
  ) async {
    await pumpApp(tester);

    for (final keyword in ['K', 'Ki', 'Kit']) {
      await tester.enterText(
        find.byKey(const ValueKey('search-field')),
        keyword,
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pump(pastDebounce);
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    expect(catalog.searchRequests.single.query, 'Kit');
  });

  testWidgets('clearing the field takes the results away', (tester) async {
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    await tester.tap(find.byKey(const ValueKey('search-clear')));
    await tester.pump();

    expect(tileOf('series-kitchen'), findsNothing);
    expect(find.byKey(const ValueKey('search-prompt')), findsOneWidget);
    // Clearing is not a search: the field is empty, and the API is told
    // nothing about a keyword that is no longer there.
    expect(catalog.searchRequests, hasLength(1));
  });

  testWidgets('a series opened from the results opens on the search tab, '
      'and going back returns to the results', (tester) async {
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, tileOf('series-kitchen'));
    await tester.tap(tileOf('series-kitchen'));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(
      router.state.uri.path,
      AppTab.search.locate(AppRoutes.seriesDetailPath('series-kitchen')),
    );

    router.pop();
    await pumpUntilRouteSettled(tester, tileOf('series-kitchen'));

    expect(router.state.uri.path, AppRoutes.search);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('search-field')))
          .controller!
          .text,
      'Kitchen',
    );
  });

  testWidgets('a keyword asks every group for it once', (tester) async {
    await pumpApp(tester);

    await type(tester, 'Seed');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('label-tile-SeedLABLAAA1')),
    );

    expect(catalog.searchRequests.single.query, 'Seed');
    expect(catalog.creatorSearchRequests.single.query, 'Seed');
    expect(catalog.labelSearchRequests.single.query, 'Seed');
  });

  testWidgets('a keyword that names an author opens their series', (
    tester,
  ) async {
    catalog.searchResults = const [];
    await pumpApp(tester);

    await type(tester, 'Seed Author');
    final author = find.byKey(const ValueKey('creator-tile-SeedAUTHAAA1'));
    await pumpUntilFound(tester, author);

    // A name matches no title, and the author still arrives: the groups
    // answer on their own.
    expect(find.byKey(const ValueKey('search-series-empty')), findsOneWidget);

    await tester.tap(author);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('creator-body')),
    );

    expect(find.text('Profile text for Seed Author 001'), findsOneWidget);
    expect(tileOf(fixtureSeries.first.id), findsOneWidget);
  });

  testWidgets('a keyword that names a label opens its series', (tester) async {
    catalog.searchResults = const [];
    await pumpApp(tester);

    await type(tester, 'Seed Label');
    final label = find.byKey(const ValueKey('label-tile-SeedLABLAAA1'));
    await pumpUntilFound(tester, label);

    await tester.tap(label);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('label-body')),
    );

    expect(tileOf(fixtureSeries.first.id), findsOneWidget);
  });

  testWidgets('a keyword nothing matches says so for every group', (
    tester,
  ) async {
    catalog.searchResults = const [];
    catalog.creatorSearchResults = const [];
    catalog.labelSearchResults = const [];
    await pumpApp(tester);

    await type(tester, 'nothing here');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-labels-empty')),
    );

    expect(find.text('No series match “nothing here”.'), findsOneWidget);
    expect(find.text('No authors match “nothing here”.'), findsOneWidget);
    expect(find.text('No labels match “nothing here”.'), findsOneWidget);
  });

  testWidgets('a group the API could not answer leaves the others alone', (
    tester,
  ) async {
    catalog.creatorSearchError = const CatalogFailure(
      CatalogFailureKind.network,
    );
    await pumpApp(tester);

    await type(tester, 'Seed');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-creators-retry')),
    );

    expect(tileOf(fixtureSeries.first.id), findsOneWidget);
    expect(
      find.byKey(const ValueKey('label-tile-SeedLABLAAA1')),
      findsOneWidget,
    );

    catalog.creatorSearchError = null;
    await tester.tap(find.byKey(const ValueKey('search-creators-retry')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('creator-tile-SeedAUTHAAA1')),
    );

    expect(catalog.creatorSearchRequests, hasLength(2));
    // Retrying one group asks nothing of the groups that answered.
    expect(catalog.searchRequests, hasLength(1));
  });

  testWidgets('the overview offers the rest of a group only when there is '
      'more of it', (tester) async {
    catalog.searchResults = fixtureCatalog(6);
    await pumpApp(tester);

    await type(tester, 'Catalog');
    await pumpUntilFound(tester, tileOf('catalog-series-5'));

    expect(tileOf('catalog-series-6'), findsNothing);
    expect(
      find.byKey(const ValueKey('search-creators-show-all')),
      findsNothing,
    );

    await tester.tap(find.byKey(const ValueKey('search-series-show-all')));
    await pumpUntilFound(tester, tileOf('catalog-series-6'));

    // The group opened on its own keeps what the overview read.
    expect(catalog.searchRequests, hasLength(1));
    expect(find.byKey(const ValueKey('search-series-results')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('search-show-overview')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('search-overview')));

    expect(tileOf('catalog-series-6'), findsNothing);
  });

  testWidgets('a search the API could not answer offers a retry', (
    tester,
  ) async {
    catalog.searchError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-retry')),
    );

    catalog.searchError = null;
    await tester.tap(find.byKey(const ValueKey('search-series-retry')));
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    expect(catalog.searchRequests, hasLength(2));
    expect(catalog.searchRequests.last.query, 'Kitchen');
  });

  testWidgets('a group pages as the reader reaches the end of it', (
    tester,
  ) async {
    catalog.searchResults = fixtureCatalog(40);
    catalog.searchPageSize = 10;
    await pumpApp(tester, size: phoneSize);

    await type(tester, 'Catalog');
    await pumpUntilFound(tester, tileOf('catalog-series-1'));
    await tester.tap(find.byKey(const ValueKey('search-show-series')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-results')),
    );

    await dragUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-results')),
      tileOf('catalog-series-12'),
    );

    expect(tileOf('catalog-series-12'), findsOneWidget);
    expect(
      catalog.searchRequests.map((request) => request.token),
      containsAllInOrder(['', '10']),
    );
    // Every page of one search answers the keyword the first page was built
    // for, which is what the API's token belongs to.
    expect(
      catalog.searchRequests.every((request) => request.query == 'Catalog'),
      isTrue,
    );
  });

  testWidgets('a page the API could not answer leaves the results alone', (
    tester,
  ) async {
    catalog.searchResults = fixtureCatalog(40);
    catalog.searchPageSize = 10;
    catalog.searchMoreError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester, size: phoneSize);

    await type(tester, 'Catalog');
    await pumpUntilFound(tester, tileOf('catalog-series-1'));
    await tester.tap(find.byKey(const ValueKey('search-show-series')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-results')),
    );

    await dragUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-results')),
      find.byKey(const ValueKey('search-series-more-error')),
    );

    expect(
      find.byKey(const ValueKey('search-series-more-error')),
      findsOneWidget,
    );
    // The last row of the page that did arrive stands right above the footer.
    expect(tileOf('catalog-series-10'), findsOneWidget);
  });

  testWidgets('the keyword the reader typed past does not answer the screen', (
    tester,
  ) async {
    catalog.searchResults = const [];
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('search-series-empty')),
    );

    catalog.searchResults = fixtureSeries;
    await type(tester, 'Seed');
    await pumpUntilFound(tester, tileOf(fixtureSeries.first.id));

    expect(find.byKey(const ValueKey('search-series-empty')), findsNothing);
    expect(catalog.searchRequests.last.query, 'Seed');
  });

  testWidgets('the field is limited to the code points the API counts', (
    tester,
  ) async {
    await pumpApp(tester);

    // One grapheme cluster of two code points, which is what tells a limit
    // measured in clusters apart from the one the API measures in.
    const thumbsUp = '\u{1F44D}\u{1F3FD}';
    await tester.enterText(
      find.byKey(const ValueKey('search-field')),
      thumbsUp * (searchQueryMaxRunes ~/ 2 + 1),
    );
    await tester.pump();

    final field = tester.widget<TextField>(
      find.byKey(const ValueKey('search-field')),
    );

    expect(field.controller!.text.runes.length, searchQueryMaxRunes);
  });

  testWidgets('a repository swapped under the screen answers again', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: AppRoutes.search);
    final auth = fakeAuthController();

    Future<void> pumpWith(FakeCatalogRepository repository) =>
        tester.pumpWidget(
          PubliraApp(
            router: router,
            catalog: repository,
            auth: auth,
            offline: offline,
          ),
        );

    await pumpWith(catalog);
    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    final replacement = FakeCatalogRepository(searchResults: fixtureCatalog(1));
    await pumpWith(replacement);
    await pumpUntilFound(tester, tileOf('catalog-series-1'));

    // The rows on screen and the token under them belonged to the repository
    // that was replaced, so neither is carried over.
    expect(tileOf('series-kitchen'), findsNothing);
    expect(replacement.searchRequests.single.query, 'Kitchen');
    expect(replacement.searchRequests.single.token, isEmpty);
  });
}
