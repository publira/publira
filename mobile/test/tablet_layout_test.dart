import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/catalog_screen.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_notification_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A phone held upright, below the breakpoint.
const phonePortrait = Size(400, 800);

/// The same phone on its side, which is past the breakpoint.
const phoneLandscape = Size(800, 400);

/// A tablet held upright and on its side.
const tabletPortrait = Size(800, 1280);
const tabletLandscape = Size(1280, 800);

/// More series than one screen holds, so the catalog has somewhere to scroll.
final _longCatalog = [
  for (var index = 1; index <= 120; index++)
    SeriesItem(
      id: 'series-$index',
      title: 'Series number $index',
      description: 'The series in position $index.',
    ),
];

void main() {
  final series = fixtureSeries.first;
  final seriesId = series.id;
  final episodeId = '$seriesId-ep-1';

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeNotificationRepository notifications;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
      searchResults: fixtureSeries,
    );
    notifications = FakeNotificationRepository(
      notifications: [
        for (final id in ['n-1', 'n-2'])
          InboxNotification(
            id: id,
            kind: InboxNotificationKind.episodePublished,
            payload: InboxNotificationPayload(
              seriesId: seriesId,
              episodeId: episodeId,
              seriesTitle: series.title,
              episodeTitle: 'Episode $id',
            ),
            isRead: false,
            createdAt: DateTime.utc(2026, 9, 8, 10, 30),
          ),
      ],
    );
  });

  void resize(WidgetTester tester, Size size) {
    tester.view
      ..physicalSize = size
      ..devicePixelRatio = 1;
  }

  Future<void> pumpApp(
    WidgetTester tester, {
    required Size size,
    String initialLocation = AppRoutes.catalog,
    AuthSession? session = fakeSession,
  }) async {
    resize(tester, size);
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        notifications: NotificationInbox(repository: notifications),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Turns the device to [size] and lets the screens lay themselves out again.
  Future<void> turn(WidgetTester tester, Size size) async {
    resize(tester, size);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  final rail = find.byType(NavigationRail);
  final bar = find.byType(NavigationBar);
  final seriesBody = find.byKey(const ValueKey('series-detail-body'));

  Finder tile(String id) => find.byKey(ValueKey('series-tile-$id'));

  Finder title(String id) => find.descendant(
    of: tile(id),
    matching: find.text(fixtureSeries.firstWhere((s) => s.id == id).title),
  );

  Finder label(String id) => find.byKey(ValueKey('series-tile-label-$id'));

  ScrollPosition catalogScroll(WidgetTester tester) => tester
      .state<ScrollableState>(
        find
            .descendant(
              of: find.byType(CatalogScreen),
              matching: find.byType(Scrollable),
            )
            .first,
      )
      .position;

  /// Whether [finder] stands inside the window, rather than merely built in
  /// the cache past its edge.
  bool onScreen(WidgetTester tester, Finder finder) {
    final window = Offset.zero & tester.view.physicalSize;
    return window.contains(tester.getCenter(finder));
  }

  /// The series tile across the middle of the window, which is the one the
  /// reader is looking at.
  Key tileAtMiddle(WidgetTester tester) {
    final middle = (Offset.zero & tester.view.physicalSize).center;
    final tiles = find.byWidgetPredicate(
      (widget) =>
          widget.key is ValueKey<String> &&
          (widget.key! as ValueKey<String>).value.startsWith('series-tile-'),
    );
    return tiles
        .evaluate()
        .map((element) => element.widget.key!)
        .firstWhere((key) => tester.getRect(find.byKey(key)).contains(middle));
  }

  group('a phone', () {
    testWidgets('keeps the bar along its foot and one series to a row', (
      tester,
    ) async {
      await pumpApp(tester, size: phonePortrait);
      await pumpUntilFound(tester, tile(fixtureSeries[1].id));

      expect(bar, findsOneWidget);
      expect(rail, findsNothing);
      expect(
        tester.getTopLeft(tile(fixtureSeries[1].id)).dy,
        greaterThan(tester.getBottomLeft(tile(fixtureSeries.first.id)).dy - 1),
      );
      // A phone's row has room for the label at its end.
      expect(
        tester.getTopLeft(label(seriesId)).dx,
        greaterThan(tester.getTopRight(title(seriesId)).dx),
      );
    });
  });

  group('a tablet', () {
    testWidgets('switches tabs from a rail down its side', (tester) async {
      await pumpApp(tester, size: tabletPortrait);
      await pumpUntilFound(tester, tile(seriesId));

      expect(rail, findsOneWidget);
      expect(bar, findsNothing);
      // A tablet has the height for every destination, so the screen's own
      // list is the one vertical scroll view.
      expect(
        find.descendant(of: rail, matching: find.byType(Scrollable)),
        findsNothing,
      );
      // The rail stands along the leading edge, and the tabs beside it.
      expect(tester.getTopLeft(rail).dx, 0);
      expect(
        tester.getTopLeft(find.byType(CatalogScreen)).dx,
        tester.getTopRight(rail).dx,
      );

      // The unread count rides on the notifications destination, as it does
      // on the bar.
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('tab-notifications-unread')),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('tab-search')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('search-field')),
      );
      expect(router.state.uri.path, AppRoutes.search);

      await tester.tap(find.byKey(const ValueKey('tab-notifications')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-list')),
      );
      expect(router.state.uri.path, AppRoutes.notifications);

      await tester.tap(find.byKey(const ValueKey('tab-home')));
      await pumpUntilRouteSettled(tester, tile(seriesId));
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('hides the rail under the viewer, as the bar is hidden', (
      tester,
    ) async {
      await pumpApp(
        tester,
        size: tabletPortrait,
        initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('episode-page-view')),
      );

      expect(rail, findsNothing);
      expect(bar, findsNothing);
    });

    testWidgets('lists the catalog two series to a row', (tester) async {
      await pumpApp(tester, size: tabletPortrait);
      await pumpUntilFound(tester, tile(fixtureSeries[1].id));

      final first = tester.getRect(tile(fixtureSeries.first.id));
      final second = tester.getRect(tile(fixtureSeries[1].id));
      expect(second.top, first.top);
      expect(second.left, greaterThan(first.right - 1));
      // The two columns share the room beside the rail evenly.
      final body = tester.getRect(find.byType(CatalogScreen));
      expect(first.width, closeTo(body.width / 2, 1));
      expect(second.width, closeTo(body.width / 2, 1));
      // A column narrower than a phone's row leaves the title the width of
      // the row and puts the label under it.
      expect(
        tester.getTopLeft(label(seriesId)).dy,
        greaterThan(tester.getBottomLeft(title(seriesId)).dy),
      );
      expect(
        tester.getTopLeft(label(seriesId)).dx,
        closeTo(tester.getTopLeft(title(seriesId)).dx, 1),
      );
    });

    testWidgets('lists search results two series to a row', (tester) async {
      await pumpApp(
        tester,
        size: tabletPortrait,
        initialLocation: AppRoutes.search,
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('search-field')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('search-field')),
        'Seed',
      );
      await pumpUntilFound(tester, tile(fixtureSeries[1].id));

      expect(
        tester.getTopLeft(tile(fixtureSeries[1].id)).dy,
        tester.getTopLeft(tile(fixtureSeries.first.id)).dy,
      );
    });

    testWidgets('draws a form no wider than a readable line, centred', (
      tester,
    ) async {
      await pumpApp(
        tester,
        size: tabletLandscape,
        initialLocation: AppRoutes.signIn,
        session: null,
      );
      final email = find.byKey(const ValueKey('sign-in-email'));
      await pumpUntilRouteSettled(tester, email);

      final field = tester.getRect(email);
      final body = tester.getRect(
        find.ancestor(of: email, matching: find.byType(Scaffold)).first,
      );
      expect(field.width, readableWidth);
      expect(field.center.dx, closeTo(body.center.dx, 1));
    });

    testWidgets('keeps the catalog where it was scrolled once it is turned', (
      tester,
    ) async {
      catalog.series = _longCatalog;
      await pumpApp(tester, size: tabletPortrait);
      await pumpUntilFound(tester, tile('series-1'));

      catalogScroll(tester).jumpTo(1200);
      await tester.pump();
      final scrolled = catalogScroll(tester).pixels;
      final looking = find.byKey(tileAtMiddle(tester));
      expect(onScreen(tester, looking), isTrue);
      await turn(tester, tabletLandscape);
      expect(catalogScroll(tester).pixels, scrolled);
      expect(onScreen(tester, looking), isTrue);

      await turn(tester, tabletPortrait);
      expect(catalogScroll(tester).pixels, scrolled);
      expect(onScreen(tester, looking), isTrue);
    });

    testWidgets('keeps the reader on its page once it is turned', (
      tester,
    ) async {
      catalog.episodes = fixtureEpisodes(pageCount: 5);
      await pumpApp(
        tester,
        size: tabletPortrait,
        initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
      );
      final next = find.byKey(const ValueKey('episode-next-page'));
      await pumpUntilFound(tester, find.text('1 / 5'));
      for (final counter in ['2 / 5', '3 / 5']) {
        await tester.tap(next);
        await pumpUntilFound(tester, find.text(counter));
        await pumpUntilNoPendingFrameCallbacks(tester);
      }

      // On its side the tablet pairs the pages, and the third shares its
      // screen with the second.
      await turn(tester, tabletLandscape);
      await pumpUntilFound(tester, find.text('2–3 / 5'));

      await turn(tester, tabletPortrait);
      await pumpUntilFound(tester, find.text('3 / 5'));
      await pumpUntilNoPendingFrameCallbacks(tester);
    });
  });

  testWidgets(
    'a window crossing the breakpoint keeps every tab where it was left',
    (tester) async {
      catalog.series = _longCatalog;
      await pumpApp(tester, size: phonePortrait);
      await pumpUntilFound(tester, tile('series-1'));
      await tester.drag(tile('series-1'), const Offset(0, -300));
      await tester.pump();
      final scrolled = catalogScroll(tester).pixels;

      // A series opened on the search tab is still on top of it once the
      // phone is turned and the bar gives way to the rail.
      await tester.tap(find.byKey(const ValueKey('tab-search')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('search-field')),
      );
      router.go(AppTab.search.locate(AppRoutes.seriesDetailPath(seriesId)));
      await pumpUntilRouteSettled(tester, seriesBody);

      await turn(tester, phoneLandscape);
      expect(rail, findsOneWidget);
      expect(bar, findsNothing);
      // A phone on its side is too short to promise every destination room.
      expect(
        find.descendant(of: rail, matching: find.byType(Scrollable)),
        findsOneWidget,
      );
      expect(seriesBody, findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('tab-home')));
      await pumpUntilRouteSettled(tester, find.byType(CatalogScreen));
      expect(catalogScroll(tester).pixels, scrolled);

      await turn(tester, phonePortrait);
      expect(bar, findsOneWidget);
      expect(catalogScroll(tester).pixels, scrolled);
    },
  );
}
