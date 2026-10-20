import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/series_item.dart';
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

  /// The fixture series' first two episodes, sold together.
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

  const remainder = SeriesRemainderOffer(
    episodeCount: 4,
    listPrice: 900,
    discountPercent: 10,
    price: 810,
  );

  final card = find.byKey(ValueKey('series-volume-${volume.publicId}'));
  final buyVolume = find.byKey(ValueKey('volume-buy-${volume.publicId}'));
  final owned = find.byKey(ValueKey('volume-owned-${volume.publicId}'));
  final buyRemainder = find.byKey(const ValueKey('series-remainder-buy'));
  final confirming = find.byKey(const ValueKey('series-checkout-confirming'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;
  late FakeIncomingLinks incoming;

  setUp(() {
    final details = fixtureDetails();
    final detail = details[series.id]!;
    details[series.id] = SeriesDetail(
      series: detail.series,
      episodes: detail.episodes,
      volumes: [volume],
    );
    catalog = FakeCatalogRepository(series: fixtureSeries, details: details);
    purchases = FakePurchaseRepository()..remainder = remainder;
    launcher = FakeCheckoutLauncher();
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String? initialLocation,
    AuthSession? session = fakeSession,
    // Tall enough that the volumes and the episodes are on screen at once.
    Size size = const Size(400, 2400),
  }) async {
    tester.view
      ..physicalSize = size
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation ?? seriesPath);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        purchases: purchases,
        checkoutLauncher: launcher,
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('a volume', () {
    testWidgets('says what it holds and costs', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      expect(find.text('Volumes'), findsOneWidget);
      expect(
        find.descendant(of: card, matching: find.text('Volume 1')),
        findsOne,
      );
      expect(
        find.descendant(of: card, matching: find.text('2 episodes · ¥350')),
        findsOne,
      );
    });

    testWidgets('hands its checkout to the browser', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      await tester.tap(buyVolume);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(purchases.volumeCheckouts, [volume.id]);
      expect(launcher.opened, [
        FakePurchaseRepository.checkoutUrlFor(volume.id),
      ]);
    });

    testWidgets('says so once every episode in it is the reader\'s', (
      tester,
    ) async {
      purchases.owned = volume.episodeIds.toSet();
      await pumpApp(tester);
      await pumpUntilFound(tester, owned);

      expect(find.text('You own every episode in this volume'), findsOne);
      expect(buyVolume, findsNothing);
    });

    // A rental or a ticket opens an episode without keeping it, so the volume
    // that keeps them is still offered.
    testWidgets('is still offered when only some of it is owned', (
      tester,
    ) async {
      purchases.owned = {volume.episodeIds.first};
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      expect(owned, findsNothing);
    });

    testWidgets('sends a guest to sign in before any checkout', (tester) async {
      await pumpApp(tester, session: null);
      await pumpUntilRouteSettled(tester, buyVolume);

      await tester.tap(buyVolume);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );

      expect(purchases.volumeCheckouts, isEmpty);
      expect(launcher.opened, isEmpty);
    });

    testWidgets('reads the reader\'s holdings again when already bought', (
      tester,
    ) async {
      purchases.bundleCheckoutFailure = const PurchaseFailure(
        PurchaseFailureKind.alreadyPurchased,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      purchases.owned = volume.episodeIds.toSet();
      await tester.tap(buyVolume);
      await pumpUntilFound(tester, owned);

      expect(launcher.opened, isEmpty);
    });

    testWidgets('says so when the checkout could not start', (tester) async {
      purchases.bundleCheckoutFailure = const PurchaseFailure(
        PurchaseFailureKind.unexpected,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      await tester.tap(buyVolume);
      await pumpUntilFound(
        tester,
        find.text('Could not start the purchase. Try again later.'),
      );
      expect(launcher.opened, isEmpty);
    });

    // The store has no product for a volume, and the app must not steer the
    // reader to an outside checkout, so it names the website without a link.
    testWidgets('is sold on the website where the app sells in the store', (
      tester,
    ) async {
      purchases.route = AppPurchaseRoute.store;
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('volume-sold-on-web-${volume.publicId}')),
      );

      expect(buyVolume, findsNothing);
      expect(buyRemainder, findsNothing);
    });

    testWidgets('offers nothing to buy where the tenant takes no payments', (
      tester,
    ) async {
      purchases.payments = false;
      await pumpApp(tester);
      await pumpUntilFound(tester, card);
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('2 episodes · ¥350'), findsOne);
      expect(buyVolume, findsNothing);
      expect(buyRemainder, findsNothing);
    });

    testWidgets('says so when what the reader owns could not be read', (
      tester,
    ) async {
      purchases.accessFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('series-volumes-ownership-failed')),
      );

      expect(buyVolume, findsNothing);
      expect(
        find.text('Could not show the price of the remaining episodes'),
        findsOne,
      );
    });

    testWidgets('a series with none shows no volumes', (tester) async {
      catalog.details = fixtureDetails();
      await pumpApp(tester);
      await pumpUntilFound(tester, buyRemainder);

      expect(find.text('Volumes'), findsNothing);
    });
  });

  group('the rest of the series', () {
    testWidgets('is quoted with what the series takes off', (tester) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, buyRemainder);

      expect(find.text('Buy remaining episodes (4) for ¥810'), findsOne);
      expect(find.text('10% off the ¥900 they cost one by one'), findsOne);
    });

    testWidgets('is not said to be discounted when it is not', (tester) async {
      purchases.remainder = const SeriesRemainderOffer(
        episodeCount: 4,
        listPrice: 900,
        discountPercent: 0,
        price: 900,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, buyRemainder);

      expect(
        find.byKey(const ValueKey('series-remainder-discount')),
        findsNothing,
      );
    });

    testWidgets('hands its checkout to the browser in the app\'s language', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(tester, buyRemainder);

      await tester.tap(buyRemainder);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(purchases.remainderCheckouts, [series.internalId]);
      expect(purchases.remainderCheckoutLocales, ['en']);
      expect(launcher.opened, [
        FakePurchaseRepository.checkoutUrlFor(series.internalId),
      ]);
    });

    testWidgets('is not offered when nothing is left to sell', (tester) async {
      purchases.remainder = null;
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      expect(buyRemainder, findsNothing);
    });

    testWidgets('is read again when it is no longer sold', (tester) async {
      purchases.bundleCheckoutFailure = const PurchaseFailure(
        PurchaseFailureKind.notSold,
      );
      await pumpApp(tester);
      await pumpUntilFound(tester, buyRemainder);

      purchases.remainder = null;
      await tester.tap(buyRemainder);
      await pumpUntilTrue(tester, () => buyRemainder.evaluate().isEmpty);

      expect(
        find.text('Could not start the purchase. Try again later.'),
        findsOne,
      );
    });
  });

  group('the return from the browser', () {
    Uri returnLink(String status, {String item = 'volume=VOLUME000001'}) =>
        Uri.parse(
          'https://localhost/en/checkout/return'
          '?series=${series.id}&$item&status=$status',
        );

    testWidgets('lands on the series and says the payment is applied', (
      tester,
    ) async {
      incoming.initialUri = returnLink('success');
      await pumpApp(tester);
      await pumpUntilFound(tester, confirming);

      expect(router.state.uri.path, seriesPath);
      expect(
        find.text(
          'We are confirming your payment. The episodes open once the '
          'purchase is applied.',
        ),
        findsOne,
      );
      for (final delay in checkoutConfirmationDelays) {
        await tester.pump(delay);
      }
      // Up for good: what was bought is not known here.
      expect(confirming, findsOne);
    });

    testWidgets('reads the holdings again while the webhook has not landed', (
      tester,
    ) async {
      incoming.initialUri = returnLink('success');
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      // Recorded between the first read and the first re-read.
      purchases.owned = volume.episodeIds.toSet();
      for (final delay in checkoutConfirmationDelays) {
        await tester.pump(delay);
      }
      await pumpUntilFound(tester, owned);
    });

    testWidgets('reads the holdings again when asked to check', (tester) async {
      incoming.initialUri = returnLink('success', item: 'remainder=1');
      await pumpApp(tester);
      await pumpUntilFound(tester, confirming);
      for (final delay in checkoutConfirmationDelays) {
        await tester.pump(delay);
      }
      await tester.pump();

      purchases.remainder = null;
      await tester.tap(
        find.byKey(const ValueKey('series-checkout-check-again')),
      );
      await pumpUntilTrue(tester, () => buyRemainder.evaluate().isEmpty);
    });

    testWidgets('brings the notice into view on the screen bought from', (
      tester,
    ) async {
      await pumpApp(tester, size: const Size(400, 700));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('series-detail-body')),
      );
      await tester.scrollUntilVisible(
        find.byKey(ValueKey('episode-tile-${series.id}-ep-10')),
        200,
        scrollable: find
            .descendant(
              of: find.byKey(const ValueKey('series-detail-body')),
              matching: find.byType(Scrollable),
            )
            .first,
      );

      expect(confirming, findsNothing);

      incoming.deliver(returnLink('success'));
      await pumpUntilFound(tester, confirming);
      for (final delay in checkoutConfirmationDelays) {
        await tester.pump(delay);
      }
    });

    testWidgets('a cancelled checkout offers the purchase again', (
      tester,
    ) async {
      incoming.initialUri = returnLink('cancelled');
      await pumpApp(tester);
      await pumpUntilFound(tester, buyVolume);

      expect(find.byKey(const ValueKey('series-checkout-cancelled')), findsOne);
      expect(
        find.text('The purchase was cancelled. You have not been charged.'),
        findsOne,
      );
      expect(confirming, findsNothing);
    });
  });
}
