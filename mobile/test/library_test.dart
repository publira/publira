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

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpLibrary(
    WidgetTester tester, {
    AuthSession? session = fakeSession,
  }) async {
    router = createAppRouter(initialLocation: AppRoutes.library);
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
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('library-tab-continue')),
    );
  }

  Future<void> openSection(WidgetTester tester, String section) async {
    await tester.tap(find.byKey(ValueKey('library-tab-$section')));
    // The tab view slides the list in.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
  }

  /// [count] series the reader is in the middle of, each at its first episode.
  List<RecentSeriesItem> recentSeries(int count) => [
    for (var index = 0; index < count; index++)
      RecentSeriesItem(
        series: SeriesItem(
          id: 'recent-$index',
          title: 'Recent series $index',
          description: '',
        ),
        episode: EpisodeItem(
          id: 'recent-$index-ep-1',
          title: 'Recent series $index #1',
          orderIndex: 1,
          price: 0,
        ),
      ),
  ];

  group('a guest', () {
    testWidgets('is offered sign-in for what they read and follow', (
      tester,
    ) async {
      await pumpLibrary(tester, session: null);

      expect(
        find.byKey(const ValueKey('library-continue-signed-out')),
        findsOneWidget,
      );
      expect(catalog.recentSeriesLimits, isEmpty);

      await openSection(tester, 'follows');

      expect(find.byKey(const ValueKey('follows-signed-out')), findsOneWidget);
    });

    testWidgets('sees what the device keeps', (tester) async {
      await pumpLibrary(tester, session: null);

      await openSection(tester, 'downloads');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('downloads-usage')),
      );

      expect(find.byKey(const ValueKey('downloads-empty')), findsOneWidget);
    });

    testWidgets('signs in on the library tab', (tester) async {
      await pumpLibrary(tester, session: null);

      await tester.tap(find.byKey(const ValueKey('library-continue-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

      expect(router.state.uri.path, AppTab.library.locate(AppRoutes.signIn));
    });
  });

  group('continue reading', () {
    testWidgets('lists each series with the episode to continue from', (
      tester,
    ) async {
      catalog.recentSeries = fixtureRecentSeries();
      await pumpLibrary(tester);
      final row = find.byKey(
        ValueKey('library-continue-${fixtureSeries.first.id}'),
      );
      await pumpUntilFound(tester, row);

      expect(
        find.descendant(
          of: row,
          matching: find.text('${fixtureSeries.first.title} #1'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('reads the page under it as the reader nears the end', (
      tester,
    ) async {
      catalog.recentSeries = recentSeries(25);
      await pumpLibrary(tester);
      final list = find.byKey(const ValueKey('library-continue-list'));
      await pumpUntilFound(tester, list);

      await tester.fling(list, const Offset(0, -3000), 1000);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('library-continue-recent-24')),
      );

      expect(catalog.recentSeriesTokens, ['', '20']);
    });

    testWidgets('says so when the reader is in the middle of nothing', (
      tester,
    ) async {
      await pumpLibrary(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('library-continue-empty')),
      );
    });

    testWidgets('offers a retry when the list could not be read', (
      tester,
    ) async {
      catalog.recentSeriesError = const CatalogFailure(
        CatalogFailureKind.network,
      );
      await pumpLibrary(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('library-continue-error')),
      );

      catalog
        ..recentSeriesError = null
        ..recentSeries = fixtureRecentSeries();
      await tester.tap(find.byKey(const ValueKey('library-continue-retry')));
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('library-continue-${fixtureSeries.first.id}')),
      );
    });
  });
}
