import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/config.dart';

import 'support/fake_auth.dart';

void main() {
  const config = AppConfig(
    baseUrl: AppConfig.defaultBaseUrl,
    tenantHost: AppConfig.defaultTenantHost,
  );

  test('a build given no session token keeps its session in the credential '
      'store', () {
    expect(sessionStoreFor(config), isA<SecureSessionStore>());
  });

  test('a build given a session token starts signed in as the reader GetMe '
      'names', () async {
    final repository = FakeAuthRepository();
    final controller = AuthController(
      repository: repository,
      store: sessionStoreFor(
        const AppConfig(
          baseUrl: AppConfig.defaultBaseUrl,
          tenantHost: AppConfig.defaultTenantHost,
          sessionToken: 'given-token',
        ),
      ),
    );

    await controller.restore();

    expect(controller.isSignedIn, isTrue);
    expect(controller.accessToken, 'given-token');
    expect(controller.session?.userPublicId, fakeSession.userPublicId);
    expect(controller.session?.userName, fakeSession.userName);
    expect(repository.refreshCount, 1);
  });

  test('a session held in memory is gone once the reader signs out', () async {
    final store = sessionStoreFor(
      const AppConfig(
        baseUrl: AppConfig.defaultBaseUrl,
        tenantHost: AppConfig.defaultTenantHost,
        sessionToken: 'given-token',
      ),
    );
    final controller = AuthController(
      repository: FakeAuthRepository(),
      store: store,
    );
    await controller.restore();

    await controller.signOut();

    expect(await store.read(), isNull);
  });
}
