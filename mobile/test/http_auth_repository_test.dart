import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/reader_age.dart';
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

  const stored = AuthSession(
    accessToken: ConnectFixtureServer.memberAccessToken,
    userPublicId: ConnectFixtureServer.memberPublicId,
    userName: ConnectFixtureServer.memberName,
  );

  test('readReaderAge reports the date and the tenant rule', () async {
    server.memberBirthDate = '1990-04-02';

    final age = await auth.readReaderAge(stored);

    expect(age.birthDate, '1990-04-02');
    expect(age.timeZone, 'UTC');
    expect(age.verification, AgeVerification.checked);
  });

  test('readEmail reports the address the account holds', () async {
    expect(await auth.readEmail(stored), ConnectFixtureServer.memberEmail);
  });

  test('readReaderAge reports an account that holds none', () async {
    server.ageVerification = 'AGE_VERIFICATION_NONE';

    final age = await auth.readReaderAge(stored);

    expect(age.hasBirthDate, isFalse);
    expect(age.verification, AgeVerification.none);
  });

  test('recordBirthDate writes the date beside the name it holds', () async {
    final written = await auth.recordBirthDate(
      stored.withUser(userPublicId: stored.userPublicId, userName: 'Stale'),
      DateTime.utc(2001, 2, 3),
    );

    expect(written, '2001-02-03');
    expect(server.memberBirthDate, '2001-02-03');
    final request = server.requestsTo('UpdateMe').single;
    expect(request.body['name'], ConnectFixtureServer.memberName);
    expect(request.body['birthDate'], '2001-02-03');
  });

  test('recordBirthDate maps a date the API refuses to birthDateInvalid', () {
    final unreached = DateTime.now().toUtc().add(const Duration(days: 2));

    expect(
      () => auth.recordBirthDate(stored, unreached),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.birthDateInvalid,
        ),
      ),
    );
  });

  test('recordBirthDate maps a date already set to birthDateAlreadySet', () {
    server.memberBirthDate = '1990-04-02';

    expect(
      () => auth.recordBirthDate(stored, DateTime.utc(2001, 2, 3)),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.birthDateAlreadySet,
        ),
      ),
    );
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
