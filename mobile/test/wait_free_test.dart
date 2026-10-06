import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/localizations.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';
import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_offer.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/fake_purchase.dart';
import 'support/fake_wait_free.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final paidInternalId = fixtureInternalId(paidEpisodeId);
  final viewerPath = AppRoutes.episodeViewerPath(series.id, paidEpisodeId);

  final locked = find.byKey(const ValueKey('episode-locked'));
  final pages = find.byKey(const ValueKey('episode-page-view'));
  final use = find.byKey(const ValueKey('episode-wait-free-use'));
  final buy = find.byKey(ValueKey('episode-buy-$paidEpisodeId'));
  final ready = find.byKey(const ValueKey('wait-free-ready'));
  final recharging = find.byKey(const ValueKey('wait-free-recharging'));

  late FakeCatalogRepository catalog;
  late FakeWaitFreeRepository waitFree;
  late FakePurchaseRepository purchases;
  late FakeIncomingLinks incoming;

  /// The fixture series offering wait-for-free, with [excluded] kept off it.
  void offerWaitFree({Set<String> excluded = const {}}) {
    final detail = fixtureDetail(series);
    catalog.details[series.id] = SeriesDetail(
      series: detail.series,
      episodes: detail.episodes,
      waitFree: WaitFreeRule(
        rechargeHours: 23,
        accessHours: 72,
        excludedEpisodeIds: excluded,
      ),
    );
  }

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(access: EpisodeAccess.locked),
    );
    waitFree = FakeWaitFreeRepository();
    purchases = FakePurchaseRepository();
    // The API answers the episode as the reader's once a ticket opened it.
    waitFree.onUsed = (_) {
      catalog.episodes[episodeKey(series.id, paidEpisodeId)] = fixtureEpisodes(
        access: EpisodeAccess.entitled,
        entitlementSource: EpisodeEntitlementSource.accessTicket,
      )[episodeKey(series.id, paidEpisodeId)]!;
    };
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    String? location,
  }) async {
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: location ?? viewerPath),
        catalog: catalog,
        auth: fakeAuthController(session: session),
        purchases: purchases,
        checkoutLauncher: FakeCheckoutLauncher(),
        waitFree: waitFree,
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('a locked episode of a series offering wait-for-free', () {
    testWidgets('opens with the reader\'s ready ticket', (tester) async {
      offerWaitFree();
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, use);

      expect(ready, findsOneWidget);
      expect(
        find.textContaining('Your free ticket for this series is ready.'),
        findsOneWidget,
      );
      expect(waitFree.stateReads, [series.internalId]);
      // The ticket opens it for nothing, so it is offered before the price.
      expect(tester.getTopLeft(use).dx, lessThan(tester.getTopLeft(buy).dx));

      await tester.tap(use);
      await pumpUntilFound(tester, pages);

      expect(waitFree.used, [paidInternalId]);
      expect(locked, findsNothing);
    });

    testWidgets('counts down to the reader\'s next ticket', (tester) async {
      offerWaitFree();
      waitFree.state = WaitFreeTicketState(
        nextAvailableAt: DateTime.now().add(
          const Duration(hours: 5, minutes: 3, seconds: 30),
        ),
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, recharging);

      expect(
        find.textContaining('Your next free ticket is ready in 5:0'),
        findsOneWidget,
      );
      expect(use, findsNothing);
      expect(buy, findsOneWidget);
    });

    testWidgets('says a ticket cannot open one of the latest episodes', (
      tester,
    ) async {
      offerWaitFree(excluded: {paidInternalId});
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('wait-free-excluded')),
      );

      expect(use, findsNothing);
      // Nothing about this reader could change that, so nothing is asked.
      expect(waitFree.stateReads, isEmpty);
    });

    testWidgets('asks a guest to sign in for a ticket', (tester) async {
      offerWaitFree();
      await pumpApp(tester);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('wait-free-guest')),
      );

      expect(use, findsNothing);
      expect(waitFree.stateReads, isEmpty);
    });

    testWidgets('says so when the reader\'s ticket cannot be checked', (
      tester,
    ) async {
      offerWaitFree();
      waitFree.stateFailure = const WaitFreeFailure(
        WaitFreeFailureKind.network,
      );
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('wait-free-unavailable')),
      );

      expect(use, findsNothing);
      expect(buy, findsOneWidget);
    });

    testWidgets('reads the reader\'s standing again after a refusal', (
      tester,
    ) async {
      offerWaitFree();
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, use);

      // The ticket was spent somewhere else since the gate was drawn.
      waitFree
        ..useFailure = const WaitFreeFailure(WaitFreeFailureKind.notRecharged)
        ..state = WaitFreeTicketState(
          nextAvailableAt: DateTime.now().add(const Duration(hours: 22)),
        );
      await tester.tap(use);
      await pumpUntilFound(tester, recharging);

      expect(waitFree.stateReads, hasLength(2));
      expect(use, findsNothing);
    });

    testWidgets('says so when a ticket could not be used', (tester) async {
      offerWaitFree();
      await pumpApp(tester, session: fakeSession);
      await pumpUntilFound(tester, use);

      waitFree.useFailure = const WaitFreeFailure(
        WaitFreeFailureKind.tooManyRequests,
      );
      await tester.tap(use);
      await pumpUntilFound(
        tester,
        find.text('Your free ticket could not be used. Try again in a moment.'),
      );

      expect(use, findsOneWidget);
      expect(locked, findsOneWidget);
    });
  });

  testWidgets('the series screen offers no purchase of an episode a ticket '
      'opened', (tester) async {
    offerWaitFree();
    purchases.access = {paidEpisodeId: EpisodeAccess.locked};
    final previous = waitFree.onUsed!;
    waitFree.onUsed = (id) {
      previous(id);
      purchases.access = {paidEpisodeId: EpisodeAccess.entitled};
    };
    await pumpApp(
      tester,
      session: fakeSession,
      location: AppRoutes.seriesDetailPath(series.id),
    );
    await pumpUntilFound(tester, buy);

    final title = find.text('${series.title} #${series.episodeCount}');
    await tester.ensureVisible(title);
    await tester.pumpAndSettle();
    await tester.tap(title);
    await pumpUntilFound(tester, use);
    await tester.tap(use);
    await pumpUntilFound(tester, pages);
    await tester.pageBack();
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-tile-$paidEpisodeId')),
    );
    await pumpUntilTrue(tester, () => buy.evaluate().isEmpty);
  });

  testWidgets('a read of the series screen\'s access that answers late is '
      'not shown', (tester) async {
    offerWaitFree();
    // The read the screen opens with is still out when the reader comes back
    // from opening the episode with a ticket.
    final opening = Completer<void>();
    purchases
      ..access = {paidEpisodeId: EpisodeAccess.locked}
      ..accessGate = opening;
    final previous = waitFree.onUsed!;
    waitFree.onUsed = (id) {
      previous(id);
      purchases
        ..access = {paidEpisodeId: EpisodeAccess.entitled}
        ..accessGate = null;
    };
    await pumpApp(
      tester,
      session: fakeSession,
      location: AppRoutes.seriesDetailPath(series.id),
    );
    final title = find.text('${series.title} #${series.episodeCount}');
    await pumpUntilFound(tester, title);
    await tester.ensureVisible(title);
    await tester.pumpAndSettle();
    await tester.tap(title);
    await pumpUntilFound(tester, use);
    await tester.tap(use);
    await pumpUntilFound(tester, pages);
    await tester.pageBack();
    await pumpUntilFound(tester, title);
    await tester.pump(const Duration(milliseconds: 100));

    opening.complete();
    await tester.pump(const Duration(milliseconds: 100));

    expect(buy, findsNothing);
  });

  testWidgets('a series without wait-for-free says nothing of tickets', (
    tester,
  ) async {
    await pumpApp(tester, session: fakeSession);
    await pumpUntilFound(tester, buy);

    expect(use, findsNothing);
    expect(ready, findsNothing);
    expect(waitFree.stateReads, isEmpty);
  });

  testWidgets('the countdown reads the clock and hands over once ready', (
    tester,
  ) async {
    var now = DateTime.utc(2026, 10, 5, 12);
    var recharged = 0;
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: appLocalizationsDelegates,
        supportedLocales: AppMessages.supportedLocales,
        home: Scaffold(
          body: WaitFreeNotice(
            offer: WaitFreeRecharging(
              nextAvailableAt: DateTime.utc(2026, 10, 5, 12, 0, 2),
            ),
            onRecharged: () => recharged++,
            now: () => now,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.textContaining('0:00:02'), findsOneWidget);

    now = now.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(find.textContaining('0:00:01'), findsOneWidget);
    expect(recharged, 0);

    now = now.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 3));
    expect(recharged, 1);
  });

  test('a countdown is written as a clock whose hours run past a day', () {
    expect(formatCountdown(Duration.zero), '0:00:00');
    expect(
      formatCountdown(const Duration(hours: 5, minutes: 3, seconds: 7)),
      '5:03:07',
    );
    expect(formatCountdown(const Duration(hours: 30)), '30:00:00');
    expect(formatCountdown(const Duration(seconds: -4)), '0:00:00');
  });
}
