import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_in_app_purchase.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '$seriesId-ep-${fixtureSeries.first.episodeCount}';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, paidEpisodeId);
  final intentId = FakePurchaseRepository.intentFor(paidEpisodeId);

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final confirming = find.byKey(const ValueKey('episode-purchase-confirming'));

  late GoRouter router;
  late AuthController auth;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;
  late FakeInAppPurchasePlatform platform;
  late StorePurchaser purchaser;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository(route: AppPurchaseRoute.store)
      ..onConfirmed = () {
        catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      };
    launcher = FakeCheckoutLauncher();
    platform = FakeInAppPurchasePlatform();
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
    AuthSession? session,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation ?? viewerPath);
    auth = fakeAuthController(session: session);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: auth,
        purchases: purchases,
        checkoutLauncher: launcher,
        storePurchaser: purchaser,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Finder snackBar(String text) =>
      find.descendant(of: find.byType(SnackBar), matching: find.text(text));

  group('a tenant that sells through the store', () {
    testWidgets('opens the episode once the server has the payment', (
      tester,
    ) async {
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(tester, pages);

      expect(purchases.storeIntents, [paidEpisodeId]);
      final param = platform.bought.single;
      expect(param.productDetails.id, 'episode_500');
      expect(param.applicationUserName, intentId);
      expect(purchases.confirmed, ['jws-2000000000000001']);
      expect(platform.finished.single.purchaseID, '2000000000000001');
      // Nothing is sent to the web checkout.
      expect(purchases.checkouts, isEmpty);
      expect(launcher.opened, isEmpty);
    });

    testWidgets('leaves a transaction the server could not take unfinished', (
      tester,
    ) async {
      purchases.confirmFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(tester, confirming);
      expect(platform.finished, isEmpty);

      // The next launch has the store report it again.
      purchases.confirmFailure = null;
      platform.report(FakeInAppPurchasePlatform.paysAtOnce(platform.bought[0]));
      await pumpUntilTrue(tester, () => platform.finished.isNotEmpty);
      expect(purchases.confirmed, ['jws-2000000000000001']);

      await tester.tap(
        find.byKey(const ValueKey('episode-purchase-check-again')),
      );
      await pumpUntilFound(tester, pages);
    });

    testWidgets('confirms on sign-in what the store reported signed out', (
      tester,
    ) async {
      purchases.confirmFailure = const PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
      );
      await pumpApp(tester);
      platform.report([
        FakeInAppPurchasePlatform.storeTransaction(
          id: '2000000000000002',
          productId: 'episode_500',
          intentId: intentId,
        ),
      ]);
      await tester.pump();
      expect(platform.finished, isEmpty);

      purchases.confirmFailure = null;
      await auth.signIn(email: 'member@example.com', password: 'memberpass');
      await pumpUntilTrue(tester, () => platform.finished.isNotEmpty);

      expect(purchases.confirmed, ['jws-2000000000000002']);
    });

    testWidgets('says a purchase waiting for approval is being confirmed', (
      tester,
    ) async {
      platform.sheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.pending,
        ),
      ];
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(tester, confirming);

      expect(purchases.confirmed, isEmpty);
      expect(platform.finished, isEmpty);
    });

    testWidgets('offers the purchase again when the sheet is closed', (
      tester,
    ) async {
      platform.sheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.canceled,
        ),
      ];
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilTrue(tester, () => platform.bought.isNotEmpty);
      await pumpUntilTrue(
        tester,
        () => tester.widget<FilledButton>(buy).onPressed != null,
      );

      expect(platform.bought, hasLength(1));
      expect(locked, findsOneWidget);
      expect(confirming, findsNothing);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('does not take an earlier order of the same price for this '
        'one', (tester) async {
      final earlier = FakeInAppPurchasePlatform.storeTransaction(
        id: '2000000000000003',
        productId: 'episode_500',
        intentId: 'intent-an-earlier-episode',
      );
      final completer = Completer<void>();
      platform.sheet = (param) {
        unawaited(
          completer.future.then(
            (_) => platform.report(FakeInAppPurchasePlatform.paysAtOnce(param)),
          ),
        );
        return [earlier];
      };
      purchases.onConfirmed = null;
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilTrue(tester, () => purchases.confirmed.isNotEmpty);
      await tester.pump(const Duration(milliseconds: 50));
      // The earlier order is recorded and finished, and this one still waits.
      expect(purchases.confirmed, ['jws-2000000000000003']);
      expect(locked, findsOneWidget);

      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      completer.complete();
      await pumpUntilFound(tester, pages);
      expect(purchases.confirmed, [
        'jws-2000000000000003',
        'jws-2000000000000001',
      ]);
    });

    testWidgets('says so on a device that cannot pay', (tester) async {
      platform.available = false;
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(
        tester,
        snackBar(
          'Purchases are not available on this device. Check that you are '
          'signed in to the store and that purchases are allowed.',
        ),
      );
      expect(purchases.storeIntents, isEmpty);
      expect(platform.bought, isEmpty);
    });

    testWidgets('says so when the store has no product for the price', (
      tester,
    ) async {
      platform.products = {};
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(
        tester,
        snackBar(
          'This episode cannot be bought in the app right now. Try again '
          'later.',
        ),
      );
      expect(platform.bought, isEmpty);
    });

    testWidgets('says so when the tenant has stopped selling through it', (
      tester,
    ) async {
      purchases.storeStartFailure = const PurchaseFailure(
        PurchaseFailureKind.notSold,
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(
        tester,
        snackBar(
          'This episode cannot be bought in the app right now. Try again '
          'later.',
        ),
      );
      expect(platform.bought, isEmpty);
    });

    testWidgets('opens a purchase from the episode list', (tester) async {
      purchases.access = {paidEpisodeId: EpisodeAccess.locked};
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(seriesId),
        session: fakeSession,
      );
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(tester, pages);
    });
  });

  testWidgets('a tenant on the external checkout never opens the sheet', (
    tester,
  ) async {
    purchases.route = AppPurchaseRoute.externalCheckout;
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, buy);

    await tester.tap(buy);
    await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

    expect(purchases.checkouts, [paidEpisodeId]);
    expect(purchases.storeIntents, isEmpty);
    expect(platform.bought, isEmpty);
  });
}
