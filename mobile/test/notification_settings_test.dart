import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  late FakeAuthRepository repository;
  late InMemorySessionStore store;
  late AuthController auth;

  final emailSwitch = find.byKey(const ValueKey('account-email-notifications'));
  final emailFailure = find.byKey(
    const ValueKey('account-email-notifications-failure'),
  );
  final preferencesFailure = find.byKey(
    const ValueKey('account-notification-preferences-failure'),
  );
  final accountList = find.descendant(
    of: find.byKey(const ValueKey('account-list')),
    matching: find.byType(Scrollable),
  );

  Finder cellSwitch(NotificationCell cell) => find.byKey(
    ValueKey(('account-notification', cell.$1.name, cell.$2.name)),
  );
  Finder categoryTitle(NotificationCategory category) =>
      find.byKey(ValueKey(('account-notification-category', category.name)));
  Finder channelHeading(NotificationChannel channel) =>
      find.byKey(ValueKey(('account-notification-channel', channel.name)));

  const commentsInbox = (
    NotificationCategory.comments,
    NotificationChannel.inbox,
  );
  const creatorsInbox = (
    NotificationCategory.followedCreators,
    NotificationChannel.inbox,
  );
  const creatorsWebPush = (
    NotificationCategory.followedCreators,
    NotificationChannel.webPush,
  );
  const creatorsMobilePush = (
    NotificationCategory.followedCreators,
    NotificationChannel.mobilePush,
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
  ///
  /// The scroll that brings the row fully into view is a jump the next frame
  /// lays out, so the frame is pumped before anything taps where it stands.
  Future<void> showRow(WidgetTester tester, Finder row) async {
    await tester.scrollUntilVisible(row, 100, scrollable: accountList);
    await tester.pump();
  }

  /// The email setting each request wrote, in order.
  List<bool> updatedEmail() => [
    for (final update in repository.notificationSettingsUpdates)
      update.emailEnabled,
  ];

  /// The cells each request wrote, in order.
  List<Map<NotificationCell, bool>> updatedCells() => [
    for (final update in repository.notificationSettingsUpdates) update.cells,
  ];

  bool emailValue(WidgetTester tester) =>
      tester.widget<SwitchListTile>(emailSwitch).value;
  bool cellValue(WidgetTester tester, NotificationCell cell) =>
      tester.widget<SwitchListTile>(cellSwitch(cell)).value;
  bool? categoryValue(WidgetTester tester, NotificationCategory category) =>
      tester.widget<CheckboxListTile>(categoryTitle(category)).value;

  group('preferences', () {
    testWidgets('a section per category, with a switch per channel the '
        'server delivers it on', (tester) async {
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      for (final cell in notificationCells) {
        expect(cellSwitch(cell), findsOneWidget, reason: '$cell');
      }
      expect(
        cellSwitch((
          NotificationCategory.comments,
          NotificationChannel.mobilePush,
        )),
        findsNothing,
      );
      expect(
        cellSwitch((
          NotificationCategory.announcements,
          NotificationChannel.webPush,
        )),
        findsNothing,
      );
      expect(find.text('Your comments'), findsOneWidget);
      expect(find.text('New episodes by authors you follow'), findsOneWidget);
    });

    testWidgets('shows the cells the account holds', (tester) async {
      repository.notificationSettings = repository.notificationSettings
          .copyWith(cells: {commentsInbox: false});
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      expect(cellValue(tester, commentsInbox), isFalse);
      expect(categoryValue(tester, NotificationCategory.comments), isFalse);
      expect(cellValue(tester, creatorsInbox), isTrue);
      expect(
        categoryValue(tester, NotificationCategory.followedCreators),
        isTrue,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.descendant(
                of: channelHeading(NotificationChannel.inbox),
                matching: find.byType(Checkbox),
              ),
            )
            .value,
        isNull,
      );
    });

    testWidgets('turning one switch off writes that cell alone and is still '
        'off on the next visit', (tester) async {
      repository.notificationSettings = repository.notificationSettings
          .copyWith(emailEnabled: false);
      await pumpApp(tester);
      await showRow(tester, cellSwitch(creatorsWebPush));

      await tester.tap(cellSwitch(creatorsWebPush));
      await tester.pumpAndSettle();

      expect(updatedEmail(), [false]);
      expect(updatedCells(), [
        {creatorsWebPush: false},
      ]);
      expect(cellValue(tester, creatorsWebPush), isFalse);
      expect(preferencesFailure, findsNothing);

      // A screen built afresh reads what the account now holds.
      await tester.pumpWidget(const SizedBox.shrink());
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      expect(cellValue(tester, creatorsWebPush), isFalse);
      for (final cell in notificationCells) {
        if (cell != creatorsWebPush) {
          expect(cellValue(tester, cell), isTrue, reason: '$cell');
        }
      }
      expect(emailValue(tester), isFalse);
    });

    testWidgets('a section title with mixed switches turns them all on, and '
        'off again', (tester) async {
      repository.notificationSettings = repository.notificationSettings
          .copyWith(cells: {creatorsInbox: false});
      await pumpApp(tester);
      final title = categoryTitle(NotificationCategory.followedCreators);
      await showRow(tester, title);
      expect(
        categoryValue(tester, NotificationCategory.followedCreators),
        isNull,
      );

      await tester.tap(title);
      await tester.pumpAndSettle();

      expect(
        categoryValue(tester, NotificationCategory.followedCreators),
        isTrue,
      );
      for (final cell in [creatorsInbox, creatorsWebPush, creatorsMobilePush]) {
        expect(cellValue(tester, cell), isTrue, reason: '$cell');
      }

      await tester.tap(title);
      await tester.pumpAndSettle();

      expect(
        categoryValue(tester, NotificationCategory.followedCreators),
        isFalse,
      );
      for (final cell in [creatorsInbox, creatorsWebPush, creatorsMobilePush]) {
        expect(cellValue(tester, cell), isFalse, reason: '$cell');
      }
      // One request per tap, however many switches it moves.
      expect(updatedEmail(), [true, true]);
      expect(updatedCells(), [
        {creatorsInbox: true, creatorsWebPush: true, creatorsMobilePush: true},
        {
          creatorsInbox: false,
          creatorsWebPush: false,
          creatorsMobilePush: false,
        },
      ]);
      expect(cellValue(tester, commentsInbox), isTrue);
    });

    testWidgets('a channel heading turns that channel on in every section, '
        'and off again', (tester) async {
      repository.notificationSettings = repository.notificationSettings
          .copyWith(cells: {commentsInbox: false});
      await pumpApp(tester);
      final heading = channelHeading(NotificationChannel.inbox);
      await showRow(tester, heading);

      await tester.tap(heading);
      await tester.pumpAndSettle();

      final inbox = cellsOfChannel(NotificationChannel.inbox);
      expect(repository.notificationSettingsUpdates.single.cells, {
        for (final cell in inbox) cell: true,
      });

      await tester.tap(heading);
      await tester.pumpAndSettle();

      expect(repository.notificationSettingsUpdates.last.cells, {
        for (final cell in inbox) cell: false,
      });
      await showRow(tester, emailSwitch);
      for (final cell in notificationCells) {
        expect(
          cellValue(tester, cell),
          cell.$2 != NotificationChannel.inbox,
          reason: '$cell',
        );
      }
    });

    testWidgets('a refused change moves back and is worded under its section', (
      tester,
    ) async {
      repository.updateNotificationSettingsFailure = const AuthFailure(
        AuthFailureKind.unexpected,
      );
      await pumpApp(tester);
      await showRow(tester, cellSwitch(commentsInbox));

      await tester.tap(cellSwitch(commentsInbox));
      await tester.pumpAndSettle();

      expect(cellValue(tester, commentsInbox), isTrue);
      expect(
        find.descendant(
          of: preferencesFailure,
          matching: find.text(
            'Could not change your notification preferences. Try again.',
          ),
        ),
        findsOneWidget,
      );
      expect(emailFailure, findsNothing);
    });
  });

  group('email', () {
    testWidgets('shows the setting the account holds', (tester) async {
      repository.notificationSettings = repository.notificationSettings
          .copyWith(emailEnabled: false);
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      expect(emailValue(tester), isFalse);
      expect(find.text('Email notifications'), findsOneWidget);
      expect(
        find.text(
          'Receive subscription updates and important announcements by email.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('turning the switch off writes it and no cell', (tester) async {
      await pumpApp(tester);
      await showRow(tester, emailSwitch);
      expect(emailValue(tester), isTrue);

      await tester.tap(emailSwitch);
      await tester.pumpAndSettle();

      expect(updatedEmail(), [false]);
      expect(updatedCells(), [<NotificationCell, bool>{}]);
      expect(repository.notificationSettings.emailEnabled, isFalse);
      expect(emailValue(tester), isFalse);
      expect(emailFailure, findsNothing);
    });

    testWidgets('a refused change moves back and can be tried again', (
      tester,
    ) async {
      repository.updateNotificationSettingsFailure = const AuthFailure(
        AuthFailureKind.unexpected,
      );
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      await tester.tap(emailSwitch);
      await tester.pumpAndSettle();

      expect(emailValue(tester), isTrue);
      expect(repository.notificationSettings.emailEnabled, isTrue);
      expect(
        find.text(
          'Could not change your email notification setting. Try again.',
        ),
        findsOneWidget,
      );
      expect(preferencesFailure, findsNothing);

      repository.updateNotificationSettingsFailure = null;
      await tester.tap(emailSwitch);
      await tester.pumpAndSettle();

      expect(repository.notificationSettingsUpdates, hasLength(2));
      expect(emailValue(tester), isFalse);
      expect(emailFailure, findsNothing);
    });

    testWidgets('an unreachable API is told apart from a refusal', (
      tester,
    ) async {
      repository.updateNotificationSettingsFailure = const AuthFailure(
        AuthFailureKind.network,
      );
      await pumpApp(tester);
      await showRow(tester, emailSwitch);

      await tester.tap(emailSwitch);
      await tester.pumpAndSettle();

      expect(emailValue(tester), isTrue);
      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOneWidget,
      );
    });
  });

  testWidgets('a section of its own, apart from the birth date row', (
    tester,
  ) async {
    await pumpApp(tester);
    final birthDate = find.byKey(ValueKey(fakeSession.userPublicId));
    await showRow(tester, birthDate);

    // Both start over for another reader, but each by a key of its own: two
    // siblings of one list sharing a key would be told apart by neither.
    expect(birthDate, findsOneWidget);
    await showRow(tester, emailSwitch);
    expect(emailSwitch, findsOneWidget);
  });

  testWidgets('another reader signing in reads their own settings', (
    tester,
  ) async {
    repository.notificationSettings = repository.notificationSettings.copyWith(
      emailEnabled: false,
      cells: {commentsInbox: false},
    );
    await pumpApp(tester);
    await showRow(tester, emailSwitch);
    expect(emailValue(tester), isFalse);
    expect(cellValue(tester, commentsInbox), isFalse);

    await auth.signOut();
    repository
      ..session = fakeSession.withUser(
        userPublicId: 'OtherRDRAAA1',
        userName: 'Other Reader',
        userIconUrl: null,
        userIconPresetId: null,
      )
      ..notificationSettings = const NotificationSettings(
        emailEnabled: true,
        preferences: {},
      );
    await auth.signIn(email: 'other@example.com', password: 'password');
    await tester.pump();
    await showRow(tester, emailSwitch);

    expect(emailValue(tester), isTrue);
    expect(cellValue(tester, commentsInbox), isTrue);
  });

  testWidgets('every switch holds still while a change is being saved', (
    tester,
  ) async {
    final gate = repository.updateNotificationSettingsGate = Completer<void>();
    await pumpApp(tester);
    await showRow(tester, cellSwitch(commentsInbox));

    await tester.tap(cellSwitch(commentsInbox));
    await tester.pump();

    // The new position shows at once, and a second tap cannot race the first,
    // whose request writes the email setting too.
    expect(cellValue(tester, commentsInbox), isFalse);
    expect(
      tester.widget<SwitchListTile>(cellSwitch(commentsInbox)).onChanged,
      isNull,
    );
    expect(tester.widget<SwitchListTile>(emailSwitch).onChanged, isNull);
    expect(
      tester
          .widget<CheckboxListTile>(
            categoryTitle(NotificationCategory.announcements),
          )
          .onChanged,
      isNull,
    );

    gate.complete();
    await tester.pumpAndSettle();

    expect(tester.widget<SwitchListTile>(emailSwitch).onChanged, isNotNull);
    expect(repository.notificationSettingsUpdates, hasLength(1));
  });

  testWidgets('offers a retry when the settings cannot be read', (
    tester,
  ) async {
    repository.notificationSettingsFailure = const AuthFailure(
      AuthFailureKind.network,
    );
    await pumpApp(tester);
    await showRow(
      tester,
      find.byKey(const ValueKey('account-notification-settings-error')),
    );
    expect(
      find.text('Could not load your notification settings.'),
      findsOneWidget,
    );
    expect(emailSwitch, findsNothing);
    expect(cellSwitch(commentsInbox), findsNothing);

    repository
      ..notificationSettingsFailure = null
      ..notificationSettings = repository.notificationSettings.copyWith(
        emailEnabled: false,
      );
    await tester.tap(
      find.byKey(const ValueKey('account-notification-settings-retry')),
    );
    await showRow(tester, emailSwitch);

    expect(emailValue(tester), isFalse);
  });

  testWidgets('a session the API has dropped signs the reader out', (
    tester,
  ) async {
    repository.updateNotificationSettingsFailure = const AuthFailure(
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
