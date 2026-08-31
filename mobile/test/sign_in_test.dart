import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';

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
    String initialLocation = AppRoutes.catalog,
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

  Future<void> submitCredentials(
    WidgetTester tester, {
    String email = 'member@example.com',
    String password = 'memberpass',
  }) async {
    await tester.enterText(find.byKey(const ValueKey('sign-in-email')), email);
    await tester.enterText(
      find.byKey(const ValueKey('sign-in-password')),
      password,
    );
    await tester.tap(find.byKey(const ValueKey('sign-in-submit')));
  }

  testWidgets('the catalog opens the sign-in screen while signed out', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.byKey(const ValueKey('catalog-account')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));

    expect(find.byKey(const ValueKey('sign-in-email')), findsOneWidget);
    expect(find.byKey(const ValueKey('sign-in-password')), findsOneWidget);
  });

  testWidgets('signing in returns to the catalog with an account entry', (
    tester,
  ) async {
    await pumpApp(tester, initialLocation: AppRoutes.signIn);

    await submitCredentials(tester);
    await pumpUntilFound(tester, find.text('Publira'));

    expect(auth.isSignedIn, isTrue);
    expect(repository.lastEmail, 'member@example.com');
    expect(repository.lastPassword, 'memberpass');

    await tester.tap(find.byKey(const ValueKey('catalog-account')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('account-name')));

    expect(find.text(fakeSession.userName), findsOneWidget);
  });

  testWidgets('rejected credentials stay on the form with a reason', (
    tester,
  ) async {
    repository.signInFailure = const AuthFailure(
      AuthFailureKind.invalidCredentials,
    );
    await pumpApp(tester, initialLocation: AppRoutes.signIn);

    await submitCredentials(tester, password: 'wrong');
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-error')));

    expect(find.text('メールアドレスまたはパスワードが正しくありません'), findsOneWidget);
    expect(auth.isSignedIn, isFalse);
    expect(find.byKey(const ValueKey('sign-in-submit')), findsOneWidget);
  });

  testWidgets('a store that refuses the session leaves the form usable', (
    tester,
  ) async {
    // A keychain write can fail on its own terms, and the API never gets to
    // classify that, so the form has to come back from an error it has no
    // copy for.
    auth = fakeAuthController(
      repository: repository,
      store: InMemorySessionStore(
        writeError: PlatformException(code: 'Storage error'),
      ),
    );
    await pumpApp(tester, initialLocation: AppRoutes.signIn);

    await submitCredentials(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-error')));

    expect(find.text('サインインできませんでした'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('sign-in-submit')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('an empty form reports which field is missing', (tester) async {
    await pumpApp(tester, initialLocation: AppRoutes.signIn);

    await tester.tap(find.byKey(const ValueKey('sign-in-submit')));
    await pumpUntilFound(tester, find.text('メールアドレスを入力してください'));

    expect(find.text('パスワードを入力してください'), findsOneWidget);
    expect(repository.lastEmail, isNull);
  });

  testWidgets('signing out returns the account screen to its signed-out copy', (
    tester,
  ) async {
    auth = fakeAuthController(session: fakeSession, repository: repository);
    await pumpApp(tester, initialLocation: AppRoutes.account);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('account-sign-out')),
    );

    await tester.tap(find.byKey(const ValueKey('account-sign-out')));
    await pumpUntilFound(tester, find.text('サインインしていません'));

    expect(auth.isSignedIn, isFalse);
    expect(auth.accessToken, isEmpty);
  });

  testWidgets('a locked episode offers sign-in while signed out', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
    await pumpApp(
      tester,
      initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-locked')));

    await tester.tap(find.text('サインイン'));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));

    expect(find.byKey(const ValueKey('sign-in-email')), findsOneWidget);
  });

  testWidgets('the reader reloads the body once the reader signs in', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
    await pumpApp(
      tester,
      initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-locked')));

    await tester.tap(find.text('サインイン'));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));

    // What the entitled reader gets back, so the reload is what decides
    // whether the body appears rather than the frame the viewer was built on.
    catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
    await submitCredentials(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(find.byKey(const ValueKey('episode-locked')), findsNothing);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('an expired stored session says so and offers a way back', (
    tester,
  ) async {
    repository.refreshFailure = const AuthFailure(
      AuthFailureKind.sessionExpired,
    );
    auth = fakeAuthController(
      storedSession: fakeSession,
      repository: repository,
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('サインインの有効期限が切れました'));
    // The bar slides in from below the viewport, so its action is only where
    // a tap can reach it once that animation has finished.
    await tester.pumpAndSettle();

    expect(auth.isSignedIn, isFalse);

    await tester.tap(find.widgetWithText(SnackBarAction, 'サインイン'));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));
    await tester.pumpAndSettle();
  });
}
