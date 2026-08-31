import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, episodeId);

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

  Future<void> pumpApp(WidgetTester tester, {AuthSession? session}) async {
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

  testWidgets('a locked paid body shows the purchase notice', (tester) async {
    catalog.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-locked')));

    expect(find.text('この話は購入すると読めます'), findsOneWidget);
    expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
  });

  testWidgets('an episode without pages shows the empty notice', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes(pageCount: 0);
    await pumpApp(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-empty')));

    expect(find.text('このエピソードにはまだページがありません'), findsOneWidget);
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

    await tester.tap(find.text('シリーズへ戻る'));
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });

  testWidgets('a network error offers retry', (tester) async {
    catalog.episodeError = const CatalogFailure(CatalogFailureKind.network);
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-viewer-error')),
    );
    expect(find.textContaining('エピソードを表示できませんでした'), findsOneWidget);

    catalog.episodeError = null;
    await tester.tap(find.text('再試行'));
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
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    await tester.tap(find.byKey(ValueKey('episode-tile-$episodeId')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(router.state.uri.path, viewerPath);

    await tester.pageBack();
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
  });
}
