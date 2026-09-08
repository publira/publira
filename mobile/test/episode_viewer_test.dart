import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/router.dart';
import 'package:publira/viewer/reading_position.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, episodeId);

  /// A phone held upright, where one page fills the screen.
  const portrait = Size(400, 800);

  /// Wide enough, and wider than it is tall, for two pages at once.
  const landscape = Size(900, 600);

  final pageView = find.byKey(const ValueKey('episode-page-view'));

  /// The image the reader draws for the one-based page [number].
  Finder page(int number) =>
      find.byKey(ValueKey('episode-page-$episodeId-page-$number-0'));

  /// How far the screen on display is zoomed in.
  double zoomScale(WidgetTester tester) => tester
      .widget<InteractiveViewer>(find.byType(InteractiveViewer).first)
      .transformationController!
      .value
      .getMaxScaleOnAxis();

  Future<void> doubleTapAt(WidgetTester tester, Offset position) async {
    await tester.tapAt(position);
    await tester.pump(kDoubleTapMinTime);
    await tester.tapAt(position);
    // Past the window the recognizer waits out before it lets go of the tap.
    await tester.pump(kDoubleTapTimeout);
  }

  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    router = createAppRouter(initialLocation: viewerPath);
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    Size screen = portrait,
  }) async {
    tester.view
      ..physicalSize = screen
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('a free body opens on its first page', (tester) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.text('${fixtureSeries.first.title} #1'), findsOneWidget);
  });

  testWidgets('the next button turns to the following page', (tester) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, find.text('2 / 3'));

    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('the previous button is disabled on the first page', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    final previous = tester.widget<IconButton>(
      find.byKey(const ValueKey('episode-previous-page')),
    );
    expect(previous.onPressed, isNull);
  });

  testWidgets('tapping the left half turns to the following page', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    final view = tester.getRect(
      find.byKey(const ValueKey('episode-page-view')),
    );
    await tester.tapAt(Offset(view.left + view.width * 0.25, view.center.dy));
    await pumpUntilFound(tester, find.text('2 / 3'));

    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('a double tap zooms the page in and a second one resets it', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);

    expect(zoomScale(tester), 1);

    await doubleTapAt(tester, tester.getRect(pageView).center);
    expect(zoomScale(tester), greaterThan(1));

    await doubleTapAt(tester, tester.getRect(pageView).center);
    expect(zoomScale(tester), 1);
  });

  testWidgets('a swipe turns the page only while the page is not zoomed', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);

    await doubleTapAt(tester, tester.getRect(pageView).center);
    await tester.drag(pageView, const Offset(300, 0));
    // Long enough for a turn to have finished, had the drag started one.
    await tester.pump(const Duration(milliseconds: 400));

    expect(
      tester.widget<PageView>(pageView).physics,
      isA<NeverScrollableScrollPhysics>(),
    );
    expect(find.text('1 / 3'), findsOneWidget);

    await doubleTapAt(tester, tester.getRect(pageView).center);
    await tester.drag(pageView, const Offset(300, 0));
    await pumpUntilFound(tester, find.text('2 / 3'));

    expect(find.text('2 / 3'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a landscape screen pairs the pages after the cover', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(pageCount: 5);
    await pumpApp(tester, screen: landscape);
    await pumpUntilFound(tester, pageView);

    // The cover stands alone, the way the volume it came from opens.
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, find.text('2–3 / 5'));
    // The counter answers from the page the reader is on, so it is right
    // before the turn has finished moving there.
    await tester.pump(const Duration(milliseconds: 400));

    // Reading runs right to left, so the earlier page of a pair is on the
    // right.
    final second = tester.getRect(page(2));
    final third = tester.getRect(page(3));
    expect(second.center.dx, greaterThan(third.center.dx));
    expect(third.left, greaterThanOrEqualTo(0));

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, find.text('4–5 / 5'));

    final next = tester.widget<IconButton>(
      find.byKey(const ValueKey('episode-next-page')),
    );
    expect(next.onPressed, isNull);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a locked paid body shows the purchase notice', (tester) async {
    catalog.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-locked')));

    expect(
      find.text('This episode can be read once it is purchased.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
  });

  testWidgets('an episode without pages shows the empty notice', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(pageCount: 0);
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-empty')));

    expect(find.text('This episode has no pages yet.'), findsOneWidget);
  });

  testWidgets('an unknown episode id shows the not-found state', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.episodeViewerPath(seriesId, 'ZZZZZZZZZZZZ'),
    );
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-not-found')),
    );

    await tester.tap(find.text('Back to the series'));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });

  testWidgets('a network error offers retry', (tester) async {
    catalog.episodeError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-viewer-error')),
    );
    expect(
      find.textContaining('Could not connect to the server'),
      findsOneWidget,
    );

    catalog.episodeError = null;
    await tester.tap(find.text('Retry'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(find.text('1 / 3'), findsOneWidget);
  });

  testWidgets('tapping an episode on series detail opens the reader', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));

    await tester.tap(find.byKey(ValueKey('episode-tile-$episodeId')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(router.state.uri.path, viewerPath);

    await tester.pageBack();
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });

  testWidgets('a saved position opens the body on that page', (tester) async {
    catalog.readingPositions = {episodeKey(seriesId, episodeId): 1};
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, pageView);

    expect(find.text('2 / 3'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a position past the end of the body opens on its last page', (
    tester,
  ) async {
    catalog.readingPositions = {episodeKey(seriesId, episodeId): 9};
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, pageView);

    expect(find.text('3 / 3'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a position that cannot be read opens the first page', (
    tester,
  ) async {
    catalog
      ..readingPositions = {episodeKey(seriesId, episodeId): 1}
      ..readingPositionError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, pageView);

    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.byKey(const ValueKey('episode-viewer-error')), findsNothing);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('the page a reader rests on is recorded', (tester) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilRouteSettled(tester, pageView);

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, find.text('2 / 3'));
    // Nothing is recorded while the reader may still be skimming past it.
    expect(catalog.readingPositions, isEmpty);

    await tester.pump(readingPositionSaveDelay);
    expect(catalog.readingPositions[episodeKey(seriesId, episodeId)], 1);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('leaving the reader records the page it was left on', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
    );
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, find.text('Episodes'));
    await tester.tap(find.byKey(ValueKey('episode-tile-$episodeId')));
    await pumpUntilRouteSettled(tester, pageView);

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, find.text('2 / 3'));
    expect(catalog.readingPositions, isEmpty);

    await tester.pageBack();
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(catalog.readingPositions[episodeKey(seriesId, episodeId)], 1);
  });
}
