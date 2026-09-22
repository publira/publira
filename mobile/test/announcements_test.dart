import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/announcements/announcement_board.dart';
import 'package:publira/announcements/announcement_failure.dart';
import 'package:publira/announcements/dismissed_announcement_store.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/announcement.dart';
import 'package:publira/router.dart';

import 'support/fake_announcement_repository.dart';
import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final now = DateTime.utc(2026, 9, 22, 12);

  /// What the board reads as the current time, which a test moves on.
  late DateTime clock;

  Announcement announcement(
    String id, {
    bool isRead = false,
    String linkUrl = '',
    DateTime? pinnedUntil,
  }) {
    return Announcement(
      id: id,
      title: 'Notice $id',
      body: 'Body of $id',
      linkUrl: linkUrl,
      isRead: isRead,
      createdAt: DateTime.utc(2026, 9, 20, 9),
      pinnedUntil: pinnedUntil,
    );
  }

  late GoRouter router;
  late FakeAnnouncementRepository repository;
  late MemoryDismissedAnnouncementStore dismissed;
  late List<Uri> launched;
  late bool launchSucceeds;

  setUp(() {
    repository = FakeAnnouncementRepository(
      announcements: [
        announcement('a-1', linkUrl: '/series/$seriesId'),
        announcement('a-2', linkUrl: 'https://elsewhere.example/news'),
        announcement('a-3', isRead: true),
      ],
      pinnedId: 'a-1',
    );
    dismissed = MemoryDismissedAnnouncementStore();
    launched = [];
    launchSucceeds = true;
    clock = now;
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
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: fakeAuthController(session: session),
        announcements: AnnouncementBoard(
          repository: repository,
          dismissed: dismissed,
          now: () => clock,
          launch: (url) async {
            launched.add(url);
            return launchSucceeds;
          },
        ),
        site: const PublicSite(host: 'shop.example'),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> openList(
    WidgetTester tester, {
    AuthSession? session = fakeSession,
  }) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.announcements,
      session: session,
    );
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('announcements-list')),
    );
  }

  Finder banner(String id) => find.byKey(ValueKey('pinned-announcement-$id'));
  Finder unreadDot(String id) =>
      find.byKey(ValueKey('announcement-unread-$id'));

  group('the pinned banner', () {
    testWidgets('shows a visitor the pinned announcement and opens it', (
      tester,
    ) async {
      await pumpApp(tester, session: null);
      await pumpUntilRouteSettled(tester, banner('a-1'));

      expect(find.text('Notice a-1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('pinned-announcement-open')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('announcement-a-1')),
      );

      expect(find.text('Body of a-1'), findsOneWidget);
      expect(router.state.uri.path, AppRoutes.announcementPath('a-1'));
      // A visitor has no read state to write.
      expect(repository.marked, isEmpty);
    });

    testWidgets('shows a signed-in reader the same banner', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, banner('a-1'));

      expect(find.text('Body of a-1'), findsOneWidget);
    });

    testWidgets('stays closed once dismissed, and the list keeps the entry', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilRouteSettled(tester, banner('a-1'));

      await tester.tap(
        find.byKey(const ValueKey('pinned-announcement-dismiss')),
      );
      await tester.pump();

      expect(banner('a-1'), findsNothing);
      expect(dismissed.announcementId, 'a-1');
      expect(repository.marked, isEmpty);

      await tester.tap(find.byKey(const ValueKey('catalog-announcements')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('announcements-list')),
      );
      expect(
        find.byKey(const ValueKey('announcement-row-a-1')),
        findsOneWidget,
      );
      expect(unreadDot('a-1'), findsOneWidget);
    });

    testWidgets('stays closed on the next launch', (tester) async {
      dismissed.announcementId = 'a-1';

      await pumpApp(tester);
      await pumpUntilTrue(tester, () => repository.pinnedReads > 0);
      await tester.pump();

      expect(banner('a-1'), findsNothing);
    });

    testWidgets('comes back for a newly pinned announcement', (tester) async {
      dismissed.announcementId = 'a-1';
      repository.pinnedId = 'a-2';

      await pumpApp(tester);

      await pumpUntilFound(tester, banner('a-2'));
    });

    testWidgets('is not drawn once its window has closed', (tester) async {
      repository.announcements = [
        announcement(
          'a-1',
          pinnedUntil: now.subtract(const Duration(hours: 1)),
        ),
      ];

      await pumpApp(tester);
      await pumpUntilTrue(tester, () => repository.pinnedReads > 0);
      await tester.pump();

      expect(banner('a-1'), findsNothing);
    });

    testWidgets('is drawn until its window closes on screen', (tester) async {
      repository.announcements = [
        announcement('a-1', pinnedUntil: now.add(const Duration(hours: 1))),
      ];

      await pumpApp(tester);
      await pumpUntilFound(tester, banner('a-1'));

      clock = now.add(const Duration(hours: 1));
      await tester.pump(const Duration(hours: 1));

      expect(banner('a-1'), findsNothing);
    });

    testWidgets('is not drawn when nothing is pinned', (tester) async {
      repository.pinnedId = null;

      await pumpApp(tester);
      await pumpUntilTrue(tester, () => repository.pinnedReads > 0);
      await tester.pump();

      expect(
        find.byKey(const ValueKey('pinned-announcement-open')),
        findsNothing,
      );
    });

    testWidgets('is not drawn when the pinned read fails', (tester) async {
      repository.pinnedFailure = const AnnouncementFailure(
        AnnouncementFailureKind.network,
      );

      await pumpApp(tester);
      await pumpUntilTrue(tester, () => repository.pinnedReads > 0);
      await tester.pump();

      expect(
        find.byKey(const ValueKey('pinned-announcement-open')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('catalog-announcements')),
        findsOneWidget,
      );
    });
  });

  group('the list', () {
    testWidgets('marks what a signed-in reader has not read', (tester) async {
      await openList(tester);

      expect(unreadDot('a-1'), findsOneWidget);
      expect(unreadDot('a-2'), findsOneWidget);
      expect(unreadDot('a-3'), findsNothing);
      expect(find.text('2 unread among those shown'), findsOneWidget);
    });

    testWidgets('marks one read', (tester) async {
      await openList(tester);

      await tester.tap(
        find.byKey(const ValueKey('announcement-mark-read-a-2')),
      );
      await pumpUntilTrue(tester, () => unreadDot('a-2').evaluate().isEmpty);

      expect(repository.marked, ['a-2']);
      expect(unreadDot('a-1'), findsOneWidget);
      expect(find.text('1 unread among those shown'), findsOneWidget);
    });

    testWidgets('marks everything read', (tester) async {
      await openList(tester);

      await tester.tap(
        find.byKey(const ValueKey('announcements-mark-all-read')),
      );
      await pumpUntilTrue(tester, () => unreadDot('a-1').evaluate().isEmpty);

      expect(repository.markAllCalls, 1);
      expect(unreadDot('a-2'), findsNothing);
      expect(repository.announcements.every((row) => row.isRead), isTrue);
    });

    testWidgets('says so when a mark fails, and keeps the row unread', (
      tester,
    ) async {
      repository.markFailure = const AnnouncementFailure(
        AnnouncementFailureKind.unexpected,
      );
      await openList(tester);

      await tester.tap(
        find.byKey(const ValueKey('announcement-mark-read-a-1')),
      );
      await pumpUntilFound(
        tester,
        find.text('Could not mark it as read. Please try again later.'),
      );

      expect(unreadDot('a-1'), findsOneWidget);
    });

    testWidgets('opens a row and marks it read on the way', (tester) async {
      await openList(tester);

      await tapVisible(
        tester,
        find.byKey(const ValueKey('announcement-row-a-1')),
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('announcement-a-1')),
      );

      expect(repository.marked, contains('a-1'));
      expect(repository.announcements.first.isRead, isTrue);
    });

    testWidgets('a mark landing while the list is read again stays marked', (
      tester,
    ) async {
      await openList(tester);
      final mark = repository.markGate = Completer<void>();
      await tester.tap(
        find.byKey(const ValueKey('announcement-mark-read-a-2')),
      );
      await tester.pump();

      // The page is taken while a-2 is still unread on the API.
      final page = repository.listGate = Completer<void>();
      await tester.fling(
        find.byKey(const ValueKey('announcements-list')),
        const Offset(0, 400),
        1000,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('announcements-loading')),
      );
      mark.complete();
      await tester.pump();

      expect(
        find.byKey(const ValueKey('announcements-loading')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('announcements-empty')), findsNothing);

      page.complete();
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('announcement-row-a-2')),
      );
      expect(unreadDot('a-2'), findsNothing);
      expect(unreadDot('a-1'), findsOneWidget);
    });

    testWidgets('marking everything read covers a page still in flight', (
      tester,
    ) async {
      repository
        ..announcements = [for (var i = 0; i < 25; i++) announcement('p-$i')]
        ..pageSize = 20;
      await openList(tester);

      final page = repository.listGate = Completer<void>();
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('announcement-row-p-19')),
        300,
      );
      await pumpUntilTrue(tester, () => repository.listTokens.length == 2);

      await tester.tap(
        find.byKey(const ValueKey('announcements-mark-all-read')),
      );
      await pumpUntilTrue(tester, () => repository.listTokens.length == 3);
      repository.listGate = null;
      page.complete();
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('announcement-row-p-24')),
        300,
      );

      expect(repository.listTokens, ['', '20', '20']);
      expect(unreadDot('p-24'), findsNothing);
      expect(unreadDot('p-0'), findsNothing);
    });

    testWidgets('shows a visitor the list without read state', (tester) async {
      await openList(tester, session: null);

      expect(
        find.byKey(const ValueKey('announcement-row-a-1')),
        findsOneWidget,
      );
      expect(unreadDot('a-1'), findsNothing);
      expect(
        find.byKey(const ValueKey('announcements-mark-all-read')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('announcements-unread-count')),
        findsNothing,
      );
    });

    testWidgets('reads the page under the last one', (tester) async {
      repository
        ..announcements = [
          for (var i = 0; i < 30; i++) announcement('p-$i', isRead: true),
        ]
        ..pageSize = 20;

      await openList(tester);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('announcement-row-p-29')),
        300,
      );

      expect(repository.listTokens, ['', '20']);
    });

    testWidgets('offers a retry when the list cannot be read', (tester) async {
      repository.listFailure = const AnnouncementFailure(
        AnnouncementFailureKind.network,
      );
      await pumpApp(tester, initialLocation: AppRoutes.announcements);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('announcements-retry')),
      );

      repository.listFailure = null;
      await tester.tap(find.byKey(const ValueKey('announcements-retry')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('announcements-list')),
      );
    });

    testWidgets('says so when there is nothing to show', (tester) async {
      repository.announcements = [];
      await pumpApp(tester, initialLocation: AppRoutes.announcements);

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('announcements-empty')),
      );
    });
  });

  group('an announcement', () {
    Future<void> openDetail(
      WidgetTester tester,
      String id, {
      AuthSession? session = fakeSession,
    }) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.announcementPath(id),
        session: session,
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(ValueKey('announcement-$id')),
      );
    }

    testWidgets('is marked read when a signed-in reader opens it', (
      tester,
    ) async {
      await openDetail(tester, 'a-2');
      await pumpUntilTrue(tester, () => repository.marked.contains('a-2'));

      expect(find.text('Body of a-2'), findsOneWidget);
    });

    testWidgets('is not marked again once read', (tester) async {
      await openDetail(tester, 'a-3');
      await tester.pump();

      expect(repository.marked, isEmpty);
    });

    testWidgets('opens a link to a screen of the app in the app', (
      tester,
    ) async {
      await openDetail(tester, 'a-1');

      await tester.tap(find.byKey(const ValueKey('announcement-open-link')));
      await tester.pump();

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
      expect(launched, isEmpty);
    });

    testWidgets('hands a link to another site to the browser', (tester) async {
      await openDetail(tester, 'a-2');

      await tester.tap(find.byKey(const ValueKey('announcement-open-link')));
      await tester.pump();

      expect(launched, [Uri.parse('https://elsewhere.example/news')]);
    });

    testWidgets('says so when nothing takes the link', (tester) async {
      launchSucceeds = false;
      await openDetail(tester, 'a-2');

      await tester.tap(find.byKey(const ValueKey('announcement-open-link')));
      await pumpUntilFound(tester, find.text('Could not open the link.'));
    });

    testWidgets('offers no link when the operator wrote none', (tester) async {
      await openDetail(tester, 'a-3');

      expect(
        find.byKey(const ValueKey('announcement-open-link')),
        findsNothing,
      );
    });

    testWidgets('says so when it no longer exists', (tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.announcementPath('gone'),
      );

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('announcement-not-found')),
      );
    });
  });

  testWidgets('the catalog leads to the announcements', (tester) async {
    await pumpApp(tester, session: null);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('catalog-announcements')),
    );

    await tester.tap(find.byKey(const ValueKey('catalog-announcements')));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('announcements-list')),
    );

    expect(router.state.uri.path, AppRoutes.announcements);
  });
}
