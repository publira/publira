import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
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

  /// The fixture series' last episode, the one that costs something: ¥500,
  /// and ¥300 under the campaigns these tests open on it.
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final viewerPath = AppRoutes.episodeViewerPath(series.id, paidEpisodeId);

  final row = find.byKey(ValueKey('episode-tile-$paidEpisodeId'));
  final rowCampaign = find.byKey(ValueKey('episode-campaign-$paidEpisodeId'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final gateCampaign = find.byKey(const ValueKey('episode-campaign'));

  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeIncomingLinks incoming;

  EpisodeCampaign campaignFor(Duration left) =>
      EpisodeCampaign(price: 300, endsAt: DateTime.now().add(left));

  /// Opens [campaign] on the paid episode, on the series page and on the
  /// episode alike.
  void discount(
    EpisodeCampaign campaign, {
    EpisodePurchaseSurface paidSurface = EpisodePurchaseSurface.all,
    bool rented = false,
  }) {
    catalog
      ..details = fixtureDetails(
        campaign: campaign,
        paidSurface: paidSurface,
        rented: rented,
      )
      ..episodes = fixtureEpisodes(
        access: EpisodeAccess.locked,
        campaign: campaign,
        paidSurface: paidSurface,
        rented: rented,
      );
  }

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository(
      access: {paidEpisodeId: EpisodeAccess.locked},
    );
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester,
    String location, {
    AuthSession? session,
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

  /// [note]'s struck-through regular price and its end.
  void expectNote(Finder note) {
    final regular = find.descendant(of: note, matching: find.text('¥500'));
    expect(regular, findsOneWidget);
    final text = regular.evaluate().single.widget as Text;
    expect(text.style?.decoration, TextDecoration.lineThrough);
    // Strike-through is not announced, so the price is named in words.
    expect(text.semanticsLabel, 'Regular price ¥500');
    expect(
      find.descendant(of: note, matching: find.textContaining('Sale until ')),
      findsOneWidget,
    );
  }

  group('the episode list', () {
    testWidgets('quotes the campaign price beside the regular one', (
      tester,
    ) async {
      // A tenant that sells nothing in the app still prices its episodes.
      purchases.payments = false;
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, rowCampaign);

      expect(find.descendant(of: row, matching: find.text('¥300')), findsOne);
      expectNote(rowCampaign);
    });

    testWidgets('buys the permanent copy at the campaign price', (
      tester,
    ) async {
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, seriesPath, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥300')),
        findsOne,
      );
      expectNote(rowCampaign);
    });

    testWidgets('quotes the regular price where the store sells it', (
      tester,
    ) async {
      // The store sells an episode as the product of its own price.
      purchases.route = AppPurchaseRoute.store;
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, seriesPath, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(rowCampaign, findsNothing);
    });

    testWidgets('names the campaign price beside a rental', (tester) async {
      discount(campaignFor(const Duration(days: 3)), rented: true);
      await pumpApp(tester, seriesPath, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.descendant(
          of: row,
          matching: find.text('Rent for 48 hours (¥200)'),
        ),
      );

      expect(find.descendant(of: row, matching: find.text('¥300')), findsOne);
      expectNote(rowCampaign);
    });

    testWidgets('leaves an episode a free window opens free', (tester) async {
      final campaign = campaignFor(const Duration(days: 3));
      final detail = fixtureDetail(series, campaign: campaign);
      catalog.details[series.id] = SeriesDetail(
        series: detail.series,
        episodes: [
          for (final episode in detail.episodes)
            episode.id == paidEpisodeId
                ? EpisodeItem(
                    id: episode.id,
                    internalId: episode.internalId,
                    title: episode.title,
                    orderIndex: episode.orderIndex,
                    price: episode.price,
                    freeUntil: DateTime.now().add(const Duration(days: 1)),
                    campaign: campaign,
                  )
                : episode,
        ],
      );
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('episode-free-until-$paidEpisodeId')),
      );

      expect(rowCampaign, findsNothing);
      expect(find.text('¥300'), findsNothing);
    });

    testWidgets('names where an episode sold on the website is sold', (
      tester,
    ) async {
      discount(
        campaignFor(const Duration(days: 3)),
        paidSurface: EpisodePurchaseSurface.web,
      );
      await pumpApp(tester, seriesPath, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-sold-on-web')),
      );

      expect(rowCampaign, findsNothing);
      expect(find.text('¥300'), findsNothing);
    });

    testWidgets('prices the row again once the campaign ends', (tester) async {
      purchases.payments = false;
      final campaign = campaignFor(const Duration(seconds: 2));
      discount(campaign);
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(tester, rowCampaign);

      // The rows are drawn against the wall clock, so it has to pass the end
      // too, not only the test's timers.
      await tester.runAsync(
        () => Future<void>.delayed(
          campaign.endsAt.difference(DateTime.now()) +
              const Duration(milliseconds: 50),
        ),
      );
      await tester.pump(const Duration(seconds: 3));

      expect(rowCampaign, findsNothing);
      expect(find.descendant(of: row, matching: find.text('¥500')), findsOne);
    });

    testWidgets('quotes no campaign that has ended', (tester) async {
      purchases.payments = false;
      discount(campaignFor(const Duration(minutes: -1)));
      await pumpApp(tester, seriesPath);
      await pumpUntilFound(
        tester,
        find.descendant(of: row, matching: find.text('¥500')),
      );

      expect(rowCampaign, findsNothing);
    });
  });

  group('a locked episode', () {
    testWidgets('names the campaign price on its purchase', (tester) async {
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, viewerPath, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥300')),
        findsOne,
      );
      expectNote(gateCampaign);
    });

    testWidgets('quotes the campaign to a guest too', (tester) async {
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, viewerPath);
      await pumpUntilFound(tester, buy);

      expect(find.text('Buy for ¥300'), findsOne);
      expectNote(gateCampaign);
    });

    testWidgets('quotes the regular price where the store sells it', (
      tester,
    ) async {
      purchases.route = AppPurchaseRoute.store;
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, viewerPath, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(gateCampaign, findsNothing);
    });

    testWidgets('keeps the rental at its own price', (tester) async {
      discount(campaignFor(const Duration(days: 3)), rented: true);
      final rent = find.byKey(ValueKey('episode-rent-$paidEpisodeId'));
      await pumpApp(tester, viewerPath, session: fakeSession);
      await pumpUntilFound(tester, rent);

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥300')),
        findsOne,
      );
      expect(
        find.descendant(
          of: rent,
          matching: find.text('Rent for 48 hours (¥200)'),
        ),
        findsOne,
      );
    });

    testWidgets('names the regular price once the campaign ends', (
      tester,
    ) async {
      final campaign = campaignFor(const Duration(seconds: 2));
      discount(campaign);
      await pumpApp(tester, viewerPath, session: fakeSession);
      await pumpUntilFound(tester, gateCampaign);

      // The gate is drawn against the wall clock, so it has to pass the end
      // too, not only the test's timers.
      await tester.runAsync(
        () => Future<void>.delayed(
          campaign.endsAt.difference(DateTime.now()) +
              const Duration(milliseconds: 50),
        ),
      );
      await tester.pump(const Duration(seconds: 3));

      expect(gateCampaign, findsNothing);
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
    });

    testWidgets('quotes no campaign where nothing is sold', (tester) async {
      purchases.payments = false;
      discount(campaignFor(const Duration(days: 3)));
      await pumpApp(tester, viewerPath, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-locked')),
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(gateCampaign, findsNothing);
    });
  });

  testWidgets('the end of the episode before quotes the campaign price', (
    tester,
  ) async {
    final previousEpisodeId = '${series.id}-ep-${series.episodeCount - 1}';
    final campaign = campaignFor(const Duration(days: 3));
    catalog.episodes = fixtureEpisodes(campaign: campaign);
    await pumpApp(
      tester,
      AppRoutes.episodeViewerPath(series.id, previousEpisodeId),
      session: fakeSession,
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
    for (var turn = 0; turn < 3; turn++) {
      await tester.tap(find.byKey(const ValueKey('episode-next-page')));
      await pumpUntilNoPendingFrameCallbacks(tester);
    }
    final next = find.byKey(const ValueKey('episode-end-next'));
    await pumpUntilFound(
      tester,
      find.descendant(of: next, matching: find.text('¥300')),
    );

    expectNote(
      find.descendant(
        of: next,
        matching: find.byKey(const ValueKey('episode-end-next-campaign')),
      ),
    );
    await pumpUntilNoPendingFrameCallbacks(tester);
  });
}
