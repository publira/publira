import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A screen the height of a phone, so a page of the list holds more rows than
/// fit and a test about paging has to scroll the way a reader does.
const phoneSize = Size(400, 900);

/// More authors than one page holds, by name.
final _creators = [
  for (var index = 1; index <= 30; index++)
    PublishedCreator(
      id: 'creator-$index',
      name: 'Author ${'$index'.padLeft(2, '0')}',
      seriesCount: index,
    ),
];

/// More labels than one page holds, newest first.
final _labels = [
  for (var index = 1; index <= 30; index++)
    PublishedLabel(
      id: 'label-$index',
      name: 'Label ${'$index'.padLeft(2, '0')}',
    ),
];

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      creatorList: _creators,
      labelList: _labels,
      publishedCreators: {for (final creator in _creators) creator.id: creator},
      publishedLabels: {for (final label in _labels) label.id: label},
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String location = AppRoutes.catalog,
    // The shelves stand under three others, and a screen the height of a phone
    // would leave them unbuilt.
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

  /// Drags [list] up until [finder] matches, which is what asks for the pages
  /// between where the list started and what it names.
  Future<void> scrollTo(WidgetTester tester, Finder list, Finder finder) async {
    for (var drags = 0; drags < 40; drags++) {
      if (finder.evaluate().isNotEmpty) {
        await tester.ensureVisible(finder);
        await tester.pump();
        return;
      }
      await tester.drag(list, const Offset(0, -400));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }
    fail('Timed out scrolling to $finder');
  }

  group('the catalog', () {
    testWidgets('shows the first labels and authors, ten of each', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-creators')),
      );

      expect(find.byKey(const ValueKey('catalog-labels')), findsOneWidget);
      expect(find.text('Featured labels'), findsOneWidget);
      expect(find.text('Featured authors'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('catalog-creators-creator-1')),
        findsOneWidget,
      );
      expect(find.text('1 published series'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('catalog-labels-label-1')),
        findsOneWidget,
      );
      expect(catalog.creatorListRequests, [(limit: 10, token: '')]);
      expect(catalog.labelListRequests, [(limit: 10, token: '')]);
    });

    testWidgets('opens the author or the label behind a card', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-creators')),
      );

      await tester.tap(
        find.byKey(const ValueKey('catalog-creators-creator-1')),
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('creator-body')),
      );
      expect(router.state.uri.path, AppRoutes.creatorDetailPath('creator-1'));

      router.go(AppRoutes.catalog);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('catalog-labels')),
      );
      await tester.tap(find.byKey(const ValueKey('catalog-labels-label-1')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('label-body')),
      );
      expect(router.state.uri.path, AppRoutes.labelDetailPath('label-1'));
    });

    testWidgets('leads to the list of every author and of every label', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-creators')),
      );

      await tester.tap(find.byKey(const ValueKey('catalog-creators-all')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('creators-results')),
      );
      expect(router.state.uri.path, AppRoutes.creatorsPath);

      router.go(AppRoutes.catalog);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('catalog-labels')),
      );
      await tester.tap(find.byKey(const ValueKey('catalog-labels-all')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('labels-results')),
      );
      expect(router.state.uri.path, AppRoutes.labelsPath);
    });

    testWidgets('shows no row for a tenant with no label and no author', (
      tester,
    ) async {
      catalog
        ..creatorList = const []
        ..labelList = const [];
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(find.byKey(const ValueKey('catalog-creators')), findsNothing);
      expect(find.byKey(const ValueKey('catalog-labels')), findsNothing);
      expect(find.text('Featured authors'), findsNothing);
      expect(find.text('Featured labels'), findsNothing);
    });

    testWidgets('offers a retry where the authors could not be read', (
      tester,
    ) async {
      catalog.creatorListError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-creators-retry')),
      );
      expect(
        find.text('Could not show the featured authors. Try again.'),
        findsOneWidget,
      );
      // The label row beside it is untouched.
      expect(find.byKey(const ValueKey('catalog-labels')), findsOneWidget);

      catalog.creatorListError = null;
      await tester.tap(find.byKey(const ValueKey('catalog-creators-retry')));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('catalog-creators')),
      );
    });
  });

  group('the list of authors', () {
    testWidgets('pages through every author and opens one', (tester) async {
      await pumpApp(tester, location: AppRoutes.creatorsPath, size: phoneSize);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-tile-creator-1')),
      );
      expect(find.text('Authors'), findsOneWidget);

      final last = find.byKey(const ValueKey('creator-tile-creator-30'));
      await scrollTo(
        tester,
        find.byKey(const ValueKey('creators-results')),
        last,
      );
      expect(
        catalog.creatorListRequests.map((request) => request.token),
        containsAllInOrder(['', '20']),
      );
      expect(find.byKey(const ValueKey('creators-more-loading')), findsNothing);

      await tester.tap(last);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('creator-body')),
      );
      expect(router.state.uri.path, AppRoutes.creatorDetailPath('creator-30'));
    });

    testWidgets('offers a page the API could not answer again', (tester) async {
      catalog.directoryMoreError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpApp(tester, location: AppRoutes.creatorsPath, size: phoneSize);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-tile-creator-1')),
      );

      final retry = find.byKey(const ValueKey('creators-more-retry'));
      await scrollTo(
        tester,
        find.byKey(const ValueKey('creators-results')),
        retry,
      );
      // The rows that did arrive stay where the reader is.
      expect(
        find.byKey(const ValueKey('creator-tile-creator-20')),
        findsOneWidget,
      );

      catalog.directoryMoreError = null;
      await tester.tap(retry);
      await scrollTo(
        tester,
        find.byKey(const ValueKey('creators-results')),
        find.byKey(const ValueKey('creator-tile-creator-30')),
      );
    });

    testWidgets('says so when no author is credited on anything', (
      tester,
    ) async {
      catalog.creatorList = const [];
      await pumpApp(tester, location: AppRoutes.creatorsPath);

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creators-empty')),
      );
      expect(
        find.text('No authors are credited on a published series yet.'),
        findsOneWidget,
      );
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.creatorListError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.creatorsPath);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creators-retry')),
      );
      expect(
        find.text('Could not show the authors. Try again.'),
        findsOneWidget,
      );

      catalog.creatorListError = null;
      await tester.tap(find.byKey(const ValueKey('creators-retry')));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-tile-creator-1')),
      );
    });
  });

  group('the list of labels', () {
    testWidgets('pages through every label and opens one', (tester) async {
      await pumpApp(tester, location: AppRoutes.labelsPath, size: phoneSize);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('label-tile-label-1')),
      );
      expect(find.text('Labels'), findsOneWidget);

      final last = find.byKey(const ValueKey('label-tile-label-30'));
      await scrollTo(
        tester,
        find.byKey(const ValueKey('labels-results')),
        last,
      );
      expect(
        catalog.labelListRequests.map((request) => request.token),
        containsAllInOrder(['', '20']),
      );

      await tester.tap(last);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('label-body')),
      );
      expect(router.state.uri.path, AppRoutes.labelDetailPath('label-30'));
    });

    testWidgets('says so when the tenant has registered no label', (
      tester,
    ) async {
      catalog.labelList = const [];
      await pumpApp(tester, location: AppRoutes.labelsPath);

      await pumpUntilFound(tester, find.byKey(const ValueKey('labels-empty')));
      expect(find.text('No labels have been registered yet.'), findsOneWidget);
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.labelListError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, location: AppRoutes.labelsPath);
      await pumpUntilFound(tester, find.byKey(const ValueKey('labels-retry')));
      expect(
        find.text('Could not show the labels. Try again.'),
        findsOneWidget,
      );

      catalog.labelListError = null;
      await tester.tap(find.byKey(const ValueKey('labels-retry')));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('label-tile-label-1')),
      );
    });
  });
}
