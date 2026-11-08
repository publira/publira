import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_message.dart';
import 'package:publira/push/push_messaging.dart';
import 'package:publira/push/push_repository.dart';

import 'support/fake_push.dart';

void main() {
  late FakePushMessaging messaging;
  late FakePushRepository repository;
  late InMemoryPushDeviceStore store;

  PushController controllerFor({String? stored}) {
    store = InMemoryPushDeviceStore(token: stored);
    final controller = PushController(
      messaging: messaging,
      repository: repository,
      store: store,
      platform: PushPlatform.android,
    );
    addTearDown(controller.dispose);
    return controller;
  }

  setUp(() {
    messaging = FakePushMessaging();
    repository = FakePushRepository();
    addTearDown(messaging.close);
  });

  test(
    'turning notifications on asks the device and registers the token',
    () async {
      final controller = controllerFor();
      await controller.start();

      await controller.setEnabled(true);

      expect(messaging.authorizationRequests, 1);
      expect(controller.enabled, isTrue);
      expect(controller.failure, isNull);
      expect(repository.registered, ['device-token']);
      expect(repository.lastPlatform, PushPlatform.android);
      expect(store.token, 'device-token');
    },
  );

  test('a denied prompt leaves the switch off and says so', () async {
    messaging.authorization = PushAuthorization.denied;
    final controller = controllerFor();
    await controller.start();

    await controller.setEnabled(true);

    expect(controller.enabled, isFalse);
    expect(controller.failure, PushFailure.denied);
    expect(repository.registered, isEmpty);
    expect(store.token, isNull);
  });

  test('an unreachable API leaves the switch off and says so', () async {
    repository.failure = Exception('unavailable');
    final controller = controllerFor();
    await controller.start();

    await controller.setEnabled(true);

    expect(controller.enabled, isFalse);
    expect(controller.failure, PushFailure.unavailable);
    expect(store.token, isNull);
  });

  test(
    'a credential store that refuses the write takes the registration back',
    () async {
      // The server would keep sending to a device whose switch comes back off on
      // the next launch, so the registration is rolled back rather than left.
      final controller = PushController(
        messaging: messaging,
        repository: repository,
        store: InMemoryPushDeviceStore(
          writeError: Exception('keystore refused'),
        ),
        platform: PushPlatform.android,
      );
      addTearDown(controller.dispose);
      await controller.start();

      await controller.setEnabled(true);

      expect(controller.enabled, isFalse);
      expect(controller.failure, PushFailure.unavailable);
      expect(repository.registered, ['device-token']);
      expect(repository.unregistered, ['device-token']);
      expect(messaging.deletedTokens, 1);
    },
  );

  test(
    'a credential store this launch cannot read leaves the switch off',
    () async {
      final controller = PushController(
        messaging: messaging,
        repository: repository,
        store: InMemoryPushDeviceStore(
          token: 'device-token',
          readError: Exception('keystore refused'),
        ),
        platform: PushPlatform.android,
      );
      addTearDown(controller.dispose);

      await controller.start();

      expect(controller.enabled, isFalse);
    },
  );

  test('turning notifications off unregisters and stops the token', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    await controller.setEnabled(false);

    expect(controller.enabled, isFalse);
    expect(repository.unregistered, ['device-token']);
    expect(messaging.deletedTokens, 1);
    expect(store.token, isNull);
  });

  test('an unregister the API never took still stops the token', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();
    repository.failure = Exception('unavailable');

    await controller.setEnabled(false);

    expect(controller.enabled, isFalse);
    expect(messaging.deletedTokens, 1);
    expect(store.token, isNull);
  });

  test('signing out takes the device off the delivery list', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    await controller.handleSignOut();

    expect(repository.unregistered, ['device-token']);
    expect(controller.enabled, isFalse);
    expect(messaging.deletedTokens, 1);
  });

  test('signing out with notifications off asks the API for nothing', () async {
    final controller = controllerFor();
    await controller.start();

    await controller.handleSignOut();

    expect(repository.unregistered, isEmpty);
    expect(messaging.deletedTokens, 0);
  });

  test('signing in registers the device the reader left on', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    await controller.handleSignedIn();

    expect(repository.registered, ['device-token']);
  });

  test('a refreshed token replaces the registered one', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    messaging.tokenRefreshController.add('next-token');
    await pumpEventQueue();

    expect(repository.registered, ['next-token']);
    expect(repository.unregistered, ['device-token']);
    expect(store.token, 'next-token');
    expect(controller.enabled, isTrue);
  });

  test(
    'signing in moves a stored token to the one the device answers now',
    () async {
      messaging.currentToken = 'installation-id';
      final controller = controllerFor(stored: 'registration-token');
      await controller.start();

      await controller.handleSignedIn();

      expect(repository.registered.last, 'installation-id');
      expect(repository.unregistered, ['registration-token']);
      expect(store.token, 'installation-id');
      expect(controller.enabled, isTrue);
    },
  );

  test(
    'a launch asks the API for nothing before the session is back',
    () async {
      messaging.currentToken = 'installation-id';
      final controller = controllerFor(stored: 'registration-token');
      await controller.start();
      await pumpEventQueue();

      expect(repository.registered, isEmpty);
      expect(repository.unregistered, isEmpty);
      expect(store.token, 'registration-token');
    },
  );

  test(
    'turning notifications off while a sign-in registers keeps them off',
    () async {
      messaging.currentToken = 'installation-id';
      final controller = controllerFor(stored: 'registration-token');
      await controller.start();
      final gate = repository.registerGate = Completer<void>();

      final signingIn = controller.handleSignedIn();
      await pumpEventQueue();
      final disabling = controller.setEnabled(false);
      await pumpEventQueue();
      gate.complete();
      await Future.wait([signingIn, disabling]);

      expect(controller.enabled, isFalse);
      expect(store.token, isNull);
      expect(
        repository.unregistered,
        containsAll(['registration-token', 'installation-id']),
      );
    },
  );

  test('a refreshed token is ignored while notifications are off', () async {
    final controller = controllerFor();
    await controller.start();

    messaging.tokenRefreshController.add('next-token');
    await pumpEventQueue();

    expect(repository.registered, isEmpty);
    expect(controller.enabled, isFalse);
  });

  test('a tapped notification reports the episode it names', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    messaging.openedController.add(
      const PushMessage(
        title: 'Seed Series',
        body: 'Episode Three',
        data: {'route': '/series/SERIES01/episodes/EPISODE01'},
      ),
    );
    await pumpEventQueue();

    expect(
      controller.acknowledgePendingRoute(),
      '/series/SERIES01/episodes/EPISODE01',
    );
    expect(controller.acknowledgePendingRoute(), isNull);
  });

  test('a tapped notification naming no route still reports the tap', () async {
    final controller = controllerFor(stored: 'device-token');
    await controller.start();

    messaging.openedController.add(const PushMessage(title: 'Seed Series'));
    await pumpEventQueue();

    expect(controller.acknowledgePendingRoute(), '');
  });

  test('the tap that launched a terminated app is reported once', () async {
    messaging.launchMessage = const PushMessage(
      title: 'Seed Series',
      data: {'route': '/series/SERIES01/episodes/EPISODE01'},
    );
    final controller = controllerFor(stored: 'device-token');

    await controller.start();

    expect(
      controller.acknowledgePendingRoute(),
      '/series/SERIES01/episodes/EPISODE01',
    );
  });

  test(
    'a message that arrives in the foreground is handed to the app',
    () async {
      final controller = controllerFor(stored: 'device-token');
      await controller.start();

      messaging.foregroundController.add(
        const PushMessage(title: 'Seed Series', body: 'Episode Three'),
      );
      await pumpEventQueue();

      expect(controller.acknowledgeForegroundMessage()?.body, 'Episode Three');
      expect(controller.acknowledgeForegroundMessage(), isNull);
    },
  );

  test('a build with no messaging service offers no switch', () async {
    final controller = PushController(
      messaging: null,
      repository: repository,
      store: InMemoryPushDeviceStore(),
      platform: PushPlatform.android,
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.setEnabled(true);

    expect(controller.supported, isFalse);
    expect(controller.enabled, isFalse);
    expect(repository.registered, isEmpty);
  });
}
