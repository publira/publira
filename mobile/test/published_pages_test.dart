import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/published_page.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_page_repository.dart';
import 'support/pump_until.dart';

void main() {
  late GoRouter router;
  late FakePageRepository pages;

  final pagesRow = find.byKey(const ValueKey('account-pages'));
  final list = find.byKey(const ValueKey('pages-list'));
  final termsRow = find.byKey(const ValueKey('pages-row-/legal/terms'));
  final privacyRow = find.byKey(const ValueKey('pages-row-/privacy'));

  setUp(() {
    pages = FakePageRepository(
      pages: const [
        PublishedPage(
          slug: '/legal/terms',
          title: 'Terms of service',
          contentMarkdown: 'The terms you agree to.',
          locale: 'en',
        ),
        PublishedPage(
          slug: '/privacy',
          title: 'Privacy policy',
          contentMarkdown: 'How we keep your data.',
          locale: 'en',
        ),
      ],
    );
  });

  /// The app on [initialLocation] as [session] holds it, with the page
  /// repository installed unless [withPages] takes it away.
  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.account,
    AuthSession? session,
    bool withPages = true,
  }) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: FakeCatalogRepository(),
        auth: fakeAuthController(session: session),
        pages: withPages ? pages : null,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('a guest opens every listed page from the account screen', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pagesRow);

    await tester.tap(pagesRow);
    await pumpUntilRouteSettled(tester, list);

    expect(router.state.uri.path, AppRoutes.accountPages);
    expect(
      tester.getTopLeft(termsRow).dy,
      lessThan(tester.getTopLeft(privacyRow).dy),
    );

    for (final (row, body) in [
      (termsRow, 'The terms you agree to.'),
      (privacyRow, 'How we keep your data.'),
    ]) {
      await tester.tap(row);
      await pumpUntilRouteSettled(tester, find.text(body));
      await tester.pageBack();
      await pumpUntilRouteSettled(tester, list);
    }

    expect(pages.reads, ['/legal/terms', '/privacy']);
  });

  testWidgets('a signed-in reader reaches the same list', (tester) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, pagesRow);

    await tester.tap(pagesRow);
    await pumpUntilRouteSettled(tester, list);

    expect(find.text('Terms of service'), findsOneWidget);
    expect(find.text('Privacy policy'), findsOneWidget);
  });

  testWidgets('opens a page on the account tab', (tester) async {
    await pumpApp(tester, initialLocation: AppRoutes.accountPages);
    await pumpUntilFound(tester, privacyRow);

    await tester.tap(privacyRow);
    await pumpUntilRouteSettled(tester, find.text('How we keep your data.'));

    expect(
      router.state.uri.path,
      '${AppRoutes.account}${AppRoutes.publishedPagePath('/privacy')}',
    );
  });

  group('in the app\'s language', () {
    testWidgets('reads the list in it', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.accountPages);
      await pumpUntilFound(tester, list);

      expect(pages.listLocales, ['en']);
    });

    testWidgets('reads the list again when the device changes language', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      await pumpApp(tester, initialLocation: AppRoutes.accountPages);
      await pumpUntilFound(tester, list);

      tester.platformDispatcher.localesTestValue = const [Locale('ja')];
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(pages.listLocales, ['en', 'ja']);
      // The screen's own title follows the language, as the copy it names.
      expect(find.text('このサイトについて'), findsOneWidget);
    });
  });

  testWidgets('says so when the tenant lists no page', (tester) async {
    pages.pages = const [];
    await pumpApp(tester, initialLocation: AppRoutes.accountPages);
    await pumpUntilFound(tester, find.byKey(const ValueKey('pages-empty')));

    expect(find.text('This site has not published any pages.'), findsOneWidget);
  });

  testWidgets('offers a retry when the list could not be read', (tester) async {
    pages.listPagesFailure = const PageFailure(PageFailureKind.unexpected);
    await pumpApp(tester, initialLocation: AppRoutes.accountPages);
    await pumpUntilFound(tester, find.byKey(const ValueKey('pages-retry')));

    expect(
      find.text("Could not load this site's pages. Try again."),
      findsOneWidget,
    );

    pages.listPagesFailure = null;
    await tester.tap(find.byKey(const ValueKey('pages-retry')));
    await pumpUntilFound(tester, termsRow);
  });

  testWidgets('leaves the row out of a build with no pages to read', (
    tester,
  ) async {
    await pumpApp(tester, withPages: false);
    await pumpUntilFound(tester, find.byKey(const ValueKey('account-sign-in')));

    expect(pagesRow, findsNothing);
  });
}
