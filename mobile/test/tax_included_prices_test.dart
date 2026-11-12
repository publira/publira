import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/models/tenant_invoice.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final seriesPath = AppRoutes.seriesDetailPath(series.id);

  /// The fixture series' last episode, the one that costs something: ¥500.
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final viewerPath = AppRoutes.episodeViewerPath(series.id, paidEpisodeId);

  final volume = VolumeItem(
    id: 'volume-1',
    publicId: 'VOLUME000001',
    title: 'Volume 1',
    orderIndex: 1,
    price: 350,
    episodeIds: [
      fixtureInternalId('${series.id}-ep-1'),
      fixtureInternalId('${series.id}-ep-2'),
    ],
  );

  final row = find.byKey(ValueKey('episode-tile-$paidEpisodeId'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final rent = find.byKey(ValueKey('episode-rent-$paidEpisodeId'));
  final volumeCard = find.byKey(ValueKey('series-volume-${volume.publicId}'));
  final buyRemainder = find.byKey(const ValueKey('series-remainder-buy'));

  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeIncomingLinks incoming;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository(
      access: {paidEpisodeId: EpisodeAccess.locked},
    )..tenantInvoice = const TenantInvoice(taxRateBps: 1000);
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester,
    String location, {
    AuthSession? session = fakeSession,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: location),
        catalog: catalog,
        auth: fakeAuthController(session: session),
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
        purchases: purchases,
        checkoutLauncher: FakeCheckoutLauncher(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('the series page', () {
    testWidgets('an episode the reader can buy says so on its button', (
      tester,
    ) async {
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500 incl. tax')),
        findsOne,
      );
    });

    testWidgets('a price quoted in the row says so', (tester) async {
      // A tenant that sells nothing in the app still prices its episodes.
      purchases.payments = false;
      await pumpApp(tester, seriesPath);

      await pumpUntilFound(
        tester,
        find.descendant(of: row, matching: find.text('¥500 incl. tax')),
      );
    });

    testWidgets('a rental says so', (tester) async {
      catalog
        ..details = fixtureDetails(rented: true)
        ..episodes = fixtureEpisodes(
          access: EpisodeAccess.locked,
          rented: true,
        );
      await pumpApp(tester, seriesPath);

      await pumpUntilFound(
        tester,
        find.descendant(
          of: row,
          matching: find.text('Rent for 48 hours (¥200 incl. tax)'),
        ),
      );
    });

    testWidgets('a campaign says so on the price that is charged', (
      tester,
    ) async {
      final campaign = EpisodeCampaign(
        price: 300,
        endsAt: DateTime.now().add(const Duration(days: 3)),
      );
      catalog
        ..details = fixtureDetails(campaign: campaign)
        ..episodes = fixtureEpisodes(
          access: EpisodeAccess.locked,
          campaign: campaign,
        );
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥300 incl. tax')),
        findsOne,
      );
    });

    testWidgets('a volume and the rest of the series say so', (tester) async {
      final details = fixtureDetails();
      final detail = details[series.id]!;
      details[series.id] = SeriesDetail(
        series: detail.series,
        episodes: detail.episodes,
        volumes: [volume],
      );
      catalog.details = details;
      purchases.remainder = const SeriesRemainderOffer(
        episodeCount: 4,
        listPrice: 900,
        discountPercent: 10,
        price: 810,
      );
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, buyRemainder);

      expect(
        find.descendant(
          of: volumeCard,
          matching: find.text('2 episodes · ¥350 incl. tax'),
        ),
        findsOne,
      );
      expect(
        find.descendant(
          of: buyRemainder,
          matching: find.text('Buy remaining episodes (4) for ¥810 incl. tax'),
        ),
        findsOne,
      );
    });

    testWidgets('the longer button still fits the row of a small phone', (
      tester,
    ) async {
      await pumpApp(tester, seriesPath);
      tester.view.physicalSize = const Size(320, 2400);
      await tester.pump();
      await pumpUntilFound(tester, buy);

      expect(tester.takeException(), isNull);
      expect(tester.getSize(buy).width, lessThan(320));
    });

    testWidgets('a tenant that states no rate says nothing', (tester) async {
      purchases.tenantInvoice = TenantInvoice.none;
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
    });

    testWidgets('a tenant that cannot be read still offers the purchase', (
      tester,
    ) async {
      purchases.invoiceFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
    });
  });

  group('a locked episode', () {
    testWidgets('says so on what it offers', (tester) async {
      catalog
        ..details = fixtureDetails(rented: true)
        ..episodes = fixtureEpisodes(
          access: EpisodeAccess.locked,
          rented: true,
        );
      await pumpApp(tester, viewerPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500 incl. tax')),
        findsOne,
      );
      expect(
        find.descendant(
          of: rent,
          matching: find.text('Rent for 48 hours (¥200 incl. tax)'),
        ),
        findsOne,
      );
    });

    testWidgets('says so where the store sells it', (tester) async {
      purchases.route = AppPurchaseRoute.store;
      await pumpApp(tester, viewerPath);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500 incl. tax')),
        findsOne,
      );
    });
  });

  testWidgets('the end of the episode before says so on the next price', (
    tester,
  ) async {
    catalog.episodes = fixtureEpisodes();
    final previousEpisodeId = '${series.id}-ep-${series.episodeCount - 1}';
    await pumpApp(
      tester,
      AppRoutes.episodeViewerPath(series.id, previousEpisodeId),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
    for (var turn = 0; turn < 3; turn++) {
      await tester.tap(find.byKey(const ValueKey('episode-next-page')));
      await pumpUntilNoPendingFrameCallbacks(tester);
    }

    await pumpUntilFound(
      tester,
      find.descendant(
        of: find.byKey(const ValueKey('episode-end-next')),
        matching: find.text('¥500 incl. tax'),
      ),
    );
    await pumpUntilNoPendingFrameCallbacks(tester);
  });
}
