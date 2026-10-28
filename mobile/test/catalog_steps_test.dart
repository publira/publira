import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/campaign_banner.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/catalog_steps.dart';
import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A screen the height of a phone, whose foot the label shelf reaches into
/// until the campaign banners above it arrive.
const _phoneSize = Size(400, 900);

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      newestSeries: fixtureSeries,
      rankedSeries: [
        for (final (index, series) in fixtureSeries.indexed)
          RankedSeriesItem(rank: index + 1, series: series),
      ],
      genres: const [
        PublishedGenre(id: 'fantasy', name: 'Fantasy', seriesCount: 3),
      ],
      labelList: const [PublishedLabel(id: 'label-1', name: 'Label 01')],
      campaignBanners: [
        CampaignBanner(
          id: 'spring',
          linkUrl: '/spring',
          imageVariants: [
            EyeCatchVariant(
              variantType: 'landscape',
              url: Uri.parse(
                'http://images.test/images/campaign-banners/spring/landscape/800',
              ),
              width: 800,
              height: 450,
            ),
          ],
        ),
      ],
    );
  });

  tearDown(() => imageCache.clear());

  testWidgets('a shelf list opens when the shelf is pushed below the fold '
      'while it is read', (tester) async {
    tester.view.physicalSize = _phoneSize;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    catalog
      ..campaignBannersGate = Completer<void>()
      ..labelListGate = Completer<void>();
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
        site: const PublicSite(host: 'shop.example'),
      ),
    );
    await tester.pump();
    // The shelf is on screen while it is read, and has no action yet.
    expect(find.text('Featured labels'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('catalog-labels-all'), skipOffstage: false),
      findsNothing,
    );

    // The banners arrive above the shelf and push it below the fold, and only
    // then does the shelf finish reading, out of sight.
    unawaited(
      Future<void>.delayed(
        const Duration(seconds: 1),
        catalog.campaignBannersGate!.complete,
      ),
    );
    unawaited(
      Future<void>.delayed(
        const Duration(seconds: 2),
        catalog.labelListGate!.complete,
      ),
    );
    await openShelfList(tester, const ValueKey('catalog-labels-all'));

    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('labels-results')),
    );
    expect(router.state.uri.path, AppRoutes.labelsPath);
  });
}
