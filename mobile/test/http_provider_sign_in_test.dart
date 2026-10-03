import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
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

  /// A Google token for [email] the fixture accepts once, for its nonce.
  ProviderCredential issueGoogleToken({
    required String email,
    String subject = 'google-subject-1',
    String idToken = 'google-id-token-1',
    String nonce = 'google-nonce-1',
  }) {
    server.idTokens[idToken] = FixtureIdToken(
      provider: IdentityProvider.google.wireName,
      subject: subject,
      email: email,
      nonce: nonce,
    );
    return ProviderCredential(
      provider: IdentityProvider.google,
      idToken: idToken,
      nonce: nonce,
    );
  }

  Matcher failsWith(AuthFailureKind kind) => throwsA(
    isA<AuthFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  setUp(() async {
    server = ConnectFixtureServer()
      ..appleSignIn = const {}
      ..iosAppBundleIdentifier = 'com.example.reader'
      ..googleSignIn = const {
        'webClientId': '1-web.apps.googleusercontent.com',
        'iosClientId': '1-ios.apps.googleusercontent.com',
      };
    await server.start();
    auth = HttpAuthRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  group('fieldViolationsOf', () {
    test('reads the fields a BadRequest detail names', () {
      expect(
        fieldViolationsOf([
          {'type': 'google.rpc.ErrorInfo', 'value': 'CgA'},
          ConnectFixtureServer.badRequestDetail('agreed_page_version_ids'),
        ]),
        ['agreed_page_version_ids'],
      );
    });

    test('skips a detail that does not decode', () {
      expect(
        fieldViolationsOf([
          {'type': 'google.rpc.BadRequest', 'value': 'CgUKA2Zv'},
        ]),
        isEmpty,
      );
      expect(fieldViolationsOf(null), isEmpty);
    });
  });

  test('readSignInProviders reads the providers the tenant enables', () async {
    expect(
      await auth.readSignInProviders(),
      const SignInProviders(
        apple: true,
        appleBundleIdentifier: 'com.example.reader',
        google: GoogleSignInClients(
          webClientId: '1-web.apps.googleusercontent.com',
          iosClientId: '1-ios.apps.googleusercontent.com',
        ),
      ),
    );

    server
      ..appleSignIn = null
      ..googleSignIn = null
      ..iosAppBundleIdentifier = null;
    expect(await auth.readSignInProviders(), SignInProviders.none);
  });

  test('readSignInProviders reads the Services ID and the Android app the '
      'storefront hands Apple\'s answer to', () async {
    server
      ..appleSignIn = const {'servicesId': ' com.example.reader.web '}
      ..androidApplicationId = 'com.example.reader';

    final providers = await auth.readSignInProviders();

    expect(providers.appleServicesId, 'com.example.reader.web');
    expect(providers.androidApplicationId, 'com.example.reader');
    expect(providers.appleBundleIdentifier, 'com.example.reader');
  });

  test(
    'a Google account the site linked signs in to the same account',
    () async {
      // The site linked the member's Google account when it created the
      // account, so the app's token finds it by the provider's subject.
      server.memberIdentities[IdentityProvider.google.wireName] =
          const FixtureIdToken(
            provider: 'IDENTITY_PROVIDER_GOOGLE',
            subject: 'google-subject-1',
            email: 'another-address@example.com',
            nonce: '',
          );

      final session = await auth.signInWithProvider(
        issueGoogleToken(email: 'another-address@example.com'),
      );

      expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
      expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
      final sent = server.requestsTo('LoginWithIdToken').single.body;
      expect(sent['provider'], 'IDENTITY_PROVIDER_GOOGLE');
      expect(sent['idToken'], 'google-id-token-1');
      expect(sent['nonce'], 'google-nonce-1');
      expect(sent.containsKey('authorizationCode'), isFalse);
    },
  );

  test('signInWithProvider sends Apple the code and the name it handed '
      'over', () async {
    server.idTokens['apple-id-token'] = const FixtureIdToken(
      provider: 'IDENTITY_PROVIDER_APPLE',
      subject: 'apple-subject',
      email: ConnectFixtureServer.memberEmail,
      nonce: 'raw-nonce',
    );

    await auth.signInWithProvider(
      const ProviderCredential(
        provider: IdentityProvider.apple,
        idToken: 'apple-id-token',
        nonce: 'raw-nonce',
        authorizationCode: 'apple-code',
        name: 'Taylor Reader',
      ),
    );

    final sent = server.requestsTo('LoginWithIdToken').single.body;
    expect(sent['provider'], 'IDENTITY_PROVIDER_APPLE');
    expect(sent['nonce'], 'raw-nonce');
    expect(sent['authorizationCode'], 'apple-code');
    expect(sent['name'], 'Taylor Reader');
    expect(sent.containsKey('redirectUri'), isFalse);
  });

  test('an Apple account the site linked signs in to the same account from '
      'the Android app, with the redirect its code is exchanged at', () async {
    // The site linked the member's Apple account through the Services ID, and
    // the Android app's web flow is issued to the same one.
    server.memberIdentities[IdentityProvider.apple.wireName] =
        const FixtureIdToken(
          provider: 'IDENTITY_PROVIDER_APPLE',
          subject: 'apple-subject-1',
          email: 'relay@privaterelay.appleid.com',
          nonce: '',
        );
    server.idTokens['apple-id-token'] = const FixtureIdToken(
      provider: 'IDENTITY_PROVIDER_APPLE',
      subject: 'apple-subject-1',
      email: 'relay@privaterelay.appleid.com',
      nonce: 'raw-nonce',
    );

    final session = await auth.signInWithProvider(
      const ProviderCredential(
        provider: IdentityProvider.apple,
        idToken: 'apple-id-token',
        nonce: 'raw-nonce',
        authorizationCode: 'apple-code',
        redirectUri: 'https://localhost/api/v1/auth/apple/callback/android',
      ),
    );

    expect(session.userPublicId, ConnectFixtureServer.memberPublicId);
    final sent = server.requestsTo('LoginWithIdToken').single.body;
    expect(sent['authorizationCode'], 'apple-code');
    expect(
      sent['redirectUri'],
      'https://localhost/api/v1/auth/apple/callback/android',
    );
  });

  test('a first sign-in the tenant asks consent for is consentRequired, and '
      'the same token signs up with it', () async {
    server.termsPage = const {
      'slug': '/terms',
      'title': 'Terms',
      'versionId': 'terms-v1',
    };
    final credential = issueGoogleToken(email: 'new-reader@example.com');

    await expectLater(
      auth.signInWithProvider(credential),
      failsWith(AuthFailureKind.consentRequired),
    );
    final session = await auth.signInWithProvider(
      credential,
      birthDate: '2000-01-02',
      agreedPageVersionIds: ['terms-v1'],
    );

    expect(session.accessToken, ConnectFixtureServer.signedUpAccessToken);
    final signup = server.signups['new-reader@example.com']!;
    expect(signup.agreedPageVersionIds, ['terms-v1']);
    expect(signup.birthDate, '2000-01-02');
  });

  test('signInWithProvider maps a provider the tenant turned off to '
      'providerRefused', () {
    server.googleSignIn = null;

    expect(
      auth.signInWithProvider(issueGoogleToken(email: 'a@example.com')),
      failsWith(AuthFailureKind.providerRefused),
    );
  });

  test('readLinkedIdentities reads the links and whether there is a '
      'password', () async {
    server
      ..memberHasPassword = false
      ..memberIdentities['IDENTITY_PROVIDER_GOOGLE'] = const FixtureIdToken(
        provider: 'IDENTITY_PROVIDER_GOOGLE',
        subject: 'google-subject-1',
        email: 'member@gmail.example',
        nonce: '',
      );

    final linked = await auth.readLinkedIdentities(member);

    expect(linked.hasPassword, isFalse);
    expect(linked.keepsLast, isTrue);
    expect(linked.identities.single.provider, IdentityProvider.google);
    expect(linked.identities.single.email, 'member@gmail.example');
    expect(
      linked.identities.single.linkedAt,
      DateTime.utc(2026, 1, 2, 3, 4, 5),
    );
  });

  test('unlinkIdentity maps the last way in to lastSignInMethod, and one '
      'already gone to success', () async {
    server
      ..memberHasPassword = false
      ..memberIdentities['IDENTITY_PROVIDER_GOOGLE'] = const FixtureIdToken(
        provider: 'IDENTITY_PROVIDER_GOOGLE',
        subject: 'google-subject-1',
        email: 'member@gmail.example',
        nonce: '',
      );

    await expectLater(
      auth.unlinkIdentity(member, IdentityProvider.google),
      failsWith(AuthFailureKind.lastSignInMethod),
    );
    await auth.unlinkIdentity(member, IdentityProvider.apple);

    server.memberHasPassword = true;
    await auth.unlinkIdentity(member, IdentityProvider.google);
    expect(server.memberIdentities, isEmpty);
  });

  test('deleteAccountWithProvider confirms with a token of the linked '
      'account', () async {
    server
      ..memberHasPassword = false
      ..memberIdentities['IDENTITY_PROVIDER_GOOGLE'] = const FixtureIdToken(
        provider: 'IDENTITY_PROVIDER_GOOGLE',
        subject: 'google-subject-1',
        email: 'member@gmail.example',
        nonce: '',
      );

    await expectLater(
      auth.deleteAccountWithProvider(
        member,
        issueGoogleToken(
          email: 'someone-else@example.com',
          subject: 'google-subject-2',
          idToken: 'other-token',
        ),
      ),
      failsWith(AuthFailureKind.invalidInput),
    );
    // The API answers a token it cannot verify as it answers an ended
    // session; GetMe still accepting the session makes it the token's fault.
    await expectLater(
      auth.deleteAccountWithProvider(
        member,
        const ProviderCredential(
          provider: IdentityProvider.google,
          idToken: 'forged-token',
          nonce: 'google-nonce-1',
        ),
      ),
      failsWith(AuthFailureKind.invalidInput),
    );
    expect(server.memberDeleted, isFalse);
    await auth.deleteAccountWithProvider(
      member,
      issueGoogleToken(email: 'member@gmail.example'),
    );

    expect(server.memberDeleted, isTrue);
  });

  group('requestEmailChangeWithProvider', () {
    setUp(() {
      server
        ..memberHasPassword = false
        ..memberIdentities['IDENTITY_PROVIDER_GOOGLE'] = const FixtureIdToken(
          provider: 'IDENTITY_PROVIDER_GOOGLE',
          subject: 'google-subject-1',
          email: 'member@gmail.example',
          nonce: '',
        );
    });

    Future<void> requestWith(ProviderCredential credential) =>
        auth.requestEmailChangeWithProvider(
          member,
          currentEmail: ConnectFixtureServer.memberEmail,
          newEmail: 'moved@example.com',
          credential: credential,
        );

    test('confirms with a token of the linked account', () async {
      await requestWith(issueGoogleToken(email: 'member@gmail.example'));

      expect(server.requestedEmailChanges, ['moved@example.com']);
    });

    test('maps a token of another account to invalidInput', () async {
      await expectLater(
        requestWith(
          issueGoogleToken(
            email: 'someone-else@example.com',
            subject: 'google-subject-2',
          ),
        ),
        failsWith(AuthFailureKind.invalidInput),
      );
      expect(server.requestedEmailChanges, isEmpty);
    });

    test('maps a token the API cannot verify to invalidInput while the '
        'session is still accepted', () async {
      await expectLater(
        requestWith(
          const ProviderCredential(
            provider: IdentityProvider.google,
            idToken: 'forged-token',
            nonce: 'google-nonce-1',
          ),
        ),
        failsWith(AuthFailureKind.invalidInput),
      );
    });

    test('maps a session the API no longer accepts to sessionExpired', () {
      server.activeAccessToken = 'another-session';

      expect(
        requestWith(issueGoogleToken(email: 'member@gmail.example')),
        failsWith(AuthFailureKind.sessionExpired),
      );
    });
  });
}
