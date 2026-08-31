import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';

import 'support/fake_auth.dart';

void main() {
  late FakeAuthRepository repository;
  late InMemorySessionStore store;

  AuthController controllerFor({AuthSession? stored}) {
    store = InMemorySessionStore(session: stored);
    return AuthController(repository: repository, store: store);
  }

  setUp(() {
    repository = FakeAuthRepository();
  });

  test('signIn keeps the issued session and its access token', () async {
    final controller = controllerFor();

    await controller.signIn(
      email: 'member@example.com',
      password: 'memberpass',
    );

    expect(controller.isSignedIn, isTrue);
    expect(controller.accessToken, fakeSession.accessToken);
    expect(controller.session?.userName, fakeSession.userName);
    expect(store.session?.accessToken, fakeSession.accessToken);
    expect(repository.lastEmail, 'member@example.com');
    expect(repository.lastPassword, 'memberpass');
  });

  test('a rejected sign-in leaves the reader signed out', () async {
    repository.signInFailure = const AuthFailure(
      AuthFailureKind.invalidCredentials,
    );
    final controller = controllerFor();

    await expectLater(
      controller.signIn(email: 'member@example.com', password: 'wrong'),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidCredentials,
        ),
      ),
    );
    expect(controller.isSignedIn, isFalse);
    expect(store.session, isNull);
  });

  test('signOut drops the stored session', () async {
    final controller = controllerFor();
    await controller.signIn(
      email: 'member@example.com',
      password: 'memberpass',
    );

    await controller.signOut();

    expect(controller.isSignedIn, isFalse);
    expect(controller.accessToken, isEmpty);
    expect(store.session, isNull);
  });

  test('restore brings back a stored session the API still accepts', () async {
    final controller = controllerFor(stored: fakeSession);

    await controller.restore();

    expect(controller.isSignedIn, isTrue);
    expect(controller.accessToken, fakeSession.accessToken);
    expect(repository.refreshCount, 1);
    expect(controller.expired, isFalse);
  });

  test('restore drops a session the API no longer accepts', () async {
    repository.refreshFailure = const AuthFailure(
      AuthFailureKind.sessionExpired,
    );
    final controller = controllerFor(stored: fakeSession);

    await controller.restore();

    expect(controller.isSignedIn, isFalse);
    expect(store.session, isNull);
    expect(controller.acknowledgeExpiry(), isTrue);
    expect(controller.acknowledgeExpiry(), isFalse);
  });

  test('restore keeps a stored session when the API is unreachable', () async {
    repository.refreshFailure = const AuthFailure(AuthFailureKind.network);
    final controller = controllerFor(stored: fakeSession);

    await controller.restore();

    expect(controller.isSignedIn, isTrue);
    expect(store.session?.accessToken, fakeSession.accessToken);
    expect(controller.expired, isFalse);
  });

  test('a sign-out during restore is not undone by the check', () async {
    repository.refreshGate = Completer<void>();
    final controller = controllerFor(stored: fakeSession);
    final restoring = controller.restore();
    await pumpEventQueue();
    expect(controller.isSignedIn, isTrue);

    // The reader signs out while `GetMe` is still in flight, so its answer is
    // older than what they have just said.
    await controller.signOut();
    repository.refreshGate!.complete();
    await restoring;

    expect(controller.isSignedIn, isFalse);
    expect(controller.accessToken, isEmpty);
    expect(store.session, isNull);
  });

  test('a sign-in during restore survives a rejected stored token', () async {
    repository
      ..refreshGate = Completer<void>()
      ..refreshFailure = const AuthFailure(AuthFailureKind.sessionExpired);
    final controller = controllerFor(stored: fakeSession);
    final restoring = controller.restore();
    await pumpEventQueue();

    await controller.signIn(
      email: 'member@example.com',
      password: 'memberpass',
    );
    repository.refreshGate!.complete();
    await restoring;

    expect(controller.isSignedIn, isTrue);
    expect(controller.accessToken, fakeSession.accessToken);
    expect(store.session?.accessToken, fakeSession.accessToken);
    expect(controller.expired, isFalse);
  });

  test('restore drops a token that has already expired', () async {
    final controller = controllerFor(
      stored: AuthSession(
        accessToken: fakeSession.accessToken,
        userPublicId: fakeSession.userPublicId,
        userName: fakeSession.userName,
        expiresAt: DateTime.now().toUtc().subtract(const Duration(minutes: 1)),
      ),
    );

    await controller.restore();

    expect(controller.isSignedIn, isFalse);
    expect(store.session, isNull);
    expect(repository.refreshCount, 0);
    expect(controller.acknowledgeExpiry(), isTrue);
  });
}
