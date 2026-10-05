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

void main() {
  final series = fixtureSeries.first;

  /// The fixture series' last episode, the one that costs something.
  final paidEpisodeId = '${series.id}-ep-${series.episodeCount}';
  final rowBadge = find.byKey(ValueKey('episode-free-until-$paidEpisodeId'));

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

  testWidgets('a window that has closed leaves the row priced', (tester) async {
    catalog.details[series.id] = windowed(
      DateTime.now().subtract(const Duration(minutes: 1)),
    );
    await pumpApp(tester, AppRoutes.seriesDetailPath(series.id));
    await pumpUntilFound(tester, find.text('¥500'));

    expect(rowBadge, findsNothing);
  });

  testWidgets('the age gate tells a guest the episode is free for now', (
    tester,
  ) async {
    final key = episodeKey(series.id, paidEpisodeId);
    final body = fixtureEpisodes(access: EpisodeAccess.ageRestricted)[key]!;
    catalog.episodes[key] = EpisodeDetail(
      episode: windowed(
        DateTime.now().add(const Duration(days: 3)),
      ).episodes.last,
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

    expect(find.byKey(const ValueKey('episode-free-until')), findsOneWidget);
  });
}
