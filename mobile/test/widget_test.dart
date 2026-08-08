import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/data/sample_series.dart';
import 'package:publira/router.dart';

void main() {
  late GoRouter router;

  setUp(() {
    router = createAppRouter();
  });

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(PubliraApp(router: router));
    await tester.pumpAndSettle();
  }

  testWidgets('catalog shows sample series titles', (tester) async {
    await pumpApp(tester);

    expect(find.text('Publira'), findsOneWidget);
    for (final series in sampleSeries) {
      expect(find.text(series.title), findsOneWidget);
    }
  });

  testWidgets('tapping a series opens its detail screen', (tester) async {
    await pumpApp(tester);

    final first = sampleSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await tester.pumpAndSettle();

    expect(find.text(first.title), findsWidgets);
    expect(find.text(first.description), findsOneWidget);
    expect(find.text('${first.episodeCount} 話'), findsOneWidget);
    expect(find.text('エピソード一覧とビューアは今後の Issue で実装します。'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.seriesDetailPath(first.id));
  });

  testWidgets('back from detail returns to catalog', (tester) async {
    await pumpApp(tester);

    final first = sampleSeries.first;
    await tester.tap(find.byKey(ValueKey('series-tile-${first.id}')));
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Publira'), findsOneWidget);
    expect(find.byKey(ValueKey('series-tile-${first.id}')), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown series id shows not-found message', (tester) async {
    router = createAppRouter(initialLocation: '/series/does-not-exist');
    await pumpApp(tester);

    expect(find.textContaining('シリーズが見つかりません'), findsOneWidget);

    await tester.tap(find.text('カタログへ戻る'));
    await tester.pumpAndSettle();

    expect(find.text('Publira'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });

  testWidgets('unknown route shows not-found screen', (tester) async {
    router = createAppRouter(initialLocation: '/no-such-page');
    await pumpApp(tester);

    expect(find.text('ページが見つかりません'), findsOneWidget);
    expect(find.textContaining('は存在しません'), findsOneWidget);

    await tester.tap(find.text('カタログへ戻る'));
    await tester.pumpAndSettle();

    expect(find.text('Publira'), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.catalog);
  });
}
