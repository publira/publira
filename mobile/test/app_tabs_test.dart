import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/catalog_screen.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_comment_repository.dart';
import 'support/fake_follow_repository.dart';
import 'support/fake_notification_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// More series than one screen holds, so the catalog has somewhere to scroll.
final _longCatalog = [
  for (var index = 1; index <= 30; index++)
    SeriesItem(
      id: 'series-$index',
      title: 'Series number $index',
      description: 'The series in position $index.',
    ),
];

void main() {
  final series = fixtureSeries.first;
  final episodeId = '${series.id}-ep-1';

  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
      searchResults: fixtureSeries,
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.catalog,
    AuthSession? session = fakeSession,
  }) async {
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        comments: FakeCommentRepository(),
        follows: FakeFollowRepository(),
        notifications: NotificationInbox(
          repository: FakeNotificationRepository(),
        ),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> tapTab(WidgetTester tester, String tab, Finder arrives) async {
    await tester.tap(find.byKey(ValueKey('tab-$tab')));
    await pumpUntilRouteSettled(tester, arrives);
  }

  final tabBar = find.byKey(const ValueKey('tab-bar'));
  final seriesBody = find.byKey(const ValueKey('series-detail-body'));
  final pageView = find.byKey(const ValueKey('episode-page-view'));

  testWidgets('every tab is one tap away, and each keeps its own stack', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );
    await pumpUntilRouteSettled(tester, seriesBody);

    await tapTab(tester, 'search', find.byKey(const ValueKey('search-field')));
    expect(router.state.uri.path, AppRoutes.search);

    await tapTab(
      tester,
      'library',
      find.byKey(const ValueKey('library-tab-continue')),
    );
    expect(router.state.uri.path, AppRoutes.library);

    await tapTab(
      tester,
      'notifications',
      find.byKey(const ValueKey('notifications-empty')),
    );
    expect(router.state.uri.path, AppRoutes.notifications);

    await tapTab(tester, 'account', find.byKey(const ValueKey('account-name')));
    expect(router.state.uri.path, AppRoutes.account);

    // The series the home tab was left on is still on top of it.
    await tapTab(tester, 'home', seriesBody);
    expect(router.state.uri.path, AppRoutes.seriesDetailPath(series.id));
  });

  testWidgets('coming back to a tab finds it scrolled where it was left', (
    tester,
  ) async {
    catalog.series = _longCatalog;
    await pumpApp(tester);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('series-tile-series-1')),
    );
    ScrollPosition catalogScroll() => tester
        .state<ScrollableState>(
          find
              .descendant(
                of: find.byType(CatalogScreen, skipOffstage: false),
                matching: find.byType(Scrollable, skipOffstage: false),
              )
              .first,
        )
        .position;

    await tester.drag(
      find.byKey(const ValueKey('series-tile-series-1')),
      const Offset(0, -300),
    );
    await tester.pump();
    final scrolled = catalogScroll().pixels;
    expect(scrolled, greaterThan(0));

    await tapTab(tester, 'search', find.byKey(const ValueKey('search-field')));
    await tapTab(tester, 'home', find.byType(CatalogScreen));

    expect(catalogScroll().pixels, scrolled);
  });

  testWidgets('tapping the tab on screen takes it back to its root', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppTab.search.locate(
        AppRoutes.seriesDetailPath(series.id),
      ),
    );
    await pumpUntilRouteSettled(tester, seriesBody);

    await tapTab(tester, 'search', find.byKey(const ValueKey('search-field')));

    expect(router.state.uri.path, AppRoutes.search);
    expect(seriesBody, findsNothing);
  });

  testWidgets('a series opened on a tab stays on that tab', (tester) async {
    catalog.recentSeries = fixtureRecentSeries();
    await pumpApp(tester, initialLocation: AppRoutes.library);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(ValueKey('library-continue-${series.id}')),
    );

    await tester.tap(find.byKey(ValueKey('library-continue-${series.id}')));
    await pumpUntilRouteSettled(tester, pageView);

    expect(
      router.state.uri.path,
      AppTab.library.locate(AppRoutes.episodeViewerPath(series.id, episodeId)),
    );
  });

  testWidgets('the viewer hides the bar, and its comments bring it back', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.episodeViewerPath(series.id, episodeId),
    );
    await pumpUntilRouteSettled(tester, pageView);

    expect(tabBar, findsNothing);

    router.go(AppRoutes.episodeCommentsPath(series.id, episodeId));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-comments-empty')),
    );

    expect(tabBar, findsOneWidget);

    router.pop();
    await pumpUntilRouteSettled(tester, pageView);

    expect(tabBar, findsNothing);

    router.pop();
    await pumpUntilRouteSettled(tester, seriesBody);

    expect(tabBar, findsOneWidget);
  });

  test('every tab holds the catalog routes under its own root', () {
    final seriesPath = AppRoutes.seriesDetailPath(series.id);

    expect(AppTab.home.locate(seriesPath), seriesPath);
    expect(AppTab.search.locate(seriesPath), '/search$seriesPath');
    expect(AppTab.library.locate(AppRoutes.signIn), '/library/sign-in');
    expect(
      AppTab.notifications.locate(AppRoutes.announcements),
      '/notifications/announcements',
    );
    // What only one tab holds keeps its path wherever it is opened from.
    expect(AppTab.search.locate(AppRoutes.account), AppRoutes.account);
    expect(AppTab.library.locate(AppRoutes.catalog), AppRoutes.catalog);
  });
}
