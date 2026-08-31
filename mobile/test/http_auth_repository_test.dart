import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/config.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpAuthRepository auth;

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
    auth = HttpAuthRepository(
      config: AppConfig(apiBaseUrl: server.baseUrl, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  test('signIn returns the session the API issued', () async {
    final session = await auth.signIn(
      email: ConnectFixtureServer.memberEmail,
      password: ConnectFixtureServer.memberPassword,
    );

    expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
    expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
    expect(session.userName, ConnectFixtureServer.memberName);
    expect(session.expiresAt, isNotNull);
    expect(session.hasExpired(DateTime.now()), isFalse);
  });

  test('signIn maps rejected credentials to invalidCredentials', () async {
    expect(
      () => auth.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: 'wrong',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidCredentials,
        ),
      ),
    );
  });

  test('signIn maps an unreachable API to network', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();
    final offline = HttpAuthRepository(
      config: AppConfig(apiBaseUrl: closedBaseUrl, tenantHost: 'localhost'),
    );

    expect(
      () => offline.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: ConnectFixtureServer.memberPassword,
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.network,
        ),
      ),
    );
  });

  test('refresh confirms a stored token and re-reads its user', () async {
    const stored = AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: '',
      userName: '',
    );

    final refreshed = await auth.refresh(stored);

    expect(refreshed.accessToken, ConnectFixtureServer.memberAccessToken);
    expect(refreshed.userName, ConnectFixtureServer.memberName);
    expect(refreshed.userPublicId, ConnectFixtureServer.memberPublicId);
  });

  test('refresh maps a token the API rejects to sessionExpired', () async {
    server.activeAccessToken = 'another-token';
    const stored = AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: ConnectFixtureServer.memberPublicId,
      userName: ConnectFixtureServer.memberName,
    );

    expect(
      () => auth.refresh(stored),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.sessionExpired,
        ),
      ),
    );
  });
}
