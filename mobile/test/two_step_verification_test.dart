import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/two_step_verification.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  late FakeAuthRepository repository;
  late AuthController auth;
  late FakeShareSheet share;
  late GoRouter router;

  setUp(() {
    repository = FakeAuthRepository();
    auth = fakeAuthController(repository: repository);
    share = FakeShareSheet();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    required String initialLocation,
    ProviderSignIn? providerSignIn,
    FakePasskeyAuthenticator? passkeys,
  }) async {
    // Tall enough that a whole form is built without scrolling.
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router = createAppRouter(initialLocation: initialLocation),
        catalog: FakeCatalogRepository(series: fixtureSeries),
        auth: auth,
        site: const PublicSite(host: 'localhost'),
        share: share,
        providerSignIn: providerSignIn,
        passkeyAuthenticator: passkeys,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// What the app last put on the clipboard.
  String? copied;

  void recordClipboard(WidgetTester tester) {
    copied = null;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map<Object?, Object?>)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
  }

  Future<void> enterText(WidgetTester tester, String key, String text) async {
    await tester.enterText(find.byKey(ValueKey(key)), text);
    await tester.pump();
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tapReachable(tester, find.byKey(ValueKey(key)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('the code step after sign-in', () {
    final codeStep = find.byKey(const ValueKey('two-step-submit'));
    final error = find.byKey(const ValueKey('two-step-error'));

    Future<void> signInWithPassword(WidgetTester tester) async {
      await enterText(tester, 'sign-in-email', 'member@example.com');
      await enterText(tester, 'sign-in-password', repository.password);
      await tapKey(tester, 'sign-in-submit');
    }

    setUp(() {
      repository
        ..mfaEnabled = true
        ..mfaRecoveryCodes = FakeAuthRepository.fakeRecoveryCodes('kept');
    });

    testWidgets('follows the password of an account that holds an '
        'authenticator, and its code signs the reader in', (tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.signInPath(
          returnTo: AppRoutes.announcements,
        ),
      );
      await signInWithPassword(tester);
      await pumpUntilFound(tester, codeStep);

      expect(auth.isSignedIn, isFalse);
      expect(find.text('Two-step verification'), findsOneWidget);
      expect(
        find.text(
          'Enter the 6-digit code from your authenticator app to finish '
          'signing in.',
        ),
        findsOneWidget,
      );

      await enterText(tester, 'two-step-code', FakeAuthRepository.mfaCode);
      await tapKey(tester, 'two-step-submit');

      expect(auth.isSignedIn, isTrue);
      expect(repository.mfaVerifications, [FakeAuthRepository.mfaCode]);
      expect(router.state.uri.path, AppRoutes.announcements);
    });

    testWidgets('keeps the reader on the form for a wrong code, and says so '
        'once too many have locked the account', (tester) async {
      repository.mfaLockAfter = 1;
      await pumpApp(tester, initialLocation: AppRoutes.signIn);
      await signInWithPassword(tester);
      await pumpUntilFound(tester, codeStep);

      await enterText(tester, 'two-step-code', '000000');
      await tapKey(tester, 'two-step-submit');

      expect(
        find.descendant(
          of: error,
          matching: find.text(
            'The code is incorrect. Check your authenticator app and try '
            'again.',
          ),
        ),
        findsOneWidget,
      );
      expect(auth.isSignedIn, isFalse);

      await tapKey(tester, 'two-step-submit');

      expect(
        find.descendant(
          of: error,
          matching: find.text(
            'Too many incorrect codes. Wait a while before trying again.',
          ),
        ),
        findsOneWidget,
      );
      expect(auth.isSignedIn, isFalse);
    });

    testWidgets('signs in with a recovery code once the reader asks to use '
        'one, which is spent', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.signIn);
      await signInWithPassword(tester);
      await pumpUntilFound(tester, codeStep);

      await tapKey(tester, 'two-step-switch-method');

      expect(find.text('Recovery code'), findsOneWidget);
      expect(find.text('Use your authenticator app'), findsOneWidget);

      final code = repository.mfaRecoveryCodes.first;
      await enterText(tester, 'two-step-code', code);
      await tapKey(tester, 'two-step-submit');

      expect(auth.isSignedIn, isTrue);
      expect(repository.mfaRecoveryCodes, isNot(contains(code)));
    });

    testWidgets('sends the reader back to sign in once the challenge is over', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.signIn);
      await signInWithPassword(tester);
      await pumpUntilFound(tester, codeStep);
      repository.mfaChallengeSpent = true;

      await enterText(tester, 'two-step-code', FakeAuthRepository.mfaCode);
      await tapKey(tester, 'two-step-submit');

      expect(
        find.text('This sign-in has expired. Sign in again.'),
        findsOneWidget,
      );
      await tapKey(tester, 'two-step-start-again');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );
    });

    testWidgets('opened without a challenge offers only a fresh sign-in', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.twoStepSignIn);

      expect(find.byKey(const ValueKey('two-step-expired')), findsOneWidget);
      expect(codeStep, findsNothing);
    });

    testWidgets('follows an Apple or Google sign-in as well', (tester) async {
      repository.signInProviders = const SignInProviders(
        google: GoogleSignInClients(webClientId: 'web-client'),
      );
      await pumpApp(
        tester,
        initialLocation: AppRoutes.signIn,
        providerSignIn: FakeProviderSignIn(
          providers: const [IdentityProvider.google],
        ),
      );
      final google = find.byKey(const ValueKey('sign-in-with-google'));
      await pumpUntilFound(tester, google);

      await tapReachable(tester, google);
      await pumpUntilFound(tester, codeStep);
      expect(auth.isSignedIn, isFalse);

      await enterText(tester, 'two-step-code', FakeAuthRepository.mfaCode);
      await tapKey(tester, 'two-step-submit');

      expect(auth.isSignedIn, isTrue);
    });
  });

  group('two-step verification on the account screen', () {
    final status = find.byKey(const ValueKey('two-step-verification-status'));
    final error = find.byKey(const ValueKey('two-step-verification-error'));

    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
    });

    Future<List<String>> turnOn(WidgetTester tester) async {
      await tapKey(tester, 'two-step-verification-enable');
      await enterText(
        tester,
        'two-step-verification-code',
        FakeAuthRepository.mfaCode,
      );
      await tapKey(tester, 'two-step-verification-confirm');
      return repository.mfaRecoveryCodes;
    }

    testWidgets('is reached from the account screen', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.account);

      await tapKey(tester, 'account-two-step-verification');
      await pumpUntilFound(tester, status);

      expect(
        find.descendant(
          of: status,
          matching: find.text('Two-step verification is off.'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('turns on with the key and the QR code, a code from the '
        'authenticator, and shows the recovery codes once', (tester) async {
      recordClipboard(tester);
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
      );
      await pumpUntilFound(tester, status);

      await tapKey(tester, 'two-step-verification-enable');

      expect(
        find.bySemanticsLabel('QR code for setting up two-step verification'),
        findsOneWidget,
      );
      expect(find.text(FakeAuthRepository.mfaSecret), findsOneWidget);
      await tapKey(tester, 'two-step-verification-secret-copy');
      expect(copied, FakeAuthRepository.mfaSecret);

      await enterText(tester, 'two-step-verification-code', '000000');
      await tapKey(tester, 'two-step-verification-confirm');
      expect(
        find.descendant(
          of: error,
          matching: find.text(
            'The code is incorrect. Check your authenticator app and try '
            'again.',
          ),
        ),
        findsOneWidget,
      );
      expect(repository.mfaEnabled, isFalse);

      await enterText(
        tester,
        'two-step-verification-code',
        FakeAuthRepository.mfaCode,
      );
      await tapKey(tester, 'two-step-verification-confirm');

      expect(repository.mfaEnabled, isTrue);
      final codes = repository.mfaRecoveryCodes.join('\n');
      expect(find.text(codes), findsOneWidget);
      await tapKey(tester, 'two-step-verification-recovery-codes-copy');
      expect(copied, codes);
      await tapKey(tester, 'two-step-verification-recovery-codes-share');
      expect(share.texts.single.text, codes);
      expect(share.texts.single.title, 'Recovery codes');

      await tapKey(tester, 'two-step-verification-done');

      expect(find.text(codes), findsNothing);
      expect(
        find.descendant(
          of: status,
          matching: find.textContaining('Two-step verification has been on '),
        ),
        findsOneWidget,
      );
      expect(find.text('10 recovery codes left'), findsOneWidget);
    });

    testWidgets('regenerates the recovery codes for a code from the '
        'authenticator', (tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
      );
      await pumpUntilFound(tester, status);
      final first = await turnOn(tester);
      await tapKey(tester, 'two-step-verification-done');

      await tapKey(tester, 'two-step-verification-regenerate');
      await enterText(tester, 'two-step-verification-code', first.first);
      await tapKey(tester, 'two-step-verification-regenerate-submit');
      expect(error, findsOneWidget);
      expect(repository.mfaRecoveryCodes, first);

      await enterText(
        tester,
        'two-step-verification-code',
        FakeAuthRepository.mfaCode,
      );
      await tapKey(tester, 'two-step-verification-regenerate-submit');

      expect(repository.mfaRecoveryCodes, isNot(first));
      expect(find.text(repository.mfaRecoveryCodes.join('\n')), findsOneWidget);
    });

    testWidgets('turns off with the password and a recovery code', (
      tester,
    ) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
      );
      await pumpUntilFound(tester, status);
      final codes = await turnOn(tester);
      await tapKey(tester, 'two-step-verification-done');

      await tapKey(tester, 'two-step-verification-disable');
      await enterText(tester, 'two-step-verification-password', 'wrong');
      await enterText(tester, 'two-step-verification-code', codes.first);
      await tapKey(tester, 'two-step-verification-disable-submit');
      expect(
        find.descendant(
          of: error,
          matching: find.text('The password is incorrect.'),
        ),
        findsOneWidget,
      );
      expect(repository.mfaEnabled, isTrue);

      await enterText(
        tester,
        'two-step-verification-password',
        repository.password,
      );
      await tapKey(tester, 'two-step-verification-disable-submit');

      expect(repository.mfaEnabled, isFalse);
      expect(repository.mfaDisables.last.code, codes.first);
      expect(
        find.descendant(
          of: status,
          matching: find.text('Two-step verification is off.'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('turns off an account without a password with a fresh '
        'sign-in to a linked provider', (tester) async {
      repository
        ..hasPassword = false
        ..identities = const [
          LinkedIdentity(
            provider: IdentityProvider.google,
            email: 'member@gmail.example',
          ),
        ]
        ..signInProviders = const SignInProviders(
          google: GoogleSignInClients(webClientId: 'web-client'),
        )
        ..mfaEnabled = true
        ..mfaRecoveryCodes = FakeAuthRepository.fakeRecoveryCodes('kept');
      final providerSignIn = FakeProviderSignIn(
        providers: const [IdentityProvider.google],
      );
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
        providerSignIn: providerSignIn,
      );
      await pumpUntilFound(tester, status);

      await tapKey(tester, 'two-step-verification-disable');
      expect(
        find.byKey(const ValueKey('two-step-verification-password')),
        findsNothing,
      );
      await enterText(
        tester,
        'two-step-verification-code',
        FakeAuthRepository.mfaCode,
      );
      await tapKey(tester, 'two-step-verification-disable-google');

      expect(providerSignIn.requested, [IdentityProvider.google]);
      expect(repository.mfaEnabled, isFalse);
      expect(
        repository.mfaDisables.single.confirmation,
        isA<ProviderCredential>(),
      );
    });

    testWidgets('tells staff who sign in to the console with a passkey to '
        'set it up there', (tester) async {
      repository.mfaStartFailure = const AuthFailure(
        AuthFailureKind.mfaSetUpInConsole,
      );
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
      );
      await pumpUntilFound(tester, status);

      await tapKey(tester, 'two-step-verification-enable');

      expect(
        find.descendant(
          of: error,
          matching: find.text(
            "This account signs in to the tenant's console with a passkey, "
            'so set up two-step verification from Account settings in the '
            'console.',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('two-step-verification-qr')),
        findsNothing,
      );
    });

    testWidgets('offers a retry when the settings cannot be read', (
      tester,
    ) async {
      repository.mfaStatusFailure = const AuthFailure(AuthFailureKind.network);
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountTwoStepVerification,
      );
      final loadError = find.byKey(
        const ValueKey('two-step-verification-load-error'),
      );
      await pumpUntilFound(tester, loadError);

      repository.mfaStatusFailure = null;
      await tapKey(tester, 'two-step-verification-retry');

      expect(status, findsOneWidget);
    });
  });

  test('a challenge is over once its expiry has come', () {
    final challenge = MfaChallenge(
      token: 'token',
      expiresAt: DateTime.utc(2026, 11, 10, 9, 5),
    );

    expect(challenge.hasExpired(DateTime.utc(2026, 11, 10, 9, 4)), isFalse);
    expect(challenge.hasExpired(DateTime.utc(2026, 11, 10, 9, 5)), isTrue);
  });
}
