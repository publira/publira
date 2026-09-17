import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A screen the height of a phone, so a page of series holds more rows than
/// fit and a test about paging has to scroll the way a reader does.
const phoneSize = Size(400, 900);

void main() {
  const creator = fixturePublishedCreator;
  const label = fixturePublishedLabel;

  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      publishedCreators: {creator.id: creator},
      publishedLabels: {label.id: label},
      detailSeries: {
        creator.id: [fixtureSeries.first],
        label.id: [fixtureSeries.first],
      },
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    required String location,
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

  Finder tileOf(String seriesId) =>
      find.byKey(ValueKey('series-tile-$seriesId'));

  group('the author screen', () {
    testWidgets('shows the author and the series credited to them', (
      tester,
    ) async {
      await pumpApp(tester, location: AppRoutes.creatorDetailPath(creator.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('creator-body')));

      expect(find.text(creator.name), findsWidgets);
      expect(find.text(creator.profileText), findsOneWidget);
      expect(find.text('1 published series'), findsOneWidget);
      expect(tileOf(fixtureSeries.first.id), findsOneWidget);
    });

    testWidgets('says so when the author has published no profile', (
      tester,
    ) async {
      catalog.publishedCreators = {
        creator.id: PublishedCreator(id: creator.id, name: creator.name),
      };
      await pumpApp(tester, location: AppRoutes.creatorDetailPath(creator.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('creator-body')));

      expect(
        find.byKey(const ValueKey('creator-profile-empty')),
        findsOneWidget,
      );
    });

    testWidgets('opens a series it lists', (tester) async {
      await pumpApp(tester, location: AppRoutes.creatorDetailPath(creator.id));
      await pumpUntilRouteSettled(tester, tileOf(fixtureSeries.first.id));

      await tester.tap(tileOf(fixtureSeries.first.id));
      await pumpUntilRouteSettled(tester, find.text('Episodes'));

      expect(
        router.state.uri.path,
        AppRoutes.seriesDetailPath(fixtureSeries.first.id),
      );
    });

    testWidgets('says so when the author credits nothing published', (
      tester,
    ) async {
      catalog.detailSeries = const {};
      await pumpApp(tester, location: AppRoutes.creatorDetailPath(creator.id));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-series-empty')),
      );
    });

    testWidgets('says so for an author the API does not know', (tester) async {
      await pumpApp(tester, location: AppRoutes.creatorDetailPath('missing'));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-not-found')),
      );
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.creatorDetailError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpApp(tester, location: AppRoutes.creatorDetailPath(creator.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('creator-retry')));

      catalog.creatorDetailError = null;
      await tester.tap(find.byKey(const ValueKey('creator-retry')));

      await pumpUntilFound(tester, find.byKey(const ValueKey('creator-body')));
    });

    testWidgets('pages the series as the reader reaches the end of them', (
      tester,
    ) async {
      catalog.detailSeries = {creator.id: fixtureCatalog(40)};
      catalog.detailSeriesPageSize = 10;
      await pumpApp(
        tester,
        location: AppRoutes.creatorDetailPath(creator.id),
        size: phoneSize,
      );
      await pumpUntilFound(tester, tileOf('catalog-series-1'));

      for (var drags = 0; drags < 40; drags++) {
        if (tileOf('catalog-series-12').evaluate().isNotEmpty) {
          break;
        }
        await tester.drag(
          find.byKey(const ValueKey('creator-body')),
          const Offset(0, -400),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(tileOf('catalog-series-12'), findsOneWidget);
      expect(
        catalog.detailRequests.map((request) => request.token),
        containsAllInOrder(['', '10']),
      );
    });

    testWidgets('is reached from a name in the credit line of a series', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
      );
      final credits = find.byKey(const ValueKey('series-creators'));
      await pumpUntilRouteSettled(tester, credits);

      await tester.tapOnText(
        find.textRange.ofSubstring(creator.name, descendentOf: credits),
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('creator-body')),
      );

      expect(router.state.uri.path, AppRoutes.creatorDetailPath(creator.id));
    });
  });

  group('the label screen', () {
    testWidgets('shows the label and its series', (tester) async {
      await pumpApp(tester, location: AppRoutes.labelDetailPath(label.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('label-body')));

      expect(find.text(label.name), findsWidgets);
      expect(find.text('1 published series'), findsOneWidget);
      expect(tileOf(fixtureSeries.first.id), findsOneWidget);
    });

    testWidgets('says so when the label publishes nothing now', (tester) async {
      catalog.detailSeries = const {};
      await pumpApp(tester, location: AppRoutes.labelDetailPath(label.id));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('label-series-empty')),
      );
    });

    testWidgets('says so for a label the API does not know', (tester) async {
      await pumpApp(tester, location: AppRoutes.labelDetailPath('missing'));

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('label-not-found')),
      );
    });

    testWidgets('offers a retry when the API could not answer', (tester) async {
      catalog.labelDetailError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpApp(tester, location: AppRoutes.labelDetailPath(label.id));
      await pumpUntilFound(tester, find.byKey(const ValueKey('label-retry')));

      catalog.labelDetailError = null;
      await tester.tap(find.byKey(const ValueKey('label-retry')));

      await pumpUntilFound(tester, find.byKey(const ValueKey('label-body')));
    });

    testWidgets('is reached from the label on the series screen', (
      tester,
    ) async {
      await pumpApp(
        tester,
        location: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
      );
      final labelButton = find.byKey(const ValueKey('series-label'));
      await pumpUntilRouteSettled(tester, labelButton);

      await tester.ensureVisible(labelButton);
      await tester.tap(labelButton);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('label-body')),
      );

      expect(router.state.uri.path, AppRoutes.labelDetailPath(label.id));
    });

    testWidgets('is reached from the label on a catalog row', (tester) async {
      await pumpApp(tester, location: AppRoutes.catalog);
      final labelButton = find.byKey(
        ValueKey('series-tile-label-${fixtureSeries.first.id}'),
      );
      await pumpUntilRouteSettled(tester, labelButton);

      await tester.ensureVisible(labelButton);
      await tester.tap(labelButton);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('label-body')),
      );

      expect(router.state.uri.path, AppRoutes.labelDetailPath(label.id));
    });
  });
}
