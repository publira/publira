import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/contact/contact_failure.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_contact_repository.dart';
import 'support/pump_until.dart';

void main() {
  late GoRouter router;
  late FakeAuthRepository auth;
  late FakeContactRepository contact;

  final birthDateRow = find.byKey(const ValueKey('account-birth-date'));
  final contactRow = find.byKey(const ValueKey('account-contact'));
  final emailField = find.byKey(const ValueKey('contact-email'));
  final subjectField = find.byKey(const ValueKey('contact-subject'));
  final bodyField = find.byKey(const ValueKey('contact-body'));
  final submit = find.byKey(const ValueKey('contact-submit'));
  final sent = find.byKey(const ValueKey('contact-sent'));
  final error = find.byKey(const ValueKey('contact-error'));

  setUp(() {
    router = createAppRouter(initialLocation: AppRoutes.account);
    auth = FakeAuthRepository(birthDate: '1990-04-02');
    contact = FakeContactRepository();
  });

  /// The account screen as [session] holds it, with the contact repository
  /// installed unless [withContact] takes it away.
  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    bool withContact = true,
  }) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: FakeCatalogRepository(),
        auth: fakeAuthController(session: session, repository: auth),
        contact: withContact ? contact : null,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  String textOf(WidgetTester tester, Finder field) {
    return tester
        .widget<TextField>(
          find.descendant(of: field, matching: find.byType(TextField)),
        )
        .controller!
        .text;
  }

  testWidgets('a reader with a wrong birth date sends a message about it', (
    tester,
  ) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, birthDateRow);

    await tester.tap(birthDateRow);
    await pumpUntilFound(tester, submit);
    await tester.pumpAndSettle();

    expect(textOf(tester, emailField), 'member@example.com');

    await tester.enterText(subjectField, 'Date of birth');
    await tester.enterText(
      bodyField,
      '  My date of birth should be 1990-02-04.  ',
    );
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(contact.sent, [
      (
        replyToEmail: 'member@example.com',
        subject: 'Date of birth',
        body: 'My date of birth should be 1990-02-04.',
      ),
    ]);
    expect(sent, findsOneWidget);
    expect(find.text('Your message has been sent'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('contact-done')));
    await tester.pumpAndSettle();

    expect(birthDateRow, findsOneWidget);
  });

  testWidgets('a signed-out reader reaches the form from the account screen', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, contactRow);

    await tester.tap(contactRow);
    await pumpUntilFound(tester, submit);
    await tester.pumpAndSettle();

    expect(textOf(tester, emailField), isEmpty);

    await tester.enterText(emailField, 'guest@example.com');
    await tester.enterText(bodyField, 'I cannot sign in.');
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(contact.sent.single.replyToEmail, 'guest@example.com');
    expect(contact.sent.single.subject, isEmpty);
    expect(sent, findsOneWidget);
  });

  testWidgets('a signed-in reader reaches the form from the account screen', (
    tester,
  ) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, contactRow);

    await tester.tap(contactRow);
    await pumpUntilFound(tester, submit);

    expect(router.state.uri.path, AppRoutes.accountContact);
  });

  testWidgets('a refused message keeps what the reader typed', (tester) async {
    contact.failure = const ContactFailure(ContactFailureKind.rateLimited);
    await pumpApp(tester);
    await pumpUntilFound(tester, contactRow);
    await tester.tap(contactRow);
    await pumpUntilFound(tester, submit);

    await tester.enterText(emailField, 'guest@example.com');
    await tester.enterText(subjectField, 'Hello');
    await tester.enterText(bodyField, 'A question.');
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(sent, findsNothing);
    expect(error, findsOneWidget);
    expect(
      find.text(
        'Too many requests in a short time. '
        'Please wait a moment and try again.',
      ),
      findsOneWidget,
    );
    expect(textOf(tester, emailField), 'guest@example.com');
    expect(textOf(tester, subjectField), 'Hello');
    expect(textOf(tester, bodyField), 'A question.');

    contact.failure = null;
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(contact.sent, hasLength(2));
    expect(sent, findsOneWidget);
  });

  testWidgets('an incomplete form sends nothing and says what is missing', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, contactRow);
    await tester.tap(contactRow);
    await pumpUntilFound(tester, submit);

    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(find.text('Enter your email address.'), findsOneWidget);
    expect(find.text('Enter a message.'), findsOneWidget);

    await tester.enterText(emailField, 'not an address');
    await tester.enterText(bodyField, 'x' * 4001);
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(
      find.text('Keep the message to 4000 characters or fewer.'),
      findsOneWidget,
    );
    expect(contact.sent, isEmpty);
  });

  testWidgets('an address the reader started typing is not replaced', (
    tester,
  ) async {
    final gate = auth.emailGate = Completer<void>();
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, contactRow);
    await tester.tap(contactRow);
    await pumpUntilFound(tester, submit);
    await tester.enterText(emailField, 'other@example.com');
    gate.complete();
    await tester.pumpAndSettle();

    expect(textOf(tester, emailField), 'other@example.com');
  });

  testWidgets('a build with no contact form leads to none', (tester) async {
    await pumpApp(tester, session: fakeSession, withContact: false);
    await pumpUntilFound(tester, birthDateRow);
    await tester.pumpAndSettle();

    expect(contactRow, findsNothing);
    await tester.tap(birthDateRow);
    await tester.pumpAndSettle();
    expect(router.state.uri.path, AppRoutes.account);
  });
}
