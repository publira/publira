import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/notifications/notification_failure.dart';
import 'package:publira/notifications/notification_inbox.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_repository.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_notification_repository.dart';
import 'support/fake_push.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';

  InboxNotification episodePublished(String id, {bool isRead = false}) {
    return InboxNotification(
      id: id,
      kind: InboxNotificationKind.episodePublished,
      payload: InboxNotificationPayload(
        seriesId: seriesId,
        episodeId: episodeId,
        seriesTitle: 'Seed Series 001',
        episodeTitle: 'Episode $id',
      ),
      isRead: isRead,
      createdAt: DateTime.utc(2026, 9, 8, 10, 30),
    );
  }

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeNotificationRepository repository;
  late NotificationInbox inbox;
  late AuthController auth;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    repository = FakeNotificationRepository(
      notifications: [
        episodePublished('n-1'),
        episodePublished('n-2'),
        episodePublished('n-3', isRead: true),
      ],
    );
    inbox = NotificationInbox(repository: repository);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.catalog,
    AuthSession? session = fakeSession,
    FakeAuthRepository? authRepository,
    PushController? push,
  }) async {
    router = createAppRouter(initialLocation: initialLocation);
    auth = fakeAuthController(session: session, repository: authRepository);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: auth,
        notifications: inbox,
        push: push,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> openInbox(
    WidgetTester tester, {
    AuthSession? session,
    FakeAuthRepository? authRepository,
  }) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.notifications,
      session: session ?? fakeSession,
      authRepository: authRepository,
    );
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('notifications-list')),
    );
  }

  Finder unreadDot(String id) =>
      find.byKey(ValueKey('notification-unread-$id'));

  /// The badge the notifications tab carries.
  Badge tabBadge(WidgetTester tester) => tester.widget<Badge>(
    find.byKey(const ValueKey('tab-notifications-unread')),
  );

  group('the notifications tab', () {
    testWidgets('is badged with the unread count', (tester) async {
      await pumpApp(tester);

      expect(tabBadge(tester).isLabelVisible, isTrue);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('tab-notifications-unread')),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
      expect(find.byTooltip('Notifications, 2 unread'), findsOneWidget);
    });

    testWidgets('carries no badge for a guest', (tester) async {
      await pumpApp(tester, session: null);

      expect(tabBadge(tester).isLabelVisible, isFalse);
      expect(repository.countReads, 0);
    });

    testWidgets('opens the inbox', (tester) async {
      await pumpApp(tester);

      await tester.tap(find.byKey(const ValueKey('tab-notifications')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-list')),
      );

      expect(router.state.uri.path, AppRoutes.notifications);
    });

    testWidgets('follows the count down as notifications are read', (
      tester,
    ) async {
      await openInbox(tester);

      await tester.tap(
        find.byKey(const ValueKey('notification-mark-read-n-1')),
      );
      await tester.pump();
      await tester.pump();

      expect(
        find.descendant(
          of: find.byKey(const ValueKey('tab-notifications-unread')),
          matching: find.text('1'),
        ),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const ValueKey('notifications-mark-all-read')),
      );
      await tester.pump();
      await tester.pump();

      expect(tabBadge(tester).isLabelVisible, isFalse);
    });

    testWidgets('drops the count when the reader signs out', (tester) async {
      await pumpApp(tester);
      expect(inbox.unreadCount, 2);

      await auth.signOut();
      await tester.pump();

      expect(inbox.unreadCount, 0);
      expect(tabBadge(tester).isLabelVisible, isFalse);
    });

    testWidgets('reads the count again when a push arrives in front', (
      tester,
    ) async {
      final messaging = FakePushMessaging();
      addTearDown(messaging.close);
      final push = PushController(
        messaging: messaging,
        repository: FakePushRepository(),
        store: InMemoryPushDeviceStore(),
        platform: PushPlatform.android,
      );
      addTearDown(push.dispose);
      await pumpApp(tester, push: push);
      expect(inbox.unreadCount, 2);

      repository.notifications = [
        episodePublished('n-4'),
        ...repository.notifications,
      ];
      messaging.foregroundController.add(
        const PushMessage(title: 'Seed Series 001', body: 'Episode n-4'),
      );
      await tester.pump();
      await tester.pump();

      expect(inbox.unreadCount, 3);
    });
  });

  group('the inbox', () {
    testWidgets('lists every notification with the unread ones marked', (
      tester,
    ) async {
      await openInbox(tester);

      expect(find.text('A new episode has been published'), findsNWidgets(3));
      expect(
        find.textContaining(
          '“Episode n-1” (Seed Series 001) is now available.',
        ),
        findsOneWidget,
      );
      expect(unreadDot('n-1'), findsOneWidget);
      expect(unreadDot('n-2'), findsOneWidget);
      expect(unreadDot('n-3'), findsNothing);
    });

    testWidgets('reads the pages under the first as the reader scrolls', (
      tester,
    ) async {
      repository
        ..notifications = [
          for (var index = 1; index <= 30; index++)
            episodePublished('n-$index', isRead: index > 25),
        ]
        ..pageSize = 10;
      await openInbox(tester);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('notification-n-30')),
        300,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('notifications-list')),
          matching: find.byType(Scrollable),
        ),
      );

      expect(repository.listTokens, ['', '10', '20']);
      expect(inbox.unreadCount, 25);
    });

    testWidgets('marks one notification read and reads the count back', (
      tester,
    ) async {
      await openInbox(tester);
      final countReads = repository.countReads;

      await tester.tap(
        find.byKey(const ValueKey('notification-mark-read-n-1')),
      );
      await tester.pump();
      await tester.pump();

      expect(repository.marked, ['n-1']);
      expect(unreadDot('n-1'), findsNothing);
      expect(unreadDot('n-2'), findsOneWidget);
      expect(repository.countReads, greaterThan(countReads));
      expect(inbox.unreadCount, 1);
    });

    testWidgets('marks everything read', (tester) async {
      await openInbox(tester);

      await tester.tap(
        find.byKey(const ValueKey('notifications-mark-all-read')),
      );
      await tester.pump();
      await tester.pump();

      expect(repository.markAllCalls, 1);
      expect(unreadDot('n-1'), findsNothing);
      expect(unreadDot('n-2'), findsNothing);
      expect(inbox.unreadCount, 0);
      final button = tester.widget<IconButton>(
        find.byKey(const ValueKey('notifications-mark-all-read')),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('keeps the row unread when the mark fails', (tester) async {
      await openInbox(tester);
      repository.markFailure = const NotificationFailure(
        NotificationFailureKind.network,
      );

      await tester.tap(
        find.byKey(const ValueKey('notification-mark-read-n-1')),
      );
      await tester.pump();
      await tester.pump();

      expect(unreadDot('n-1'), findsOneWidget);
      expect(inbox.unreadCount, 2);
      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOneWidget,
      );
    });

    group('leaves the next reader alone when a mark answers late', () {
      const nextReader = AuthSession(
        accessToken: 'next-access-token',
        userPublicId: 'SeedMMBRBBB2',
        userName: 'Next Member',
      );

      /// Opens the inbox, starts [mark] and holds it, and signs the next
      /// reader in before letting it answer.
      Future<void> switchReaderDuring(WidgetTester tester, Finder mark) async {
        await openInbox(
          tester,
          authRepository: FakeAuthRepository(session: nextReader),
        );
        final gate = Completer<void>();
        repository.markGate = gate;

        await tester.tap(mark);
        await tester.pump();
        await auth.signIn(email: 'next@example.com', password: 'password');
        await pumpUntilFound(tester, unreadDot('n-1'));

        gate.complete();
        await tester.pump();
        await tester.pump();
      }

      testWidgets('marking one', (tester) async {
        await switchReaderDuring(
          tester,
          find.byKey(const ValueKey('notification-mark-read-n-1')),
        );

        expect(unreadDot('n-1'), findsOneWidget);
      });

      testWidgets('marking all', (tester) async {
        await switchReaderDuring(
          tester,
          find.byKey(const ValueKey('notifications-mark-all-read')),
        );

        expect(unreadDot('n-1'), findsOneWidget);
        expect(unreadDot('n-2'), findsOneWidget);
        final button = tester.widget<IconButton>(
          find.byKey(const ValueKey('notifications-mark-all-read')),
        );
        expect(button.onPressed, isNotNull);
      });
    });

    testWidgets('opens the episode a row is about and marks it read', (
      tester,
    ) async {
      await openInbox(tester);

      await tester.tap(find.byKey(const ValueKey('notification-n-1')));
      await tester.pump();
      await tester.pump();

      expect(
        router.state.uri.path,
        AppTab.notifications.locate(
          AppRoutes.episodeViewerPath(seriesId, episodeId),
        ),
      );
      expect(repository.marked, ['n-1']);
      expect(inbox.unreadCount, 1);
    });

    testWidgets('sends a row naming nothing it can open to the catalog', (
      tester,
    ) async {
      repository.notifications = [
        InboxNotification(
          id: 'n-bad',
          kind: InboxNotificationKind.episodePublished,
          payload: InboxNotificationPayload.parse('{"series_id":"../../x"}'),
        ),
      ];
      await openInbox(tester);

      await tester.tap(find.byKey(const ValueKey('notification-n-bad')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(router.state.uri.path, AppRoutes.catalog);
      expect(repository.marked, ['n-bad']);
    });

    testWidgets('says so when the reader has no notifications', (tester) async {
      repository.notifications = [];
      await pumpApp(tester, initialLocation: AppRoutes.notifications);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-empty')),
      );
    });

    testWidgets('offers a retry when the API cannot be reached', (
      tester,
    ) async {
      repository.listFailure = const NotificationFailure(
        NotificationFailureKind.network,
      );
      await pumpApp(tester, initialLocation: AppRoutes.notifications);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-error')),
      );

      repository.listFailure = null;
      await tester.tap(find.byKey(const ValueKey('notifications-retry')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('notifications-list')),
      );
    });

    testWidgets('sends a reader whose session was refused to sign in', (
      tester,
    ) async {
      repository.listFailure = const NotificationFailure(
        NotificationFailureKind.sessionExpired,
      );
      await pumpApp(tester, initialLocation: AppRoutes.notifications);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-error')),
      );

      expect(find.byKey(const ValueKey('notifications-retry')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('notifications-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));
      expect(
        router.state.uri.path,
        AppTab.notifications.locate(AppRoutes.signIn),
      );
    });

    testWidgets('gives the whole screen to a session refused on a later page', (
      tester,
    ) async {
      repository
        ..notifications = [
          for (var index = 1; index <= 30; index++)
            episodePublished('n-$index'),
        ]
        ..pageSize = 10
        ..moreFailure = const NotificationFailure(
          NotificationFailureKind.sessionExpired,
        );
      await pumpApp(tester, initialLocation: AppRoutes.notifications);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-error')),
      );

      expect(repository.listTokens, ['', '10']);
      expect(find.byKey(const ValueKey('notifications-list')), findsNothing);
      expect(find.byKey(const ValueKey('notifications-sign-in')), findsOne);
    });

    testWidgets('asks a guest to sign in', (tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.notifications,
        session: null,
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('notifications-signed-out')),
      );

      expect(repository.listTokens, isEmpty);
      await tester.tap(find.byKey(const ValueKey('notifications-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));
      expect(
        router.state.uri.path,
        AppTab.notifications.locate(AppRoutes.signIn),
      );
    });
  });
}
