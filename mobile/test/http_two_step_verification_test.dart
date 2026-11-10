import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/two_step_verification.dart';
import 'package:publira/config.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpAuthRepository auth;

  const member = AuthSession(
    accessToken: ConnectFixtureServer.memberAccessToken,
    userPublicId: ConnectFixtureServer.memberPublicId,
    userName: ConnectFixtureServer.memberName,
  );

  Matcher failsWith(AuthFailureKind kind) => throwsA(
    isA<AuthFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
    auth = HttpAuthRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  /// The challenge a password sign-in answers the member with.
  Future<MfaChallenge> challenge() async {
    try {
      await auth.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: ConnectFixtureServer.memberPassword,
      );
    } on TwoStepVerificationRequired catch (required) {
      return required.challenge;
    }
    fail('the sign-in issued a session without asking for a code');
  }

  group('a sign-in to an account that holds an authenticator', () {
    test('answers the challenge instead of a session', () async {
      server.memberMfaEnabled = true;

      final issued = await challenge();

      expect(issued.token, ConnectFixtureServer.mfaChallengeToken);
      expect(issued.expiresAt, DateTime.utc(2100));
    });

    test('issues the session for the authenticator code', () async {
      server.memberMfaEnabled = true;

      final (session, verification) = await auth.verifyMfa(
        await challenge(),
        ConnectFixtureServer.mfaCode,
      );

      expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
      expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
      expect(verification.recoveryCodeUsed, isFalse);
      expect(
        server.mfaVerifyRequests.single.challengeToken,
        ConnectFixtureServer.mfaChallengeToken,
      );
    });

    test('issues the session for a recovery code, which it spends', () async {
      final codes = await _enroll(auth, member);
      final (_, verification) = await auth.verifyMfa(
        await challenge(),
        codes.first,
      );

      expect(verification.recoveryCodeUsed, isTrue);
      expect(verification.remainingRecoveryCodes, 9);
      await expectLater(
        auth.verifyMfa(await challenge(), codes.first),
        failsWith(AuthFailureKind.mfaInvalidCode),
      );
    });

    test('tells a wrong code apart from a challenge that has ended', () async {
      server.memberMfaEnabled = true;
      final issued = await challenge();

      await expectLater(
        auth.verifyMfa(issued, '000000'),
        failsWith(AuthFailureKind.mfaInvalidCode),
      );
      await auth.verifyMfa(issued, ConnectFixtureServer.mfaCode);
      await expectLater(
        auth.verifyMfa(issued, ConnectFixtureServer.mfaCode),
        failsWith(AuthFailureKind.sessionExpired),
      );
    });

    test('says so once too many wrong codes have locked the account', () async {
      server.memberMfaEnabled = true;
      final issued = await challenge();
      server.mfaLocked = true;

      await expectLater(
        auth.verifyMfa(issued, ConnectFixtureServer.mfaCode),
        failsWith(AuthFailureKind.mfaLocked),
      );
    });
  });

  group("the signed-in reader's two-step verification", () {
    test('reads as off until an authenticator is turned on', () async {
      final status = await auth.readMfaStatus(member);

      expect(status.enabled, isFalse);
      expect(status.enabledAt, isNull);
    });

    test('is turned on with a code from the authenticator it set up, which '
        'answers the recovery codes', () async {
      final enrollment = await auth.startMfaEnrollment(member);

      expect(enrollment.secret, ConnectFixtureServer.mfaSecret);
      expect(enrollment.otpauthUri, startsWith('otpauth://totp/'));

      await expectLater(
        auth.confirmMfaEnrollment(member, '000000'),
        failsWith(AuthFailureKind.mfaInvalidCode),
      );
      final codes = await auth.confirmMfaEnrollment(
        member,
        ConnectFixtureServer.mfaCode,
      );

      expect(codes, hasLength(10));
      final status = await auth.readMfaStatus(member);
      expect(status.enabled, isTrue);
      expect(status.enabledAt, DateTime.utc(2026, 11, 10, 9));
      expect(status.remainingRecoveryCodes, 10);
    });

    test('is refused to staff who set it up in the console', () {
      server.mfaSetUpInConsole = true;

      expect(
        auth.startMfaEnrollment(member),
        failsWith(AuthFailureKind.mfaSetUpInConsole),
      );
    });

    test(
      'regenerates the recovery codes for the authenticator code alone',
      () async {
        final first = await _enroll(auth, member);

        await expectLater(
          auth.regenerateMfaRecoveryCodes(member, first.first),
          failsWith(AuthFailureKind.mfaInvalidCode),
        );
        final second = await auth.regenerateMfaRecoveryCodes(
          member,
          ConnectFixtureServer.mfaCode,
        );

        expect(second, hasLength(10));
        expect(second, isNot(contains(first.first)));
      },
    );

    test('is turned off with the password and a recovery code', () async {
      final codes = await _enroll(auth, member);

      await auth.disableMfa(
        member,
        password: ConnectFixtureServer.memberPassword,
        code: codes.last,
      );

      expect((await auth.readMfaStatus(member)).enabled, isFalse);
      final request = server.mfaDisableRequests.single;
      expect(request.password, ConnectFixtureServer.memberPassword);
      expect(request.code, codes.last);
    });

    test('keeps a wrong password and a wrong code apart from an ended '
        'session', () async {
      await _enroll(auth, member);

      await expectLater(
        auth.disableMfa(
          member,
          password: 'not-the-password',
          code: ConnectFixtureServer.mfaCode,
        ),
        failsWith(AuthFailureKind.invalidInput),
      );
      await expectLater(
        auth.disableMfa(
          member,
          password: ConnectFixtureServer.memberPassword,
          code: '000000',
        ),
        failsWith(AuthFailureKind.mfaInvalidCode),
      );
      expect((await auth.readMfaStatus(member)).enabled, isTrue);
    });
  });
}

/// Turns the member's authenticator on and returns the recovery codes.
Future<List<String>> _enroll(
  HttpAuthRepository auth,
  AuthSession member,
) async {
  await auth.startMfaEnrollment(member);
  return auth.confirmMfaEnrollment(member, ConnectFixtureServer.mfaCode);
}
