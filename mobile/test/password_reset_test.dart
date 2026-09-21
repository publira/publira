import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  const email = 'member@example.com';
  const newPassword = 'replaced-password';
  const token = 'good-token';

  late FakeAuthRepository repository;
  late InMemorySessionStore store;
  late AuthController auth;
  late FakeCatalogRepository catalog;

  setUp(() {
    repository = FakeAuthRepository()..resetTokens = {token};
    store = InMemorySessionStore();
    auth = fakeAuthController(repository: repository, store: store);
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.resetPassword,
  }) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: initialLocation),
        catalog: catalog,
        auth: auth,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> fillNewPassword(
    WidgetTester tester, {
    String confirmPassword = newPassword,
  }) async {
    await tester.enterText(
      find.byKey(const ValueKey('confirm-password-password')),
      newPassword,
    );
    await tester.enterText(
      find.byKey(const ValueKey('confirm-password-password-confirm')),
      confirmPassword,
    );
    await tester.tap(find.byKey(const ValueKey('confirm-password-submit')));
  }

  testWidgets('sign-in leads to the reset form with the address typed', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.signIn);
    await tester.enterText(find.byKey(const ValueKey('sign-in-email')), email);

    await tester.tap(find.byKey(const ValueKey('sign-in-forgot-password')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reset-password-submit')),
    );

    expect(find.text(email), findsOneWidget);
  });

  testWidgets('an accepted request names the address the link went to', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.enterText(
      find.byKey(const ValueKey('reset-password-email')),
      email,
    );
    await tester.tap(find.byKey(const ValueKey('reset-password-submit')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reset-password-sent')),
    );

    expect(repository.requestedPasswordResets, [email]);
    expect(find.text('Sent to: $email'), findsOneWidget);
  });

  testWidgets('a refused request keeps the form and says why', (tester) async {
    repository.requestResetFailure = const AuthFailure(
      AuthFailureKind.rateLimited,
    );
    await pumpApp(
      tester,
      initialLocation: AppRoutes.resetPasswordPath(email: email),
    );

    await tester.tap(find.byKey(const ValueKey('reset-password-submit')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reset-password-error')),
    );

    expect(
      find.text(
        'Too many requests in a short time. Please wait a moment and try again.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('reset-password-submit')), findsOneWidget);
  });

  testWidgets('a reset link sets the new password and offers sign-in', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

    await fillNewPassword(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('confirm-password-done')),
    );
    expect(repository.resetPassword, newPassword);

    await tester.tap(find.byKey(const ValueKey('confirm-password-sign-in')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));
  });

  testWidgets('mismatched passwords are refused before the API is called', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

    await fillNewPassword(tester, confirmPassword: 'something-else');
    await pumpUntilFound(
      tester,
      find.text(
        'The passwords do not match. Enter the same password in both fields.',
      ),
    );

    expect(repository.resetPassword, isNull);
  });

  testWidgets('an expired link leads to a fresh reset request', (tester) async {
    repository.confirmResetFailure = const AuthFailure(
      AuthFailureKind.linkExpired,
    );
    await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

    await fillNewPassword(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('confirm-password-link-error')),
    );
    expect(find.text('This reset link has expired.'), findsOneWidget);

    await tester.tap(
      find.byKey(const ValueKey('confirm-password-request-again')),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reset-password-submit')),
    );
  });

  testWidgets('a link the API never issued leads to a fresh request', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: '/confirm-password?token=unknown');

    await fillNewPassword(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('confirm-password-link-error')),
    );

    expect(find.text('This reset link is not valid.'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('confirm-password-request-again')),
      findsOneWidget,
    );
  });

  testWidgets('a link that lost its token offers no form at all', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.confirmPassword);

    expect(find.text('This reset link is not valid.'), findsOneWidget);
    expect(find.byKey(const ValueKey('confirm-password-submit')), findsNothing);
  });

  testWidgets('an unreachable API keeps the form to submit again', (
    tester,
  ) async {
    repository.confirmResetFailure = const AuthFailure(AuthFailureKind.network);
    await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

    await fillNewPassword(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('confirm-password-error')),
    );
    expect(
      find.text('Could not connect to the server. Please try again later.'),
      findsOneWidget,
    );

    repository.confirmResetFailure = null;
    await tester.tap(find.byKey(const ValueKey('confirm-password-submit')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('confirm-password-done')),
    );
  });

  group('a session the device already holds', () {
    setUp(() {
      store = InMemorySessionStore(session: fakeSession);
      auth = fakeAuthController(
        repository: repository,
        store: store,
        session: fakeSession,
      );
    });

    testWidgets('is dropped once the reset has ended it', (tester) async {
      await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

      await fillNewPassword(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-password-done')),
      );

      expect(auth.isSignedIn, isFalse);
      expect(store.session, isNull);
      // The reader replaced the password themselves, so they are not told
      // their session expired.
      expect(auth.acknowledgeExpiry(), isFalse);
    });

    testWidgets('is kept when it belongs to another account', (tester) async {
      repository.refreshFailureAfterReset = null;
      await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

      await fillNewPassword(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-password-done')),
      );

      expect(auth.isSignedIn, isTrue);
      expect(store.session?.accessToken, fakeSession.accessToken);
    });

    testWidgets('is kept when it could not be checked', (tester) async {
      repository.refreshFailureAfterReset = const AuthFailure(
        AuthFailureKind.network,
      );
      await pumpApp(tester, initialLocation: '/confirm-password?token=$token');

      await fillNewPassword(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('confirm-password-done')),
      );

      expect(auth.isSignedIn, isTrue);
    });
  });
}
