import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:publira/app.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
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
  final episodeId = '$seriesId-ep-1';
  final episodeInternalId = fixtureInternalId(episodeId);
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, episodeId);

  final endPanel = find.byKey(const ValueKey('episode-end-panel'));
  final tip = find.byKey(const ValueKey('episode-end-tip'));
  final sheet = find.byKey(const ValueKey('tip-sheet'));
  Finder amount(int value) => find.byKey(ValueKey('tip-amount-$value'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;
  late FakeInAppPurchasePlatform platform;
  late StorePurchaser purchaser;

  /// The reaction state the API answers the signed-in reader for the episode.
  void reaction({required bool readerCredited}) {
    catalog.reactions = {
      episodeInternalId: EpisodeReaction(
        score: 0,
        ratingCount: 2,
        allowsMultiplePresses: false,
        readerCredited: readerCredited,
      ),
    };
  }

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(
        tipAmounts: const [300, 1000],
        creators: fixtureCreators,
      ),
    );
    reaction(readerCredited: false);
    purchases = FakePurchaseRepository(seriesByEpisode: {episodeId: seriesId});
    launcher = FakeCheckoutLauncher();
    platform = FakeInAppPurchasePlatform(products: {'tip_300', 'tip_1000'});
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
      ..physicalSize = const Size(400, 800)
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
        storePurchaser: purchaser,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Reads the three fixture pages and one screen further, to the panel that
  /// ends the episode.
  Future<void> turnToEnd(WidgetTester tester) async {
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );
    for (var turn = 0; turn < 3; turn++) {
      await tester.tap(find.byKey(const ValueKey('episode-next-page')));
      await pumpUntilNoPendingFrameCallbacks(tester);
    }
    await pumpUntilFound(tester, endPanel);
  }

  /// Opens the sheet from the end of the episode and picks [value].
  Future<void> give(WidgetTester tester, int value) async {
    await tester.ensureVisible(tip);
    await tester.tap(tip);
    await pumpUntilFound(tester, amount(value));
    // Until the sheet has slid in, its buttons are below the screen.
    await tester.pumpAndSettle();
    await tester.tap(amount(value));
    await tester.pumpAndSettle();
  }

  Finder snackBar(String text) =>
      find.descendant(of: find.byType(SnackBar), matching: find.text(text));

  group('the end of an episode', () {
    testWidgets('offers no tip while the tenant takes none', (tester) async {
      catalog.episodes = fixtureEpisodes(creators: fixtureCreators);
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      expect(tip, findsNothing);
    });

    testWidgets('offers no tip while the tenant takes no payments', (
      tester,
    ) async {
      purchases.payments = false;
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      expect(tip, findsNothing);
    });

    testWidgets('offers no tip to a reader credited on a free episode', (
      tester,
    ) async {
      reaction(readerCredited: true);
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);
      await tester.pumpAndSettle();

      expect(tip, findsNothing);
    });

    testWidgets('offers no tip to a reader credited on a priced episode', (
      tester,
    ) async {
      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.entitled,
        entitlementSource: EpisodeEntitlementSource.creator,
        tipAmounts: const [300, 1000],
        creators: fixtureCreators,
      );
      reaction(readerCredited: true);
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);
      await tester.pumpAndSettle();

      expect(tip, findsNothing);
    });

    testWidgets('offers a tip to a reader not credited on a free episode', (
      tester,
    ) async {
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await pumpUntilFound(tester, tip);
      expect(tip, findsOne);
    });

    testWidgets('offers a tip to a reader not credited on a priced episode', (
      tester,
    ) async {
      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.entitled,
        entitlementSource: EpisodeEntitlementSource.purchase,
        tipAmounts: const [300, 1000],
        creators: fixtureCreators,
      );
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await pumpUntilFound(tester, tip);
      expect(tip, findsOne);
    });

    testWidgets('holds the tip back until the reader has been read', (
      tester,
    ) async {
      final gate = Completer<EpisodeReaction?>();
      catalog.reactionGate = gate;
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      expect(tip, findsNothing);

      gate.complete(
        const EpisodeReaction(
          score: 0,
          ratingCount: 2,
          allowsMultiplePresses: false,
        ),
      );
      await pumpUntilFound(tester, tip);
      expect(tip, findsOne);
    });

    testWidgets('offers no tip to a reader who could not be read', (
      tester,
    ) async {
      catalog.reactionError = const CatalogFailure(
        CatalogFailureKind.unexpected,
      );
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);
      await tester.pumpAndSettle();

      expect(tip, findsNothing);
    });

    testWidgets('takes the tip back from a press refused as credited', (
      tester,
    ) async {
      catalog.pressError = const CatalogFailure(
        CatalogFailureKind.unexpected,
        refused: true,
        reasons: [readerCreditedOnEpisodeReason],
      );
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);
      await pumpUntilFound(tester, tip);

      final press = find.byKey(const ValueKey('episode-reaction-press'));
      tester.widget<FilledButton>(press).onPressed!.call();
      await tester.pumpAndSettle();

      expect(tip, findsNothing);
    });

    testWidgets('names the Authors and offers every amount in the sheet', (
      tester,
    ) async {
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await tester.ensureVisible(tip);
      await tester.tap(tip);
      await pumpUntilFound(tester, sheet);

      expect(
        find.descendant(of: sheet, matching: find.text('Tip the Authors')),
        findsOne,
      );
      expect(
        find.text('To Seed Author 001, Seed Author 002, and Seed Author 003'),
        findsOne,
      );
      expect(
        find.descendant(of: amount(300), matching: find.text('¥300')),
        findsOne,
      );
      expect(
        find.descendant(of: amount(1000), matching: find.text('¥1,000')),
        findsOne,
      );
    });

    testWidgets('sends a guest to sign in before the sheet', (tester) async {
      await pumpApp(tester);
      await turnToEnd(tester);

      await tester.ensureVisible(tip);
      await tester.tap(tip);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('sign-in-submit')),
      );

      expect(sheet, findsNothing);
      expect(purchases.tipCheckouts, isEmpty);
      expect(purchases.tipIntents, isEmpty);
    });
  });

  group('a tenant that sells through the store', () {
    setUp(() {
      purchases.route = AppPurchaseRoute.store;
    });

    testWidgets('takes the tip on the payment sheet and thanks the reader', (
      tester,
    ) async {
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await give(tester, 300);
      await pumpUntilFound(
        tester,
        snackBar(
          'Thank you for your tip. It goes to the Authors of this episode.',
        ),
      );

      expect(purchases.tipIntents, ['$episodeInternalId:300']);
      final param = platform.bought.single;
      expect(param.productDetails.id, 'tip_300');
      expect(
        param.applicationUserName,
        FakePurchaseRepository.tipIntentFor(episodeInternalId, 300),
      );
      expect(purchases.confirmed, ['jws-2000000000000001']);
      expect(platform.finished.single.purchaseID, '2000000000000001');
      // Nothing is sent to the web checkout, and the episode stays as it was.
      expect(purchases.tipCheckouts, isEmpty);
      expect(launcher.opened, isEmpty);
      expect(endPanel, findsOne);
    });

    testWidgets('names each amount at the price the store charges', (
      tester,
    ) async {
      // The store sells the ¥300 tip at its own price in this storefront, and
      // has no product for the ¥1,000 one.
      platform
        ..products = {'tip_300'}
        ..prices = {'tip_300': 320};
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await tester.ensureVisible(tip);
      await tester.tap(tip);
      await pumpUntilFound(tester, sheet);

      expect(
        find.descendant(of: amount(300), matching: find.text('¥320')),
        findsOne,
      );
      expect(
        find.descendant(of: amount(1000), matching: find.text('¥1,000')),
        findsOne,
      );
    });

    testWidgets('says so for an amount the store does not sell', (
      tester,
    ) async {
      platform.products = {'tip_1000'};
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await give(tester, 300);
      await pumpUntilFound(
        tester,
        snackBar(
          'This amount cannot be given in the app right now. Try again later.',
        ),
      );

      expect(platform.bought, isEmpty);
      expect(purchases.confirmed, isEmpty);
    });

    testWidgets('waits for a tip the store holds for approval', (tester) async {
      platform.sheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.pending,
        ),
      ];
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await give(tester, 1000);
      await pumpUntilFound(
        tester,
        snackBar(
          'We are confirming your tip. It is recorded once the store settles '
          'the payment.',
        ),
      );

      expect(purchases.confirmed, isEmpty);
    });

    testWidgets('says nothing of a payment sheet the reader closed', (
      tester,
    ) async {
      platform.sheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.canceled,
        ),
      ];
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await give(tester, 300);
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(SnackBar), findsNothing);
      expect(purchases.confirmed, isEmpty);
    });
  });

  group('a tenant that sells through its web checkout', () {
    testWidgets('opens the tip checkout in the browser', (tester) async {
      await pumpApp(tester, session: fakeSession);
      await turnToEnd(tester);

      await give(tester, 1000);

      expect(purchases.tipCheckouts, ['$episodeInternalId:1000']);
      expect(purchases.tipCheckoutLocales, ['en']);
      expect(launcher.opened, [
        FakePurchaseRepository.tipCheckoutUrlFor(episodeInternalId, 1000),
      ]);
      expect(purchases.tipIntents, isEmpty);
      expect(platform.bought, isEmpty);
    });

    testWidgets('thanks the reader the browser hands back', (tester) async {
      await pumpApp(
        tester,
        session: fakeSession,
        initialLocation:
            '${AppRoutes.checkoutReturn}?episode=$episodeId&tip=1000'
            '&status=success',
      );
      await pumpUntilFound(
        tester,
        snackBar(
          'Thank you for your tip. It goes to the Authors of this episode.',
        ),
      );

      expect(router.routerDelegate.currentConfiguration.uri.path, viewerPath);
      // A tip opens nothing, so there is no purchase to wait for.
      expect(
        find.byKey(const ValueKey('episode-purchase-confirming')),
        findsNothing,
      );
    });

    testWidgets('tells the reader a cancelled tip charged nothing', (
      tester,
    ) async {
      await pumpApp(
        tester,
        session: fakeSession,
        initialLocation:
            '${AppRoutes.checkoutReturn}?episode=$episodeId&tip=1000'
            '&status=cancelled',
      );
      await pumpUntilFound(
        tester,
        snackBar('The tip was cancelled. You have not been charged.'),
      );

      expect(router.routerDelegate.currentConfiguration.uri.path, viewerPath);
    });
  });
}
