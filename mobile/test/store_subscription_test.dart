import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/store_kit_2_wrappers.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/purchase/store_subscriber.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_in_app_purchase.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final seriesId = series.id;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '$seriesId-ep-${series.episodeCount}';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, paidEpisodeId);

  const planId = 'plan-unlimited';
  const productId = 'plan_unlimited_monthly';
  final intentId = FakePurchaseRepository.subscriptionIntentFor(planId);
  const unlimited = SubscriptionPlan(
    id: planId,
    name: 'Unlimited',
    scope: SubscriptionPlanScope.all,
    appStoreProductId: productId,
    googlePlayProductId: 'plan_unlimited',
  );

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final seePlans = find.byKey(const ValueKey('episode-see-plans'));
  final sheet = find.byKey(const ValueKey('subscription-plans'));
  final subscribe = find.byKey(
    const ValueKey('subscription-plan-subscribe-$planId'),
  );

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;
  late FakeInAppPurchasePlatform platform;
  late StoreSubscriber subscriber;
  late StorePurchaser purchaser;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository(route: AppPurchaseRoute.store)
      ..plans = const [unlimited]
      ..onSubscriptionConfirmed = (_) {
        catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      };
    launcher = FakeCheckoutLauncher();
    platform = FakeInAppPurchasePlatform()
      ..subscriptions = {
        productId: (
          price: '¥980',
          period: const SK2SubscriptionPeriod(
            value: 1,
            unit: SK2SubscriptionPeriodUnit.month,
          ),
        ),
      };
    addTearDown(platform.close);
    subscriber = StoreSubscriber(
      platform: platform,
      store: InAppPurchaseStore.appStore,
      repository: purchases,
      applicationId: () async => 'com.example.reader',
    );
    addTearDown(subscriber.dispose);
    purchaser = StorePurchaser(
      platform: platform,
      store: InAppPurchaseStore.appStore,
      repository: purchases,
      isSubscription: subscriber.isSubscription,
    );
    addTearDown(purchaser.dispose);
  });

  group('StoreSubscriber', () {
    setUp(() async {
      await subscriber.start();
      await purchaser.start();
    });

    test('subscribes through the sheet and finishes the transaction once '
        'the server has it', () async {
      final outcome = await subscriber.subscribe(planId);

      expect(outcome, StoreSubscriptionOutcome.subscribed);
      expect(purchases.subscriptionIntents, [planId]);
      final param = platform.bought.single;
      expect(param.productDetails.id, productId);
      expect(param.applicationUserName, intentId);
      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000001']);
      expect(platform.finished.single.purchaseID, '3000000000000001');
      // The purchase of an episode is not what the store charged.
      expect(purchases.confirmed, isEmpty);
    });

    test('answers a sheet the reader closed as cancelled', () async {
      platform.subscriptionSheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.canceled,
        ),
      ];

      expect(
        await subscriber.subscribe(planId),
        StoreSubscriptionOutcome.cancelled,
      );
      expect(purchases.subscriptionsConfirmed, isEmpty);
    });

    test('keeps a subscription the server could not take, and confirms it on '
        'reconcile', () async {
      purchases.subscriptionConfirmFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );

      expect(
        await subscriber.subscribe(planId),
        StoreSubscriptionOutcome.pending,
      );
      expect(platform.finished, isEmpty);

      purchases.subscriptionConfirmFailure = null;
      final recorded = subscriber.recorded.first;
      await subscriber.reconcile();

      expect(await recorded, productId);
      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000001']);
      expect(platform.finished.single.purchaseID, '3000000000000001');
    });

    test('confirms a renewal the store reports on its own', () async {
      platform.report([
        FakeInAppPurchasePlatform.subscriptionTransaction(
          id: '3000000000000002',
          productId: productId,
          intentId: intentId,
        ),
      ]);
      await subscriber.reconcile();

      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000002']);
      expect(purchases.confirmed, isEmpty);
    });

    test('restores what the store holds without finishing it again', () async {
      platform.entitlements = [
        FakeInAppPurchasePlatform.subscriptionTransaction(
          id: '3000000000000003',
          productId: productId,
          intentId: intentId,
          status: PurchaseStatus.restored,
        ),
      ];

      expect(await subscriber.restore(), StoreRestoreOutcome.restored);
      expect(platform.restores, 1);
      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000003']);
      expect(platform.finished, isEmpty);
    });

    test(
      'says a subscription held for another account belongs to it',
      () async {
        platform.entitlements = [
          FakeInAppPurchasePlatform.subscriptionTransaction(
            id: '3000000000000004',
            productId: productId,
            intentId: 'another-readers-intent',
            status: PurchaseStatus.restored,
          ),
        ];
        purchases.subscriptionConfirmFailure = const PurchaseFailure(
          PurchaseFailureKind.otherAccount,
        );

        expect(await subscriber.restore(), StoreRestoreOutcome.otherAccount);
      },
    );

    test('finds nothing where the store holds no subscription', () async {
      expect(await subscriber.restore(), StoreRestoreOutcome.none);
      expect(purchases.subscriptionsConfirmed, isEmpty);
    });

    test('refuses to restore on a device that cannot pay', () async {
      platform.available = false;

      await expectLater(
        subscriber.restore(),
        throwsA(
          isA<PurchaseFailure>().having(
            (failure) => failure.kind,
            'kind',
            PurchaseFailureKind.storeUnavailable,
          ),
        ),
      );
    });

    test('offers the plans the store sells, at its price and period', () async {
      final offers = await subscriber.offers(const [
        unlimited,
        SubscriptionPlan(
          id: 'plan-missing',
          scope: SubscriptionPlanScope.all,
          appStoreProductId: 'plan_not_in_the_store',
        ),
        SubscriptionPlan(id: 'plan-web', scope: SubscriptionPlanScope.all),
      ]);

      expect(offers.map((offer) => offer.plan.id), [planId]);
      expect(offers.single.price, '¥980');
      expect(
        offers.single.period,
        const StoreBillingPeriod(StoreBillingUnit.month, 1),
      );
    });

    test('opens each store on its page of subscriptions', () async {
      expect(
        await subscriber.manageUrl(InAppPurchaseStore.appStore, productId),
        Uri.parse('https://apps.apple.com/account/subscriptions'),
      );
      expect(
        await subscriber.manageUrl(
          InAppPurchaseStore.googlePlay,
          'plan_unlimited',
        ),
        Uri.parse(
          'https://play.google.com/store/account/subscriptions'
          '?sku=plan_unlimited&package=com.example.reader',
        ),
      );
    });
  });

  test('reads the billing periods Google Play writes', () {
    expect(
      parseBillingPeriod('P1M'),
      const StoreBillingPeriod(StoreBillingUnit.month, 1),
    );
    expect(
      parseBillingPeriod('P3M'),
      const StoreBillingPeriod(StoreBillingUnit.month, 3),
    );
    expect(
      parseBillingPeriod('P1Y'),
      const StoreBillingPeriod(StoreBillingUnit.year, 1),
    );
    expect(
      parseBillingPeriod('P1W'),
      const StoreBillingPeriod(StoreBillingUnit.week, 1),
    );
    expect(parseBillingPeriod('P1Y6M'), isNull);
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
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        purchases: purchases,
        checkoutLauncher: launcher,
        storePurchaser: purchaser,
        storeSubscriber: subscriber,
        site: const PublicSite(host: 'localhost'),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> pumpLocked(WidgetTester tester) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, locked);
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Opens the plans and waits for the sheet to have slid up.
  Future<void> openPlans(WidgetTester tester) async {
    await tester.tap(seePlans);
    await pumpUntilFound(tester, subscribe);
    await tester.pump(const Duration(seconds: 1));
  }

  Finder snackBar(String text) =>
      find.descendant(of: find.byType(SnackBar), matching: find.text(text));

  group('a locked episode on the store route', () {
    testWidgets('lists the plans in the app and opens the episode once the '
        'store has subscribed the reader', (tester) async {
      await pumpLocked(tester);

      await openPlans(tester);
      expect(
        find.descendant(of: sheet, matching: find.text('Unlimited')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: sheet, matching: find.text('¥980 a month')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: sheet, matching: find.text('Covers every work.')),
        findsOneWidget,
      );

      await tester.tap(subscribe);
      await pumpUntilFound(tester, pages);

      expect(platform.bought.single.applicationUserName, intentId);
      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000001']);
      // Nothing is sent to the site.
      expect(launcher.opened, isEmpty);
    });

    testWidgets('keeps the plans open when the reader closes the payment '
        'sheet', (tester) async {
      platform.subscriptionSheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.canceled,
        ),
      ];
      await pumpLocked(tester);

      await openPlans(tester);
      await tester.tap(subscribe);
      await pumpUntilTrue(tester, () => platform.bought.isNotEmpty);
      await tester.pump(const Duration(milliseconds: 50));

      expect(sheet, findsOneWidget);
      expect(purchases.subscriptionsConfirmed, isEmpty);
    });

    testWidgets('says a subscription is being confirmed while the store '
        'holds it', (tester) async {
      platform.subscriptionSheet = (param) => [
        FakeInAppPurchasePlatform.orderWithoutTransaction(
          param.productDetails.id,
          PurchaseStatus.pending,
        ),
      ];
      await pumpLocked(tester);

      await openPlans(tester);
      await tester.tap(subscribe);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-purchase-confirming')),
      );

      expect(sheet, findsNothing);
    });

    testWidgets('says so when the store sells none of the plans', (
      tester,
    ) async {
      platform.subscriptions = {};
      await pumpLocked(tester);

      await tester.tap(seePlans);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('subscription-plans-empty')),
      );

      expect(subscribe, findsNothing);
    });

    testWidgets('offers no plan the app does not sell in this store', (
      tester,
    ) async {
      purchases.plans = const [
        SubscriptionPlan(
          id: planId,
          scope: SubscriptionPlanScope.all,
          googlePlayProductId: 'plan_unlimited',
        ),
      ];
      await pumpLocked(tester);

      expect(seePlans, findsNothing);
    });

    testWidgets('reports a plan the reader already holds', (tester) async {
      purchases.subscriptionStartFailure = const PurchaseFailure(
        PurchaseFailureKind.alreadyPurchased,
      );
      await pumpLocked(tester);

      await openPlans(tester);
      await tester.tap(subscribe);
      await pumpUntilFound(
        tester,
        snackBar('You already have a plan. See it on the account screen.'),
      );
      await tester.pump(const Duration(seconds: 1));
      expect(sheet, findsNothing);
    });
  });

  testWidgets('a locked episode on the web checkout route still sends the '
      'reader to the site for the plans', (tester) async {
    purchases.route = AppPurchaseRoute.externalCheckout;
    await pumpLocked(tester);

    await tester.tap(seePlans);
    await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

    expect(launcher.opened, [Uri.parse('https://localhost/plans')]);
    expect(sheet, findsNothing);
  });

  group('the account screen', () {
    final plan = find.byKey(const ValueKey('account-plan'));
    final none = find.byKey(const ValueKey('account-plan-none'));
    final manageSubscription = find.byKey(
      const ValueKey('account-manage-subscription'),
    );
    final manageBilling = find.byKey(const ValueKey('account-manage-billing'));
    final restore = find.byKey(const ValueKey('account-restore-purchases'));

    MySubscription storeSubscription() => MySubscription(
      planName: 'Unlimited',
      status: SubscriptionStatus.active,
      currentPeriodEnd: DateTime.utc(2026, 12, 1, 12),
      store: InAppPurchaseStore.appStore,
      productId: productId,
    );

    Future<void> pumpAccount(WidgetTester tester) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.account,
        session: fakeSession,
      );
      await pumpUntilFound(tester, find.byKey(const ValueKey('account-list')));
      await tester.pump(const Duration(milliseconds: 50));
    }

    testWidgets('opens the store to manage a plan the store bills', (
      tester,
    ) async {
      purchases.subscription = storeSubscription();
      await pumpAccount(tester);

      expect(
        find.descendant(
          of: plan,
          matching: find.text(
            'You subscribed through the App Store. Change or cancel the plan '
            'there.',
          ),
        ),
        findsOneWidget,
      );
      expect(manageBilling, findsNothing);
      expect(restore, findsOneWidget);
      await tester.tap(manageSubscription);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(launcher.opened, [
        Uri.parse('https://apps.apple.com/account/subscriptions'),
      ]);
    });

    testWidgets('restores a plan to a reader who holds none here', (
      tester,
    ) async {
      platform.entitlements = [
        FakeInAppPurchasePlatform.subscriptionTransaction(
          id: '3000000000000005',
          productId: productId,
          intentId: intentId,
          status: PurchaseStatus.restored,
        ),
      ];
      purchases.onSubscriptionConfirmed = (_) {
        purchases.subscription = storeSubscription();
      };
      await pumpAccount(tester);

      expect(
        find.descendant(
          of: none,
          matching: find.text(
            'Subscribed through the store on another device? Restore the '
            'plan here.',
          ),
        ),
        findsOneWidget,
      );
      await tester.tap(restore);
      await pumpUntilFound(tester, snackBar('Your plan has been restored.'));
      await pumpUntilFound(tester, plan);

      expect(purchases.subscriptionsConfirmed, ['jws-3000000000000005']);
      expect(find.text('Unlimited'), findsOneWidget);
    });

    testWidgets('says a restored subscription belongs to another account', (
      tester,
    ) async {
      platform.entitlements = [
        FakeInAppPurchasePlatform.subscriptionTransaction(
          id: '3000000000000006',
          productId: productId,
          intentId: 'another-readers-intent',
          status: PurchaseStatus.restored,
        ),
      ];
      purchases.subscriptionConfirmFailure = const PurchaseFailure(
        PurchaseFailureKind.otherAccount,
      );
      await pumpAccount(tester);

      await tester.tap(restore);
      await pumpUntilFound(
        tester,
        snackBar(
          'This subscription belongs to another account. Sign in with that '
          'account to read with it.',
        ),
      );
      expect(plan, findsNothing);
    });

    testWidgets('says when the store holds nothing to restore', (tester) async {
      await pumpAccount(tester);

      await tester.tap(restore);
      await pumpUntilFound(
        tester,
        snackBar('The store holds no subscription to restore.'),
      );
    });

    testWidgets('keeps billing for a plan the web checkout bills', (
      tester,
    ) async {
      purchases
        ..route = AppPurchaseRoute.externalCheckout
        ..subscription = MySubscription(
          planName: 'Unlimited',
          status: SubscriptionStatus.active,
          currentPeriodEnd: DateTime.utc(2026, 12, 1, 12),
        );
      await pumpAccount(tester);

      expect(manageBilling, findsOneWidget);
      expect(manageSubscription, findsNothing);
      expect(restore, findsNothing);
    });

    testWidgets('shows nothing to a reader with no plan on the web checkout '
        'route', (tester) async {
      purchases.route = AppPurchaseRoute.externalCheckout;
      await pumpAccount(tester);

      expect(none, findsNothing);
      expect(restore, findsNothing);
    });
  });
}
