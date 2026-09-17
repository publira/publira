import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// The [NetworkImage] behind [finder], unwrapping the decode bound the cover
/// puts around it.
NetworkImage _requestOf(WidgetTester tester, Finder finder) {
  final image = tester.widget<Image>(finder).image;
  final provider = image is ResizeImage ? image.imageProvider : image;
  return provider as NetworkImage;
}

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  final withCover = fixtureSeries.first;
  final withoutCover = fixtureSeries.last;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
    );
  });

  tearDown(() => imageCache.clear());

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
      ),
    );
    await pumpUntilFound(tester, find.text(withCover.title));
  }

  testWidgets('a catalog tile draws the portrait rendition of its box', (
    tester,
  ) async {
    await pumpApp(tester);

    final request = _requestOf(
      tester,
      find.byKey(ValueKey('series-cover-${withCover.id}')),
    );
    expect(
      request.url,
      'http://images.test/images/series/SeedSIMGAAA1/portrait/400',
    );
    expect(request.headers, fixtureImageHeaders);
  });

  testWidgets('a series with no cover shows the placeholder', (tester) async {
    await pumpApp(tester);

    expect(
      find.byKey(ValueKey('series-cover-${withoutCover.id}')),
      findsNothing,
    );
    expect(
      find.byKey(ValueKey('series-cover-placeholder-${withoutCover.id}')),
      findsOneWidget,
    );
  });

  testWidgets('a cover that cannot be fetched falls back to the placeholder', (
    tester,
  ) async {
    await pumpApp(tester);

    // The test binding answers every image request with a 400, which is the
    // same failure a reader with no network sees.
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('series-cover-placeholder-${withCover.id}')),
    );
  });

  testWidgets('the detail screen draws the landscape rendition', (
    tester,
  ) async {
    await pumpApp(tester);

    await tester.tap(find.byKey(ValueKey('series-tile-${withCover.id}')));
    await pumpUntilFound(tester, find.text('Episodes'));

    final request = _requestOf(
      tester,
      find.byKey(ValueKey('series-cover-${withCover.id}')),
    );
    expect(
      request.url,
      'http://images.test/images/series/SeedSIMGAAA1/landscape/1600',
    );
  });
}
