import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';
import 'package:publira/push/push_repository.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_push.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePushMessaging messaging;
  late FakePushRepository repository;
  late InMemoryPushDeviceStore store;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    messaging = FakePushMessaging();
    repository = FakePushRepository();
    store = InMemoryPushDeviceStore();
    addTearDown(messaging.close);
  });

  PushController pushController() {
    final controller = PushController(
      messaging: messaging,
      repository: repository,
      store: store,
      platform: PushPlatform.android,
    );
    addTearDown(controller.dispose);
    return controller;
  }

  Future<PushController> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.catalog,
    bool signedIn = true,
  }) async {
    final push = pushController();
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: signedIn ? fakeSession : null),
        push: push,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    return push;
  }

  testWidgets('a restored session re-registers the device it was left on', (
    tester,
  ) async {
    // Restoring the session is what reports the sign-in that re-registers the
    // device, and both restores start at launch. A session that came back
    // first would report it while the controller still held no token, and the
    // device would stay registered to whoever signed in last.
    store.token = 'device-token';
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(),
        catalog: catalog,
        auth: fakeAuthController(storedSession: fakeSession),
        push: pushController(),
      ),
    );
    await tester.pumpAndSettle();

    expect(repository.registered, ['device-token']);
  });

  testWidgets('the account screen offers the notification switch', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.account);

    final switchTile = find.byKey(const ValueKey('account-notifications'));
    expect(switchTile, findsOneWidget);
    expect(tester.widget<SwitchListTile>(switchTile).value, isFalse);
    expect(find.text('New episode notifications'), findsOneWidget);
  });

  testWidgets('turning the switch on registers the device', (tester) async {
    await pumpApp(tester, initialLocation: AppRoutes.account);

    await tester.tap(find.byKey(const ValueKey('account-notifications')));
    await tester.pumpAndSettle();

    expect(repository.registered, ['device-token']);
    expect(
      tester
          .widget<SwitchListTile>(
            find.byKey(const ValueKey('account-notifications')),
          )
          .value,
      isTrue,
    );
  });

  testWidgets('a denied prompt settles the switch back to off', (tester) async {
    messaging.authorization = PushAuthorization.denied;
    await pumpApp(tester, initialLocation: AppRoutes.account);

    await tester.tap(find.byKey(const ValueKey('account-notifications')));
    await tester.pumpAndSettle();

    expect(repository.registered, isEmpty);
    expect(
      find.byKey(const ValueKey('account-notifications-failure')),
      findsOneWidget,
    );
    expect(
      find.text(
        'Notifications are turned off for this app. '
        'Turn them on in your device settings.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('signing out unregisters before the session goes away', (
    tester,
  ) async {
    store.token = 'device-token';
    await pumpApp(tester, initialLocation: AppRoutes.account);

    await tester.tap(find.byKey(const ValueKey('account-sign-out')));
    await tester.pumpAndSettle();

    expect(repository.unregistered, ['device-token']);
    expect(find.byKey(const ValueKey('account-sign-in')), findsOneWidget);
  });

  testWidgets('a build with no messaging service shows no switch', (
    tester,
  ) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: fakeSession),
        push: PushController(
          messaging: null,
          repository: repository,
          store: store,
          platform: PushPlatform.android,
        ),
      ),
    );
    router.go(AppRoutes.account);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('account-notifications')), findsNothing);
  });

  testWidgets('tapping a notification opens the episode it names', (
    tester,
  ) async {
    final push = await pumpApp(tester);

    messaging.openedController.add(
      PushMessage(
        title: 'Seed Series',
        body: 'Episode Three',
        data: {'route': AppRoutes.episodeViewerPath(seriesId, episodeId)},
      ),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeViewerPath(seriesId, episodeId),
    );
    expect(push.pendingRoute, isNull);
  });

  testWidgets('a notification naming no route opens the catalog', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.account);

    messaging.openedController.add(const PushMessage(title: 'Seed Series'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));
  });

  testWidgets('a message that arrives in the foreground is drawn by the app', (
    tester,
  ) async {
    await pumpApp(tester);

    messaging.foregroundController.add(
      PushMessage(
        title: 'Seed Series',
        body: 'Episode Three',
        data: {'route': AppRoutes.episodeViewerPath(seriesId, episodeId)},
      ),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('push-foreground-message')),
    );

    expect(find.text('Episode Three'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
  });
}
