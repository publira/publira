import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/localizations.dart';
import 'package:publira/models/episode_comment.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/router.dart';
import 'package:publira/viewer/episode_reaction_control.dart';
import 'package:publira/viewer/reading_position.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_comment_repository.dart';
import 'support/fake_offline_library.dart';
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
  final endPanel = find.byKey(const ValueKey('episode-end-panel'));

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
  late InMemoryOfflineLibrary offline;

  setUp(() {
    router = createAppRouter(initialLocation: viewerPath);
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    offline = InMemoryOfflineLibrary();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    Size screen = portrait,
    FakeCommentRepository? comments,
    String birthDate = '',
    AuthFailure? birthDateFailure,
  }) async {
    tester.view
      ..physicalSize = screen
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(
          session: session,
          birthDate: birthDate,
          birthDateFailure: birthDateFailure,
        ),
        comments: comments,
        offline: offline,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Reads [pages] pages to the end of the body and one screen further, which
  /// is where the panel that ends the episode is.
  Future<void> turnToEnd(WidgetTester tester, {int pages = 3}) async {
    for (var turn = 0; turn < pages; turn++) {
      await tester.tap(find.byKey(const ValueKey('episode-next-page')));
      // A turn started before the one before it has settled is dropped: the
      // pager reports the page it is leaving once it arrives, and that report
      // puts the reader back on it.
      await pumpUntilNoPendingFrameCallbacks(tester);
    }
    await pumpUntilFound(tester, endPanel);
  }

  /// The reader opened at [episodeId] of the first fixture series.
  void openEpisode(String episodeId) {
    router = createAppRouter(
      initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
    );
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

  /// The fixture body of [episodeId] credited to [creators].
  void creditEpisode(String episodeId, List<SeriesCreator> creators) {
    final key = episodeKey(seriesId, episodeId);
    final detail = catalog.episodes[key]!;
    catalog.episodes[key] = EpisodeDetail(
      episode: detail.episode,
      seriesId: detail.seriesId,
      seriesTitle: detail.seriesTitle,
      access: detail.access,
      images: detail.images,
      previousEpisode: detail.previousEpisode,
      nextEpisode: detail.nextEpisode,
      imageRequestHeaders: detail.imageRequestHeaders,
      creators: creators,
    );
  }

  final episodeCredits = find.byKey(const ValueKey('episode-credits'));

  group('episode credits', () {
    testWidgets('an episode names its own credits with their roles', (
      tester,
    ) async {
      creditEpisode(episodeId, const [
        SeriesCreator(id: 'A1', name: 'Seed Author 001', roleName: 'Story'),
        SeriesCreator(id: 'A2', name: 'Guest Artist', roleName: 'Art'),
        SeriesCreator(id: 'A3', name: 'Seed Author 002', roleName: 'Art'),
      ]);
      await pumpApp(tester);
      await pumpUntilFound(tester, pageView);

      expect(
        find.descendant(
          of: episodeCredits,
          matching: find.text(
            'Story Seed Author 001 / Art Guest Artist and Seed Author 002',
          ),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a guest artist is not named on the neighbouring episodes', (
      tester,
    ) async {
      final neighbourId = '$seriesId-ep-2';
      creditEpisode(episodeId, const [
        SeriesCreator(id: 'A1', name: 'Seed Author 001', roleName: 'Story'),
        SeriesCreator(id: 'A2', name: 'Guest Artist', roleName: 'Art'),
      ]);
      creditEpisode(neighbourId, const [
        SeriesCreator(id: 'A1', name: 'Seed Author 001', roleName: 'Story'),
      ]);
      openEpisode(neighbourId);
      await pumpApp(tester);
      await pumpUntilFound(tester, pageView);

      expect(
        find.descendant(
          of: episodeCredits,
          matching: find.text('Story Seed Author 001'),
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Guest Artist'), findsNothing);
    });

    testWidgets('an episode credited to nobody names nobody, not the series', (
      tester,
    ) async {
      // The fixture series is credited, so a fallback would put its names up.
      expect(fixtureSeries.first.creators, isNotEmpty);
      await pumpApp(tester);
      await pumpUntilFound(tester, pageView);

      expect(episodeCredits, findsNothing);
      for (final creator in fixtureSeries.first.creators) {
        expect(find.textContaining(creator.name), findsNothing);
      }
    });

    testWidgets('a credit with no role is the name on its own', (tester) async {
      creditEpisode(episodeId, const [
        SeriesCreator(id: 'A1', name: 'Seed Author 001'),
      ]);
      await pumpApp(tester);
      await pumpUntilFound(tester, pageView);

      expect(
        find.descendant(
          of: episodeCredits,
          matching: find.text('Seed Author 001'),
        ),
        findsOneWidget,
      );
    });
  });

  testWidgets('a rated episode is not opened without the confirmation', (
    tester,
  ) async {
    const series = fixtureRatedSeries;
    final episode = fixtureDetail(series).episodes.first;
    catalog = FakeCatalogRepository(
      series: [series],
      details: {series.id: fixtureDetail(series)},
      episodes: {
        episodeKey(series.id, episode.id): EpisodeDetail(
          episode: episode,
          seriesId: series.id,
          seriesTitle: series.title,
          access: EpisodeAccess.free,
          images: [
            EpisodeImageItem(
              id: '${episode.id}-page-1',
              url: Uri.parse('http://127.0.0.1:8200/images/episodes/p1'),
              displayOrder: 1,
              width: 800,
              height: 1200,
            ),
          ],
          ageRating: SeriesAgeRating.r15,
        ),
      },
    );
    router = createAppRouter(
      initialLocation: AppRoutes.episodeViewerPath(series.id, episode.id),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
    expect(find.text('“After Dark” is rated R15'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
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
    await pumpUntilNoPendingFrameCallbacks(tester);

    await tester.tap(find.byKey(const ValueKey('episode-next-page')));
    await pumpUntilFound(tester, endPanel);

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

  testWidgets('a guest is asked to sign in for an age-rated body', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(
      access: EpisodeAccess.ageRestricted,
      ageRating: SeriesAgeRating.r18,
    );
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-age-restricted')),
    );

    expect(
      find.text(
        'Your age is checked before this work opens. '
        'Sign in with an account that has your date of birth.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
    expect(find.byKey(const ValueKey('age-rating-gate')), findsNothing);

    await tester.tap(find.text('Sign in'));
    await pumpUntilFound(tester, find.text('Email address'));
  });

  testWidgets('a reader with no birth date on file is led to add one', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(
      access: EpisodeAccess.ageRestricted,
      ageRating: SeriesAgeRating.r18,
    );
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-age-restricted')),
    );

    expect(
      find.text(
        'Your age is checked before this work opens, '
        'and your account has no date of birth on it.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('age-rating-gate')), findsNothing);

    await tester.tap(find.text('Add your date of birth'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('account-birth-date-add')),
    );
  });

  testWidgets('a reader whose date of birth is too recent is told so', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(
      access: EpisodeAccess.ageRestricted,
      ageRating: SeriesAgeRating.r18,
    );
    await pumpApp(tester, session: fakeSession, birthDate: '2020-01-01');
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-age-restricted')),
    );

    expect(
      find.text('This work is not available for your age.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('age-rating-gate')), findsNothing);
  });

  testWidgets('a reader the age rule opens for still meets the confirmation', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(ageRating: SeriesAgeRating.r18);
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, find.byKey(const ValueKey('age-rating-gate')));

    expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
    expect(find.byKey(const ValueKey('episode-age-restricted')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
  });

  testWidgets('a session the API has dropped leads back to sign-in', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(
      access: EpisodeAccess.ageRestricted,
      ageRating: SeriesAgeRating.r18,
    );
    await pumpApp(
      tester,
      session: fakeSession,
      birthDateFailure: const AuthFailure(AuthFailureKind.sessionExpired),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-age-restricted')),
    );

    // The bearer is one the API has stopped accepting, so the reader is signed
    // out: the gate stands them where a guest stands, and the app's own expiry
    // notice offers the way back in.
    expect(
      find.text(
        'Your age is checked before this work opens. '
        'Sign in with an account that has your date of birth.',
      ),
      findsOneWidget,
    );
    expect(
      find.text('Your session is no longer valid. Please sign in again.'),
      findsOneWidget,
    );
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

  testWidgets('turning past the last page offers the next episode', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(find.text('Up next'), findsOneWidget);
    expect(find.text('${fixtureSeries.first.title} #2'), findsOneWidget);
    expect(find.text('Free'), findsOneWidget);
    // The panel is not a page of the episode, so the counter still names the
    // last one the reader read.
    expect(find.text('3 / 3'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('the offer prices a next episode that is not free', (
    tester,
  ) async {
    openEpisode('$seriesId-ep-9');
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(find.text('¥500'), findsOneWidget);
    expect(find.text('Free'), findsNothing);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('the last episode of a series says the reader is up to date', (
    tester,
  ) async {
    openEpisode('$seriesId-ep-10');
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(find.text('You are up to date'), findsOneWidget);
    expect(find.textContaining(fixtureSeries.first.title), findsWidgets);
    expect(find.text('Up next'), findsNothing);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('a next episode saved on the device is marked', (tester) async {
    final next = fixtureDetail(fixtureSeries.first).episodes[1];
    await offline.writeEpisode(
      SavedEpisode(
        ownerId: '',
        checkedAt: DateTime.now(),
        detail: EpisodeDetail(
          episode: next,
          seriesId: seriesId,
          seriesTitle: fixtureSeries.first.title,
          access: EpisodeAccess.free,
          images: const [],
        ),
      ),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(
      find.byKey(const ValueKey('episode-end-next-saved')),
      findsOneWidget,
    );
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('an episode the device does not hold is not marked', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(find.byKey(const ValueKey('episode-end-next-saved')), findsNothing);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('taking the offer opens the next episode in place of this one', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text('Episodes'));
    await tester.tap(find.byKey(ValueKey('episode-tile-$episodeId')));
    await pumpUntilRouteSettled(tester, pageView);
    await turnToEnd(tester);

    await tester.tap(find.byKey(const ValueKey('episode-end-next')));
    // The route is what says the offer was taken. The panel the tap was made
    // on is still on screen for the frame after it, next episode's title and
    // all, so what is drawn cannot tell one episode from the other yet.
    await pumpUntilTrue(
      tester,
      () =>
          router.state.uri.path ==
          AppRoutes.episodeViewerPath(seriesId, '$seriesId-ep-2'),
      description: 'the next episode to open',
    );
    await pumpUntilRouteSettled(tester, pageView);

    // The episode that opens is read from its first page, not from where the
    // reader stopped in the one before it.
    expect(find.text('1 / 3'), findsOneWidget);

    // The episode read before it was replaced rather than stacked, so the way
    // back is the series it was opened from.
    await tester.pageBack();
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });

  testWidgets('the end of an episode leads to its comments', (tester) async {
    // The only way to them: what a reader has to say about an episode comes
    // after they have read it.
    await pumpApp(tester, comments: FakeCommentRepository());
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    final open = find.byKey(const ValueKey('episode-end-comments'));
    await pumpUntilFound(tester, open);
    await tester.tap(open);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-empty')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeCommentsPath(seriesId, episodeId),
    );
  });

  testWidgets('the end panel sends a guest to sign in to react', (
    tester,
  ) async {
    await pumpApp(tester);
    await turnToEnd(tester);

    expect(
      find.byKey(const ValueKey('episode-reaction-sign-in')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('episode-reaction-press')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('episode-reaction-sign-in')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-submit')));
  });

  testWidgets('a signed-in reader can react once from the end panel', (
    tester,
  ) async {
    catalog.reactions = {
      episodeId: const EpisodeReaction(
        score: 0,
        ratingCount: 0,
        allowsMultiplePresses: false,
      ),
    };
    await pumpApp(tester, session: fakeSession);
    await turnToEnd(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-reaction-press')),
    );
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('episode-reaction-press')),
          )
          .onPressed,
      isNotNull,
    );

    tester
        .widget<FilledButton>(
          find.byKey(const ValueKey('episode-reaction-press')),
        )
        .onPressed!
        .call();
    await tester.pumpAndSettle();

    expect(catalog.reactions[episodeId]?.score, 5);
    expect(find.text('1 reader reacted'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('episode-reaction-press')),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('a reaction response from a signed-out reader is discarded', (
    tester,
  ) async {
    final auth = fakeAuthController(session: fakeSession);
    final reaction = Completer<EpisodeReaction?>();
    catalog.reactionGate = reaction;

    await tester.pumpWidget(
      MaterialApp(
        supportedLocales: AppMessages.supportedLocales,
        localizationsDelegates: appLocalizationsDelegates,
        home: AuthScope(
          controller: auth,
          child: CatalogScope(
            repository: catalog,
            child: Scaffold(
              body: EpisodeReactionControl(
                episode: fixtureDetails()[seriesId]!.episodes.first,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(
      find.byKey(const ValueKey('episode-reaction-press')),
      findsOneWidget,
    );

    await auth.signOut();
    expect(auth.isSignedIn, isFalse);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('episode-reaction-sign-in')),
      findsOneWidget,
    );
    reaction.complete(
      const EpisodeReaction(
        score: 5,
        ratingCount: 1,
        allowsMultiplePresses: false,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('0 readers reacted'), findsOneWidget);
  });

  testWidgets('a tenant that takes no comments offers none at the end', (
    tester,
  ) async {
    await pumpApp(
      tester,
      comments: FakeCommentRepository(mode: CommentMode.disabled),
    );
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    expect(find.byKey(const ValueKey('episode-end-comments')), findsNothing);
  });

  testWidgets('the panel leads back to the series', (tester) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);
    await turnToEnd(tester);

    await tester.tap(find.byKey(const ValueKey('episode-end-back-to-series')));
    await pumpUntilFound(tester, find.text('Episodes'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });

  testWidgets('the control bar opens the episode after this one', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);

    await tester.tap(find.byKey(const ValueKey('episode-next-episode')));
    await pumpUntilTrue(
      tester,
      () =>
          router.state.uri.path ==
          AppRoutes.episodeViewerPath(seriesId, '$seriesId-ep-2'),
      description: 'the next episode to open',
    );
    await pumpUntilFound(tester, pageView);

    expect(find.text('${fixtureSeries.first.title} #2'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('the control bar opens the episode before this one', (
    tester,
  ) async {
    openEpisode('$seriesId-ep-2');
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);

    await tester.tap(find.byKey(const ValueKey('episode-previous-episode')));
    await pumpUntilTrue(
      tester,
      () => router.state.uri.path == viewerPath,
      description: 'the previous episode to open',
    );
    await pumpUntilFound(tester, pageView);

    expect(find.text('${fixtureSeries.first.title} #1'), findsOneWidget);
    await pumpUntilNoPendingFrameCallbacks(tester);
  });

  testWidgets('the first episode has no episode before it to open', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, pageView);

    final previous = tester.widget<IconButton>(
      find.byKey(const ValueKey('episode-previous-episode')),
    );
    final next = tester.widget<IconButton>(
      find.byKey(const ValueKey('episode-next-episode')),
    );
    expect(previous.onPressed, isNull);
    expect(next.onPressed, isNotNull);
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
