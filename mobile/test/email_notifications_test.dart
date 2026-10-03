import 'dart:async';

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
  late FakeAuthRepository repository;
  late InMemorySessionStore store;
  late AuthController auth;

  final emailSwitch = find.byKey(const ValueKey('account-email-notifications'));
  final failure = find.byKey(
    const ValueKey('account-email-notifications-failure'),
  );
  final accountList = find.descendant(
    of: find.byKey(const ValueKey('account-list')),
    matching: find.byType(Scrollable),
  );

  setUp(() {
    repository = FakeAuthRepository();
    store = InMemorySessionStore(session: fakeSession);
  });

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: AppRoutes.account),
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: auth = fakeAuthController(
          session: fakeSession,
          repository: repository,
          store: store,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Scrolls the account screen until [row], which sits below the rows above
  /// it, is on screen.
  Future<void> showRow(WidgetTester tester, Finder row) =>
      tester.scrollUntilVisible(row, 100, scrollable: accountList);

  bool switchValue(WidgetTester tester) =>
      tester.widget<SwitchListTile>(emailSwitch).value;

  testWidgets('shows the setting the account holds', (tester) async {
    repository.emailNotifications = false;
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    expect(switchValue(tester), isFalse);
    expect(find.text('Email notifications'), findsOneWidget);
    expect(
      find.text(
        'Receive subscription updates and important announcements by email.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a row of its own, apart from the birth date row', (
    tester,
  ) async {
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    // Both rows start over for another reader, but each by a key of its own:
    // two siblings of one list sharing a key would be told apart by neither.
    expect(find.byKey(ValueKey(fakeSession.userPublicId)), findsOneWidget);
  });

  testWidgets('another reader signing in reads their own setting', (
    tester,
  ) async {
    repository.emailNotifications = false;
    await pumpApp(tester);
    await showRow(tester, emailSwitch);
    expect(switchValue(tester), isFalse);

    await auth.signOut();
    repository
      ..session = fakeSession.withUser(
        userPublicId: 'OtherRDRAAA1',
        userName: 'Other Reader',
      )
      ..emailNotifications = true;
    await auth.signIn(email: 'other@example.com', password: 'password');
    await tester.pump();
    await showRow(tester, emailSwitch);

    expect(switchValue(tester), isTrue);
  });

  testWidgets('turning the switch off writes it to the account', (
    tester,
  ) async {
    await pumpApp(tester);
    await showRow(tester, emailSwitch);
    expect(switchValue(tester), isTrue);

    await tester.tap(emailSwitch);
    await tester.pumpAndSettle();

    expect(repository.emailNotificationUpdates, [false]);
    expect(repository.emailNotifications, isFalse);
    expect(switchValue(tester), isFalse);
    expect(failure, findsNothing);
  });

  testWidgets('the switch holds still while a change is being saved', (
    tester,
  ) async {
    final gate = repository.updateEmailNotificationsGate = Completer<void>();
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    await tester.tap(emailSwitch);
    await tester.pump();

    // The new position shows at once, and a second tap cannot race the first.
    expect(switchValue(tester), isFalse);
    expect(tester.widget<SwitchListTile>(emailSwitch).onChanged, isNull);

    gate.complete();
    await tester.pumpAndSettle();

    expect(tester.widget<SwitchListTile>(emailSwitch).onChanged, isNotNull);
    expect(repository.emailNotificationUpdates, [false]);
  });

  testWidgets('a refused change moves back and can be tried again', (
    tester,
  ) async {
    repository.updateEmailNotificationsFailure = const AuthFailure(
      AuthFailureKind.unexpected,
    );
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    await tester.tap(emailSwitch);
    await tester.pumpAndSettle();

    expect(switchValue(tester), isTrue);
    expect(repository.emailNotifications, isTrue);
    expect(
      find.text('Could not change your email notification setting. Try again.'),
      findsOneWidget,
    );

    repository.updateEmailNotificationsFailure = null;
    await tester.tap(emailSwitch);
    await tester.pumpAndSettle();

    expect(repository.emailNotificationUpdates, [false, false]);
    expect(switchValue(tester), isFalse);
    expect(failure, findsNothing);
  });

  testWidgets('an unreachable API is told apart from a refusal', (
    tester,
  ) async {
    repository.updateEmailNotificationsFailure = const AuthFailure(
      AuthFailureKind.network,
    );
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    await tester.tap(emailSwitch);
    await tester.pumpAndSettle();

    expect(switchValue(tester), isTrue);
    expect(
      find.text('Could not connect to the server. Please try again later.'),
      findsOneWidget,
    );
  });

  testWidgets('offers a retry when the setting cannot be read', (tester) async {
    repository.emailNotificationsFailure = const AuthFailure(
      AuthFailureKind.network,
    );
    await pumpApp(tester);
    await showRow(
      tester,
      find.byKey(const ValueKey('account-email-notifications-error')),
    );
    expect(
      find.text('Could not load your email notification setting.'),
      findsOneWidget,
    );
    expect(emailSwitch, findsNothing);

    repository
      ..emailNotificationsFailure = null
      ..emailNotifications = false;
    await tester.tap(
      find.byKey(const ValueKey('account-email-notifications-retry')),
    );
    await showRow(tester, emailSwitch);

    expect(switchValue(tester), isFalse);
  });

  testWidgets('a session the API has dropped signs the reader out', (
    tester,
  ) async {
    repository.updateEmailNotificationsFailure = const AuthFailure(
      AuthFailureKind.sessionExpired,
    );
    await pumpApp(tester);
    await showRow(tester, emailSwitch);

    await tester.tap(emailSwitch);
    await pumpUntilFound(tester, find.byKey(const ValueKey('account-sign-in')));

    expect(auth.isSignedIn, isFalse);
    expect(store.session, isNull);
  });
}
