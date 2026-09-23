import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/app.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_content_view_repository.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final firstEpisode = '${series.id}-ep-1';
  final pageView = find.byKey(const ValueKey('episode-page-view'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeContentViewRepository views;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    views = FakeContentViewRepository();
  });

  Future<void> pumpApp(WidgetTester tester, String location) async {
    router = createAppRouter(initialLocation: location);
    tester.view
      ..physicalSize = const Size(1000, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        contentViews: views,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('the series screen', () {
    testWidgets('records one view of the series it opens', (tester) async {
      await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
      await pumpUntilRouteSettled(tester, find.text('Episodes'));

      expect(views.recorded, ['series:${series.id}']);
    });

    testWidgets('records nothing while the age rating gate stands', (
      tester,
    ) async {
      catalog.details = {
        fixtureRatedSeries.id: fixtureDetail(fixtureRatedSeries),
      };
      await pumpApp(tester, AppRoutes.seriesDetailPath(fixtureRatedSeries.id));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('age-rating-gate')),
      );

      expect(views.recorded, isEmpty);

      await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
      await pumpUntilRouteSettled(tester, find.text('Episodes'));

      expect(views.recorded, ['series:${fixtureRatedSeries.id}']);
    });

    testWidgets('records nothing for a series the API does not show', (
      tester,
    ) async {
      await pumpApp(tester, AppRoutes.seriesDetailPath('missing-series'));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('series-not-found')),
      );

      expect(views.recorded, isEmpty);
    });

    testWidgets('still opens when the view could not be recorded', (
      tester,
    ) async {
      views.failure = const ConnectException(
        code: 'unavailable',
        message: 'unreachable',
      );
      await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
      await pumpUntilRouteSettled(tester, find.text('Episodes'));

      expect(views.recorded, ['series:${series.id}']);
      expect(find.byKey(const ValueKey('series-detail-error')), findsNothing);
    });
  });

  group('the viewer', () {
    testWidgets('records one view of the episode it opens', (tester) async {
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(tester, pageView);

      expect(views.recorded, ['episode:$firstEpisode']);
    });

    testWidgets('records the series beneath only once the reader goes back', (
      tester,
    ) async {
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(tester, pageView);

      expect(views.recorded, ['episode:$firstEpisode']);

      router.pop();
      await pumpUntilRouteSettled(tester, find.text('Episodes'));

      expect(views.recorded, ['episode:$firstEpisode', 'series:${series.id}']);
    });

    testWidgets('records the next episode the reader moves on to', (
      tester,
    ) async {
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(tester, pageView);

      await tester.tap(find.byKey(const ValueKey('episode-next-episode')));
      await pumpUntilTrue(
        tester,
        () =>
            router.state.uri.path ==
            AppRoutes.episodeViewerPath(series.id, '${series.id}-ep-2'),
        description: 'the next episode to open',
      );
      await pumpUntilFound(tester, pageView);
      await pumpUntilNoPendingFrameCallbacks(tester);

      expect(views.recorded, [
        'episode:$firstEpisode',
        'episode:${series.id}-ep-2',
      ]);
    });

    testWidgets('records a locked episode the reader was shown', (
      tester,
    ) async {
      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-locked')),
      );

      expect(views.recorded, ['episode:$firstEpisode']);
    });

    testWidgets('records nothing while the age rating gate stands', (
      tester,
    ) async {
      catalog.episodes = fixtureEpisodes(ageRating: SeriesAgeRating.r15);
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('age-rating-gate')),
      );

      expect(views.recorded, isEmpty);

      await tester.tap(find.byKey(const ValueKey('age-rating-confirm')));
      await pumpUntilFound(tester, pageView);

      expect(views.recorded, ['episode:$firstEpisode']);
    });

    testWidgets('still opens when the view could not be recorded', (
      tester,
    ) async {
      views.failure = StateError('the record failed');
      await pumpApp(
        tester,
        AppRoutes.episodeViewerPath(series.id, firstEpisode),
      );
      await pumpUntilFound(tester, pageView);

      expect(views.recorded, ['episode:$firstEpisode']);
      expect(find.text('1 / 3'), findsOneWidget);
    });
  });
}
