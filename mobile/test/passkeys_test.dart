import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  late FakeAuthRepository repository;
  late AuthController auth;
  late FakePasskeyAuthenticator passkeys;
  late GoRouter router;

  setUp(() {
    repository = FakeAuthRepository();
    passkeys = FakePasskeyAuthenticator();
    auth = fakeAuthController(repository: repository);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.signIn,
    bool withPasskeys = true,
    ProviderSignIn? providerSignIn,
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
        passkeyAuthenticator: withPasskeys ? passkeys : null,
        providerSignIn: providerSignIn,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  final passkeyButton = find.byKey(const ValueKey('sign-in-with-passkey'));
  final signInError = find.byKey(const ValueKey('provider-sign-in-error'));

  group('the sign-in screen', () {
    testWidgets('offers a passkey under the form where the device uses the '
        "site's", (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, passkeyButton);

      expect(find.text('Sign in with a passkey'), findsOneWidget);
      expect(find.text('or'), findsOneWidget);
    });

    testWidgets("offers none where the device does not use the site's", (
      tester,
    ) async {
      passkeys.available = false;
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(passkeyButton, findsNothing);
      expect(find.text('or'), findsNothing);
    });

    testWidgets('still offers Apple and Google where the device cannot say '
        'whether it makes passkeys', (tester) async {
      repository.signInProviders = const SignInProviders(
        google: GoogleSignInClients(webClientId: 'web-client'),
      );
      passkeys.offeredFailure = Exception('no package info');
      await pumpApp(tester, providerSignIn: FakeProviderSignIn());
      final google = find.byKey(const ValueKey('sign-in-with-google'));
      await pumpUntilFound(tester, google);

      expect(passkeyButton, findsNothing);
    });

    testWidgets('still offers a passkey where the device cannot say which '
        'providers it offers', (tester) async {
      await pumpApp(
        tester,
        providerSignIn: FakeProviderSignIn()
          ..offeredFailure = Exception('no package info'),
      );
      await pumpUntilFound(tester, passkeyButton);

      expect(find.byKey(const ValueKey('sign-in-with-google')), findsNothing);
    });

    testWidgets('offers none where this run has no passkey authenticator', (
      tester,
    ) async {
      await pumpApp(tester, withPasskeys: false);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );

      expect(passkeyButton, findsNothing);
    });

    testWidgets('signs in with the passkey the reader picks and leaves the '
        'form', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.catalog);
      unawaited(router.push(AppRoutes.signIn));
      await pumpUntilFound(tester, passkeyButton);

      await tapVisible(tester, passkeyButton);
      await pumpUntilTrue(tester, () => auth.isSignedIn);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(passkeys.authenticated, [FakeAuthRepository.requestOptionsJson]);
      expect(repository.passkeyCredentials, [
        FakePasskeyAuthenticator.credentialFor('asserted', 1),
      ]);
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('a closed sheet says so and leaves the reader signed out', (
      tester,
    ) async {
      passkeys.failure = const PasskeyCancelled();
      await pumpApp(tester);
      await pumpUntilFound(tester, passkeyButton);

      await tapVisible(tester, passkeyButton);
      await pumpUntilFound(tester, signInError);

      expect(
        find.text(
          'The passkey request was cancelled or timed out. Try again, or sign '
          'in with your email address and password.',
        ),
        findsOneWidget,
      );
      expect(repository.passkeyCredentials, isEmpty);
      expect(auth.isSignedIn, isFalse);
    });

    testWidgets('a passkey the site does not take offers the password '
        'instead', (tester) async {
      repository.passkeySignInFailure = const AuthFailure(
        AuthFailureKind.invalidCredentials,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, passkeyButton);

      await tapVisible(tester, passkeyButton);
      await pumpUntilFound(tester, signInError);

      expect(
        find.text(
          'Could not sign in with this passkey. Try again, or sign in with '
          'your email address and password.',
        ),
        findsOneWidget,
      );
      expect(auth.isSignedIn, isFalse);
    });
  });

  group('the passkeys screen', () {
    final iphone = Passkey(
      id: 'passkey-iphone',
      name: 'iPhone',
      createdAt: DateTime.utc(2026, 10, 1, 9),
      lastUsedAt: DateTime.utc(2026, 10, 16, 9),
      backedUp: true,
    );
    final unnamed = Passkey(
      id: 'passkey-unnamed',
      name: '',
      createdAt: DateTime.utc(2026, 10, 2, 9),
    );

    final addButton = find.byKey(const ValueKey('passkeys-add'));

    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
    });

    Future<void> openActions(WidgetTester tester, Passkey passkey) async {
      await tapVisible(
        tester,
        find.byKey(ValueKey('passkey-actions-${passkey.id}')),
      );
      await tester.pumpAndSettle();
    }

    /// What scrolls the account screen, whose lower rows sit below the test
    /// viewport.
    final accountList = find.descendant(
      of: find.byKey(const ValueKey('account-list')),
      matching: find.byType(Scrollable),
    );

    testWidgets('is reached from the account screen', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.account);
      await pumpUntilFound(tester, accountList);

      await tapVisible(
        tester,
        find.byKey(const ValueKey('account-passkeys')),
        scrollable: accountList,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkeys-empty')),
      );

      expect(router.state.uri.path, AppRoutes.accountPasskeys);
    });

    testWidgets('is not offered where this run has no passkey '
        'authenticator', (tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.account,
        withPasskeys: false,
      );
      await pumpUntilFound(tester, accountList);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('account-linked-accounts')),
        100,
        scrollable: accountList,
      );

      expect(find.byKey(const ValueKey('account-passkeys')), findsNothing);
    });

    testWidgets('lists each passkey with when it was added and last used', (
      tester,
    ) async {
      repository.passkeys = [iphone, unnamed];
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-unnamed')),
      );

      expect(find.text('iPhone'), findsOneWidget);
      expect(find.text('Unnamed passkey'), findsOneWidget);
      expect(find.textContaining('Last used on'), findsOneWidget);
      expect(find.textContaining('Not used yet'), findsOneWidget);
      expect(find.textContaining('Added on'), findsNWidgets(2));
    });

    testWidgets('adds a passkey and names it once it is made', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(tester, find.byKey(const ValueKey('passkey-name')));

      expect(passkeys.registered, [FakeAuthRepository.creationOptionsJson]);
      expect(repository.passkeys.single.name, isEmpty);

      await tester.enterText(
        find.byKey(const ValueKey('passkey-name')),
        '  Pixel 9  ',
      );
      await tester.tap(find.byKey(const ValueKey('passkey-name-save')));
      await pumpUntilFound(tester, find.text('Pixel 9'));

      expect(repository.passkeyRenames, [('passkey-1', 'Pixel 9')]);
      expect(
        find.text('The passkey has been added. You can now sign in with it.'),
        findsOneWidget,
      );
    });

    testWidgets('leaves a passkey unnamed when naming is skipped', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(tester, find.byKey(const ValueKey('passkey-name')));
      await tester.tap(find.byKey(const ValueKey('passkey-name-dismiss')));
      await pumpUntilFound(tester, find.text('Unnamed passkey'));

      expect(repository.passkeyRenames, isEmpty);
      expect(repository.passkeys, hasLength(1));
    });

    testWidgets('refuses a name longer than the API keeps', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(tester, find.byKey(const ValueKey('passkey-name')));
      await tester.enterText(
        find.byKey(const ValueKey('passkey-name')),
        'x' * 65,
      );
      await tester.tap(find.byKey(const ValueKey('passkey-name-save')));
      await tester.pump();

      expect(
        find.text('Use 64 characters or fewer for the name.'),
        findsOneWidget,
      );
      expect(repository.passkeyRenames, isEmpty);
    });

    testWidgets('a closed sheet adds nothing and says so', (tester) async {
      passkeys.failure = const PasskeyCancelled();
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(
        tester,
        find.text('The passkey request was cancelled or timed out. Try again.'),
      );

      expect(repository.passkeyCredentials, isEmpty);
      expect(find.byKey(const ValueKey('passkey-name')), findsNothing);
    });

    testWidgets('an account that holds as many as it may is told to remove '
        'one', (tester) async {
      repository.beginPasskeyRegistrationFailure = const AuthFailure(
        AuthFailureKind.passkeyLimit,
      );
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(
        tester,
        find.text(
          'Your account has as many passkeys as it can hold. Remove one '
          'before adding another.',
        ),
      );

      expect(passkeys.registered, isEmpty);
    });

    testWidgets('a passkey the device holds already says so', (tester) async {
      passkeys.failure = const PasskeyAlreadyRegistered();
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, addButton);

      await tapVisible(tester, addButton);
      await pumpUntilFound(
        tester,
        find.text('This passkey is already registered to your account.'),
      );
    });

    testWidgets('offers no way to add one where the device does not use the '
        "site's, and still lists them", (tester) async {
      passkeys.available = false;
      repository.passkeys = [iphone];
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-iphone')),
      );

      expect(addButton, findsNothing);
    });

    testWidgets('renames a passkey', (tester) async {
      repository.passkeys = [iphone];
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-iphone')),
      );

      await openActions(tester, iphone);
      await tester.tap(
        find.byKey(const ValueKey('passkey-rename-passkey-iphone')),
      );
      await pumpUntilFound(tester, find.byKey(const ValueKey('passkey-name')));

      expect(find.widgetWithText(TextFormField, 'iPhone'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('passkey-name')),
        'Work iPhone',
      );
      await tester.tap(find.byKey(const ValueKey('passkey-name-save')));
      await pumpUntilFound(tester, find.text('Work iPhone'));

      expect(find.text("The passkey's name has been saved."), findsOneWidget);
    });

    testWidgets('removes a passkey', (tester) async {
      repository.passkeys = [iphone, unnamed];
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-iphone')),
      );

      await openActions(tester, iphone);
      await tester.tap(
        find.byKey(const ValueKey('passkey-remove-passkey-iphone')),
      );
      await pumpUntilFound(tester, find.text('The passkey has been removed.'));

      expect(repository.passkeys.single.id, 'passkey-unnamed');
      expect(
        find.byKey(const ValueKey('passkey-passkey-iphone')),
        findsNothing,
      );
    });

    testWidgets('a list that could not be read again after a removal offers '
        'a retry rather than the passkey removed', (tester) async {
      repository
        ..passkeys = [iphone, unnamed]
        ..passkeysFailureAfterRemoval = const AuthFailure(
          AuthFailureKind.network,
        );
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-iphone')),
      );

      await openActions(tester, iphone);
      await tester.tap(
        find.byKey(const ValueKey('passkey-remove-passkey-iphone')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkeys-retry')),
      );

      expect(
        find.byKey(const ValueKey('passkey-passkey-iphone')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('passkey-passkey-unnamed')),
        findsNothing,
      );
    });

    testWidgets('keeps the last one of an account without a password or a '
        'linked account', (tester) async {
      repository
        ..hasPassword = false
        ..passkeys = [iphone];
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      await pumpUntilFound(tester, find.byKey(const ValueKey('passkeys-last')));

      await openActions(tester, iphone);
      final remove = tester.widget<MenuItemButton>(
        find.byKey(const ValueKey('passkey-remove-passkey-iphone')),
      );
      expect(remove.onPressed, isNull);
    });

    testWidgets('a list that could not be read offers a retry', (tester) async {
      repository.passkeysFailure = const AuthFailure(AuthFailureKind.network);
      await pumpApp(tester, initialLocation: AppRoutes.accountPasskeys);
      final retry = find.byKey(const ValueKey('passkeys-retry'));
      await pumpUntilFound(tester, retry);

      repository
        ..passkeysFailure = null
        ..passkeys = [iphone];
      await tester.tap(retry);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('passkey-passkey-iphone')),
      );
    });
  });

  group('linked accounts', () {
    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
    });

    testWidgets('lets an account without a password but with a passkey '
        'unlink its last one', (tester) async {
      repository
        ..hasPassword = false
        ..passkeys = [const Passkey(id: 'passkey-a', name: '')]
        ..identities = const [
          LinkedIdentity(
            provider: IdentityProvider.google,
            email: 'member@gmail.example',
          ),
        ];
      await pumpApp(tester, initialLocation: AppRoutes.accountLinkedAccounts);
      final unlink = find.byKey(const ValueKey('linked-account-unlink-google'));
      await pumpUntilFound(tester, unlink);

      expect(find.byKey(const ValueKey('linked-accounts-last')), findsNothing);

      await tester.tap(unlink);
      await pumpUntilFound(tester, find.text('The account was unlinked.'));

      expect(repository.identities, isEmpty);
    });
  });

  group('deleting an account without a password', () {
    final passkeyConfirm = find.byKey(
      const ValueKey('delete-account-with-passkey'),
    );
    final note = find.byKey(const ValueKey('delete-account-provider-note'));
    final error = find.byKey(const ValueKey('delete-account-error'));

    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
      repository
        ..hasPassword = false
        ..passkeys = [const Passkey(id: 'passkey-a', name: '')];
    });

    Future<void> confirmDeletion(WidgetTester tester) async {
      await tester.tap(passkeyConfirm);
      final confirm = find.byKey(
        const ValueKey('delete-account-confirm-delete'),
      );
      await pumpUntilFound(tester, confirm);
      await tester.tap(confirm);
    }

    testWidgets('confirms with a passkey the reader picks and signs out', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, passkeyConfirm);

      expect(
        find.text('Your account has no password. Confirm with a passkey.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('delete-account-password')),
        findsNothing,
      );

      await confirmDeletion(tester);
      await pumpUntilTrue(tester, () => repository.deleted);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('series-tile-${fixtureSeries.first.id}')),
      );

      expect(passkeys.authenticated, [
        FakeAuthRepository.confirmationOptionsJson,
      ]);
      expect(repository.deletionPasskeyCredentials, [
        FakePasskeyAuthenticator.credentialFor('asserted', 1),
      ]);
      expect(auth.isSignedIn, isFalse);
      expect(router.state.uri.path, AppRoutes.catalog);
    });

    testWidgets('offers the passkey above the linked providers', (
      tester,
    ) async {
      repository.identities = const [
        LinkedIdentity(
          provider: IdentityProvider.google,
          email: 'member@gmail.example',
        ),
      ];
      await pumpApp(
        tester,
        initialLocation: AppRoutes.accountDelete,
        providerSignIn: FakeProviderSignIn(),
      );
      final google = find.byKey(const ValueKey('delete-account-with-google'));
      await pumpUntilFound(tester, google);

      expect(
        find.text(
          'Your account has no password. Confirm with a passkey, or sign in '
          'again with a linked account.',
        ),
        findsOneWidget,
      );
      expect(
        tester.getTopLeft(passkeyConfirm).dy,
        lessThan(tester.getTopLeft(google).dy),
      );
    });

    testWidgets('a closed sheet says so and keeps the account', (tester) async {
      passkeys.failure = const PasskeyCancelled();
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, passkeyConfirm);

      await confirmDeletion(tester);
      await pumpUntilFound(tester, error);

      expect(
        find.text('The passkey request was cancelled or timed out. Try again.'),
        findsOneWidget,
      );
      expect(repository.deletionPasskeyCredentials, isEmpty);
      expect(auth.isSignedIn, isTrue);
      expect(tester.widget<FilledButton>(passkeyConfirm).onPressed, isNotNull);
    });

    testWidgets('a passkey the API does not take says so and keeps the '
        'account', (tester) async {
      repository.accountFailure = const AuthFailure(
        AuthFailureKind.passkeyRefused,
      );
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, passkeyConfirm);

      await confirmDeletion(tester);
      await pumpUntilFound(tester, error);

      expect(
        find.text('Could not confirm with this passkey. Try again.'),
        findsOneWidget,
      );
      expect(auth.isSignedIn, isTrue);
    });

    testWidgets('a passkey removed since the screen opened says to confirm '
        'another way', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, passkeyConfirm);
      repository.passkeys = const [];

      await confirmDeletion(tester);
      await pumpUntilFound(tester, error);

      expect(
        find.text(
          'No passkey is registered to your account. Confirm another way.',
        ),
        findsOneWidget,
      );
      expect(passkeys.authenticated, isEmpty);
    });

    testWidgets("offers none where the device does not use the site's", (
      tester,
    ) async {
      passkeys.available = false;
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, note);

      expect(passkeyConfirm, findsNothing);
      expect(
        find.textContaining('None of the accounts linked to yours'),
        findsOneWidget,
      );
    });

    testWidgets('offers none to an account that holds no passkey', (
      tester,
    ) async {
      repository.passkeys = const [];
      await pumpApp(tester, initialLocation: AppRoutes.accountDelete);
      await pumpUntilFound(tester, note);

      expect(passkeyConfirm, findsNothing);
    });
  });

  group('changing the email address of an account without a password', () {
    final passkeyConfirm = find.byKey(
      const ValueKey('change-email-with-passkey'),
    );
    final error = find.byKey(const ValueKey('change-email-error'));

    setUp(() {
      auth = fakeAuthController(session: fakeSession, repository: repository);
      repository
        ..hasPassword = false
        ..passkeys = [const Passkey(id: 'passkey-a', name: '')];
    });

    Future<void> request(WidgetTester tester, String newEmail) async {
      await tester.enterText(
        find.byKey(const ValueKey('change-email-new')),
        newEmail,
      );
      await tester.tap(passkeyConfirm);
    }

    testWidgets('confirms with a passkey the reader picks', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountEmail);
      await pumpUntilFound(tester, passkeyConfirm);

      expect(
        find.text(
          'Your account has no password. Confirm with a passkey to send the '
          'confirmation emails.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('change-email-password')), findsNothing);

      await request(tester, 'moved@example.com');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('change-email-requested')),
      );

      expect(passkeys.authenticated, [
        FakeAuthRepository.confirmationOptionsJson,
      ]);
      final call = repository.emailChanges.single;
      expect(call.currentEmail, repository.email);
      expect(call.newEmail, 'moved@example.com');
      expect(call.currentPassword, isEmpty);
      expect(
        call.passkeyCredentialJson,
        FakePasskeyAuthenticator.credentialFor('asserted', 1),
      );
      expect(auth.isSignedIn, isTrue);
    });

    testWidgets('an address the form refuses never opens the sheet', (
      tester,
    ) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountEmail);
      await pumpUntilFound(tester, passkeyConfirm);

      await request(tester, repository.email);
      await tester.pump();

      expect(
        find.text('Enter an address different from your current one.'),
        findsOneWidget,
      );
      expect(passkeys.authenticated, isEmpty);
    });

    testWidgets('a closed sheet says so and keeps the form', (tester) async {
      passkeys.failure = const PasskeyCancelled();
      await pumpApp(tester, initialLocation: AppRoutes.accountEmail);
      await pumpUntilFound(tester, passkeyConfirm);

      await request(tester, 'moved@example.com');
      await pumpUntilFound(tester, error);

      expect(
        find.text('The passkey request was cancelled or timed out. Try again.'),
        findsOneWidget,
      );
      expect(repository.emailChanges, isEmpty);
      expect(tester.widget<FilledButton>(passkeyConfirm).onPressed, isNotNull);
    });

    testWidgets('a passkey the API does not take is told apart from an '
        'address it refuses', (tester) async {
      repository.accountFailure = const AuthFailure(
        AuthFailureKind.passkeyRefused,
      );
      await pumpApp(tester, initialLocation: AppRoutes.accountEmail);
      await pumpUntilFound(tester, passkeyConfirm);

      await request(tester, 'moved@example.com');
      await pumpUntilFound(tester, error);

      expect(
        find.text('Could not confirm with this passkey. Try again.'),
        findsOneWidget,
      );

      repository.accountFailure = const AuthFailure(
        AuthFailureKind.invalidInput,
      );
      await tester.tap(passkeyConfirm);
      await pumpUntilFound(
        tester,
        find.text(
          'Could not request the email change. Check what you entered.',
        ),
      );
    });
  });
}
