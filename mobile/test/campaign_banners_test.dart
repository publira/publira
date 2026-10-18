import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/campaign_banner.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/fake_offline_library.dart';
import 'support/pump_until.dart';

/// A banner linking to [linkUrl], with a landscape image unless [variants]
/// says otherwise.
CampaignBanner _banner(
  String id, {
  required String linkUrl,
  List<EyeCatchVariant>? variants,
}) => CampaignBanner(
  id: id,
  linkUrl: linkUrl,
  imageVariants:
      variants ??
      [
        EyeCatchVariant(
          variantType: 'landscape',
          url: Uri.parse(
            'http://images.test/images/campaign-banners/$id/landscape/800',
          ),
          width: 800,
          height: 450,
        ),
      ],
);

Finder _bannerOf(String id) => find.byKey(ValueKey('campaign-banner-$id'));

const _band = ValueKey('campaign-banners');

void main() {
  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeExternalBrowser browser;

  final series = fixtureSeries.first;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      newestSeries: fixtureSeries,
      details: fixtureDetails(),
    );
    browser = FakeExternalBrowser();
  });

  tearDown(() => imageCache.clear());

  Future<void> pumpLoadedApp(
    WidgetTester tester, {
    Size size = const Size(800, 2400),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        offline: InMemoryOfflineLibrary(),
        site: const PublicSite(host: 'shop.example'),
        browser: browser,
      ),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('series-tile-${series.id}')),
    );
  }

  testWidgets(
    'a scheduled banner stands above the shelves and opens its link',
    (tester) async {
      catalog.campaignBanners = [
        _banner('banner-1', linkUrl: '/en/series/${series.id}'),
      ];
      await pumpLoadedApp(tester);

      expect(find.byKey(_band), findsOneWidget);
      expect(find.bySemanticsLabel('Campaign banner'), findsOneWidget);
      expect(
        tester.getBottomLeft(find.byKey(_band)).dy,
        lessThanOrEqualTo(
          tester
              .getTopLeft(find.byKey(const ValueKey('catalog-new-arrivals')))
              .dy,
        ),
      );
      // The landscape cut is the one the console crops for the band.
      final image = tester.widget<Image>(
        find.byKey(const ValueKey('campaign-banner-cover-banner-1')),
      );
      final provider =
          (image.image as ResizeImage).imageProvider as NetworkImage;
      expect(
        provider.url,
        'http://images.test/images/campaign-banners/banner-1/landscape/800',
      );

      await tester.tap(_bannerOf('banner-1'));
      await pumpUntilFound(tester, find.text('Episodes'));

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(series.id));
      expect(browser.opened, isEmpty);
    },
  );

  testWidgets('a banner linking to another site hands it to the browser', (
    tester,
  ) async {
    catalog.campaignBanners = [
      _banner('banner-1', linkUrl: 'https://elsewhere.example/sale'),
    ];
    await pumpLoadedApp(tester);

    await tester.tap(_bannerOf('banner-1'));
    await tester.pump();

    expect(browser.opened, [Uri.parse('https://elsewhere.example/sale')]);
  });

  testWidgets('several banners are swiped through in the operator\'s order', (
    tester,
  ) async {
    catalog.campaignBanners = [
      _banner('banner-2', linkUrl: '/series'),
      _banner('banner-1', linkUrl: '/labels'),
      _banner('banner-3', linkUrl: '/genres'),
    ];
    await pumpLoadedApp(tester, size: const Size(400, 900));

    final screenCenter = tester.getCenter(find.byType(PageView)).dx;
    expect(tester.getCenter(_bannerOf('banner-2')).dx, screenCenter);
    // The next banner's edge shows, which is what says the band scrolls.
    expect(
      tester.getTopLeft(_bannerOf('banner-1')).dx,
      lessThan(tester.view.physicalSize.width),
    );

    // Each page is announced by its place in the band, since the banners
    // carry no text of their own to tell them apart.
    expect(find.bySemanticsLabel('Campaign banner 1 of 3'), findsOneWidget);
    expect(find.bySemanticsLabel('Campaign banner 2 of 3'), findsOneWidget);

    await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
    await tester.pumpAndSettle();
    expect(tester.getCenter(_bannerOf('banner-1')).dx, screenCenter);

    await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
    await tester.pumpAndSettle();
    expect(tester.getCenter(_bannerOf('banner-3')).dx, screenCenter);
  });

  testWidgets('a banner the app cannot follow or draw is left out', (
    tester,
  ) async {
    catalog.campaignBanners = [
      _banner('foreign', linkUrl: '//evil.example/sale'),
      _banner('blank', linkUrl: '/series', variants: const []),
      _banner('shown', linkUrl: '/series'),
    ];
    await pumpLoadedApp(tester);

    expect(_bannerOf('shown'), findsOneWidget);
    expect(_bannerOf('foreign'), findsNothing);
    expect(_bannerOf('blank'), findsNothing);
    // What is left is one banner, drawn as one band rather than a strip.
    expect(find.byType(PageView), findsNothing);
  });

  testWidgets('a tenant with nothing scheduled is shown no band', (
    tester,
  ) async {
    await pumpLoadedApp(tester);

    expect(catalog.campaignBannersReads, 1);
    expect(find.byKey(_band), findsNothing);
    expect(find.bySemanticsLabel('Campaign banner'), findsNothing);
  });

  testWidgets('a read the API could not answer leaves the catalog as it is', (
    tester,
  ) async {
    catalog.campaignBannersError = const CatalogFailure(
      CatalogFailureKind.network,
    );
    await pumpLoadedApp(tester);

    expect(catalog.campaignBannersReads, 1);
    expect(find.byKey(_band), findsNothing);
    expect(find.byKey(const ValueKey('catalog-new-arrivals')), findsOneWidget);
  });

  testWidgets('pulling to refresh reads the banners again', (tester) async {
    await pumpLoadedApp(tester);
    expect(find.byKey(_band), findsNothing);

    catalog.campaignBanners = [_banner('banner-1', linkUrl: '/series')];
    await tester.fling(
      find.byType(CustomScrollView),
      const Offset(0, 800),
      1000,
    );
    await pumpUntilFound(tester, _bannerOf('banner-1'));

    expect(catalog.campaignBannersReads, 2);
  });
}
