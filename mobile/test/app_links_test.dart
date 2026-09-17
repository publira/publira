import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeIncomingLinks incoming;
  late FakeShareSheet share;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    incoming = FakeIncomingLinks();
    share = FakeShareSheet();
    addTearDown(incoming.close);
  });

  Future<void> pumpApp(
    WidgetTester tester, {
    String initialLocation = AppRoutes.catalog,
    ValueNotifier<String?>? tenantDefaultLocale,
  }) async {
    router = createAppRouter(initialLocation: initialLocation);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        site: const PublicSite(host: 'localhost'),
        incomingLinks: incoming,
        share: share,
        tenantDefaultLocale: tenantDefaultLocale,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('a series link opens the series', (tester) async {
    incoming.initialUri = Uri.parse('https://localhost/series/$seriesId');
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(find.text(fixtureSeries.first.title), findsWidgets);
    expect(
      router.routerDelegate.currentConfiguration.uri.path,
      '/series/$seriesId',
    );
  });

  testWidgets('an episode link opens the viewer on top of its series', (
    tester,
  ) async {
    incoming.initialUri = Uri.parse(
      'https://localhost/series/$seriesId/episodes/$episodeId',
    );
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-page-view')),
    );

    expect(find.text('${fixtureSeries.first.title} #1'), findsOneWidget);
  });

  testWidgets('a locale-prefixed series link opens the same series', (
    tester,
  ) async {
    incoming.initialUri = Uri.parse('https://localhost/en/series/$seriesId');
    await pumpApp(tester);
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(find.text(fixtureSeries.first.title), findsWidgets);
  });

  testWidgets('a link that arrives while the app is open replaces the stack', (
    tester,
  ) async {
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    incoming.deliver(Uri.parse('https://localhost/series/$seriesId'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(find.text('Episodes'), findsOneWidget);
  });

  testWidgets('a runtime link still opens after the initial lookup fails', (
    tester,
  ) async {
    incoming.initialError = Exception('platform lookup failed');
    await pumpApp(tester);

    incoming.deliver(Uri.parse('https://localhost/series/$seriesId'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(find.text(fixtureSeries.first.title), findsWidgets);
  });

  testWidgets('a checkout return lands on the catalog', (tester) async {
    incoming.initialUri = Uri.parse(
      'https://localhost/checkout/return?episode=$episodeId&status=success',
    );
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.byKey(const ValueKey('series-detail-body')), findsNothing);
  });

  testWidgets('a host this build is not pinned to is ignored', (tester) async {
    incoming.initialUri = Uri.parse('https://other.example/series/$seriesId');
    await pumpApp(tester);
    await pumpUntilFound(tester, find.text(fixtureSeries.first.title));

    expect(find.byKey(const ValueKey('series-detail-body')), findsNothing);
  });

  testWidgets('sharing a series hands over the canonical site URL', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('series-share')));

    await tester.tap(find.byKey(const ValueKey('series-share')));
    await tester.pump();

    expect(share.calls, 1);
    expect(share.title, fixtureSeries.first.title);
    expect(share.url, Uri.parse('https://localhost/series/$seriesId'));
    expect(
      share.text,
      'Seed Series 001 by Seed Author 001, Seed Author 002, and Seed Author 003',
    );
  });

  testWidgets('sharing an episode names the series and points at the episode', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.episodeViewerPath(seriesId, episodeId),
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('episode-share')));

    await tester.tap(find.byKey(const ValueKey('episode-share')));
    await tester.pump();

    expect(share.calls, 1);
    expect(share.title, '${fixtureSeries.first.title} #1');
    expect(
      share.url,
      Uri.parse('https://localhost/series/$seriesId/episodes/$episodeId'),
    );
    expect(share.text, startsWith('Seed Series 001'));
  });

  testWidgets('a non-default locale prefixes the shared URL', (tester) async {
    final tenantDefaultLocale = ValueNotifier<String?>('ja');
    addTearDown(tenantDefaultLocale.dispose);
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
      tenantDefaultLocale: tenantDefaultLocale,
    );
    await pumpUntilFound(tester, find.byKey(const ValueKey('series-share')));

    await tester.tap(find.byKey(const ValueKey('series-share')));
    await tester.pump();

    expect(share.url, Uri.parse('https://localhost/en/series/$seriesId'));
  });

  testWidgets('the share action is absent when this run has no share sheet', (
    tester,
  ) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(seriesId),
    );
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(),
        site: const PublicSite(host: 'localhost'),
      ),
    );
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('series-detail-body')),
    );

    expect(find.byKey(const ValueKey('series-share')), findsNothing);
  });
}
