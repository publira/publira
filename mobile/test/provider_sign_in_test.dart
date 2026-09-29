import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  group('offeredProviders', () {
    const both = SignInProviders(
      apple: true,
      appleBundleIdentifier: 'com.example.reader',
      google: GoogleSignInClients(
        webClientId: 'web-client',
        iosClientId: 'ios-client',
      ),
    );

    List<IdentityProvider> offered(
      SignInProviders providers,
      TargetPlatform platform, {
      String bundleIdentifier = 'com.example.reader',
      String googleIosClientId = 'ios-client',
    }) => offeredProviders(
      providers,
      platform: platform,
      bundleIdentifier: bundleIdentifier,
      googleIosClientId: googleIosClientId,
    );

    test('iOS offers Apple, and Google through the client the build '
        'registered', () {
      expect(offered(both, TargetPlatform.iOS), [
        IdentityProvider.apple,
        IdentityProvider.google,
      ]);
      expect(
        offered(both, TargetPlatform.iOS, googleIosClientId: 'other-client'),
        [IdentityProvider.apple],
      );
      expect(offered(both, TargetPlatform.iOS, googleIosClientId: ''), [
        IdentityProvider.apple,
      ]);
    });

    test('iOS offers Apple only to the app the tenant names, never to the '
        'dev flavor', () {
      expect(
        offered(
          both,
          TargetPlatform.iOS,
          bundleIdentifier: 'com.example.reader.dev',
        ),
        isEmpty,
      );
      expect(
        offered(
          const SignInProviders(
            apple: true,
            google: GoogleSignInClients(iosClientId: 'ios-client'),
          ),
          TargetPlatform.iOS,
        ),
        isEmpty,
      );
    });

    test('iOS offers no Google without Apple beside it', () {
      expect(
        offered(
          const SignInProviders(
            google: GoogleSignInClients(iosClientId: 'ios-client'),
          ),
          TargetPlatform.iOS,
        ),
        isEmpty,
      );
    });

    test('Android offers Google through the web client alone', () {
      expect(offered(both, TargetPlatform.android), [IdentityProvider.google]);
      expect(
        offered(
          const SignInProviders(
            apple: true,
            google: GoogleSignInClients(iosClientId: 'ios-client'),
          ),
          TargetPlatform.android,
        ),
        isEmpty,
      );
    });

    test('other platforms offer none', () {
      expect(offered(both, TargetPlatform.linux), isEmpty);
    });
  });

  late FakeAuthRepository repository;
  late AuthController auth;
  late FakeProviderSignIn providerSignIn;
  late GoRouter router;

  setUp(() {
    repository = FakeAuthRepository()
      ..signInProviders = const SignInProviders(
        apple: true,
        google: GoogleSignInClients(webClientId: 'web-client'),
      );
    providerSignIn = FakeProviderSignIn();
    auth = fakeAuthController(repository: repository);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.signIn,
    ProviderSignIn? signIn,
    bool withSignIn = true,
  }) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router = createAppRouter(initialLocation: initialLocation),
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: auth,
        providerSignIn: withSignIn ? signIn ?? providerSignIn : null,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  final googleButton = find.byKey(const ValueKey('sign-in-with-google'));

  group('the sign-in screen', () {
    testWidgets('offers a button per provider under the form', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, googleButton);

      expect(find.text('Continue with Apple'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('or'), findsOneWidget);
    });

    testWidgets('offers none where this run has no provider sign-in', (
      tester,
    ) async {
      await pumpApp(tester, withSignIn: false);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );

      expect(googleButton, findsNothing);
      expect(find.text('or'), findsNothing);
    });

    testWidgets('offers none where the device offers none of the tenant\'s', (
      tester,
    ) async {
      providerSignIn.providers = const [];
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(googleButton, findsNothing);
    });

    testWidgets('signs in with the token the provider issued and leaves the '
        'form', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.catalog);
      unawaited(router.push(AppRoutes.signIn));
      await pumpUntilFound(tester, googleButton);

      await tapVisible(tester, googleButton);
      await pumpUntilTrue(tester, () => auth.isSignedIn);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(providerSignIn.requested, [IdentityProvider.google]);
      final call = repository.providerSignIns.single;
      expect(call.credential.idToken, 'google-id-token-1');
      expect(call.credential.nonce, 'google-nonce-1');
      expect(call.agreedPageVersionIds, isEmpty);
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('a closed provider sheet leaves the form as it was', (
      tester,
    ) async {
      providerSignIn.failure = const ProviderSignInCancelled();
      await pumpApp(tester);
      await pumpUntilFound(tester, googleButton);

      await tapVisible(tester, googleButton);
      await tester.pump(const Duration(milliseconds: 50));

      expect(
        find.byKey(const ValueKey('provider-sign-in-error')),
        findsNothing,
      );
      expect(repository.providerSignIns, isEmpty);
      expect(auth.isSignedIn, isFalse);
    });

    testWidgets('an account the API will not sign in says to use the email '
        'address', (tester) async {
      repository.providerSignInFailures.add(
        const AuthFailure(AuthFailureKind.providerRefused),
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, googleButton);

      await tapVisible(tester, googleButton);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('provider-sign-in-error')),
      );

      expect(
        find.text(
          'This account cannot sign in here. Sign in with your email address '
          'instead.',
        ),
        findsOneWidget,
      );
      expect(auth.isSignedIn, isFalse);
    });
  });

  group('a first sign-in the tenant asks consent for', () {
    const terms = LegalPage(
      slug: '/terms',
      title: 'Terms of Service',
      versionId: 'terms-v1',
    );

    testWidgets('continues on a screen that sends the same token with the '
        'consent', (tester) async {
      repository
        ..termsPage = terms
        ..providerSignInFailures.add(
          const AuthFailure(AuthFailureKind.consentRequired),
        );
      await pumpApp(tester, initialLocation: AppRoutes.catalog);
      unawaited(router.push(AppRoutes.signIn));
      await pumpUntilFound(tester, googleButton);

      await tapVisible(tester, googleButton);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('continue-sign-up-submit')),
      );
      expect(find.text('Finish signing up'), findsOneWidget);

      await tapVisible(
        tester,
        find.byKey(const ValueKey('continue-sign-up-submit')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-up-consent-error')),
      );
      expect(repository.providerSignIns, hasLength(1));

      await tapVisible(tester, find.byKey(const ValueKey('sign-up-consent')));
      await tapVisible(
        tester,
        find.byKey(const ValueKey('continue-sign-up-submit')),
      );
      await pumpUntilTrue(tester, () => auth.isSignedIn);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(repository.providerSignIns, hasLength(2));
      final [first, second] = repository.providerSignIns;
      expect(second.credential, same(first.credential));
      expect(second.agreedPageVersionIds, ['terms-v1']);
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('reached without a token offers a fresh sign-in', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.continueSignUp);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('continue-sign-up-expired')),
      );

      await tester.tap(
        find.byKey(const ValueKey('continue-sign-up-start-again')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );
    });
  });

  group('linked accounts', () {
    final google = LinkedIdentity(
      provider: IdentityProvider.google,
      email: 'member@gmail.example',
      linkedAt: DateTime.utc(2026, 1, 2),
    );

    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
    });

    testWidgets('lists each linked account and unlinks one', (tester) async {
      repository.identities = [google];
      await pumpApp(tester, initialLocation: AppRoutes.accountLinkedAccounts);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('linked-account-google')),
      );

      expect(find.text('Google'), findsOneWidget);
      expect(find.textContaining('member@gmail.example'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('linked-account-unlink-google')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('linked-accounts-empty')),
      );

      expect(find.text('The account was unlinked.'), findsOneWidget);
      expect(repository.identities, isEmpty);
    });

    testWidgets('keeps the last one of an account without a password', (
      tester,
    ) async {
      repository
        ..identities = [google]
        ..hasPassword = false;
      await pumpApp(tester, initialLocation: AppRoutes.accountLinkedAccounts);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('linked-accounts-last')),
      );

      final unlink = tester.widget<TextButton>(
        find.byKey(const ValueKey('linked-account-unlink-google')),
      );
      expect(unlink.onPressed, isNull);
    });
  });

  group('deleting an account without a password', () {
    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
      repository
        ..hasPassword = false
        ..identities = const [
          LinkedIdentity(
            provider: IdentityProvider.google,
            email: 'member@gmail.example',
          ),
        ];
    });

    testWidgets('confirms with a fresh sign-in to the linked provider', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-with-google')),
      );

      expect(
        find.byKey(const ValueKey('delete-account-password')),
        findsNothing,
      );
      // Apple is offered by the device but not linked to this account.
      expect(
        find.byKey(const ValueKey('delete-account-with-apple')),
        findsNothing,
      );

      await tester.tap(
        find.byKey(const ValueKey('delete-account-with-google')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-confirm-delete')),
      );
      await tester.tap(
        find.byKey(const ValueKey('delete-account-confirm-delete')),
      );
      await pumpUntilTrue(tester, () => repository.deleted);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(providerSignIn.requested, [IdentityProvider.google]);
      expect(
        repository.deletionCredentials.single.idToken,
        'google-id-token-1',
      );
      expect(auth.isSignedIn, isFalse);
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('says so where no linked provider can sign in here', (
      tester,
    ) async {
      providerSignIn.providers = const [IdentityProvider.apple];
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-provider-note')),
      );

      expect(
        find.textContaining('None of the accounts linked to yours'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('delete-account-with-google')),
        findsNothing,
      );
    });
  });
}
