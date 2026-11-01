import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
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
  final seriesId = series.id;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '$seriesId-ep-${series.episodeCount}';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, paidEpisodeId);

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final seePlans = find.byKey(const ValueKey('episode-see-plans'));

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakePurchaseRepository purchases;
  late FakeCheckoutLauncher launcher;
  late FakeIncomingLinks incoming;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    purchases = FakePurchaseRepository(
      seriesByEpisode: {paidEpisodeId: seriesId},
    );
    launcher = FakeCheckoutLauncher();
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String? initialLocation,
    AuthSession? session,
  }) async {
    // Tall enough that the paid episode's row is on screen without scrolling.
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
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Pumps the locked episode until its gate is drawn and the tenant's
  /// payment settings have been read, which decide the plan offer.
  Future<void> pumpLocked(WidgetTester tester, {AuthSession? session}) async {
    await pumpApp(tester, session: session);
    await pumpUntilFound(tester, locked);
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('a locked episode', () {
    testWidgets('offers the plans when a plan of the whole site opens it, '
        'and hands them to the browser', (tester) async {
      purchases.plans = const [
        SubscriptionPlan(scope: SubscriptionPlanScope.all),
      ];
      await pumpLocked(tester, session: fakeSession);

      expect(find.text('See plans'), findsOneWidget);
      await tester.tap(seePlans);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(launcher.opened, [Uri.parse('https://localhost/plans')]);
      // The plans are offered beside the purchase, not in place of it.
      expect(
        find.byKey(ValueKey('episode-buy-$paidEpisodeId')),
        findsOneWidget,
      );
    });

    testWidgets('offers the plans to a guest as well', (tester) async {
      purchases.plans = const [
        SubscriptionPlan(scope: SubscriptionPlanScope.all),
      ];
      await pumpLocked(tester);

      expect(seePlans, findsOneWidget);
    });

    testWidgets('offers the plans when a plan names its series', (
      tester,
    ) async {
      purchases.plans = [
        SubscriptionPlan(
          scope: SubscriptionPlanScope.series,
          seriesIds: {seriesId},
        ),
      ];
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsOneWidget);
    });

    testWidgets('offers the plans when a plan names the label of its series', (
      tester,
    ) async {
      purchases.plans = [
        SubscriptionPlan(
          scope: SubscriptionPlanScope.label,
          labelIds: {series.labelId},
        ),
      ];
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsOneWidget);
    });

    testWidgets('offers no plan when every plan opens other works', (
      tester,
    ) async {
      purchases.plans = const [
        SubscriptionPlan(
          scope: SubscriptionPlanScope.series,
          seriesIds: {'series-kitchen'},
        ),
        SubscriptionPlan(
          scope: SubscriptionPlanScope.label,
          labelIds: {'OtherLABL001'},
        ),
      ];
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsNothing);
    });

    testWidgets('offers no plan where the tenant sells none', (tester) async {
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsNothing);
    });

    testWidgets('offers no plan when the plans cannot be read', (tester) async {
      purchases
        ..plans = const [SubscriptionPlan(scope: SubscriptionPlanScope.all)]
        ..plansFailure = const PurchaseFailure(PurchaseFailureKind.network);
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsNothing);
    });

    testWidgets('offers no plan where the tenant takes no payments', (
      tester,
    ) async {
      purchases
        ..plans = const [SubscriptionPlan(scope: SubscriptionPlanScope.all)]
        ..payments = false;
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsNothing);
    });

    testWidgets('offers no plan where the app sells through the store', (
      tester,
    ) async {
      purchases
        ..plans = const [SubscriptionPlan(scope: SubscriptionPlanScope.all)]
        ..route = AppPurchaseRoute.store;
      await pumpLocked(tester, session: fakeSession);

      expect(seePlans, findsNothing);
    });

    testWidgets('says so when the browser could not open the plans', (
      tester,
    ) async {
      purchases.plans = const [
        SubscriptionPlan(scope: SubscriptionPlanScope.all),
      ];
      launcher.opens = false;
      await pumpLocked(tester, session: fakeSession);

      await tester.tap(seePlans);
      await pumpUntilFound(
        tester,
        find.text('Could not open the plans. Try again later.'),
      );
    });

    testWidgets('opens once the reader comes back from subscribing', (
      tester,
    ) async {
      purchases.plans = const [
        SubscriptionPlan(scope: SubscriptionPlanScope.all),
      ];
      await pumpLocked(tester, session: fakeSession);

      await tester.tap(seePlans);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.entitled,
        entitlementSource: EpisodeEntitlementSource.subscription,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pumpUntilFound(tester, pages);

      expect(locked, findsNothing);
    });
  });

  group('the episode list', () {
    final seriesPath = AppRoutes.seriesDetailPath(seriesId);

    testWidgets('says the plan opens an episode in place of its price', (
      tester,
    ) async {
      purchases
        ..access = {paidEpisodeId: EpisodeAccess.entitled}
        ..sources = {paidEpisodeId: EpisodeEntitlementSource.subscription};
      await pumpApp(tester, initialLocation: seriesPath, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-included-in-plan')),
      );

      expect(find.text('Included in your plan'), findsOneWidget);
      expect(find.text('¥500'), findsNothing);
    });

    testWidgets('names the price of an episode the reader bought', (
      tester,
    ) async {
      purchases
        ..access = {paidEpisodeId: EpisodeAccess.entitled}
        ..sources = {paidEpisodeId: EpisodeEntitlementSource.purchase};
      await pumpApp(tester, initialLocation: seriesPath, session: fakeSession);
      await pumpUntilFound(tester, find.text('¥500'));

      expect(find.text('Included in your plan'), findsNothing);
    });
  });

  group('the account screen', () {
    final plan = find.byKey(const ValueKey('account-plan'));
    final manageBilling = find.byKey(const ValueKey('account-manage-billing'));
    final renewal = DateTime.utc(2026, 12, 1, 12);

    MySubscription subscription({
      SubscriptionStatus status = SubscriptionStatus.active,
      bool cancelAtPeriodEnd = false,
      InAppPurchaseStore? store,
    }) => MySubscription(
      planName: 'Unlimited',
      status: status,
      currentPeriodEnd: renewal,
      cancelAtPeriodEnd: cancelAtPeriodEnd,
      store: store,
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

    testWidgets('names the plan and the day it renews, and opens billing in '
        'the browser', (tester) async {
      purchases.subscription = subscription();
      await pumpAccount(tester);

      expect(
        find.descendant(of: plan, matching: find.text('Unlimited')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: plan,
          matching: find.text('Renews on Dec 1, 2026.'),
        ),
        findsOneWidget,
      );
      await tester.tap(manageBilling);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(launcher.opened, [purchases.portalUrl]);
    });

    testWidgets('says when a canceled plan ends', (tester) async {
      purchases.subscription = subscription(cancelAtPeriodEnd: true);
      await pumpAccount(tester);

      expect(
        find.text('Ends on Dec 1, 2026. You can keep reading until then.'),
        findsOneWidget,
      );
    });

    testWidgets('says a payment is to be fixed, and that a plan is over', (
      tester,
    ) async {
      purchases.subscription = subscription(status: SubscriptionStatus.pastDue);
      await pumpAccount(tester);

      expect(
        find.text(
          'Your last payment did not go through. Update your payment method '
          'to keep reading.',
        ),
        findsOneWidget,
      );
      // Billing is where the payment method is updated.
      expect(manageBilling, findsOneWidget);

      purchases.subscription = subscription(
        status: SubscriptionStatus.canceled,
      );
      // The tab stays mounted while another is on screen, and coming back to
      // it reads the plan again.
      await tester.tap(find.byKey(const ValueKey('tab-library')));
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byKey(const ValueKey('tab-account')));
      await pumpUntilFound(tester, find.text('This plan has ended.'));
    });

    testWidgets('offers no billing where the app sells through the store', (
      tester,
    ) async {
      purchases
        ..route = AppPurchaseRoute.store
        ..subscription = subscription();
      await pumpAccount(tester);

      expect(find.text('Renews on Dec 1, 2026.'), findsOneWidget);
      expect(manageBilling, findsNothing);
    });

    testWidgets('sends a plan a store bills to that store', (tester) async {
      purchases.subscription = subscription(store: InAppPurchaseStore.appStore);
      await pumpAccount(tester);

      expect(
        find.text(
          'You subscribed through the App Store. Change or cancel the plan '
          'there.',
        ),
        findsOneWidget,
      );
      expect(manageBilling, findsNothing);
    });

    testWidgets('shows nothing to a reader who has never subscribed', (
      tester,
    ) async {
      await pumpAccount(tester);

      expect(purchases.subscriptionReads, 1);
      expect(find.text('Your plan'), findsNothing);
    });

    testWidgets('reads a plan that could not be read again on retry', (
      tester,
    ) async {
      purchases.subscriptionFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );
      await pumpAccount(tester);

      expect(find.text('Could not load your plan.'), findsOneWidget);
      purchases
        ..subscriptionFailure = null
        ..subscription = subscription();
      await tester.tap(find.byKey(const ValueKey('account-plan-retry')));
      await pumpUntilFound(tester, plan);

      expect(find.text('Could not load your plan.'), findsNothing);
    });

    testWidgets('says so when the tenant has no billing to open', (
      tester,
    ) async {
      purchases
        ..subscription = subscription()
        ..portalFailure = const PurchaseFailure(PurchaseFailureKind.notSold);
      await pumpAccount(tester);

      await tester.tap(manageBilling);
      await pumpUntilFound(
        tester,
        find.text('Billing cannot be managed on this site at the moment.'),
      );
      expect(launcher.opened, isEmpty);
    });

    testWidgets(
      'reads the plan again when the reader comes back from billing',
      (tester) async {
        purchases.subscription = subscription();
        await pumpAccount(tester);
        await tester.tap(manageBilling);
        await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

        purchases.subscription = subscription(cancelAtPeriodEnd: true);
        tester.binding
          ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
          ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await pumpUntilFound(
          tester,
          find.text('Ends on Dec 1, 2026. You can keep reading until then.'),
        );
        expect(purchases.subscriptionReads, 2);
      },
    );
  });
}
