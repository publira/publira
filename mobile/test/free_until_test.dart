import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/pump_until.dart';
import 'support/fake_purchase.dart';

void main() {
  final series = fixtureSeries.first;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final rowBadge = find.byKey(ValueKey('episode-free-until-$paidEpisodeId'));

  /// The end the API reports for a window the free-after-publication rule
  /// opened, decoded the way the catalog repository decodes it.
  final ruleFreeUntil = DateTime.parse('9999-12-31T00:00:00Z').toLocal();

  late FakeCatalogRepository catalog;
  late FakeIncomingLinks incoming;

  /// The fixture series with a free window on its paid episode closing at
  /// [freeUntil].
  SeriesDetail windowed(DateTime freeUntil) {
    final detail = fixtureDetail(series);
    return SeriesDetail(
      series: detail.series,
      episodes: [
        for (final episode in detail.episodes)
          episode.id == paidEpisodeId
              ? EpisodeItem(
                  id: episode.id,
                  internalId: episode.internalId,
                  title: episode.title,
                  orderIndex: episode.orderIndex,
                  price: episode.price,
                  freeUntil: freeUntil,
                )
              : episode,
      ],
    );
  }

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    incoming = FakeIncomingLinks();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(WidgetTester tester, String location) async {
    tester.view
      ..physicalSize = const Size(400, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: location),
        catalog: catalog,
        auth: fakeAuthController(),
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
        // A tenant that sells nothing in the app still prices its episodes,
        // in the currency the purchases read answers.
        purchases: FakePurchaseRepository(payments: false),
        checkoutLauncher: FakeCheckoutLauncher(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('an episode row says until when a window keeps it free', (
    tester,
  ) async {
    final freeUntil = DateTime.now().add(const Duration(days: 3));
    catalog.details[series.id] = windowed(freeUntil);
    await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
    await pumpUntilFound(tester, rowBadge);

    expect(
      find.descendant(
        of: rowBadge,
        matching: find.textContaining('Free until '),
      ),
      findsOneWidget,
    );
    // Nobody is charged the price while the window is open.
    expect(find.text('¥500'), findsNothing);
  });

  testWidgets('an episode row says only that the free-after rule opened it', (
    tester,
  ) async {
    catalog.details[series.id] = windowed(ruleFreeUntil);
    await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
    await pumpUntilFound(tester, rowBadge);

    expect(
      find.descendant(of: rowBadge, matching: find.text('Free')),
      findsOneWidget,
    );
    expect(find.textContaining('Free until '), findsNothing);
    expect(find.text('¥500'), findsNothing);
  });

  testWidgets('a window that closes while the screen is open prices the row', (
    tester,
  ) async {
    final freeUntil = DateTime.now().add(const Duration(seconds: 2));
    catalog.details[series.id] = windowed(freeUntil);
    await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
    await pumpUntilFound(tester, rowBadge);

    // The rows are drawn against the wall clock, so it has to pass the close
    // too, not only the test's timers.
    await tester.runAsync(
      () => Future<void>.delayed(
        freeUntil.difference(DateTime.now()) + const Duration(milliseconds: 50),
      ),
    );
    await tester.pump(const Duration(seconds: 3));

    expect(rowBadge, findsNothing);
    expect(find.text('¥500'), findsOneWidget);
  });

  testWidgets('a window that has closed leaves the row priced', (tester) async {
    catalog.details[series.id] = windowed(
      DateTime.now().subtract(const Duration(minutes: 1)),
    );
    await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
    await pumpUntilFound(tester, find.text('¥500'));

    expect(rowBadge, findsNothing);
  });

  /// Opens the paid episode, age-restricted for a guest, with its free window
  /// closing at [freeUntil].
  Future<void> pumpAgeGate(WidgetTester tester, DateTime freeUntil) async {
    final key = episodeKey(series.id, paidEpisodeId);
    final body = fixtureEpisodes(access: EpisodeAccess.ageRestricted)[key]!;
    catalog.episodes[key] = EpisodeDetail(
      episode: windowed(freeUntil).episodes.last,
      seriesId: body.seriesId,
      seriesTitle: body.seriesTitle,
      access: body.access,
      images: const [],
      previewImages: body.previewImages,
    );
    await pumpApp(
      tester,
      AppRoutes.episodeViewerPath(series.id, paidEpisodeId),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-age-restricted')),
    );
  }

  const gateBadge = ValueKey('episode-free-until');

  testWidgets('the age gate tells a guest the episode is free for now', (
    tester,
  ) async {
    await pumpAgeGate(tester, DateTime.now().add(const Duration(days: 3)));

    expect(
      find.descendant(
        of: find.byKey(gateBadge),
        matching: find.textContaining('Free until '),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the age gate says only that the free-after rule opened it', (
    tester,
  ) async {
    await pumpAgeGate(tester, ruleFreeUntil);

    expect(
      find.descendant(of: find.byKey(gateBadge), matching: find.text('Free')),
      findsOneWidget,
    );
    expect(find.textContaining('Free until '), findsNothing);
  });
}
