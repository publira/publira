import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final internalId = fixtureInternalId(paidEpisodeId);
  final viewerPath = AppRoutes.episodeViewerPath(series.id, paidEpisodeId);
  final seriesPath = AppRoutes.seriesDetailPath(series.id);
  final sale = PromotionCodeSale.episode(internalId);

  final field = find.byKey(const ValueKey('promotion-code-field'));
  final input = find.byKey(const ValueKey('promotion-code-input'));
  final apply = find.byKey(const ValueKey('promotion-code-apply'));
  final message = find.byKey(const ValueKey('promotion-code-message'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final rent = find.byKey(ValueKey('episode-rent-$paidEpisodeId'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository()..promotionCodes = true;
    launcher = FakeCheckoutLauncher();
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
    router = createAppRouter(initialLocation: initialLocation ?? viewerPath);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        purchases: purchases,
        checkoutLauncher: launcher,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> applyCode(WidgetTester tester, String code) async {
    await pumpUntilFound(tester, input);
    await tester.enterText(input, code);
    await tester.tap(apply);
    await tester.pump();
    await tester.pump();
  }

  String said(WidgetTester tester) =>
      tester.widget<AutospacedText>(message).data!;

  Finder struck(Finder button) => find.descendant(
    of: button,
    matching: find.byWidgetPredicate(
      (widget) =>
          widget is AutospacedText &&
          widget.style?.decoration == TextDecoration.lineThrough,
    ),
  );

  group('on a locked episode', () {
    testWidgets('rewrites the button and starts the checkout with the code', (
      tester,
    ) async {
      purchases.promotionQuotes = {
        sale: const PromotionCodeQuote(listPrice: 500, price: 400),
      };
      await pumpApp(tester);
      await applyCode(tester, ' spring10 ');

      expect(purchases.promotionPreviews.single.code, 'spring10');
      expect(purchases.promotionPreviews.single.store, isFalse);
      expect(said(tester), 'Code spring10 applied.');
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥400')),
        findsOne,
      );
      expect(
        find.descendant(of: struck(buy), matching: find.text('¥500')),
        findsOne,
      );
      expect(
        tester.getSemantics(struck(buy)).label,
        contains('Price before the code ¥500'),
      );

      await tester.tap(buy);
      await tester.pump();
      await tester.pump();

      expect(purchases.checkoutPromotionCodes, ['spring10']);
      expect(
        launcher.opened.single,
        FakePurchaseRepository.checkoutUrlFor(internalId),
      );
    });

    testWidgets('quotes the rental with the permanent copy for one lookup', (
      tester,
    ) async {
      catalog = FakeCatalogRepository(
        series: fixtureSeries,
        details: fixtureDetails(),
        episodes: fixtureEpisodes(access: EpisodeAccess.locked, rented: true),
      );
      final rental = PromotionCodeSale.episode(
        internalId,
        kind: PurchaseKind.rental,
      );
      purchases.promotionQuotes = {
        rental: const PromotionCodeQuote(listPrice: 200, price: 100),
      };
      await pumpApp(tester);
      await applyCode(tester, 'RENT50');

      expect(purchases.promotionPreviews.single.sales, [sale, rental]);
      // The permanent copy is not what the code applies to.
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(struck(buy), findsNothing);
      expect(find.descendant(of: rent, matching: find.text('¥200')), findsOne);

      await tester.tap(buy);
      await tester.pump();
      await tester.pump();

      expect(purchases.checkoutPromotionCodes, ['']);
    });

    testWidgets('holds the purchase while a code is being quoted', (
      tester,
    ) async {
      final gate = Completer<void>();
      purchases
        ..promotionGate = gate
        ..promotionQuotes = {
          sale: const PromotionCodeQuote(listPrice: 500, price: 400),
        };
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');

      expect(tester.widget<FilledButton>(buy).onPressed, isNull);

      gate.complete();
      await tester.pump();
      await tester.pump();

      expect(tester.widget<FilledButton>(buy).onPressed, isNotNull);
    });

    testWidgets('takes the code off when the campaign it priced ends', (
      tester,
    ) async {
      catalog = FakeCatalogRepository(
        series: fixtureSeries,
        details: fixtureDetails(),
        episodes: fixtureEpisodes(
          access: EpisodeAccess.locked,
          campaign: EpisodeCampaign(
            price: 300,
            endsAt: DateTime.now().add(const Duration(hours: 1)),
          ),
        ),
      );
      purchases.promotionQuotes = {
        sale: const PromotionCodeQuote(listPrice: 300, price: 240),
      };
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');

      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥240')),
        findsOne,
      );

      await tester.pump(const Duration(hours: 1, seconds: 1));

      expect(struck(buy), findsNothing);
      expect(message, findsNothing);

      await tester.tap(buy);
      await tester.pump();
      await tester.pump();

      expect(purchases.checkoutPromotionCodes, ['']);
    });

    testWidgets('takes the code off when the field is emptied', (tester) async {
      purchases.promotionQuotes = {
        sale: const PromotionCodeQuote(listPrice: 500, price: 400),
      };
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');
      await applyCode(tester, '');

      expect(message, findsNothing);
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(purchases.promotionPreviews, hasLength(1));
    });

    testWidgets('refuses a code no tenant could hold without asking', (
      tester,
    ) async {
      await pumpApp(tester);
      await applyCode(tester, 'NOT A CODE');

      expect(said(tester), "This code isn't valid.");
      expect(purchases.promotionPreviews, isEmpty);
    });

    for (final (kind, text) in [
      (PurchaseFailureKind.promotionCodeInvalid, "This code isn't valid."),
      (PurchaseFailureKind.promotionCodeExpired, 'This code has expired.'),
      (
        PurchaseFailureKind.promotionCodeExhausted,
        'This code has been used up.',
      ),
      (
        PurchaseFailureKind.promotionCodeAlreadyRedeemed,
        'You have already used this code.',
      ),
      (
        PurchaseFailureKind.promotionCodeRateLimited,
        'Too many codes entered. Wait a moment and try again.',
      ),
      (
        PurchaseFailureKind.network,
        'The code could not be checked. Try again.',
      ),
    ]) {
      testWidgets('says why when the code is ${kind.name}', (tester) async {
        purchases.promotionFailure = PurchaseFailure(kind);
        await pumpApp(tester);
        await applyCode(tester, 'SPRING10');

        expect(said(tester), text);
        expect(
          find.descendant(of: buy, matching: find.text('Buy for ¥500')),
          findsOne,
        );

        await tester.tap(buy);
        await tester.pump();
        await tester.pump();

        expect(purchases.checkoutPromotionCodes, ['']);
      });
    }

    testWidgets('says a code does not apply when no sale takes it', (
      tester,
    ) async {
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');

      expect(said(tester), "This code can't be used on this episode.");
    });

    testWidgets('sends a session that expired to sign in', (tester) async {
      purchases.promotionFailure = const PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
      );
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');

      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );
    });

    testWidgets('puts the button back when the checkout refuses the code', (
      tester,
    ) async {
      purchases
        ..promotionQuotes = {
          sale: const PromotionCodeQuote(listPrice: 500, price: 400),
        }
        ..checkoutFailure = const PurchaseFailure(
          PurchaseFailureKind.promotionCodeExhausted,
        );
      await pumpApp(tester);
      await applyCode(tester, 'SPRING10');

      await tester.tap(buy);
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(said(tester), 'This code has been used up.');
      expect(
        find.descendant(of: buy, matching: find.text('Buy for ¥500')),
        findsOne,
      );
      expect(struck(buy), findsNothing);
      expect(launcher.opened, isEmpty);
    });

    testWidgets('is not offered to a guest', (tester) async {
      await pumpApp(tester, session: null);
      await pumpUntilFound(tester, buy);

      expect(field, findsNothing);
    });

    testWidgets('is not offered by a tenant that holds no code', (
      tester,
    ) async {
      purchases.promotionCodes = false;
      await pumpApp(tester);
      await pumpUntilFound(tester, buy);

      expect(field, findsNothing);
    });
  });

  group('above the volumes', () {
    final volumeOne = VolumeItem(
      id: 'volume-1',
      publicId: 'VOLUME000001',
      title: 'Volume 1',
      orderIndex: 1,
      price: 350,
      episodeIds: [fixtureInternalId('${series.id}-ep-1')],
    );
    final volumeTwo = VolumeItem(
      id: 'volume-2',
      publicId: 'VOLUME000002',
      title: 'Volume 2',
      orderIndex: 2,
      price: 400,
      episodeIds: [fixtureInternalId('${series.id}-ep-2')],
    );
    const saleOne = PromotionCodeSale.volume('volume-1');
    const saleTwo = PromotionCodeSale.volume('volume-2');
    final buyOne = find.byKey(ValueKey('volume-buy-${volumeOne.publicId}'));
    final buyTwo = find.byKey(ValueKey('volume-buy-${volumeTwo.publicId}'));

    setUp(() {
      final details = fixtureDetails();
      final detail = details[series.id]!;
      details[series.id] = SeriesDetail(
        series: detail.series,
        episodes: detail.episodes,
        volumes: [volumeOne, volumeTwo],
      );
      catalog = FakeCatalogRepository(series: fixtureSeries, details: details);
      purchases.remainder = const SeriesRemainderOffer(
        episodeCount: 4,
        listPrice: 900,
        discountPercent: 10,
        price: 810,
      );
    });

    testWidgets('rewrites the volumes the code applies to alone', (
      tester,
    ) async {
      purchases.promotionQuotes = {
        saleOne: const PromotionCodeQuote(listPrice: 350, price: 175),
      };
      await pumpApp(tester, initialLocation: seriesPath);
      await applyCode(tester, 'SPRING10');

      expect(purchases.promotionPreviews.single.sales, [saleOne, saleTwo]);
      expect(
        find.descendant(of: buyOne, matching: find.text('Buy for ¥175')),
        findsOne,
      );
      expect(
        find.descendant(of: struck(buyOne), matching: find.text('¥350')),
        findsOne,
      );
      expect(
        find.descendant(of: buyTwo, matching: find.text('Buy volume')),
        findsOne,
      );

      await tester.tap(buyOne);
      await tester.pump();
      await tester.pump();
      await tester.tap(buyTwo);
      await tester.pump();
      await tester.pump();

      expect(purchases.volumeCheckouts, ['volume-1', 'volume-2']);
      expect(purchases.volumePromotionCodes, ['SPRING10', '']);
    });

    testWidgets('holds the volumes while a code is being quoted', (
      tester,
    ) async {
      final gate = Completer<void>();
      purchases
        ..promotionGate = gate
        ..promotionQuotes = {
          saleOne: const PromotionCodeQuote(listPrice: 350, price: 175),
        };
      await pumpApp(tester, initialLocation: seriesPath);
      await applyCode(tester, 'SPRING10');

      await tester.tap(buyOne, warnIfMissed: false);
      await tester.pump();
      await tester.pump();

      expect(purchases.volumeCheckouts, isEmpty);

      gate.complete();
      await tester.pump();
      await tester.pump();
      await tester.tap(buyOne);
      await tester.pump();
      await tester.pump();

      expect(purchases.volumePromotionCodes, ['SPRING10']);
    });

    testWidgets('quotes only the volumes the reader can still buy', (
      tester,
    ) async {
      purchases.owned = volumeOne.episodeIds.toSet();
      await pumpApp(tester, initialLocation: seriesPath);
      await applyCode(tester, 'SPRING10');

      expect(purchases.promotionPreviews.single.sales, [saleTwo]);
      expect(said(tester), "This code can't be used on these volumes.");
    });

    testWidgets('puts the buttons back when a checkout refuses the code', (
      tester,
    ) async {
      purchases
        ..promotionQuotes = {
          saleOne: const PromotionCodeQuote(listPrice: 350, price: 175),
        }
        ..bundleCheckoutFailure = const PurchaseFailure(
          PurchaseFailureKind.promotionCodeExpired,
        );
      await pumpApp(tester, initialLocation: seriesPath);
      await applyCode(tester, 'SPRING10');

      await tester.tap(buyOne);
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(said(tester), 'This code has expired.');
      expect(
        find.descendant(of: buyOne, matching: find.text('Buy volume')),
        findsOne,
      );
    });

    testWidgets('the rest of the series takes no code', (tester) async {
      purchases.promotionQuotes = {
        saleOne: const PromotionCodeQuote(listPrice: 350, price: 175),
      };
      await pumpApp(tester, initialLocation: seriesPath);
      await applyCode(tester, 'SPRING10');

      final remainder = find.byKey(const ValueKey('series-remainder-buy'));
      expect(struck(remainder), findsNothing);
    });

    testWidgets('is left out where the store sells the series', (tester) async {
      purchases.route = AppPurchaseRoute.store;
      await pumpApp(tester, initialLocation: seriesPath);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('volume-sold-on-web-${volumeOne.publicId}')),
      );

      expect(field, findsNothing);
    });

    testWidgets('is left out once every volume is the reader\'s', (
      tester,
    ) async {
      purchases.owned = {...volumeOne.episodeIds, ...volumeTwo.episodeIds};
      await pumpApp(tester, initialLocation: seriesPath);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('volume-owned-${volumeOne.publicId}')),
      );

      expect(field, findsNothing);
    });

    testWidgets('is not offered to a guest', (tester) async {
      await pumpApp(tester, initialLocation: seriesPath, session: null);
      await pumpUntilFound(tester, buyOne);

      expect(field, findsNothing);
    });
  });
}
