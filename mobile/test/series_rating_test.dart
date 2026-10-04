import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  const series = SeriesItem(
    id: 'series-rated',
    internalId: 'internal-series-rated',
    title: 'Rated series',
    description: '',
    episodeCount: 3,
    ratingAverage: 3.25,
    ratingCount: 12,
  );
  final detail = fixtureDetail(series);

  final publicRating = find.byKey(const ValueKey('series-rating'));
  final ownRating = find.byKey(const ValueKey('series-rating-own'));
  final ownRatingFailed = find.byKey(
    const ValueKey('series-rating-own-failed'),
  );
  final explanation = find.byKey(const ValueKey('series-rating-explanation'));
  final readingAction = find.byKey(const ValueKey('series-reading-action'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late AuthController auth;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: const [series],
      details: {series.id: detail},
    );
  });

  Future<void> pumpSeries(
    WidgetTester tester, {
    AuthSession? session = fakeSession,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );
    auth = fakeAuthController(session: session);
    await tester.pumpWidget(
      PubliraApp(router: router, catalog: catalog, auth: auth),
    );
    await pumpUntilRouteSettled(tester, publicRating);
  }

  Future<void> pumpUntilAsked(WidgetTester tester, int times) async {
    await pumpUntilTrue(
      tester,
      () => catalog.mySeriesRatingRequests.length >= times,
    );
    await tester.pump();
  }

  testWidgets('a guest sees the series rating and is asked for none of '
      'their own', (tester) async {
    catalog.mySeriesRatings = {series.internalId: 4};
    await pumpSeries(tester, session: null);

    expect(find.text('Rating: 3.3 · 12 readers'), findsOne);
    expect(find.text('React to episodes to rate this series.'), findsOne);
    expect(ownRating, findsNothing);
    expect(catalog.mySeriesRatingRequests, isEmpty);
  });

  testWidgets('a member who rated the series sees their rating beside the '
      'series rating', (tester) async {
    catalog.mySeriesRatings = {series.internalId: 4.25};
    await pumpSeries(tester);
    await pumpUntilFound(tester, ownRating);

    expect(catalog.mySeriesRatingRequests, [series.internalId]);
    expect(
      find.descendant(of: ownRating, matching: find.text('Your rating: 4.3')),
      findsOne,
    );
    // Beside it, in the run the series rating opens.
    final run = find.byType(Wrap);
    expect(
      find.ancestor(of: ownRating, matching: run).evaluate().single,
      find.ancestor(of: publicRating, matching: run).evaluate().single,
    );
    expect(
      tester.getTopLeft(explanation).dy,
      greaterThan(tester.getBottomLeft(publicRating).dy),
    );
  });

  testWidgets('a member who reacted to no episode has no rating to see', (
    tester,
  ) async {
    await pumpSeries(tester);
    await pumpUntilAsked(tester, 1);

    expect(ownRating, findsNothing);
    expect(ownRatingFailed, findsNothing);
    expect(publicRating, findsOne);
  });

  testWidgets('a member\'s rating shows on a series no one else rated yet', (
    tester,
  ) async {
    const unrated = SeriesItem(
      id: 'series-unrated',
      internalId: 'internal-series-unrated',
      title: 'Unrated series',
      description: '',
      episodeCount: 1,
    );
    catalog = FakeCatalogRepository(
      series: const [unrated],
      details: {unrated.id: fixtureDetail(unrated)},
      mySeriesRatings: {unrated.internalId: 5},
    );
    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(
          initialLocation: AppRoutes.seriesDetailPath(unrated.id),
        ),
        catalog: catalog,
        auth: fakeAuthController(session: fakeSession),
      ),
    );
    await pumpUntilRouteSettled(tester, explanation);
    await pumpUntilFound(tester, ownRating);

    expect(find.text('Your rating: 5.0'), findsOne);
    expect(publicRating, findsNothing);
  });

  testWidgets('a read that fails says so where the rating would be', (
    tester,
  ) async {
    catalog
      ..mySeriesRatings = {series.internalId: 4}
      ..mySeriesRatingError = const CatalogFailure(CatalogFailureKind.network);
    await pumpSeries(tester);
    await pumpUntilFound(tester, ownRatingFailed);

    expect(
      find.descendant(
        of: ownRatingFailed,
        matching: find.text('Could not show your rating'),
      ),
      findsOne,
    );
    expect(ownRating, findsNothing);
    // The rest of the screen stays.
    expect(publicRating, findsOne);
    expect(find.byKey(const ValueKey('series-detail-error')), findsNothing);
  });

  testWidgets('a session the API no longer takes shows no rating and no '
      'failure', (tester) async {
    catalog.mySeriesRatingError = const CatalogFailure(
      CatalogFailureKind.sessionExpired,
    );
    await pumpSeries(tester);
    await pumpUntilAsked(tester, 1);

    expect(ownRating, findsNothing);
    expect(ownRatingFailed, findsNothing);
  });

  testWidgets('coming back from an episode shows the rating the reader gave '
      'in it', (tester) async {
    await pumpSeries(tester);
    await pumpUntilAsked(tester, 1);
    expect(ownRating, findsNothing);

    await tapReachable(tester, readingAction);
    final viewer = AppRoutes.episodeViewerPath(
      series.id,
      detail.episodes.first.id,
    );
    await pumpUntilTrue(tester, () => router.state.uri.path == viewer);
    await tester.pump();
    // What a reaction in the viewer makes of the reader's rating.
    catalog.mySeriesRatings = {series.internalId: 2};
    await tester.pageBack();
    await pumpUntilRouteSettled(tester, publicRating);
    await pumpUntilFound(tester, ownRating);

    expect(find.text('Your rating: 2.0'), findsOne);
  });

  testWidgets('a reaction that lands after the return still reaches the '
      'screen', (tester) async {
    await pumpSeries(tester);
    await pumpUntilAsked(tester, 1);
    await tapReachable(tester, readingAction);
    final viewer = AppRoutes.episodeViewerPath(
      series.id,
      detail.episodes.first.id,
    );
    await pumpUntilTrue(tester, () => router.state.uri.path == viewer);
    await tester.pageBack();
    await pumpUntilRouteSettled(tester, publicRating);
    await pumpUntilAsked(tester, 2);
    expect(ownRating, findsNothing);

    // The press was made just before the reader left, and reaches the API
    // after the return has already asked.
    catalog.mySeriesRatings = {series.internalId: 5};
    await catalog.reactToEpisode(detail.episodes.first.internalId);
    await pumpUntilFound(tester, ownRating);

    expect(find.text('Your rating: 5.0'), findsOne);
  });

  testWidgets('reactions in an open episode are not read back one by one', (
    tester,
  ) async {
    await pumpSeries(tester);
    await pumpUntilAsked(tester, 1);
    await tapReachable(tester, readingAction);
    final viewer = AppRoutes.episodeViewerPath(
      series.id,
      detail.episodes.first.id,
    );
    await pumpUntilTrue(tester, () => router.state.uri.path == viewer);
    final asked = catalog.mySeriesRatingRequests.length;

    await catalog.reactToEpisode(detail.episodes.first.internalId);
    await tester.pump();

    expect(catalog.mySeriesRatingRequests, hasLength(asked));
  });

  testWidgets('signing out takes the reader\'s rating off the screen', (
    tester,
  ) async {
    catalog.mySeriesRatings = {series.internalId: 4};
    await pumpSeries(tester);
    await pumpUntilFound(tester, ownRating);

    await auth.signOut();
    // The screen opens the series again for the guest the reader now is.
    await pumpUntilTrue(
      tester,
      () => publicRating.evaluate().isNotEmpty && ownRating.evaluate().isEmpty,
    );
    await tester.pump();

    expect(ownRating, findsNothing);
    expect(catalog.mySeriesRatingRequests, hasLength(1));
  });
}
