import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/router.dart';

import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
    );
  });

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(PubliraApp(router: router, catalog: catalog));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('catalog shows series titles from the repository', (
    tester,
  ) async {
    await pumpApp(tester);

    expect(find.text('Publira'), findsOneWidget);
    for (final series in fixtureSeries) {
      expect(find.text(series.title), findsOneWidget);
    }
  });

  testWidgets('tapping a series opens its detail screen', (tester) async {
    await pumpApp(tester);

    final first = fixtureSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    expect(find.text(first.title), findsWidgets);
    expect(find.text(first.description), findsWidgets);
    expect(find.text('${first.episodeCount} 話'), findsOneWidget);
    expect(find.text('エピソード一覧'), findsOneWidget);
    expect(find.text('${first.title} #1'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.seriesDetailPath(first.id));
  });

  testWidgets('back from detail returns to catalog', (tester) async {
    await pumpApp(tester);

    final first = fixtureSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    await tester.pageBack();
    await pumpUntilFound(tester, find.text('Publira'));

    expect(find.text('Publira'), findsOneWidget);
    expect(find.byKey(ValueKey('series-tile-${first.id}')), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown series id shows not-found message', (tester) async {
    router = createAppRouter(initialLocation: '/series/does-not-exist');
    await pumpApp(tester);

    expect(find.textContaining('シリーズが見つかりません'), findsOneWidget);

    await tester.tap(find.text('カタログへ戻る'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text('Publira'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown route shows not-found screen', (tester) async {
    router = createAppRouter(initialLocation: '/no-such-page');
    await pumpApp(tester);

    expect(find.text('ページが見つかりません'), findsOneWidget);
    expect(find.textContaining('は存在しません'), findsOneWidget);

    await tester.tap(find.text('カタログへ戻る'));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text('Publira'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('empty catalog shows an empty-state message', (tester) async {
    catalog = FakeCatalogRepository();
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('catalog-empty')), findsOneWidget);
    expect(find.text('公開中のシリーズはありません'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('catalog network error offers retry', (tester) async {
    catalog = FakeCatalogRepository(
      listError: const CatalogFailure(CatalogFailureKind.network),
    );
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('catalog-error')), findsOneWidget);
    expect(find.textContaining('カタログを表示できませんでした'), findsOneWidget);

    catalog
      ..listError = null
      ..series = fixtureSeries
      ..details = fixtureDetails();
    await tester.tap(find.byKey(const ValueKey('catalog-retry')));
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.text(fixtureSeries.first.title), findsOneWidget);
  });

  testWidgets('series detail network error offers retry', (tester) async {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      detailError: const CatalogFailure(CatalogFailureKind.network),
    );
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(fixtureSeries.first.id),
    );
    await pumpApp(tester);

    expect(find.byKey(const ValueKey('series-detail-error')), findsOneWidget);
    expect(find.textContaining('ページを表示できませんでした'), findsOneWidget);

    catalog.detailError = null;
    await tester.tap(find.text('再試行'));
    await pumpUntilFound(tester, find.text('エピソード一覧'));

    expect(find.text(fixtureSeries.first.title), findsWidgets);
  });
}
