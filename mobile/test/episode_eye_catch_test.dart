import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// An eye-catch the console uploaded for the episode [id], cut both ways.
List<EyeCatchVariant> episodeEyeCatch(String id) => [
  for (final (type, height) in [('landscape', 450), ('portrait', 1066)])
    EyeCatchVariant(
      variantType: type,
      url: Uri.parse('http://images.test/images/episode-eye-catches/$id/$type'),
      width: 800,
      height: height,
    ),
];

/// [series] with two free episodes, the second of them carrying artwork of
/// its own and the first none.
SeriesDetail detailOf(SeriesItem series) => SeriesDetail(
  series: series,
  episodes: [
    EpisodeItem(
      id: '${series.id}-ep-1',
      title: '${series.title} #1',
      orderIndex: 1,
      price: 0,
    ),
    EpisodeItem(
      id: '${series.id}-ep-2',
      title: '${series.title} #2',
      orderIndex: 2,
      price: 0,
      eyeCatchVariants: episodeEyeCatch('${series.id}-ep-2'),
    ),
  ],
);

/// The [NetworkImage] behind [finder], unwrapping the decode bound the cover
/// puts around it.
NetworkImage requestOf(WidgetTester tester, Finder finder) {
  final image = tester.widget<Image>(finder).image;
  final provider = image is ResizeImage ? image.imageProvider : image;
  return provider as NetworkImage;
}

void main() {
  final covered = fixtureSeries.first;
  final uncovered = fixtureSeries[1];

  Future<void> pumpSeries(WidgetTester tester, SeriesItem series) async {
    // Tall enough that every episode row is laid out without scrolling.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(
          initialLocation: AppRoutes.seriesDetailPath(series.id),
        ),
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: {series.id: detailOf(series)},
        ),
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await tester.pump();
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-tile-${series.id}-ep-2')),
    );
  }

  Finder inRow(String episodeId, Finder finder) => find.descendant(
    of: find.byKey(ValueKey('episode-tile-$episodeId')),
    matching: finder,
  );

  testWidgets("an episode row draws the episode's own eye-catch", (
    tester,
  ) async {
    await pumpSeries(tester, covered);

    final episodeId = '${covered.id}-ep-2';
    final cover = inRow(
      episodeId,
      find.byKey(ValueKey('episode-cover-$episodeId')),
    );
    expect(cover, findsOneWidget);
    final request = requestOf(tester, cover);
    // The row's box is 16:9, so the landscape cut is the one it asks for.
    expect(
      request.url,
      'http://images.test/images/episode-eye-catches/$episodeId/landscape',
    );
    expect(request.headers, fixtureImageHeaders);
  });

  testWidgets("an episode without artwork of its own draws the series' cover", (
    tester,
  ) async {
    await pumpSeries(tester, covered);

    final episodeId = '${covered.id}-ep-1';
    final cover = inRow(
      episodeId,
      find.byKey(ValueKey('episode-cover-$episodeId')),
    );
    expect(cover, findsOneWidget);
    expect(
      requestOf(tester, cover).url,
      'http://images.test/images/series/SeedSIMGAAA1/landscape/800',
    );
  });

  testWidgets('a row whose series has no cover either keeps the placeholder', (
    tester,
  ) async {
    await pumpSeries(tester, uncovered);

    final bare = '${uncovered.id}-ep-1';
    expect(
      inRow(bare, find.byKey(ValueKey('episode-cover-placeholder-$bare'))),
      findsOneWidget,
    );
    expect(inRow(bare, find.byType(Image)), findsNothing);
    // The episode that has artwork still draws it under a series that has
    // none.
    final drawn = '${uncovered.id}-ep-2';
    expect(
      inRow(drawn, find.byKey(ValueKey('episode-cover-$drawn'))),
      findsOneWidget,
    );
  });

  testWidgets('every episode row gives its picture the same box', (
    tester,
  ) async {
    await pumpSeries(tester, uncovered);

    final drawn = tester.getSize(
      find.byKey(ValueKey('episode-cover-${uncovered.id}-ep-2')),
    );
    final placeholder = tester.getSize(
      find.byKey(ValueKey('episode-cover-placeholder-${uncovered.id}-ep-1')),
    );
    expect(drawn, placeholder);
    expect(drawn.aspectRatio, closeTo(16 / 9, 0.01));
    // The picture leaves room above and below it, so those of adjacent rows
    // do not run together.
    final row = tester.getSize(
      find.byKey(ValueKey('episode-tile-${uncovered.id}-ep-2')),
    );
    expect(drawn.height, lessThan(row.height - 8));
  });
}
