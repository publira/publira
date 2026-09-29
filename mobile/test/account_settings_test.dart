import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_repository.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_push.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  late FakeAuthRepository repository;
  late InMemorySessionStore store;
  late AuthController auth;
  late FakeCatalogRepository catalog;

  setUp(() {
    repository = FakeAuthRepository();
    store = InMemorySessionStore(session: fakeSession);
    auth = fakeAuthController(
      session: fakeSession,
      repository: repository,
      store: store,
    );
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.account,
    PushController? push,
  }) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: initialLocation),
        catalog: catalog,
        auth: auth,
        push: push,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// What scrolls the account screen, whose lower rows sit below the test
  /// viewport.
  final accountList = find.descendant(
    of: find.byKey(const ValueKey('account-list')),
    matching: find.byType(Scrollable),
  );

  /// Opens the account screen's [row] and waits for [arrived] on the screen
  /// it leads to.
  Future<void> openFromAccount(
    WidgetTester tester,
    String row,
    String arrived,
  ) async {
    await pumpApp(tester);
    await tapVisible(
      tester,
      find.byKey(ValueKey(row)),
      scrollable: accountList,
    );
    await pumpUntilFound(tester, find.byKey(ValueKey(arrived)));
  }

  group('display name', () {
    testWidgets('a new name is saved and shown on the account screen', (
      tester,
    ) async {
      await openFromAccount(tester, 'account-name', 'edit-name-name');
      expect(find.text(fakeSession.userName), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('edit-name-name')),
        '  Renamed Reader  ',
      );
      await tester.tap(find.byKey(const ValueKey('edit-name-submit')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('account-name')));

      expect(repository.renames, ['Renamed Reader']);
      expect(auth.session?.userName, 'Renamed Reader');
      expect(store.session?.userName, 'Renamed Reader');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('account-name')),
          matching: find.text('Renamed Reader'),
        ),
        findsOneWidget,
      );
      expect(find.text('Your profile has been updated.'), findsOneWidget);
    });

    testWidgets('an empty name is refused before the API is called', (
      tester,
    ) async {
      await openFromAccount(tester, 'account-name', 'edit-name-name');

      await tester.enterText(
        find.byKey(const ValueKey('edit-name-name')),
        '   ',
      );
      await tester.tap(find.byKey(const ValueKey('edit-name-submit')));
      await tester.pump();

      expect(find.text('Enter a display name.'), findsOneWidget);
      expect(repository.renames, isEmpty);
    });

    testWidgets('a different reader signing in starts the form afresh', (
      tester,
    ) async {
      await openFromAccount(tester, 'account-name', 'edit-name-name');
      await tester.enterText(
        find.byKey(const ValueKey('edit-name-name')),
        'Half-typed name',
      );

      await auth.signOut();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('account-settings-sign-in')),
        findsOneWidget,
      );
      repository.session = const AuthSession(
        accessToken: 'other-access-token',
        userPublicId: 'SeedMMBRCCC3',
        userName: 'Other Reader',
      );
      await auth.signIn(email: 'other@example.com', password: 'other');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('edit-name-name')),
      );

      expect(find.text('Other Reader'), findsOneWidget);
      expect(find.text('Half-typed name'), findsNothing);
    });

    testWidgets('a refused rename keeps the form and says why', (tester) async {
      repository.accountFailure = const AuthFailure(AuthFailureKind.network);
      await openFromAccount(tester, 'account-name', 'edit-name-name');

      await tester.tap(find.byKey(const ValueKey('edit-name-submit')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('edit-name-error')),
      );

      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOneWidget,
      );
      expect(auth.session?.userName, fakeSession.userName);
    });
  });

  group('password', () {
    Future<void> fillPasswords(
      WidgetTester tester, {
      String current = 'current-password',
      String next = 'replaced-password',
      String confirm = 'replaced-password',
    }) async {
      await tester.enterText(
        find.byKey(const ValueKey('change-password-current')),
        current,
      );
      await tester.enterText(
        find.byKey(const ValueKey('change-password-new')),
        next,
      );
      await tester.enterText(
        find.byKey(const ValueKey('change-password-confirm')),
        confirm,
      );
      await tester.tap(find.byKey(const ValueKey('change-password-submit')));
    }

    testWidgets('a change keeps this device signed in on the new token', (
      tester,
    ) async {
      await openFromAccount(
        tester,
        'account-change-password',
        'change-password-current',
      );

      await fillPasswords(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('account-sign-out')),
      );

      expect(repository.password, 'replaced-password');
      expect(auth.accessToken, FakeAuthRepository.changedAccessToken);
      expect(store.session?.accessToken, FakeAuthRepository.changedAccessToken);
      expect(auth.session?.userPublicId, fakeSession.userPublicId);
      expect(
        find.text(
          'Your password has been changed. Your other devices have been signed out.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('the current password again is refused before the API', (
      tester,
    ) async {
      await openFromAccount(
        tester,
        'account-change-password',
        'change-password-current',
      );

      await fillPasswords(
        tester,
        next: 'current-password',
        confirm: 'current-password',
      );
      await tester.pump();

      expect(
        find.text(
          'Enter a new password that is different from your current one.',
        ),
        findsOneWidget,
      );
      expect(repository.password, 'current-password');
    });

    testWidgets('a wrong current password stays a form error', (tester) async {
      await openFromAccount(
        tester,
        'account-change-password',
        'change-password-current',
      );

      await fillPasswords(tester, current: 'mistyped-password');
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('change-password-error')),
      );

      expect(
        find.text('Could not change your password. Check what you entered.'),
        findsOneWidget,
      );
      expect(auth.accessToken, fakeSession.accessToken);
      expect(auth.isSignedIn, isTrue);
    });

    testWidgets('a session the API has dropped signs the reader out', (
      tester,
    ) async {
      repository.accountFailure = const AuthFailure(
        AuthFailureKind.sessionExpired,
      );
      await openFromAccount(
        tester,
        'account-change-password',
        'change-password-current',
      );

      await fillPasswords(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('account-settings-sign-in')),
      );

      expect(auth.isSignedIn, isFalse);
      expect(store.session, isNull);
    });
  });

  group('email address', () {
    testWidgets('a change is requested from the address the account holds', (
      tester,
    ) async {
      await openFromAccount(tester, 'account-change-email', 'change-email-new');
      expect(find.text(repository.email), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('change-email-new')),
        ' moved@example.com ',
      );
      await tester.enterText(
        find.byKey(const ValueKey('change-email-password')),
        'current-password',
      );
      await tester.tap(find.byKey(const ValueKey('change-email-submit')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('change-email-requested')),
      );

      final call = repository.emailChanges.single;
      expect(call.currentEmail, repository.email);
      expect(call.newEmail, 'moved@example.com');
      expect(call.currentPassword, 'current-password');
      expect(
        find.text(
          'We sent a confirmation email to both your current and your new '
          'address. Open both links to finish the change.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('the address the account holds is refused before the API', (
      tester,
    ) async {
      await openFromAccount(tester, 'account-change-email', 'change-email-new');

      await tester.enterText(
        find.byKey(const ValueKey('change-email-new')),
        repository.email.toUpperCase(),
      );
      await tester.enterText(
        find.byKey(const ValueKey('change-email-password')),
        'current-password',
      );
      await tester.tap(find.byKey(const ValueKey('change-email-submit')));
      await tester.pump();

      expect(
        find.text('Enter an address different from your current one.'),
        findsOneWidget,
      );
      expect(repository.emailChanges, isEmpty);
    });

    testWidgets('a wrong password keeps the form and says why', (tester) async {
      await openFromAccount(tester, 'account-change-email', 'change-email-new');

      await tester.enterText(
        find.byKey(const ValueKey('change-email-new')),
        'moved@example.com',
      );
      await tester.enterText(
        find.byKey(const ValueKey('change-email-password')),
        'mistyped-password',
      );
      await tester.tap(find.byKey(const ValueKey('change-email-submit')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('change-email-error')),
      );

      expect(
        find.text(
          'Could not request the email change. Check what you entered.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('an address that cannot be read offers another try', (
      tester,
    ) async {
      repository.emailFailure = const AuthFailure(AuthFailureKind.network);
      await openFromAccount(
        tester,
        'account-change-email',
        'change-email-load-error',
      );

      repository.emailFailure = null;
      await tester.tap(find.byKey(const ValueKey('change-email-reload')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('change-email-new')),
      );
    });

    for (final (progress, copy) in [
      (EmailChangeProgress.changed, 'Your email address has been changed.'),
      (
        EmailChangeProgress.awaitingCurrentEmail,
        'This confirmation is complete. The change takes effect once the '
            'current address is confirmed as well.',
      ),
      (
        EmailChangeProgress.awaitingNewEmail,
        'This confirmation is complete. The change takes effect once the new '
            'address is confirmed as well.',
      ),
    ]) {
      testWidgets('a confirmation link reports ${progress.name}', (
        tester,
      ) async {
        repository.emailChangeTokens = {'change-token': progress};
        await pumpApp(
          tester,
          initialLocation: '${AppRoutes.confirmEmail}?token=change-token',
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('confirm-email-result')),
        );

        expect(find.text(copy), findsOneWidget);

        await tester.tap(
          find.byKey(const ValueKey('confirm-email-to-account')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('account-sign-out')),
        );
      });
    }

    testWidgets('a link the API never issued is a dead end', (tester) async {
      await pumpApp(
        tester,
        initialLocation: '${AppRoutes.confirmEmail}?token=never-issued',
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-email-error')),
      );

      expect(find.text('This confirmation link is not valid.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('confirm-email-to-account')),
        findsOneWidget,
      );
    });

    testWidgets('a link the API could not be reached for is tried again', (
      tester,
    ) async {
      repository
        ..emailChangeTokens = {'change-token': EmailChangeProgress.changed}
        ..confirmEmailChangeFailure = const AuthFailure(
          AuthFailureKind.network,
        );
      await pumpApp(
        tester,
        initialLocation: '${AppRoutes.confirmEmail}?token=change-token',
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-email-retry')),
      );

      repository.confirmEmailChangeFailure = null;
      await tester.tap(find.byKey(const ValueKey('confirm-email-retry')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-email-result')),
      );
    });
  });

  group('deletion', () {
    Future<void> submitPassword(
      WidgetTester tester, {
      String password = 'current-password',
    }) async {
      await tester.enterText(
        find.byKey(const ValueKey('delete-account-password')),
        password,
      );
      await tester.tap(find.byKey(const ValueKey('delete-account-submit')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-confirm')),
      );
    }

    testWidgets('nothing is deleted until the reader confirms', (tester) async {
      await openFromAccount(
        tester,
        'account-delete',
        'delete-account-password',
      );

      await submitPassword(tester);
      await tester.tap(find.byKey(const ValueKey('delete-account-cancel')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(repository.deleted, isFalse);
      expect(auth.isSignedIn, isTrue);
      expect(
        find.byKey(const ValueKey('delete-account-password')),
        findsOneWidget,
      );
    });

    testWidgets('a confirmed deletion leaves no session behind', (
      tester,
    ) async {
      final messaging = FakePushMessaging();
      addTearDown(messaging.close);
      final push = PushController(
        messaging: messaging,
        repository: FakePushRepository(),
        store: InMemoryPushDeviceStore(),
        platform: PushPlatform.android,
      );
      addTearDown(push.dispose);
      await pumpApp(tester, push: push);
      await tapVisible(
        tester,
        find.byKey(const ValueKey('account-notifications')),
        scrollable: accountList,
      );
      await pumpUntilTrue(tester, () => push.enabled);

      await tapVisible(
        tester,
        find.byKey(const ValueKey('account-delete')),
        scrollable: accountList,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-password')),
      );
      await submitPassword(tester);
      await tester.tap(
        find.byKey(const ValueKey('delete-account-confirm-delete')),
      );
      await pumpUntilFound(
        tester,
        find.text(
          'Your account has been deleted. Thank you for using the site.',
        ),
      );

      expect(repository.deleted, isTrue);
      expect(auth.isSignedIn, isFalse);
      expect(auth.accessToken, isEmpty);
      expect(store.session, isNull);
      expect(messaging.deletedTokens, 1);
      expect(
        find.byKey(const ValueKey('delete-account-password')),
        findsNothing,
      );
    });

    testWidgets('a wrong password keeps the account and the session', (
      tester,
    ) async {
      await openFromAccount(
        tester,
        'account-delete',
        'delete-account-password',
      );

      await submitPassword(tester, password: 'mistyped-password');
      await tester.tap(
        find.byKey(const ValueKey('delete-account-confirm-delete')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('delete-account-error')),
      );

      expect(
        find.text('Could not delete your account. Check what you entered.'),
        findsOneWidget,
      );
      expect(repository.deleted, isFalse);
      expect(auth.isSignedIn, isTrue);
      expect(store.session, isNotNull);
    });

    testWidgets('an empty password never opens the confirmation', (
      tester,
    ) async {
      await openFromAccount(
        tester,
        'account-delete',
        'delete-account-password',
      );

      await tester.tap(find.byKey(const ValueKey('delete-account-submit')));
      await tester.pump();

      expect(find.text('Enter your password.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('delete-account-confirm')),
        findsNothing,
      );
    });
  });
}
