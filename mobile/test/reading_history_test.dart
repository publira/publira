import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;

  EpisodeReadItem read(int orderIndex) => EpisodeReadItem(
    series: series,
    episode: EpisodeItem(
      id: '${series.id}-ep-$orderIndex',
      title: 'Episode $orderIndex',
      orderIndex: orderIndex,
      price: 0,
    ),
    readAt: DateTime.utc(2026, 9, 1, 12),
  );

  final list = find.byKey(const ValueKey('reading-history-list'));
  Finder row(int orderIndex) =>
      find.byKey(ValueKey('reading-history-row-${series.id}-ep-$orderIndex'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late AuthController auth;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.accountReadingHistory,
    AuthSession? session = fakeSession,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation);
    auth = fakeAuthController(
      session: session,
      repository: FakeAuthRepository(
        session: const AuthSession(
          accessToken: 'another-access-token',
          userPublicId: 'SeedMMBRAAA2',
          userName: 'Another Member',
        ),
      ),
    );
    await tester.pumpWidget(
      PubliraApp(router: router, catalog: catalog, auth: auth),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('the account screen leads a signed-in reader to their history', (
    tester,
  ) async {
    catalog.episodeReads = [read(1)];
    await pumpApp(tester, initialLocation: AppRoutes.account);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('account-reading-history')),
    );

    await tester.tap(find.byKey(const ValueKey('account-reading-history')));
    await pumpUntilFound(tester, row(1));

    expect(router.state.uri.path, AppRoutes.accountReadingHistory);
  });

  testWidgets('a row names the episode, its series, and when it was finished', (
    tester,
  ) async {
    catalog.episodeReads = [read(2), read(1)];
    await pumpApp(tester);
    await pumpUntilFound(tester, list);

    expect(
      find.descendant(of: row(2), matching: find.text('#2 Episode 2')),
      findsOne,
    );
    expect(
      find.descendant(of: row(2), matching: find.textContaining(series.title)),
      findsOne,
    );
    expect(
      find.descendant(of: row(2), matching: find.textContaining('Finished')),
      findsOne,
    );
    // Most recently finished first, as the API answers.
    expect(
      tester.getTopLeft(row(2)).dy,
      lessThan(tester.getTopLeft(row(1)).dy),
    );
  });

  testWidgets('a row opens the episode it stands for', (tester) async {
    catalog.episodeReads = [read(1)];
    await pumpApp(tester);
    await pumpUntilFound(tester, row(1));

    await tester.tap(row(1));
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppTab.account.locate(
        AppRoutes.episodeViewerPath(series.id, '${series.id}-ep-1'),
      ),
    );
  });

  testWidgets('the button beside a row opens its series', (tester) async {
    catalog.episodeReads = [read(1)];
    await pumpApp(tester);
    await pumpUntilFound(tester, row(1));

    await tester.tap(
      find.byKey(ValueKey('reading-history-series-${series.id}-ep-1')),
    );
    await pumpUntilRouteSettled(tester, find.text('Episodes'));

    expect(
      router.state.uri.path,
      AppTab.account.locate(AppRoutes.seriesDetailPath(series.id)),
    );
  });

  testWidgets('reads the page under it as the reader nears the end', (
    tester,
  ) async {
    catalog.episodeReads = [
      for (var index = 21; index >= 1; index--) read(index),
    ];
    await pumpApp(tester);
    await pumpUntilFound(tester, list);

    await tester.fling(list, const Offset(0, -4000), 1000);
    await pumpUntilFound(tester, row(1));

    expect(catalog.episodeReadsTokens, ['', '20']);
  });

  testWidgets('offers a retry under the rows for a page it could not read', (
    tester,
  ) async {
    catalog
      ..episodeReads = [for (var index = 21; index >= 1; index--) read(index)]
      ..episodeReadsMoreError = const CatalogFailure(
        CatalogFailureKind.network,
      );
    await pumpApp(tester);
    await pumpUntilFound(tester, list);

    await tester.fling(list, const Offset(0, -4000), 1000);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-more-retry')),
    );

    catalog.episodeReadsMoreError = null;
    await tester.tap(find.byKey(const ValueKey('reading-history-more-retry')));
    await pumpUntilFound(tester, row(1));
  });

  testWidgets('tells a reader who finished nothing so', (tester) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-empty')),
    );

    expect(list, findsNothing);
  });

  testWidgets('offers a retry after a history it could not read', (
    tester,
  ) async {
    catalog
      ..episodeReads = [read(1)]
      ..episodeReadsError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-error')),
    );

    expect(
      find.text('Could not connect to the server. Please try again later.'),
      findsOne,
    );

    catalog.episodeReadsError = null;
    await tester.tap(find.byKey(const ValueKey('reading-history-retry')));
    await pumpUntilFound(tester, row(1));
  });

  testWidgets('sends a reader whose session was refused to sign in', (
    tester,
  ) async {
    catalog.episodeReadsError = const CatalogFailure(
      CatalogFailureKind.sessionExpired,
    );
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-error')),
    );

    expect(find.byKey(const ValueKey('reading-history-retry')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('reading-history-sign-in')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

    expect(router.state.uri.path, AppTab.account.locate(AppRoutes.signIn));
  });

  testWidgets('gives the whole screen to a session refused on a later page', (
    tester,
  ) async {
    catalog
      ..episodeReads = [for (var index = 21; index >= 1; index--) read(index)]
      ..episodeReadsMoreError = const CatalogFailure(
        CatalogFailureKind.sessionExpired,
      );
    await pumpApp(tester);
    await pumpUntilFound(tester, list);

    await tester.fling(list, const Offset(0, -4000), 1000);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-error')),
    );

    expect(list, findsNothing);
    expect(find.byKey(const ValueKey('reading-history-sign-in')), findsOne);
  });

  testWidgets('reads the history again when the reader pulls it down', (
    tester,
  ) async {
    catalog.episodeReads = [read(1)];
    await pumpApp(tester);
    await pumpUntilFound(tester, row(1));

    catalog.episodeReads = [read(2), read(1)];
    await tester.fling(list, const Offset(0, 400), 1000);
    await pumpUntilFound(tester, row(2));
  });

  testWidgets('reads an empty history again when the reader pulls it down', (
    tester,
  ) async {
    await pumpApp(tester);
    final empty = find.byKey(const ValueKey('reading-history-empty'));
    await pumpUntilFound(tester, empty);

    catalog.episodeReads = [read(1)];
    await tester.fling(empty, const Offset(0, 400), 1000);
    await pumpUntilFound(tester, row(1));
  });

  testWidgets('asks a reader who is signed out to sign in', (tester) async {
    await pumpApp(tester, session: null);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-signed-out')),
    );

    expect(catalog.episodeReadsTokens, isEmpty);
    await tester.tap(find.byKey(const ValueKey('reading-history-sign-in')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

    expect(router.state.uri.path, AppTab.account.locate(AppRoutes.signIn));
  });

  testWidgets('another reader signing in reads their own history', (
    tester,
  ) async {
    catalog.episodeReads = [read(1)];
    await pumpApp(tester);
    await pumpUntilFound(tester, row(1));

    await auth.signOut();
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('reading-history-signed-out')),
    );
    expect(row(1), findsNothing);

    catalog.episodeReads = [read(3)];
    await auth.signIn(email: 'another@example.com', password: 'password');
    await pumpUntilFound(tester, row(3));

    expect(row(1), findsNothing);
    expect(catalog.episodeReadsTokens, ['', '']);
  });
}
