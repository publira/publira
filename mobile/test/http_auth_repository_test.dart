import 'dart:io';

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

  test('signUp sends what the form collected', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
      birthDate: '1998-07-06',
    );

    final request = server.requestsTo('CreateUser').single;
    expect(request.body['name'], 'New Reader');
    expect(request.body['email'], 'new@example.com');
    expect(request.body['password'], 'newpassword');
    expect(request.body['birthDate'], '1998-07-06');
  });

  test('signUp leaves out a birth date the form did not ask for', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
    );

    expect(
      server.requestsTo('CreateUser').single.body.containsKey('birthDate'),
      isFalse,
    );
  });

  test('signUp maps a refused address to invalidInput', () async {
    server.signupStatus = HttpStatus.badRequest;
    server.signupErrorCode = 'invalid_argument';

    await expectLater(
      auth.signUp(
        name: 'New Reader',
        email: 'not-an-address',
        password: 'newpassword',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidInput,
        ),
      ),
    );
  });

  test('signUp maps a spent mail allowance to rateLimited', () async {
    server.signupStatus = HttpStatus.tooManyRequests;
    server.signupErrorCode = 'resource_exhausted';

    await expectLater(
      auth.signUp(
        name: 'New Reader',
        email: 'new@example.com',
        password: 'newpassword',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('verifyEmail confirms the address a sign-up left unconfirmed', () async {
    await auth.signUp(
      name: 'New Reader',
      email: 'new@example.com',
      password: 'newpassword',
    );

    await auth.verifyEmail(ConnectFixtureServer.verificationToken);

    expect(server.signups['new@example.com']!.verified, isTrue);
  });

  test('verifyEmail maps an unknown token to linkInvalid', () {
    expect(
      () => auth.verifyEmail('never-issued'),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkInvalid,
        ),
      ),
    );
  });

  test('verifyEmail maps a spent link to linkExpired', () {
    expect(
      () => auth.verifyEmail(ConnectFixtureServer.expiredVerificationToken),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkExpired,
        ),
      ),
    );
  });

  test('requestEmailVerification names the address it was given', () async {
    await auth.requestEmailVerification('new@example.com');

    expect(
      server.requestsTo('RequestEmailVerification').single.body['email'],
      'new@example.com',
    );
  });

  test('requestEmailVerification maps a spent allowance to rateLimited', () {
    server.verificationRequestStatus = HttpStatus.tooManyRequests;
    server.verificationRequestErrorCode = 'resource_exhausted';

    expect(
      () => auth.requestEmailVerification('new@example.com'),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('requestPasswordReset names the address it was given', () async {
    await auth.requestPasswordReset(ConnectFixtureServer.memberEmail);

    expect(
      server.requestsTo('RequestPasswordReset').single.body['email'],
      ConnectFixtureServer.memberEmail,
    );
  });

  test('requestPasswordReset maps a spent allowance to rateLimited', () {
    server.passwordResetRequestStatus = HttpStatus.tooManyRequests;
    server.passwordResetRequestErrorCode = 'resource_exhausted';

    expect(
      () => auth.requestPasswordReset(ConnectFixtureServer.memberEmail),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.rateLimited,
        ),
      ),
    );
  });

  test('confirmPasswordReset sets the password Login then takes', () async {
    await auth.confirmPasswordReset(
      token: ConnectFixtureServer.passwordResetToken,
      newPassword: 'replaced-password',
    );

    final session = await auth.signIn(
      email: ConnectFixtureServer.memberEmail,
      password: 'replaced-password',
    );
    expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
  });

  test('confirmPasswordReset maps an unknown token to linkInvalid', () {
    expect(
      () => auth.confirmPasswordReset(
        token: 'never-issued',
        newPassword: 'replaced-password',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkInvalid,
        ),
      ),
    );
  });

  test('confirmPasswordReset maps a spent link to linkExpired', () {
    expect(
      () => auth.confirmPasswordReset(
        token: ConnectFixtureServer.expiredPasswordResetToken,
        newPassword: 'replaced-password',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.linkExpired,
        ),
      ),
    );
  });

  test('confirmPasswordReset maps a blank password to invalidInput', () {
    expect(
      () => auth.confirmPasswordReset(
        token: ConnectFixtureServer.passwordResetToken,
        newPassword: '   ',
      ),
      throwsA(
        isA<AuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AuthFailureKind.invalidInput,
        ),
      ),
    );
  });

  test(
    'readAgeVerification reports the tenant rule without a session',
    () async {
      expect(await auth.readAgeVerification(), AgeVerification.checked);

      server.ageVerification = 'AGE_VERIFICATION_NONE';

      expect(await auth.readAgeVerification(), AgeVerification.none);
    },
  );

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
