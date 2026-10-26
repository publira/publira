import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_coins.dart';
import 'support/fake_in_app_purchase.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;

  /// The fixture series' last episode, the one that costs ¥500, or 50 coins.
  final paidEpisodeId = '$seriesId-ep-${fixtureSeries.first.episodeCount}';
  final paidInternalId = fixtureInternalId(paidEpisodeId);
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, paidEpisodeId);

  const smallPack = '0190a0a0-0000-7000-8000-000000000001';
  const largePack = '0190a0a0-0000-7000-8000-000000000002';
  final smallProduct = coinPackProductId(smallPack);
  final largeProduct = coinPackProductId(largePack);

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final coinSection = find.byKey(const ValueKey('episode-coins'));
  final pay = find.byKey(const ValueKey('episode-coins-pay'));
  final packButton = find.byKey(const ValueKey('episode-coins-pack'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final accountCoins = find.byKey(const ValueKey('account-coins'));

  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCoinRepository coins;
  late FakeInAppPurchasePlatform platform;
  late StorePurchaser purchaser;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(coinName: 'Points'),
      episodes: fixtureEpisodes(
        access: EpisodeAccess.locked,
        coinName: 'Points',
      ),
    );
    coins = FakeCoinRepository()
      ..onPaid = (_) {
        catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      };
    purchases = FakePurchaseRepository(route: AppPurchaseRoute.store)
      ..onCoinPackConfirmed = (productId) {
        coins.grant(productId == smallProduct ? 100 : 550);
      };
    platform = FakeInAppPurchasePlatform(
      products: {'episode_500', smallProduct, largeProduct},
    )..prices = {smallProduct: 1000, largeProduct: 5000};
    addTearDown(platform.close);
    purchaser = StorePurchaser(
      platform: platform,
      store: InAppPurchaseStore.appStore,
      repository: purchases,
    );
    addTearDown(purchaser.dispose);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String? initialLocation,
    AuthSession? session = fakeSession,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final router = createAppRouter(
      initialLocation: initialLocation ?? viewerPath,
    );
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        purchases: purchases,
        checkoutLauncher: FakeCheckoutLauncher(),
        storePurchaser: purchaser,
        coins: coins,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Every string on screen, so a test can say none of them names the coins
  /// in a word of the app's own.
  Iterable<String> textsOnScreen(WidgetTester tester) => tester
      .widgetList<Text>(find.byType(Text))
      .map((text) => text.data ?? text.textSpan?.toPlainText() ?? '');

  group('the gate of an episode priced in the tenant\'s coins', () {
    testWidgets('opens the episode with the coins a reader holds', (
      tester,
    ) async {
      coins.coins = 120;
      await pumpApp(tester);
      await pumpUntilFound(tester, pay);

      expect(find.text('You have 120 Points.'), findsOne);
      expect(find.text('Pay 50 Points'), findsOne);
      // The coins lead, and the store's purchase stands beside them.
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(tester.widget(buy), isA<OutlinedButton>());

      await tester.tap(pay);
      await pumpUntilFound(tester, pages);

      final payment = coins.payments.single;
      expect(payment.episodeId, paidInternalId);
      expect(payment.coins, 50);
      expect(payment.kind, PurchaseKind.purchase);
      expect(payment.key, hasLength(32));
      expect(coins.coins, 70);
      expect(platform.bought, isEmpty);
    });

    testWidgets('sells the smallest pack that covers the price, then pays', (
      tester,
    ) async {
      coins.coins = 10;
      await pumpApp(tester);
      await pumpUntilFound(tester, packButton);

      expect(
        find.text(
          'This episode costs 50 Points, and you have 10. '
          'Buy at least 40 more to pay with them.',
        ),
        findsOne,
      );
      expect(find.text('Buy 100 Points for ¥1000'), findsOne);
      expect(
        find.text('These Points can be spent for 180 days after purchase.'),
        findsOne,
      );
      expect(find.byKey(const ValueKey('coin-disclosures')), findsOne);
      expect(find.text('Issuer: Example Publishing'), findsOne);
      expect(pay, findsNothing);

      await tester.tap(packButton);
      await pumpUntilFound(tester, pay);

      expect(purchases.coinPackIntents, [smallPack]);
      final param = platform.bought.single;
      expect(param.productDetails.id, smallProduct);
      expect(
        param.applicationUserName,
        FakePurchaseRepository.intentFor(smallPack),
      );
      expect(platform.finished, hasLength(1));
      expect(find.text('Your Points have been added.'), findsOne);
      expect(find.text('You have 110 Points.'), findsOne);

      await tester.tap(pay);
      await pumpUntilFound(tester, pages);
      expect(coins.payments.single.coins, 50);
    });

    testWidgets('offers no pack the store does not sell', (tester) async {
      platform.products = {'episode_500'};
      await pumpApp(tester);
      await pumpUntilFound(tester, buy);

      expect(coinSection, findsNothing);
      expect(packButton, findsNothing);
    });

    testWidgets('pays no coins while the store purchase is starting', (
      tester,
    ) async {
      final gate = Completer<void>();
      coins.coins = 120;
      purchases
        ..storeStartGate = gate
        ..onConfirmed = () {
          catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
        };
      await pumpApp(tester);
      await pumpUntilFound(tester, pay);

      await tester.tap(buy);
      await tester.pump();
      expect(tester.widget<FilledButton>(pay).onPressed, isNull);
      await tester.tap(pay, warnIfMissed: false);
      await tester.pump();
      gate.complete();
      await pumpUntilFound(tester, pages);

      expect(coins.attempts, isEmpty);
      expect(platform.bought, hasLength(1));
    });

    testWidgets('opens no store purchase while coins are being paid', (
      tester,
    ) async {
      final gate = Completer<void>();
      coins
        ..coins = 120
        ..payGate = gate;
      await pumpApp(tester);
      await pumpUntilFound(tester, pay);

      await tester.tap(pay);
      await tester.pump();
      expect(tester.widget<OutlinedButton>(buy).onPressed, isNull);
      await tester.tap(buy, warnIfMissed: false);
      await tester.pump();
      gate.complete();
      await pumpUntilFound(tester, pages);

      expect(coins.payments, hasLength(1));
      expect(purchases.storeIntents, isEmpty);
      expect(platform.bought, isEmpty);
    });

    testWidgets('keeps a key for each sale across retries', (tester) async {
      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.locked,
        coinName: 'Points',
        rented: true,
      );
      coins
        ..coins = 120
        // The rental's answer is lost on its way back, twice.
        ..payFailure = const CoinFailure(CoinFailureKind.network);
      final rent = find.byKey(const ValueKey('episode-coins-rent'));
      await pumpApp(tester);
      await pumpUntilFound(tester, rent);

      await tester.tap(rent);
      await tester.pump();
      await tester.tap(rent);
      await tester.pump();
      coins.payFailure = null;
      await tester.tap(pay);
      await pumpUntilFound(tester, pages);

      final [first, retry, purchase] = coins.attempts;
      expect(first.kind, PurchaseKind.rental);
      expect(retry, first);
      expect(purchase.kind, PurchaseKind.purchase);
      expect(purchase.key, isNot(first.key));
    });

    testWidgets('reads the price again when it changed', (tester) async {
      coins
        ..coins = 120
        ..payFailure = const CoinFailure(CoinFailureKind.priceChanged);
      await pumpApp(tester);
      await pumpUntilFound(tester, pay);

      await tester.tap(pay);
      await pumpUntilFound(
        tester,
        find.text(
          'The price of this episode in Points has changed. '
          'Check the new price and try again.',
        ),
      );
      await pumpUntilFound(tester, pay);
      expect(locked, findsOne);
      expect(coins.coins, 120);
    });

    testWidgets('names the coins in the reader\'s language', (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ja')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      coins
        ..coinName = 'ポイント'
        ..coins = 10;
      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.locked,
        coinName: 'ポイント',
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, packButton);

      expect(
        find.text('このエピソードは50ポイントで、保有は10です。40ポイント以上購入すると支払えます。'),
        findsOne,
      );
      expect(find.text('100ポイントを¥1000で購入'), findsOne);
      expect(coins.locales, everyElement('ja'));
    });

    testWidgets('is the gate it was for a guest', (tester) async {
      coins.coins = 120;
      await pumpApp(tester, session: null);
      await pumpUntilFound(tester, locked);

      expect(coinSection, findsNothing);
      expect(coins.locales, isEmpty);
    });

    testWidgets('is the gate it was on the web checkout route', (tester) async {
      purchases.route = AppPurchaseRoute.externalCheckout;
      coins.coins = 120;
      await pumpApp(tester);
      await pumpUntilFound(tester, buy);

      expect(coinSection, findsNothing);
      expect(tester.widget(buy), isA<FilledButton>());
      expect(coins.locales, isEmpty);
    });

    testWidgets('is the gate it was while the tenant has coins off', (
      tester,
    ) async {
      coins.failure = const CoinFailure(CoinFailureKind.unavailable);
      await pumpApp(tester);
      await pumpUntilFound(tester, buy);

      expect(coinSection, findsNothing);
      expect(tester.widget(buy), isA<FilledButton>());
    });
  });

  group('the coins screen', () {
    testWidgets('is reached from the account under the tenant\'s word', (
      tester,
    ) async {
      coins.coins = 120;
      await pumpApp(tester, initialLocation: AppRoutes.account);
      await pumpUntilFound(tester, accountCoins);

      expect(
        find.descendant(of: accountCoins, matching: find.text('Points')),
        findsOne,
      );
      expect(
        find.descendant(of: accountCoins, matching: find.text('120 Points')),
        findsOne,
      );

      await tester.tap(accountCoins);
      await pumpUntilFound(tester, find.byKey(const ValueKey('coins-balance')));
      expect(find.widgetWithText(AppBar, 'Points'), findsOne);
    });

    testWidgets('shows the balance, the packs at the store\'s price, and the '
        'history', (tester) async {
      coins
        ..coins = 120
        ..owedCoins = 5
        ..history = [
          CoinTransaction(
            id: 'spend-1',
            kind: CoinTransactionKind.spend,
            coins: 50,
            createdAt: DateTime(2026, 10, 25, 9),
            seriesId: seriesId,
            episodeId: paidEpisodeId,
            episodeTitle: 'Fixture #3',
          ),
          CoinTransaction(
            id: 'grant-1',
            kind: CoinTransactionKind.grant,
            coins: 170,
            createdAt: DateTime(2026, 10, 24, 9),
            expiresAt: DateTime(2027, 4, 22, 9),
          ),
        ];
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      await pumpUntilFound(tester, find.byKey(const ValueKey('coins-balance')));

      expect(find.widgetWithText(AppBar, 'Points'), findsOne);
      expect(find.text('120 Points'), findsOne);
      expect(find.byKey(const ValueKey('coins-nearest-expiry')), findsOne);
      expect(
        find.text(
          '5 Points of a refunded pack had already been spent. '
          'They are taken out of the next pack you buy.',
        ),
        findsOne,
      );
      expect(find.text('100 Points'), findsOne);
      expect(find.text('550 Points (including 50 bonus)'), findsOne);
      expect(find.text('Buy for ¥1000'), findsOne);
      expect(find.text('Buy for ¥5000'), findsOne);
      expect(find.text('Issuer: Example Publishing'), findsOne);
      expect(find.text('Contact: support@example.com'), findsOne);
      expect(find.text('Unused Points are not refunded.'), findsOne);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('coins-transaction-grant-1')),
        200,
      );
      expect(find.text('Spent on an episode'), findsOne);
      expect(find.text('Fixture #3'), findsOne);
      expect(find.text('−50 Points'), findsOne);
      expect(find.text('Added'), findsOne);
      expect(find.text('+170 Points'), findsOne);
      for (final text in textsOnScreen(tester)) {
        expect(text.toLowerCase(), isNot(contains('coin')));
      }
    });

    testWidgets('adds the coins of a pack once the server has it', (
      tester,
    ) async {
      coins.coins = 0;
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      final buyLarge = find.byKey(const ValueKey('coins-pack-buy-$largePack'));
      await pumpUntilFound(tester, buyLarge);
      expect(find.text('0 Points'), findsOne);

      await tester.tap(buyLarge);
      await pumpUntilFound(tester, find.text('550 Points'));

      expect(purchases.coinPackIntents, [largePack]);
      expect(platform.bought.single.productDetails.id, largeProduct);
      expect(purchases.confirmed, hasLength(1));
    });

    testWidgets('says the packs are not on sale while the tenant stopped', (
      tester,
    ) async {
      coins
        ..coins = 30
        ..selling = false;
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('coins-packs-unavailable')),
      );

      expect(
        find.text(
          'Points are not on sale at the moment. '
          'You can keep spending the ones you hold.',
        ),
        findsOne,
      );
      expect(platform.productQueries, 0);
    });

    testWidgets('reads the rest of the history as it scrolls into view', (
      tester,
    ) async {
      coins
        ..pageSize = 2
        ..history = [
          for (var i = 0; i < 5; i++)
            CoinTransaction(
              id: 'grant-$i',
              kind: CoinTransactionKind.grant,
              coins: 10,
              createdAt: DateTime(2026, 10, 20 - i),
            ),
        ];
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      final last = find.byKey(const ValueKey('coins-transaction-grant-4'));
      await pumpUntilFound(tester, find.byKey(const ValueKey('coins-list')));

      await tester.scrollUntilVisible(last, 200);
      expect(last, findsOne);
    });

    testWidgets('reads on after a refresh that overtook a page in flight', (
      tester,
    ) async {
      final gate = Completer<void>();
      coins
        ..pageSize = 2
        ..moreGate = gate
        ..history = [
          for (var i = 0; i < 5; i++)
            CoinTransaction(
              id: 'grant-$i',
              kind: CoinTransactionKind.grant,
              coins: 10,
              createdAt: DateTime(2026, 10, 20 - i),
            ),
        ];
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      final list = find.byKey(const ValueKey('coins-list'));
      await pumpUntilFound(tester, list);
      // The page under the first is asked for and held.
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('coins-transaction-grant-1')),
        200,
      );
      await tester.pump();

      await tester.fling(list, const Offset(0, 1000), 1000);
      // The indicator's spinner never settles, so the refresh is pumped
      // through by time.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 500));
      }
      await pumpUntilFound(tester, list);
      gate.complete();

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('coins-transaction-grant-4')),
        200,
      );
    });

    testWidgets('is not found on the web checkout route', (tester) async {
      purchases.route = AppPurchaseRoute.externalCheckout;
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('coins-unavailable')),
      );
      expect(coins.locales, isEmpty);
    });

    testWidgets('is not found while the tenant has coins off', (tester) async {
      coins.failure = const CoinFailure(CoinFailureKind.unavailable);
      await pumpApp(tester, initialLocation: AppRoutes.coinsPath);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('coins-unavailable')),
      );
    });
  });

  group('the account', () {
    testWidgets('leads nowhere about coins on the web checkout route', (
      tester,
    ) async {
      purchases.route = AppPurchaseRoute.externalCheckout;
      await pumpApp(tester, initialLocation: AppRoutes.account);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('account-purchases')),
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(accountCoins, findsNothing);
    });

    testWidgets('leads nowhere about coins while the tenant has them off', (
      tester,
    ) async {
      coins.failure = const CoinFailure(CoinFailureKind.unavailable);
      await pumpApp(tester, initialLocation: AppRoutes.account);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('account-purchases')),
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(accountCoins, findsNothing);
    });
  });
}
