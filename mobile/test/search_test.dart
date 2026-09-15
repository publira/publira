import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
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

  testWidgets('the catalog app bar opens the search screen', (tester) async {
    await pumpApp(tester, location: AppRoutes.catalog);

    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('catalog-search')),
    );
    await tester.tap(find.byKey(const ValueKey('catalog-search')));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('search-field')),
    );

    expect(find.byKey(const ValueKey('search-prompt')), findsOneWidget);
  });

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

  testWidgets('the search screen leads back to the catalog', (tester) async {
    await pumpApp(tester, location: AppRoutes.catalog);

    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('catalog-search')),
    );
    await tester.tap(find.byKey(const ValueKey('catalog-search')));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('search-field')),
    );

    router.pop();
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('catalog-search')),
    );

    expect(find.byKey(const ValueKey('search-field')), findsNothing);
  });

  testWidgets('a keyword nothing matches says so', (tester) async {
    catalog.searchResults = const [];
    await pumpApp(tester);

    await type(tester, 'nothing here');
    await pumpUntilFound(tester, find.byKey(const ValueKey('search-empty')));

    expect(find.text('No series match “nothing here”.'), findsOneWidget);
  });

  testWidgets('a search the API could not answer offers a retry', (
    tester,
  ) async {
    catalog.searchError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, find.byKey(const ValueKey('search-retry')));

    catalog.searchError = null;
    await tester.tap(find.byKey(const ValueKey('search-retry')));
    await pumpUntilFound(tester, tileOf('series-kitchen'));

    expect(catalog.searchRequests, hasLength(2));
    expect(catalog.searchRequests.last.query, 'Kitchen');
  });

  testWidgets('the results page as the reader reaches the end of them', (
    tester,
  ) async {
    catalog.searchResults = fixtureCatalog(40);
    catalog.searchPageSize = 10;
    await pumpApp(tester, size: phoneSize);

    await type(tester, 'Catalog');
    await pumpUntilFound(tester, tileOf('catalog-series-1'));

    for (var drags = 0; drags < 40; drags++) {
      if (tileOf('catalog-series-12').evaluate().isNotEmpty) {
        break;
      }
      await tester.drag(
        find.byKey(const ValueKey('search-results')),
        const Offset(0, -400),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }

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

    for (var drags = 0; drags < 40; drags++) {
      if (find
          .byKey(const ValueKey('search-more-error'))
          .evaluate()
          .isNotEmpty) {
        break;
      }
      await tester.drag(
        find.byKey(const ValueKey('search-results')),
        const Offset(0, -400),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.byKey(const ValueKey('search-more-error')), findsOneWidget);
    expect(tileOf('catalog-series-1'), findsOneWidget);
  });

  testWidgets('the keyword the reader typed past does not answer the screen', (
    tester,
  ) async {
    catalog.searchResults = const [];
    await pumpApp(tester);

    await type(tester, 'Kitchen');
    await pumpUntilFound(tester, find.byKey(const ValueKey('search-empty')));

    catalog.searchResults = fixtureSeries;
    await type(tester, 'Seed');
    await pumpUntilFound(tester, tileOf(fixtureSeries.first.id));

    expect(find.byKey(const ValueKey('search-empty')), findsNothing);
    expect(catalog.searchRequests.last.query, 'Seed');
  });

  testWidgets('the field is limited to what the API accepts', (tester) async {
    await pumpApp(tester);

    final field = tester.widget<TextField>(
      find.byKey(const ValueKey('search-field')),
    );

    expect(field.maxLength, searchQueryMaxRunes);
  });
}
