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
}
