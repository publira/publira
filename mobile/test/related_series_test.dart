import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';
import 'support/tap.dart';

void main() {
  final series = fixtureSeries.first;
  final kitchen = fixtureSeries[1];
  final detail = fixtureDetail(series);

  final related = find.byKey(const ValueKey('series-related'));
  final heading = find.text('You may also like');
  final seriesBody = find.descendant(
    of: find.byKey(const ValueKey('series-detail-body')),
    matching: find.byWidgetPredicate(
      (widget) =>
          widget is Scrollable && widget.axisDirection == AxisDirection.down,
    ),
  );

  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> pumpSeries(WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: null),
      ),
    );
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );
  }

  /// Scrolls to the foot of the screen, which is where the row stands when
  /// there is one.
  Future<void> scrollToFoot(WidgetTester tester) async {
    await tester.scrollUntilVisible(
      find.byKey(ValueKey('episode-tile-${detail.episodes.last.id}')),
      200,
      scrollable: seriesBody,
    );
    await tester.drag(seriesBody, const Offset(0, -2000));
    // The row is read once the screen has been scrolled down to it.
    await pumpUntilTrue(tester, () => catalog.relatedSeriesRequests.isNotEmpty);
    await tester.pump();
  }

  testWidgets('a series with related works lists them and opens each one', (
    tester,
  ) async {
    catalog.relatedSeries = {
      series.internalId: [kitchen],
    };
    await pumpSeries(tester);
    final card = find.byKey(ValueKey('series-related-${kitchen.id}'));
    await tester.scrollUntilVisible(card, 200, scrollable: seriesBody);

    expect(catalog.relatedSeriesRequests, [
      (seriesId: series.internalId, limit: 10),
    ]);
    expect(related, findsOne);
    expect(find.descendant(of: related, matching: heading), findsOne);
    expect(
      find.descendant(of: card, matching: find.text(kitchen.title)),
      findsOne,
    );

    await tapReachable(tester, card);
    await pumpUntilRouteSettled(
      tester,
      find.descendant(
        of: find.byType(AppBar),
        matching: find.text(kitchen.title),
      ),
    );

    expect(router.state.uri.path, AppRoutes.seriesDetailPath(kitchen.id));
  });

  testWidgets('a series without related works shows no row', (tester) async {
    await pumpSeries(tester);
    await scrollToFoot(tester);

    expect(related, findsNothing);
    expect(find.byKey(const ValueKey('series-related-loading')), findsNothing);
    expect(heading, findsNothing);
  });

  testWidgets('a related row that could not be read leaves the screen whole', (
    tester,
  ) async {
    catalog.relatedSeriesError = const CatalogFailure(
      CatalogFailureKind.network,
    );
    await pumpSeries(tester);
    await scrollToFoot(tester);

    expect(related, findsNothing);
    expect(heading, findsNothing);
    // A suggestion that did not arrive is not a failure the reader is asked
    // to deal with.
    expect(find.byKey(const ValueKey('series-related-error')), findsNothing);
    expect(find.byKey(const ValueKey('series-related-retry')), findsNothing);
  });
}
