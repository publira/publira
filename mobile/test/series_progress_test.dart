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
  final series = fixtureSeries.first;
  final detail = fixtureDetail(series);
  final episodes = detail.episodes;

  EpisodeItem episode(int orderIndex) =>
      episodes.singleWhere((episode) => episode.orderIndex == orderIndex);

  final readingAction = find.byKey(const ValueKey('series-reading-action'));
  Finder finishedMark(int orderIndex) =>
      find.byKey(ValueKey('episode-finished-${episode(orderIndex).id}'));
  Finder episodeTile(int orderIndex) =>
      find.byKey(ValueKey('episode-tile-${episode(orderIndex).id}'));
  final seriesBody = find.descendant(
    of: find.byKey(const ValueKey('series-detail-body')),
    matching: find.byType(Scrollable),
  );

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
    await pumpUntilRouteSettled(tester, readingAction);
  }

  String actionLabel(WidgetTester tester) => tester
      .widgetList<Text>(
        find.descendant(of: readingAction, matching: find.byType(Text)),
      )
      .map((text) => text.data ?? text.textSpan?.toPlainText() ?? '')
      .join();

  Future<void> scrollToEpisode(WidgetTester tester, int orderIndex) async {
    await tester.scrollUntilVisible(
      episodeTile(orderIndex),
      200,
      scrollable: seriesBody,
    );
  }

  testWidgets('a guest is offered the first episode and asked nothing', (
    tester,
  ) async {
    await pumpSeries(tester, session: null);

    expect(actionLabel(tester), 'Read from episode 1');
    expect(catalog.seriesProgressRequests, isEmpty);

    await tapReachable(tester, readingAction);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeViewerPath(series.id, episode(1).id),
    );
  });

  testWidgets('a reader who opened nothing is offered the first episode', (
    tester,
  ) async {
    await pumpSeries(tester);
    await pumpUntilTrue(
      tester,
      () => catalog.seriesProgressRequests.isNotEmpty,
    );
    await tester.pump();

    expect(catalog.seriesProgressRequests, [detail.series.internalId]);
    expect(actionLabel(tester), 'Read from episode 1');
  });

  testWidgets(
    'a reader in the middle of an episode resumes it and sees what they finished',
    (tester) async {
      catalog.seriesProgress = {
        detail.series.internalId: SeriesProgress(
          episode: episode(3),
          finishedEpisodeIds: {episode(1).id, episode(2).id},
        ),
      };
      await pumpSeries(tester);
      await pumpUntilTrue(
        tester,
        () => actionLabel(tester) != 'Read from episode 1',
      );

      expect(actionLabel(tester), 'Continue reading');
      await scrollToEpisode(tester, 3);
      expect(finishedMark(1), findsOne);
      expect(finishedMark(2), findsOne);
      expect(finishedMark(3), findsNothing);
      expect(
        find.descendant(of: finishedMark(1), matching: find.text('Finished')),
        findsOne,
      );

      await tester.scrollUntilVisible(
        readingAction,
        -200,
        scrollable: seriesBody,
      );
      await tapReachable(tester, readingAction);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('episode-page-view')),
      );

      expect(
        router.state.uri.path,
        AppRoutes.episodeViewerPath(series.id, episode(3).id),
      );
    },
  );

  testWidgets('a reader who finished an episode is sent on to the next', (
    tester,
  ) async {
    catalog.seriesProgress = {
      detail.series.internalId: SeriesProgress(
        episode: episode(2),
        isFinished: true,
        finishedEpisodeIds: {episode(2).id},
      ),
    };
    await pumpSeries(tester);
    await pumpUntilTrue(
      tester,
      () => actionLabel(tester) == 'Continue reading',
    );

    await tapReachable(tester, readingAction);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeViewerPath(series.id, episode(3).id),
    );
  });

  testWidgets('a reader who finished the last episode starts over', (
    tester,
  ) async {
    catalog.seriesProgress = {
      detail.series.internalId: SeriesProgress(
        episode: episodes.last,
        isFinished: true,
        finishedEpisodeIds: {for (final episode in episodes) episode.id},
      ),
    };
    await pumpSeries(tester);
    await scrollToEpisode(tester, 1);
    await pumpUntilFound(tester, finishedMark(1));

    expect(actionLabel(tester), 'Read from episode 1');

    await tester.scrollUntilVisible(
      readingAction,
      -200,
      scrollable: seriesBody,
    );
    await tapReachable(tester, readingAction);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(
      router.state.uri.path,
      AppRoutes.episodeViewerPath(series.id, episode(1).id),
    );
  });

  testWidgets('a read that fails leaves the first episode on offer', (
    tester,
  ) async {
    catalog
      ..seriesProgress = {
        detail.series.internalId: SeriesProgress(
          episode: episode(3),
          finishedEpisodeIds: {episode(1).id},
        ),
      }
      ..seriesProgressError = const CatalogFailure(CatalogFailureKind.network);
    await pumpSeries(tester);
    await pumpUntilTrue(
      tester,
      () => catalog.seriesProgressRequests.isNotEmpty,
    );
    await tester.pump();
    await scrollToEpisode(tester, 1);

    expect(finishedMark(1), findsNothing);
    expect(find.byKey(const ValueKey('series-detail-error')), findsNothing);
    await tester.scrollUntilVisible(
      readingAction,
      -200,
      scrollable: seriesBody,
    );
    expect(actionLabel(tester), 'Read from episode 1');
  });

  testWidgets('coming back from an episode shows where the reader is now', (
    tester,
  ) async {
    await pumpSeries(tester);
    await pumpUntilTrue(
      tester,
      () => catalog.seriesProgressRequests.isNotEmpty,
    );

    await tapReachable(tester, readingAction);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
    // What the viewer records while the reader is in it.
    catalog.seriesProgress = {
      detail.series.internalId: SeriesProgress(
        episode: episode(1),
        isFinished: true,
        finishedEpisodeIds: {episode(1).id},
      ),
    };
    await tester.pageBack();
    await pumpUntilRouteSettled(tester, readingAction);
    await pumpUntilTrue(
      tester,
      () => actionLabel(tester) == 'Continue reading',
    );

    await scrollToEpisode(tester, 1);
    expect(finishedMark(1), findsOne);
  });

  testWidgets('signing out takes the reader\'s place off the screen', (
    tester,
  ) async {
    catalog.seriesProgress = {
      detail.series.internalId: SeriesProgress(
        episode: episode(3),
        finishedEpisodeIds: {episode(1).id},
      ),
    };
    await pumpSeries(tester);
    await pumpUntilTrue(
      tester,
      () => actionLabel(tester) == 'Continue reading',
    );

    await auth.signOut();
    await pumpUntilTrue(
      tester,
      () => actionLabel(tester) == 'Read from episode 1',
    );

    await scrollToEpisode(tester, 1);
    expect(finishedMark(1), findsNothing);
  });

  group('the episode a series offers', () {
    test('is the first one for a reader who opened nothing', () {
      final offer = SeriesProgress.none.offerIn(episodes)!;

      expect(offer.episode.id, episode(1).id);
      expect(offer.isContinuation, isFalse);
    });

    test('is the one a reader stopped inside', () {
      final offer = SeriesProgress(episode: episode(4)).offerIn(episodes)!;

      expect(offer.episode.id, episode(4).id);
      expect(offer.isContinuation, isTrue);
    });

    test('is the next one published after a finished episode', () {
      final offer = SeriesProgress(
        episode: episode(4),
        isFinished: true,
      ).offerIn([episode(1), episode(4), episode(6)])!;

      expect(offer.episode.id, episode(6).id);
      expect(offer.isContinuation, isTrue);
    });

    test('is the first one again once the last is finished', () {
      final offer = SeriesProgress(
        episode: episodes.last,
        isFinished: true,
      ).offerIn(episodes)!;

      expect(offer.episode.id, episode(1).id);
      expect(offer.isContinuation, isFalse);
    });

    test('is nothing for a series with no episodes', () {
      expect(SeriesProgress(episode: episode(1)).offerIn(const []), isNull);
    });
  });
}
