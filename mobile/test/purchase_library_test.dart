import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';

  MyPurchase purchase(
    String id, {
    bool isActive = true,
    DateTime? expiresAt,
    String? episodeTitle,
  }) => MyPurchase(
    id: id,
    seriesId: series.id,
    seriesTitle: series.title,
    episodeId: paidEpisodeId,
    episodeTitle: episodeTitle ?? 'The paid episode',
    orderIndex: series.episodeCount,
    price: 500,
    isActive: isActive,
    purchasedAt: DateTime.utc(2026, 1, 10, 12),
    expiresAt: expiresAt,
  );

  late GoRouter router;
  late FakePurchaseRepository purchases;

  setUp(() {
    purchases = FakePurchaseRepository();
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    required String initialLocation,
    AuthSession? session = fakeSession,
    bool withPurchases = true,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: fakeAuthController(session: session),
        purchases: withPurchases ? purchases : null,
        checkoutLauncher: withPurchases ? FakeCheckoutLauncher() : null,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> openPurchases(
    WidgetTester tester, {
    AuthSession? session = fakeSession,
  }) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.accountPurchases,
      session: session,
    );
    await pumpUntilRouteSettled(tester, find.text('Purchases'));
  }

  group('the account screen', () {
    testWidgets('leads a signed-in reader to their purchases', (tester) async {
      purchases.pages = [
        [purchase('purchase-1')],
      ];
      await pumpApp(tester, initialLocation: AppRoutes.account);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('account-purchases')),
      );

      await tester.tap(find.byKey(const ValueKey('account-purchases')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-1')),
      );

      expect(router.state.uri.path, AppRoutes.accountPurchases);
    });

    testWidgets('offers no purchases in a build that sells nothing', (
      tester,
    ) async {
      await pumpApp(
        tester,
        initialLocation: AppRoutes.account,
        withPurchases: false,
      );
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('account-list')),
      );

      expect(find.byKey(const ValueKey('account-purchases')), findsNothing);
    });
  });

  group('the purchase library', () {
    testWidgets('tells a readable purchase from an expired one', (
      tester,
    ) async {
      purchases.pages = [
        [
          purchase('purchase-active', episodeTitle: 'Still open'),
          purchase(
            'purchase-expired',
            isActive: false,
            expiresAt: DateTime.utc(2026, 1, 13, 12),
            episodeTitle: 'Rental ended',
          ),
        ],
      ];
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-list')),
      );

      final active = find.byKey(const ValueKey('purchase-row-purchase-active'));
      final expired = find.byKey(
        const ValueKey('purchase-row-purchase-expired'),
      );
      expect(
        find.descendant(of: active, matching: find.text('Readable')),
        findsOne,
      );
      expect(
        find.descendant(of: active, matching: find.textContaining('No expiry')),
        findsOne,
      );
      expect(
        find.descendant(of: expired, matching: find.text('Expired')),
        findsOne,
      );
      expect(
        find.descendant(of: expired, matching: find.textContaining('Ended ')),
        findsOne,
      );
      expect(
        find.descendant(of: active, matching: find.textContaining('Paid ¥500')),
        findsOne,
      );
    });

    testWidgets('names the date a readable rental ends', (tester) async {
      purchases.pages = [
        [purchase('purchase-rental', expiresAt: DateTime.utc(2099, 1, 1))],
      ];
      await openPurchases(tester);
      await pumpUntilFound(tester, find.textContaining('Readable until '));
    });

    testWidgets('opens the episode a row stands for', (tester) async {
      purchases.pages = [
        [purchase('purchase-1')],
      ];
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-1')),
      );

      await tester.tap(find.byKey(const ValueKey('purchase-row-purchase-1')));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('episode-page-view')),
      );

      expect(
        router.state.uri.path,
        AppTab.account.locate(
          AppRoutes.episodeViewerPath(series.id, paidEpisodeId),
        ),
      );
    });

    testWidgets('reads the page under it as the reader nears the end', (
      tester,
    ) async {
      purchases.pages = [
        [for (var index = 0; index < 20; index++) purchase('page-1-$index')],
        [purchase('page-2-0')],
      ];
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-list')),
      );

      await tester.fling(
        find.byKey(const ValueKey('purchases-list')),
        const Offset(0, -4000),
        1000,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-page-2-0')),
      );
    });

    testWidgets('tells a reader who bought nothing so', (tester) async {
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-empty')),
      );

      expect(find.byKey(const ValueKey('purchases-list')), findsNothing);
    });

    testWidgets('offers a retry after a page it could not read', (
      tester,
    ) async {
      purchases
        ..pages = [
          [purchase('purchase-1')],
        ]
        ..listFailure = const PurchaseFailure(PurchaseFailureKind.network);
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-error')),
      );

      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOne,
      );

      purchases.listFailure = null;
      await tester.tap(find.byKey(const ValueKey('purchases-retry')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-1')),
      );
    });

    testWidgets('sends a reader whose session was refused to sign in', (
      tester,
    ) async {
      purchases.listFailure = const PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
      );
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-error')),
      );

      expect(find.byKey(const ValueKey('purchases-retry')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('purchases-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

      expect(router.state.uri.path, AppTab.account.locate(AppRoutes.signIn));
    });

    testWidgets('gives the whole screen to a session refused on a later page', (
      tester,
    ) async {
      purchases
        ..pages = [
          [for (var index = 0; index < 20; index++) purchase('page-1-$index')],
          [purchase('page-2-0')],
        ]
        ..moreFailure = const PurchaseFailure(
          PurchaseFailureKind.sessionExpired,
        );
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-list')),
      );

      await tester.fling(
        find.byKey(const ValueKey('purchases-list')),
        const Offset(0, -4000),
        1000,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-error')),
      );

      expect(find.byKey(const ValueKey('purchases-list')), findsNothing);
      expect(find.byKey(const ValueKey('purchases-sign-in')), findsOne);
    });

    testWidgets('reads the list again when the reader pulls it down', (
      tester,
    ) async {
      purchases.pages = [
        [purchase('purchase-1')],
      ];
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-1')),
      );

      purchases.pages = [
        [purchase('purchase-2'), purchase('purchase-1')],
      ];
      await tester.fling(
        find.byKey(const ValueKey('purchases-list')),
        const Offset(0, 400),
        1000,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-2')),
      );
    });

    testWidgets('reads an empty list again when the reader pulls it down', (
      tester,
    ) async {
      await openPurchases(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-empty')),
      );

      purchases.pages = [
        [purchase('purchase-1')],
      ];
      await tester.fling(
        find.byKey(const ValueKey('purchases-empty')),
        const Offset(0, 400),
        1000,
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchase-row-purchase-1')),
      );
    });

    testWidgets('asks a reader who is signed out to sign in', (tester) async {
      await openPurchases(tester, session: null);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('purchases-signed-out')),
      );

      await tester.tap(find.byKey(const ValueKey('purchases-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

      expect(router.state.uri.path, AppTab.account.locate(AppRoutes.signIn));
    });
  });
}
