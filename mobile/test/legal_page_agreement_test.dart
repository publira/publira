import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/legal_page_agreements.dart';
import 'package:publira/auth/sign_up_requirements.dart';
import 'package:publira/pages/published_page.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/delete_account_screen.dart';

import 'support/connect_fixture_server.dart';
import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/fake_page_repository.dart';
import 'support/pump_until.dart';

const _terms = LegalPage(
  slug: '/legal/terms',
  title: 'Terms of service',
  versionId: 'terms-v2',
);

const _privacy = LegalPage(
  slug: '/privacy',
  title: 'Privacy policy',
  versionId: 'privacy-v3',
);

void main() {
  group('legalPageAgreementRedirect', () {
    test('holds a reader who owes an agreement on the agreement screen', () {
      expect(
        legalPageAgreementRedirect(
          Uri.parse('/series/s1?checkout=paid'),
          owesAgreement: true,
        ),
        AppRoutes.agreementPath(returnTo: '/series/s1?checkout=paid'),
      );
      expect(
        legalPageAgreementRedirect(
          Uri.parse(AppRoutes.agreementPath(returnTo: '/library')),
          owesAgreement: true,
        ),
        isNull,
      );
      expect(
        legalPageAgreementRedirect(
          Uri.parse(AppRoutes.agreementPagePath(_terms.slug)),
          owesAgreement: true,
        ),
        isNull,
      );
      expect(
        legalPageAgreementRedirect(
          Uri.parse(AppRoutes.agreementDelete),
          owesAgreement: true,
        ),
        isNull,
      );
    });

    test('a path that only starts like the agreement screen is held too', () {
      expect(
        legalPageAgreementRedirect(
          Uri.parse('/agreements'),
          owesAgreement: true,
        ),
        AppRoutes.agreementPath(returnTo: '/agreements'),
      );
    });

    test('returns a reader who owes nothing to where they were going', () {
      expect(
        legalPageAgreementRedirect(
          Uri.parse(AppRoutes.agreementPath(returnTo: '/library')),
          owesAgreement: false,
        ),
        '/library',
      );
      expect(
        legalPageAgreementRedirect(Uri.parse('/library'), owesAgreement: false),
        isNull,
      );
    });

    test('never returns to the agreement screen or out of the app', () {
      for (final returnTo in [
        AppRoutes.agreementPath(returnTo: '/library'),
        AppRoutes.agreementDelete,
        '//example.com/phish',
        'https://example.com/',
      ]) {
        expect(
          legalPageAgreementRedirect(
            Uri.parse(AppRoutes.agreementPath(returnTo: returnTo)),
            owesAgreement: false,
          ),
          AppRoutes.catalog,
          reason: returnTo,
        );
      }
      expect(
        legalPageAgreementRedirect(
          Uri.parse(AppRoutes.agreementDelete),
          owesAgreement: false,
        ),
        AppRoutes.catalog,
      );
    });
  });

  group('LegalPageAgreements', () {
    late FakeAuthRepository repository;
    late AuthController auth;
    late LegalPageAgreements agreements;

    setUp(() {
      repository = FakeAuthRepository()
        ..owedLegalPages = const [_terms, _privacy];
      auth = fakeAuthController(session: fakeSession, repository: repository);
      agreements = LegalPageAgreements(auth: auth);
    });

    test('reads what the reader owes in the locale it is given', () async {
      await agreements.check(locale: 'ja');
      await agreements.check();

      expect(agreements.owed, [_terms, _privacy]);
      expect(repository.owedLegalPagesLocales, ['ja', 'ja']);
    });

    test('a read that fails leaves what was known', () async {
      await agreements.check(locale: 'en');
      repository.legalPageAgreementFailure = const AuthFailure(
        AuthFailureKind.network,
      );

      await agreements.check();

      expect(agreements.owed, [_terms, _privacy]);
    });

    test('a read still in flight is dropped once the reader is forgotten', () {
      final read = agreements.check(locale: 'en');
      agreements.forget();

      return read.then((_) => expect(agreements.owed, isEmpty));
    });

    test('an agreement to every page shown settles it', () async {
      await agreements.check(locale: 'en');

      expect(await agreements.agree(agreements.owed), isTrue);
      expect(agreements.owed, isEmpty);
      expect(repository.legalPageAgreements, [
        ['terms-v2', 'privacy-v3'],
      ]);
    });

    test('an agreement stands over a read answered from before it', () async {
      await agreements.check(locale: 'en');
      repository.agreeToLegalPagesGate = Completer<void>();
      final agreed = agreements.agree(agreements.owed);
      // A refused request starts a read while the agreement is in flight, and
      // the API answers it from before the agreement was recorded.
      repository.owedLegalPagesGate = Completer<void>();
      final read = agreements.check();

      repository.agreeToLegalPagesGate!.complete();
      expect(await agreed, isTrue);
      repository.owedLegalPagesGate!.complete();
      await read;

      expect(agreements.owed, isEmpty);
    });

    test('an agreement recorded for a reader who signed out since is '
        'dropped', () async {
      await agreements.check(locale: 'en');
      repository.agreeToLegalPagesGate = Completer<void>();
      final agreed = agreements.agree(const [_terms]);
      agreements.forget();
      await agreements.check();

      repository.agreeToLegalPagesGate!.complete();
      await agreed;

      // What the next reader owes, not what the agreement answered.
      expect(agreements.owed, [_terms, _privacy]);
    });

    test(
      'a version published since the pages were shown is asked anew',
      () async {
        await agreements.check(locale: 'en');
        const revised = LegalPage(
          slug: '/legal/terms',
          title: 'Terms of service',
          versionId: 'terms-v3',
        );
        repository
          ..owedLegalPages = const [revised]
          ..legalPageAgreementFailure = const AuthFailure(
            AuthFailureKind.invalidInput,
          );

        final settled = agreements.agree(const [_terms]);
        // The read that follows the refusal is answered.
        repository.legalPageAgreementFailure = null;

        expect(await settled, isFalse);
        expect(agreements.owed, [revised]);
      },
    );
  });

  group('ConnectClient', () {
    test('reports a refusal for want of an agreement', () async {
      var reported = 0;
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        onLegalPageAgreementRequired: () => reported++,
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'code': 'failed_precondition',
              'message': 'agreement required',
              'details': [
                ConnectFixtureServer.errorInfoDetail(
                  legalPageAgreementRequiredReason,
                ),
              ],
            }),
            400,
          ),
        ),
      );

      await expectLater(
        client.unary('/publira.v1.FollowService/FollowSeries', {}),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.isLegalPageAgreementRequired,
            'isLegalPageAgreementRequired',
            isTrue,
          ),
        ),
      );
      expect(reported, 1);
    });

    test('a failure of any other kind reports nothing', () async {
      var reported = 0;
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        onLegalPageAgreementRequired: () => reported++,
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'code': 'failed_precondition',
              'message': 'last tenant admin',
              'details': [
                ConnectFixtureServer.errorInfoDetail(lastTenantAdminReason),
              ],
            }),
            400,
          ),
        ),
      );

      await expectLater(
        client.unary('/publira.v1.AuthService/DeleteMe', {}),
        throwsA(isA<ConnectException>()),
      );
      expect(reported, 0);
    });
  });

  group('the app', () {
    late FakeAuthRepository repository;
    late AuthController auth;
    late LegalPageAgreements agreements;
    late GoRouter router;

    setUp(() {
      repository = FakeAuthRepository()..owedLegalPages = const [_terms];
      auth = fakeAuthController(session: fakeSession, repository: repository);
      agreements = LegalPageAgreements(auth: auth);
    });

    Future<void> pumpApp(
      WidgetTester tester, {
      String initialLocation = AppRoutes.catalog,
    }) async {
      router = createAppRouter(initialLocation: initialLocation);
      await tester.pumpWidget(
        PubliraApp(
          router: router,
          catalog: FakeCatalogRepository(series: fixtureSeries),
          auth: auth,
          legalPageAgreements: agreements,
          offline: InMemoryOfflineLibrary(),
          pages: FakePageRepository(
            pages: const [
              PublishedPage(
                slug: '/legal/terms',
                title: 'Terms of service',
                contentMarkdown: 'Revised terms.',
                locale: 'en',
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Finder screen() => find.byType(AppBar).hitTestable();

    /// Where the screen on top stands, a pushed one included.
    String location() => router.state.uri.toString();

    testWidgets('asks a signed-in reader who owes an agreement before the '
        'rest of the app', (tester) async {
      final seriesId = fixtureSeries.first.id;
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(seriesId),
      );

      expect(
        location(),
        AppRoutes.agreementPath(returnTo: AppRoutes.seriesDetailPath(seriesId)),
      );
      expect(screen(), findsOneWidget);
      expect(find.text('Agree to the updated terms'), findsOneWidget);
      expect(find.text('Terms of service'), findsOneWidget);
      // The rest of the app, the tab navigation included, is behind it.
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets('opens a page it asks about without leaving it', (
      tester,
    ) async {
      await pumpApp(tester);

      await tester.tap(
        find.byKey(const ValueKey('sign-up-legal-page-/legal/terms')),
      );
      await tester.pumpAndSettle();

      expect(location(), AppRoutes.agreementPagePath(_terms.slug));
      expect(find.text('Revised terms.'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.text('Agree to the updated terms'), findsOneWidget);
    });

    testWidgets('asks for the box to be ticked before agreeing', (
      tester,
    ) async {
      await pumpApp(tester);

      await tester.tap(
        find.byKey(const ValueKey('legal-page-agreement-submit')),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Agree to the listed pages to continue.'),
        findsOneWidget,
      );
      expect(repository.legalPageAgreements, isEmpty);
    });

    testWidgets('records the agreement once and returns the reader to where '
        'they were going', (tester) async {
      final seriesId = fixtureSeries.first.id;
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(seriesId),
      );

      await tester.tap(find.byKey(const ValueKey('sign-up-consent')));
      await tester.tap(
        find.byKey(const ValueKey('legal-page-agreement-submit')),
      );
      await tester.pumpAndSettle();

      expect(repository.legalPageAgreements, [
        ['terms-v2'],
      ]);
      expect(location(), AppRoutes.seriesDetailPath(seriesId));
      expect(find.text('Agree to the updated terms'), findsNothing);

      // Coming back to the app asks the API again, which owes nothing now.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(find.text('Agree to the updated terms'), findsNothing);
      expect(repository.owedLegalPagesLocales.length, greaterThan(1));
    });

    testWidgets('a version published while the screen was open is asked '
        'anew', (tester) async {
      await pumpApp(tester);
      const revised = LegalPage(
        slug: '/legal/terms',
        title: 'Terms of service',
        versionId: 'terms-v3',
      );
      repository.owedLegalPages = const [revised];

      await tester.tap(find.byKey(const ValueKey('sign-up-consent')));
      await tester.tap(
        find.byKey(const ValueKey('legal-page-agreement-submit')),
      );
      await tester.pumpAndSettle();

      // The fake settles only the version it was sent, so terms-v3 is owed.
      expect(repository.legalPageAgreements, [
        ['terms-v2'],
      ]);
      expect(
        find.byKey(const ValueKey('legal-page-agreement-changed')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<CheckboxListTile>(
              find.byKey(const ValueKey('sign-up-consent')),
            )
            .value,
        isFalse,
      );
      expect(agreements.owed, [revised]);
    });

    testWidgets('lets a reader who agreed on the site go when the app comes '
        'back', (tester) async {
      await pumpApp(tester);
      expect(find.text('Agree to the updated terms'), findsOneWidget);

      repository.owedLegalPages = const [];
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(find.text('Agree to the updated terms'), findsNothing);
      expect(location(), AppRoutes.catalog);
    });

    testWidgets('asks once the API refuses a request for want of it', (
      tester,
    ) async {
      repository.owedLegalPages = const [];
      await pumpApp(tester);
      expect(find.text('Agree to the updated terms'), findsNothing);

      repository.owedLegalPages = const [_terms];
      agreements.reportRequired();
      await tester.pumpAndSettle();

      expect(find.text('Agree to the updated terms'), findsOneWidget);
    });

    testWidgets('signing out instead leaves the reader signed out where they '
        'were going', (tester) async {
      await pumpApp(tester, initialLocation: AppRoutes.library);

      await tester.tap(
        find.byKey(const ValueKey('legal-page-agreement-sign-out')),
      );
      await pumpUntilTrue(
        tester,
        () => location() == AppRoutes.library,
        description: 'the library',
      );

      expect(auth.isSignedIn, isFalse);
      expect(repository.legalPageAgreements, isEmpty);
    });

    testWidgets('offers the account deletion instead', (tester) async {
      await pumpApp(tester);

      await tester.tap(
        find.byKey(const ValueKey('legal-page-agreement-delete')),
      );
      await tester.pumpAndSettle();

      expect(location(), AppRoutes.agreementDelete);
      expect(find.byType(DeleteAccountScreen), findsOneWidget);
    });

    testWidgets('a reader who owes nothing is never asked', (tester) async {
      repository.owedLegalPages = const [];
      await pumpApp(tester);

      expect(find.text('Agree to the updated terms'), findsNothing);
      expect(location(), AppRoutes.catalog);
    });
  });
}
