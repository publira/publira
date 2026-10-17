import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final notice = find.byKey(const ValueKey('series-fallback-notice'));

  late FakeCatalogRepository catalog;

  /// The fixture series as the API answers it when its title and synopsis
  /// come from the translation in [locale].
  SeriesDetail servedIn(String locale) {
    final detail = fixtureDetail(series);
    return SeriesDetail(
      series: SeriesItem(
        id: series.id,
        internalId: series.internalId,
        title: series.title,
        description: series.description,
        locale: locale,
        episodeCount: detail.episodes.length,
      ),
      episodes: detail.episodes,
    );
  }

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: {series.id: servedIn('en')},
      episodes: fixtureEpisodes(),
    );
  });

  Future<void> openSeries(WidgetTester tester) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(
          initialLocation: AppRoutes.seriesDetailPath(series.id),
        ),
        catalog: catalog,
        auth: fakeAuthController(session: null),
      ),
    );
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );
  }

  testWidgets('a series is read in the app\'s language and shown in it '
      'without a note', (tester) async {
    await openSeries(tester);

    expect(catalog.readLocales, isNotEmpty);
    expect(catalog.readLocales.toSet(), {'en'});
    expect(notice, findsNothing);
  });

  testWidgets('a series without a translation in the app\'s language says '
      'which language it is shown in', (tester) async {
    catalog.details = {series.id: servedIn('ja')};
    await openSeries(tester);

    expect(
      find.text(
        'This series has no title or synopsis in your language, so it is '
        'shown in 日本語.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('the series and each episode are set in the language they '
      'were served in', (tester) async {
    final detail = servedIn('ja');
    final first = detail.episodes.first;
    catalog.details = {
      series.id: SeriesDetail(
        series: detail.series,
        episodes: [
          EpisodeItem(
            id: first.id,
            internalId: first.internalId,
            title: first.title,
            locale: 'en',
            orderIndex: first.orderIndex,
            price: first.price,
          ),
          ...detail.episodes.skip(1),
        ],
      ),
    };
    await openSeries(tester);
    await tester.scrollUntilVisible(
      find.byKey(ValueKey('episode-tile-${first.id}')),
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const ValueKey('series-detail-body')),
            matching: find.byType(Scrollable),
          )
          .first,
    );

    Locale? localeOf(String text) => tester
        .widget<AutospacedText>(
          find
              .byWidgetPredicate(
                (widget) => widget is AutospacedText && widget.data == text,
              )
              .last,
        )
        .locale;

    expect(localeOf(series.description), const Locale('ja'));
    expect(localeOf(first.title), const Locale('en'));
  });

  testWidgets('a served locale no catalog carries puts up no note', (
    tester,
  ) async {
    catalog.details = {series.id: servedIn('fr')};
    await openSeries(tester);

    expect(notice, findsNothing);
  });

  testWidgets('the series is read again when the device changes language', (
    tester,
  ) async {
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    await openSeries(tester);
    expect(notice, findsNothing);

    tester.platformDispatcher.localesTestValue = const [Locale('ko')];
    await pumpUntilFound(tester, notice);

    expect(catalog.readLocales, contains('ko'));
    expect(
      find.text('이 시리즈는 사용 중인 언어로 된 제목과 줄거리가 없어 English로 표시합니다.'),
      findsOneWidget,
    );
  });

  testWidgets('the catalog lists are read again when the device changes '
      'language', (tester) async {
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    catalog.newestSeries = fixtureSeries;
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: AppRoutes.catalog),
        catalog: catalog,
        auth: fakeAuthController(session: null),
      ),
    );
    await pumpUntilRouteSettled(
      tester,
      find.byKey(ValueKey('series-tile-${series.id}')),
    );
    expect(catalog.readLocales.toSet(), {'en'});
    final firstReads = catalog.readLocales.length;
    final firstPages = catalog.seriesTokens.length;
    final firstShelves = catalog.newestSeriesLimits.length;

    tester.platformDispatcher.localesTestValue = const [Locale('ja')];
    await pumpUntilTrue(
      tester,
      () => catalog.newestSeriesLimits.length > firstShelves,
    );
    await pumpUntilTrue(tester, () => catalog.seriesTokens.length > firstPages);

    expect(catalog.readLocales.skip(firstReads).toSet(), {'ja'});
  });
}
