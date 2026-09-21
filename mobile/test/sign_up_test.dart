import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  const email = 'new@example.com';
  const password = 'newpassword';

  late FakeAuthRepository repository;
  late AuthController auth;
  late FakeCatalogRepository catalog;

  setUp(() {
    repository = FakeAuthRepository();
    auth = fakeAuthController(repository: repository);
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.signUp,
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

  Future<void> fillSignUpForm(
    WidgetTester tester, {
    String name = 'New Reader',
    String confirmPassword = password,
  }) async {
    await tester.enterText(find.byKey(const ValueKey('sign-up-name')), name);
    await tester.enterText(find.byKey(const ValueKey('sign-up-email')), email);
    await tester.enterText(
      find.byKey(const ValueKey('sign-up-password')),
      password,
    );
    await tester.enterText(
      find.byKey(const ValueKey('sign-up-password-confirm')),
      confirmPassword,
    );
    await tester.tap(find.byKey(const ValueKey('sign-up-submit')));
  }

  testWidgets('the sign-in screen leads to the sign-up form', (tester) async {
    await pumpApp(tester, initialLocation: AppRoutes.signIn);

    await tester.tap(find.byKey(const ValueKey('sign-in-to-sign-up')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-up-submit')));

    expect(find.byKey(const ValueKey('sign-up-email')), findsOneWidget);
  });

  testWidgets('an accepted sign-up waits for the confirmation email', (
    tester,
  ) async {
    await pumpApp(tester);

    await fillSignUpForm(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-up-pending')));

    final sent = repository.lastSignUp!;
    expect(sent.name, 'New Reader');
    expect(sent.email, email);
    expect(sent.password, password);
    expect(sent.birthDate, isEmpty);
    expect(find.text('Sent to: $email'), findsOneWidget);
  });

  testWidgets('a birth date is offered where the tenant checks ages', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('sign-up-birth-date')),
    );

    expect(find.text('Date of birth'), findsOneWidget);
  });

  testWidgets('no birth date is asked for where the tenant checks none', (
    tester,
  ) async {
    repository.verification = AgeVerification.none;
    await pumpApp(tester);
    // The form is already up; the tenant answer lands a frame or two later.
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byKey(const ValueKey('sign-up-birth-date')), findsNothing);
  });

  testWidgets('mismatched passwords are refused before the API is called', (
    tester,
  ) async {
    await pumpApp(tester);

    await fillSignUpForm(tester, confirmPassword: 'something-else');
    await pumpUntilFound(
      tester,
      find.text(
        'The passwords do not match. Enter the same password in both fields.',
      ),
    );

    expect(repository.lastSignUp, isNull);
  });

  testWidgets('a refused sign-up keeps the form and says why', (tester) async {
    repository.signUpFailure = const AuthFailure(AuthFailureKind.rateLimited);
    await pumpApp(tester);

    await fillSignUpForm(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-up-error')));

    expect(
      find.text(
        'Too many requests in a short time. Please wait a moment and try again.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('sign-up-submit')), findsOneWidget);
  });

  testWidgets('the pending state asks for another confirmation email', (
    tester,
  ) async {
    await pumpApp(tester);
    await fillSignUpForm(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-up-pending')));

    await tester.tap(find.byKey(const ValueKey('sign-up-pending-resend')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('sign-up-pending-resent')),
    );

    expect(repository.requestedVerifications, [email]);
  });

  testWidgets('a resend the API refuses says so and leaves the way back', (
    tester,
  ) async {
    repository.requestVerificationFailure = const AuthFailure(
      AuthFailureKind.network,
    );
    await pumpApp(tester);
    await fillSignUpForm(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-up-pending')));

    await tester.tap(find.byKey(const ValueKey('sign-up-pending-resend')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('sign-up-pending-error')),
    );

    expect(
      find.text('Could not connect to the server. Please try again later.'),
      findsOneWidget,
    );
  });

  testWidgets('a confirmation link confirms the address and offers sign-in', (
    tester,
  ) async {
    repository.verificationTokens = {'good-token'};
    await pumpApp(tester, initialLocation: '/verify?token=good-token');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('verify-email-verified')),
    );

    await tester.tap(find.byKey(const ValueKey('verify-email-sign-in')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));

    expect(find.byKey(const ValueKey('sign-in-email')), findsOneWidget);
  });

  testWidgets('an expired link leads to a fresh confirmation email', (
    tester,
  ) async {
    repository.verifyEmailFailure = const AuthFailure(
      AuthFailureKind.verificationTokenExpired,
    );
    await pumpApp(tester, initialLocation: '/verify?token=stale-token');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('verify-email-error')),
    );

    expect(find.text('This confirmation link has expired.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('verify-email-resend')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('resend-verification-submit')),
    );
  });

  testWidgets('a link that lost its token never reaches the API', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.verifyEmail);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('verify-email-error')),
    );

    expect(find.text('This confirmation link is not valid.'), findsOneWidget);
    expect(find.byKey(const ValueKey('verify-email-resend')), findsOneWidget);
  });

  testWidgets('an unreachable API leaves the link to be spent again', (
    tester,
  ) async {
    repository.verifyEmailFailure = const AuthFailure(AuthFailureKind.network);
    await pumpApp(tester, initialLocation: '/verify?token=good-token');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('verify-email-error')),
    );

    expect(find.byKey(const ValueKey('verify-email-retry')), findsOneWidget);

    repository
      ..verifyEmailFailure = null
      ..verificationTokens = {'good-token'};
    await tester.tap(find.byKey(const ValueKey('verify-email-retry')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('verify-email-verified')),
    );
  });

  testWidgets('the resend form reports that the request was taken', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.resendVerification);

    await tester.enterText(
      find.byKey(const ValueKey('resend-verification-email')),
      email,
    );
    await tester.tap(find.byKey(const ValueKey('resend-verification-submit')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('resend-verification-sent')),
    );

    expect(repository.requestedVerifications, [email]);
  });

  testWidgets('sign-in offers a new link for an address never confirmed', (
    tester,
  ) async {
    repository.signInFailure = const AuthFailure(
      AuthFailureKind.emailNotVerified,
    );
    await pumpApp(tester, initialLocation: AppRoutes.signIn);
    await tester.enterText(find.byKey(const ValueKey('sign-in-email')), email);
    await tester.enterText(
      find.byKey(const ValueKey('sign-in-password')),
      password,
    );
    await tester.tap(find.byKey(const ValueKey('sign-in-submit')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('sign-in-resend-verification')),
    );

    await tester.tap(find.byKey(const ValueKey('sign-in-resend-verification')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('resend-verification-submit')),
    );

    // The address the refused attempt used, so it is not typed twice.
    expect(find.text(email), findsOneWidget);
  });
}
