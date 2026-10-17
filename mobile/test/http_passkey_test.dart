import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/http_auth_repository.dart';
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

  const stranger = AuthSession(
    accessToken: 'not-a-token-the-api-issued',
    userPublicId: 'SomeoneElse1',
    userName: 'Someone Else',
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

  group('signing in with a passkey', () {
    test('begins with the options the API answers and signs in with the '
        'assertion made over them', () async {
      server.memberPasskeyAssertions.add('{"id":"member-passkey"}');

      expect(
        await auth.beginPasskeySignIn(),
        ConnectFixtureServer.passkeyRequestOptionsJson,
      );
      final session = await auth.signInWithPasskey('{"id":"member-passkey"}');

      expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
      expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
      expect(session.userName, ConnectFixtureServer.memberName);
    });

    test('refuses a passkey the site does not take as a wrong password is '
        'refused', () {
      expect(
        auth.signInWithPasskey('{"id":"unknown-passkey"}'),
        failsWith(AuthFailureKind.invalidCredentials),
      );
    });
  });

  group("the signed-in reader's passkeys", () {
    test(
      'are read oldest first, with when each was added and last used',
      () async {
        server.memberPasskeys.addAll([
          pb.Passkey(
            id: 'passkey-a',
            name: 'iPhone',
            createdAt: '2026-10-01T09:00:00Z',
            lastUsedAt: '2026-10-16T21:30:00Z',
            backedUp: true,
          ),
          pb.Passkey(id: 'passkey-b', createdAt: '2026-10-02T09:00:00Z'),
        ]);

        final [first, second] = await auth.readPasskeys(member);

        expect(first.id, 'passkey-a');
        expect(first.name, 'iPhone');
        expect(first.createdAt, DateTime.utc(2026, 10, 1, 9));
        expect(first.lastUsedAt, DateTime.utc(2026, 10, 16, 21, 30));
        expect(first.backedUp, isTrue);
        expect(second.name, isEmpty);
        expect(second.lastUsedAt, isNull);
        expect(second.backedUp, isFalse);
      },
    );

    test('are refused to a token the API does not accept as an ended '
        'session', () {
      expect(
        auth.readPasskeys(stranger),
        failsWith(AuthFailureKind.sessionExpired),
      );
    });

    test('gain one registered over the options the API answers', () async {
      expect(
        await auth.beginPasskeyRegistration(member),
        ConnectFixtureServer.passkeyCreationOptionsJson,
      );
      final passkey = await auth.finishPasskeyRegistration(
        member,
        '{"id":"new-passkey"}',
      );

      expect(passkey.id, 'passkey-1');
      expect(passkey.name, isEmpty);
      expect(passkey.createdAt, DateTime.utc(2026, 10, 17, 9));
      expect(server.memberPasskeys.single.id, 'passkey-1');
    });

    test('refuse another once the account holds as many as it may', () {
      server.passkeyLimit = 0;

      expect(
        auth.beginPasskeyRegistration(member),
        failsWith(AuthFailureKind.passkeyLimit),
      );
    });

    test('refuse one the tenant holds already, and one that does not '
        'verify', () {
      server.registeredPasskeyCredentials.add('{"id":"taken"}');

      expect(
        auth.finishPasskeyRegistration(member, '{"id":"taken"}'),
        failsWith(AuthFailureKind.passkeyAlreadyRegistered),
      );
      expect(
        auth.finishPasskeyRegistration(member, ''),
        failsWith(AuthFailureKind.invalidInput),
      );
    });

    test('are renamed, and one that is gone says so', () async {
      server.memberPasskeys.add(pb.Passkey(id: 'passkey-a'));

      final renamed = await auth.renamePasskey(member, 'passkey-a', 'Pixel');

      expect(renamed.name, 'Pixel');
      expect(server.memberPasskeys.single.name, 'Pixel');
      expect(
        auth.renamePasskey(member, 'passkey-gone', 'Pixel'),
        failsWith(AuthFailureKind.passkeyNotFound),
      );
    });

    test('are removed, one already gone is answered as removed, and the last '
        'way into an account is kept', () async {
      server.memberPasskeys.addAll([
        pb.Passkey(id: 'passkey-a'),
        pb.Passkey(id: 'passkey-b'),
      ]);

      await auth.deletePasskey(member, 'passkey-a');
      await auth.deletePasskey(member, 'passkey-a');
      expect(server.memberPasskeys.single.id, 'passkey-b');

      server.memberHasPassword = false;
      await expectLater(
        auth.deletePasskey(member, 'passkey-b'),
        failsWith(AuthFailureKind.lastSignInMethod),
      );
      expect(server.memberPasskeys.single.id, 'passkey-b');
    });
  });

  group('confirming a step with a passkey', () {
    setUp(() {
      server
        ..memberHasPassword = false
        ..memberPasskeys.add(pb.Passkey(id: 'passkey-a'))
        ..memberPasskeyAssertions.add('{"id":"member-passkey"}');
    });

    test('begins with the options the API answers, which an account without '
        'a passkey has none of', () async {
      expect(
        await auth.beginPasskeyConfirmation(member),
        ConnectFixtureServer.passkeyConfirmationOptionsJson,
      );

      server.memberPasskeys.clear();
      expect(
        auth.beginPasskeyConfirmation(member),
        failsWith(AuthFailureKind.passkeyNotFound),
      );
    });

    test('is refused to a token the API does not accept as an ended '
        'session', () {
      expect(
        auth.beginPasskeyConfirmation(stranger),
        failsWith(AuthFailureKind.sessionExpired),
      );
    });

    test('deletes the account with an assertion the API takes', () async {
      await auth.deleteAccountWithPasskey(member, '{"id":"member-passkey"}');

      expect(server.memberDeleted, isTrue);
    });

    test('keeps the account when the API does not take the assertion, '
        'without ending the session', () async {
      await expectLater(
        auth.deleteAccountWithPasskey(member, '{"id":"unknown-passkey"}'),
        failsWith(AuthFailureKind.passkeyRefused),
      );

      expect(server.memberDeleted, isFalse);
    });

    test('requests an email change with an assertion the API takes', () async {
      await auth.requestEmailChangeWithPasskey(
        member,
        currentEmail: ConnectFixtureServer.memberEmail,
        newEmail: 'moved@example.com',
        credentialJson: '{"id":"member-passkey"}',
      );

      expect(server.requestedEmailChanges, ['moved@example.com']);
    });

    test('tells an assertion the API does not take apart from an address '
        'another account holds', () async {
      await expectLater(
        auth.requestEmailChangeWithPasskey(
          member,
          currentEmail: ConnectFixtureServer.memberEmail,
          newEmail: 'moved@example.com',
          credentialJson: '{"id":"unknown-passkey"}',
        ),
        failsWith(AuthFailureKind.passkeyRefused),
      );
      await expectLater(
        auth.requestEmailChangeWithPasskey(
          member,
          currentEmail: ConnectFixtureServer.memberEmail,
          newEmail: ConnectFixtureServer.takenEmail,
          credentialJson: '{"id":"member-passkey"}',
        ),
        failsWith(AuthFailureKind.invalidInput),
      );

      expect(server.requestedEmailChanges, isEmpty);
    });
  });

  test('readLinkedIdentities reads whether the reader holds a passkey, which '
      'lets an account without a password unlink its last provider', () async {
    server
      ..memberHasPassword = false
      ..memberPasskeys.add(pb.Passkey(id: 'passkey-a'))
      ..memberIdentities[pb.IdentityProvider.IDENTITY_PROVIDER_GOOGLE] =
          const FixtureIdToken(
            provider: pb.IdentityProvider.IDENTITY_PROVIDER_GOOGLE,
            subject: 'google-subject-1',
            email: 'member@gmail.example',
            nonce: '',
          );

    final linked = await auth.readLinkedIdentities(member);

    expect(linked.hasPasskey, isTrue);
    expect(linked.keepsLast, isFalse);
    expect(linked.keepsLastPasskey(1), isFalse);
  });
}
