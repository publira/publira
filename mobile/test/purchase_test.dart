import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/episode_viewer_screen.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/fake_purchase.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '$seriesId-ep-${fixtureSeries.first.episodeCount}';
  final freeEpisodeId = '$seriesId-ep-1';
  final viewerPath = AppRoutes.episodeViewerPath(seriesId, paidEpisodeId);

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final confirming = find.byKey(const ValueKey('episode-purchase-confirming'));

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

  Future<void> signIn(WidgetTester tester) async {
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('sign-in-submit')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('sign-in-email')),
      'member@example.com',
    );
    await tester.enterText(
      find.byKey(const ValueKey('sign-in-password')),
      'memberpass',
    );
    await tester.tap(find.byKey(const ValueKey('sign-in-submit')));
  }

  group('a locked episode', () {
    testWidgets('hands its checkout to the browser', (tester) async {
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(find.text('Buy for ¥500'), findsOneWidget);
      await tester.tap(buy);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);

      expect(purchases.checkouts, [paidEpisodeId]);
      expect(launcher.opened, [
        FakePurchaseRepository.checkoutUrlFor(paidEpisodeId),
      ]);
    });

    testWidgets('offers no purchase where the tenant takes no payments', (
      tester,
    ) async {
      purchases.payments = false;
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, locked);
      await tester.pump(const Duration(milliseconds: 50));

      expect(buy, findsNothing);
      expect(
        find.text('This episode can be read once it is purchased.'),
        findsOneWidget,
      );
    });

    testWidgets('sends a guest to sign in and back to the episode', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilRouteSettled(tester, buy);

      await tester.tap(buy);
      await signIn(tester);
      await pumpUntilRouteSettled(tester, buy);

      expect(router.routerDelegate.currentConfiguration.uri.path, viewerPath);
      expect(purchases.checkouts, isEmpty);
    });

    testWidgets('opens once a purchase the reader already holds is found', (
      tester,
    ) async {
      purchases.checkoutFailure = const PurchaseFailure(
        PurchaseFailureKind.alreadyPurchased,
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      await tester.tap(buy);
      await pumpUntilFound(tester, pages);

      expect(launcher.opened, isEmpty);
    });

    testWidgets('says so when the checkout could not start', (tester) async {
      purchases.checkoutFailure = const PurchaseFailure(
        PurchaseFailureKind.unexpected,
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilFound(
        tester,
        find.text('Could not start the purchase. Try again later.'),
      );
      expect(launcher.opened, isEmpty);
    });
  });

  group('the return from the browser', () {
    Uri returnLink(String status, {String? episodeId}) => Uri.parse(
      'https://localhost/checkout/return'
      '?episode=${episodeId ?? paidEpisodeId}&status=$status',
    );

    testWidgets('opens the body once the purchase is recorded', (tester) async {
      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      incoming.initialUri = returnLink('success');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, pages);

      expect(router.routerDelegate.currentConfiguration.uri.path, viewerPath);
    });

    testWidgets('reads again while the webhook has not landed yet', (
      tester,
    ) async {
      incoming.initialUri = returnLink('success');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-viewer-loading')),
      );

      // Recorded between the first read and the first re-read.
      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      await tester.pump(checkoutConfirmationDelays.first);
      await pumpUntilFound(tester, pages);

      expect(confirming, findsNothing);
    });

    testWidgets('says the purchase is being confirmed after two re-reads', (
      tester,
    ) async {
      incoming.initialUri = returnLink('success');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-viewer-loading')),
      );
      for (final delay in checkoutConfirmationDelays) {
        expect(confirming, findsNothing);
        await tester.pump(delay);
      }
      await pumpUntilFound(tester, confirming);
      expect(
        find.text(
          'We are confirming your payment. The episode opens once the '
          'purchase is applied.',
        ),
        findsOneWidget,
      );

      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      await tester.tap(
        find.byKey(const ValueKey('episode-purchase-check-again')),
      );
      await pumpUntilFound(tester, pages);
    });

    testWidgets('a cancelled checkout offers the purchase again', (
      tester,
    ) async {
      incoming.initialUri = returnLink('cancelled');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, buy);

      expect(
        find.text('The purchase was cancelled. You have not been charged.'),
        findsOneWidget,
      );
      expect(confirming, findsNothing);
    });

    testWidgets('a second return link opens its own episode', (tester) async {
      final otherSeriesId = fixtureSeries.last.id;
      final otherEpisodeId =
          '$otherSeriesId-ep-${fixtureSeries.last.episodeCount}';
      purchases.seriesByEpisode = {
        paidEpisodeId: seriesId,
        otherEpisodeId: otherSeriesId,
      };
      final gate = Completer<void>();
      purchases.seriesGate = gate;
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, locked);

      incoming.deliver(returnLink('cancelled'));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('checkout-return-loading')),
      );
      incoming.deliver(returnLink('cancelled', episodeId: otherEpisodeId));
      await tester.pump();
      gate.complete();

      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('episode-buy-$otherEpisodeId')),
      );
      expect(
        find.text(
          '${fixtureSeries.last.title} #${fixtureSeries.last.episodeCount}',
        ),
        findsOneWidget,
      );
    });

    testWidgets('an episode that is not public any more says so', (
      tester,
    ) async {
      incoming.initialUri = returnLink('success', episodeId: 'gone');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('checkout-return-error')),
      );

      expect(find.text('Episode not found (gone)'), findsOneWidget);
    });

    testWidgets('an unreachable API offers a retry', (tester) async {
      purchases.seriesFailure = const PurchaseFailure(
        PurchaseFailureKind.network,
      );
      incoming.initialUri = returnLink('success');
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('checkout-return-error')),
      );

      catalog.episodes = fixtureEpisodes(access: EpisodeAccess.entitled);
      purchases.seriesFailure = null;
      await tester.tap(find.text('Retry'));
      await pumpUntilFound(tester, pages);
    });
  });

  group('an episode sold on the website alone', () {
    const soldOnWeb = 'Sold on the website';

    setUp(() {
      catalog
        ..details = fixtureDetails(paidSurface: EpisodePurchaseSurface.web)
        ..episodes = fixtureEpisodes(
          access: EpisodeAccess.locked,
          paidSurface: EpisodePurchaseSurface.web,
        );
    });

    testWidgets('says where it is sold in place of a purchase', (tester) async {
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.text(
          'This episode is sold on the website. Once bought there, it can '
          'be read here with the same account.',
        ),
      );

      expect(buy, findsNothing);
      expect(find.textContaining('¥'), findsNothing);
    });

    testWidgets('opens for a guest who bought it there once signed in', (
      tester,
    ) async {
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.text(
          'This episode is sold on the website. If you have already bought '
          'it there, sign in.',
        ),
      );
      expect(buy, findsNothing);

      catalog.episodes = fixtureEpisodes(
        access: EpisodeAccess.entitled,
        paidSurface: EpisodePurchaseSurface.web,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await signIn(tester);
      await pumpUntilRouteSettled(tester, pages);

      expect(router.routerDelegate.currentConfiguration.uri.path, viewerPath);
    });

    testWidgets('is named as sold there on the episode list', (tester) async {
      purchases.access = {paidEpisodeId: EpisodeAccess.locked};
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(seriesId),
        session: fakeSession,
      );
      final row = find.byKey(ValueKey('episode-tile-$paidEpisodeId'));
      await pumpUntilFound(
        tester,
        find.descendant(of: row, matching: find.text(soldOnWeb)),
      );

      expect(buy, findsNothing);
      expect(find.text('¥500'), findsNothing);
    });

    testWidgets('keeps its price where the tenant takes no payments', (
      tester,
    ) async {
      purchases
        ..payments = false
        ..access = {paidEpisodeId: EpisodeAccess.locked};
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(seriesId),
        session: fakeSession,
      );
      await pumpUntilFound(tester, find.text('¥500'));
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text(soldOnWeb), findsNothing);
    });

    testWidgets('is named as sold there at the end of the one before it', (
      tester,
    ) async {
      final previousEpisodeId =
          '$seriesId-ep-${fixtureSeries.first.episodeCount - 1}';
      catalog.episodes = fixtureEpisodes(
        paidSurface: EpisodePurchaseSurface.web,
      );
      await pumpApp(
        tester,
        initialLocation: AppRoutes.episodeViewerPath(
          seriesId,
          previousEpisodeId,
        ),
        session: fakeSession,
      );
      await pumpUntilFound(tester, pages);
      for (var turn = 0; turn < 3; turn++) {
        await tester.tap(find.byKey(const ValueKey('episode-next-page')));
        await pumpUntilNoPendingFrameCallbacks(tester);
      }
      final next = find.byKey(const ValueKey('episode-end-next'));
      await pumpUntilFound(
        tester,
        find.descendant(of: next, matching: find.text(soldOnWeb)),
      );

      expect(
        find.descendant(of: next, matching: find.text('¥500')),
        findsNothing,
      );
      await pumpUntilNoPendingFrameCallbacks(tester);
    });
  });

  group('the episode list', () {
    final seriesPath = AppRoutes.seriesDetailPath(seriesId);

    testWidgets('offers a purchase on the episodes the reader would buy', (
      tester,
    ) async {
      purchases.access = {
        freeEpisodeId: EpisodeAccess.free,
        paidEpisodeId: EpisodeAccess.locked,
      };
      await pumpApp(tester, initialLocation: seriesPath, session: fakeSession);
      await pumpUntilFound(tester, buy);

      await tester.tap(buy);
      await pumpUntilTrue(tester, () => launcher.opened.isNotEmpty);
      expect(purchases.checkouts, [paidEpisodeId]);
    });

    testWidgets('names the price of an episode the reader already holds', (
      tester,
    ) async {
      purchases.access = {paidEpisodeId: EpisodeAccess.entitled};
      await pumpApp(tester, initialLocation: seriesPath, session: fakeSession);
      await pumpUntilFound(tester, find.text('¥500'));
      await tester.pump(const Duration(milliseconds: 50));

      expect(buy, findsNothing);
    });

    testWidgets('lands a guest on the episode once signed in', (tester) async {
      purchases.access = {paidEpisodeId: EpisodeAccess.locked};
      await pumpApp(tester, initialLocation: seriesPath);
      await pumpUntilRouteSettled(tester, buy);

      await tester.tap(buy);
      await signIn(tester);
      await pumpUntilRouteSettled(tester, locked);

      // The series stays behind the episode rather than the form.
      router.pop();
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('series-detail-body')),
      );
    });
  });
}
