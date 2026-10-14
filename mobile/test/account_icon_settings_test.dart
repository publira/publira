import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/account_icon_picker.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/router.dart';

import 'support/fake_account_icon_picker.dart';
import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/icon_images.dart';
import 'support/pump_until.dart';

void main() {
  final shownIcon = Uri.parse('http://images.test/user-icons/0.png');
  final withIcon = fakeSession.withUser(
    userPublicId: fakeSession.userPublicId,
    userName: fakeSession.userName,
    userIconUrl: shownIcon,
  );

  late FakeAuthRepository repository;
  late InMemorySessionStore store;
  late AuthController auth;

  void signInAs(AuthSession session) {
    repository = FakeAuthRepository(session: session);
    store = InMemorySessionStore(session: session);
    auth = fakeAuthController(
      session: session,
      repository: repository,
      store: store,
    );
  }

  setUp(() => signInAs(fakeSession));

  Future<void> pumpAccount(
    WidgetTester tester, {
    AccountIconPicker? picker,
  }) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: AppRoutes.account),
        catalog: FakeCatalogRepository(series: fixtureSeries),
        auth: auth,
        iconPicker: picker,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  final upload = find.byKey(const ValueKey('account-icon-upload'));
  final remove = find.byKey(const ValueKey('account-icon-remove'));
  final shown = find.byKey(const ValueKey('account-icon'));
  final fallback = find.byKey(const ValueKey('account-icon-fallback'));
  final failure = find.byKey(const ValueKey('account-icon-failure'));

  testWidgets(
    'an account with no icon shows the fallback and offers an upload',
    (tester) async {
      await pumpAccount(tester, picker: FakeAccountIconPicker([]));

      expect(fallback, findsOneWidget);
      expect(shown, findsNothing);
      expect(
        find.descendant(of: upload, matching: find.text('Upload icon')),
        findsOneWidget,
      );
      expect(remove, findsNothing);
    },
  );

  testWidgets('an upload shows the icon, and another one replaces it', (
    tester,
  ) async {
    final first = pngIcon();
    final second = jpegIcon(width: 640, height: 480);
    final picker = FakeAccountIconPicker([first, second]);
    await pumpAccount(tester, picker: picker);

    await tester.tap(upload);
    await pumpUntilFound(tester, shown);

    expect(repository.iconUploads.single.bytes, same(first));
    expect(picker.pickedFor, [fakeSession.userPublicId]);
    expect(repository.iconUploads.single.contentType, 'image/png');
    expect(auth.session?.userIconUrl, FakeAuthRepository.uploadedIconUrl(1));
    expect(store.session?.userIconUrl, FakeAuthRepository.uploadedIconUrl(1));
    expect(find.text('Your icon has been updated.'), findsOneWidget);
    expect(
      find.descendant(of: upload, matching: find.text('Change icon')),
      findsOneWidget,
    );
    expect(remove, findsOneWidget);

    await tester.tap(upload);
    await pumpUntilTrue(
      tester,
      () => repository.iconUploads.length == 2,
      description: 'the second upload',
    );
    await tester.pump();

    expect(repository.iconUploads.last.contentType, 'image/jpeg');
    expect(auth.session?.userIconUrl, FakeAuthRepository.uploadedIconUrl(2));
    expect(shown, findsOneWidget);
  });

  testWidgets('removing the icon shows the fallback again', (tester) async {
    signInAs(withIcon);
    await pumpAccount(tester, picker: FakeAccountIconPicker([]));
    expect(shown, findsOneWidget);

    await tester.tap(remove);
    await pumpUntilFound(tester, fallback);

    expect(repository.iconRemovals, 1);
    expect(auth.session?.userIconUrl, isNull);
    expect(store.session?.userIconUrl, isNull);
    expect(find.text('Your icon has been removed.'), findsOneWidget);
    expect(remove, findsNothing);
    expect(
      find.descendant(of: upload, matching: find.text('Upload icon')),
      findsOneWidget,
    );
  });

  testWidgets(
    'an image the API would refuse is turned away before it is sent',
    (tester) async {
      final picks = {
        'This image is smaller than 128x128px. Select a larger one.': pngIcon(
          width: 512,
          height: 100,
        ),
        'This file cannot be used. Select a JPEG, PNG, or WebP image.':
            Uint8List.fromList('GIF89a'.codeUnits),
        'This image is larger than 10MB. Select a smaller one.': pngIcon(
          padding: 10 * 1024 * 1024,
        ),
      };
      await pumpAccount(
        tester,
        picker: FakeAccountIconPicker(picks.values.toList()),
      );

      for (final copy in picks.keys) {
        await tester.tap(upload);
        await pumpUntilFound(tester, find.text(copy));
        expect(failure, findsOneWidget);
      }
      expect(repository.iconUploads, isEmpty);
      expect(fallback, findsOneWidget);
    },
  );

  testWidgets('a dismissed picker sends nothing', (tester) async {
    await pumpAccount(tester, picker: FakeAccountIconPicker([null]));

    await tester.tap(upload);
    await tester.pump();

    expect(repository.iconUploads, isEmpty);
    expect(failure, findsNothing);
    expect(tester.widget<OutlinedButton>(upload).onPressed, isNotNull);
  });

  testWidgets('a refused change keeps the icon and says why', (tester) async {
    signInAs(withIcon);
    final refusals = {
      AuthFailureKind.iconRefused:
          'This image cannot be used as an icon. Select a JPEG, PNG, or WebP '
          'image no larger than 10MB and at least 128x128px.',
      AuthFailureKind.storageNotConfigured:
          'Icons cannot be uploaded on this site right now. Contact the site '
          'if this continues.',
      AuthFailureKind.network:
          'Could not connect to the server. Please try again later.',
      AuthFailureKind.unexpected: 'Could not update your icon. Try again.',
    };
    await pumpAccount(
      tester,
      picker: FakeAccountIconPicker([for (final _ in refusals.keys) pngIcon()]),
    );

    for (final MapEntry(key: kind, value: copy) in refusals.entries) {
      repository.iconFailure = AuthFailure(kind);
      await tester.tap(upload);
      await pumpUntilFound(tester, find.text(copy));
    }
    expect(auth.session?.userIconUrl, shownIcon);
    expect(shown, findsOneWidget);

    repository.iconFailure = const AuthFailure(AuthFailureKind.unexpected);
    await tester.tap(remove);
    await pumpUntilFound(
      tester,
      find.text('Could not remove your icon. Try again.'),
    );
    expect(auth.session?.userIconUrl, shownIcon);
  });

  testWidgets('a picker that fails says the icon was not updated', (
    tester,
  ) async {
    final picker = FakeAccountIconPicker([])
      ..failure = Exception('photo library unavailable');
    await pumpAccount(tester, picker: picker);

    await tester.tap(upload);
    await pumpUntilFound(
      tester,
      find.text('Could not update your icon. Try again.'),
    );
    expect(repository.iconUploads, isEmpty);
  });

  testWidgets('the controls wait while a change is in flight', (tester) async {
    signInAs(withIcon);
    final gate = repository.iconGate = Completer<void>();
    await pumpAccount(tester, picker: FakeAccountIconPicker([pngIcon()]));

    await tester.tap(upload);
    await tester.pump();

    expect(
      find.descendant(of: upload, matching: find.text('Uploading…')),
      findsOneWidget,
    );
    expect(tester.widget<OutlinedButton>(upload).onPressed, isNull);
    expect(tester.widget<TextButton>(remove).onPressed, isNull);

    gate.complete();
    await pumpUntilFound(tester, find.text('Your icon has been updated.'));
    expect(tester.widget<OutlinedButton>(upload).onPressed, isNotNull);
  });

  testWidgets('an image Android kept after ending the app under the picker is '
      'uploaded once the account screen opens', (tester) async {
    final kept = pngIcon();
    final picker = FakeAccountIconPicker([])..lost = kept;
    await pumpAccount(tester, picker: picker);
    await pumpUntilFound(tester, shown);

    expect(repository.iconUploads.single.bytes, same(kept));
    expect(auth.session?.userIconUrl, FakeAuthRepository.uploadedIconUrl(1));
    expect(find.text('Your icon has been updated.'), findsOneWidget);
    expect(picker.picked, 0);
    expect(picker.recoveredFor, [fakeSession.userPublicId]);
  });

  testWidgets('a pick made while a kept one is recovered is sent after it', (
    tester,
  ) async {
    final kept = pngIcon();
    final chosen = jpegIcon();
    final gate = Completer<void>();
    final picker = FakeAccountIconPicker([chosen])
      ..lost = kept
      ..recoverGate = gate;
    await pumpAccount(tester, picker: picker);

    await tester.tap(upload);
    await tester.pump();
    expect(picker.picked, 0);

    gate.complete();
    await pumpUntilTrue(
      tester,
      () => repository.iconUploads.length == 2,
      description: 'both uploads',
    );
    await tester.pump();

    expect(repository.iconUploads.map((upload) => upload.bytes), [
      same(kept),
      same(chosen),
    ]);
    expect(auth.session?.userIconUrl, FakeAuthRepository.uploadedIconUrl(2));
  });

  testWidgets('a credential store that refuses the change frees the controls', (
    tester,
  ) async {
    await pumpAccount(tester, picker: FakeAccountIconPicker([pngIcon()]));
    store.writeError = Exception('keystore refused');

    await tester.tap(upload);
    await pumpUntilFound(
      tester,
      find.text('Could not update your icon. Try again.'),
    );

    expect(tester.widget<OutlinedButton>(upload).onPressed, isNotNull);
  });

  testWidgets('without a picker the icon is shown with no controls', (
    tester,
  ) async {
    signInAs(withIcon);
    await pumpAccount(tester);

    expect(shown, findsOneWidget);
    expect(upload, findsNothing);
    expect(remove, findsNothing);
  });
}
