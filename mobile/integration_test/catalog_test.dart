import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:publira/app.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/router.dart';

import '../test/support/connect_fixture_server.dart';
import '../test/support/pump_until.dart';
import 'support/artifacts.dart';

/// Live public API, used when CI / `task mobile:e2e` starts api-server.
const _liveApi = bool.fromEnvironment('PUBLIRA_LIVE_API');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('fixture public API', () {
    late ConnectFixtureServer server;

    setUp(() async {
      server = ConnectFixtureServer(
        series: ConnectFixtureServer.populatedSeries(),
        details: ConnectFixtureServer.populatedDetails(),
      );
      await server.start();
    });

    tearDown(() async {
      await server.close();
    });

    Future<void> pumpApp(
      WidgetTester tester, {
      String? initialLocation,
      AppConfig? config,
    }) async {
      await tester.pumpWidget(
        PubliraApp(
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          catalog: HttpCatalogRepository(
            config:
                config ??
                AppConfig(apiBaseUrl: server.baseUrl, tenantHost: 'localhost'),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('launches onto a catalog populated from the public API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-launch', () async {
        await pumpApp(tester);
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedSeriesTitle),
        );
        expect(find.text('Publira'), findsOneWidget);
        expect(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          findsOneWidget,
        );
      });
    });

    testWidgets('opens series detail from the catalog list', (tester) async {
      await withFailureScreenshot(tester, 'fixture-detail', () async {
        await pumpApp(tester);
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await tester.tap(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedEpisodeTitle),
        );

        expect(find.text(ConnectFixtureServer.seedSeriesTitle), findsWidgets);
        expect(
          find.text(ConnectFixtureServer.seedSeriesSynopsis),
          findsOneWidget,
        );
        expect(find.text('2 話'), findsOneWidget);
        expect(find.text('¥500'), findsOneWidget);
      });
    });

    testWidgets('returns to the catalog with the system back gesture', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-back', () async {
        await pumpApp(tester);
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await tester.tap(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await pumpUntilFound(tester, find.text('エピソード一覧'));
        await tester.pageBack();
        await pumpUntilFound(tester, find.text('Publira'));
        expect(find.text(ConnectFixtureServer.seedSeriesTitle), findsOneWidget);
      });
    });

    testWidgets('missing series shows the not-found state', (tester) async {
      await withFailureScreenshot(tester, 'fixture-not-found', () async {
        await pumpApp(tester, initialLocation: '/series/ZZZZZZZZZZZZ');
        await pumpUntilFound(tester, find.textContaining('シリーズが見つかりません'));
        await tester.tap(find.text('カタログへ戻る'));
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedSeriesTitle),
        );
      });
    });

    testWidgets('empty catalog shows the empty-state copy', (tester) async {
      server.series = const [];
      await withFailureScreenshot(tester, 'fixture-empty', () async {
        await pumpApp(tester);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('catalog-empty')),
        );
        expect(find.text('公開中のシリーズはありません'), findsOneWidget);
      });
    });

    testWidgets('unreachable API shows a retryable error', (tester) async {
      await withFailureScreenshot(tester, 'fixture-error', () async {
        final closedBaseUrl = server.baseUrl;
        await server.close();
        await pumpApp(
          tester,
          config: AppConfig(apiBaseUrl: closedBaseUrl, tenantHost: 'localhost'),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('catalog-error')),
        );
        expect(find.textContaining('カタログを表示できませんでした'), findsOneWidget);
        expect(find.byKey(const ValueKey('catalog-retry')), findsOneWidget);
      });
    });
  });

  group('live public API', skip: !_liveApi, () {
    const liveBaseUrl = String.fromEnvironment(
      'PUBLIRA_API_BASE_URL',
      defaultValue: AppConfig.androidEmulatorApiBaseUrl,
    );
    const liveTenantHost = String.fromEnvironment(
      'PUBLIRA_TENANT_HOST',
      defaultValue: AppConfig.defaultTenantHost,
    );

    Future<void> pumpLive(
      WidgetTester tester, {
      String? initialLocation,
    }) async {
      await tester.pumpWidget(
        PubliraApp(
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          catalog: HttpCatalogRepository(
            config: const AppConfig(
              apiBaseUrl: liveBaseUrl,
              tenantHost: liveTenantHost,
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('catalog lists series from the seed tenant', (tester) async {
      await withFailureScreenshot(tester, 'live-catalog', () async {
        await pumpLive(tester);
        await pumpUntilFound(
          tester,
          find.byType(ListTile),
          timeout: const Duration(seconds: 20),
        );
        expect(find.text('Publira'), findsOneWidget);
        expect(find.byKey(const ValueKey('catalog-error')), findsNothing);
      });
    });

    testWidgets('seed series detail is reachable by public id', (tester) async {
      await withFailureScreenshot(tester, 'live-detail', () async {
        await pumpLive(
          tester,
          initialLocation: '/series/${ConnectFixtureServer.seedSeriesId}',
        );
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedSeriesTitle),
          timeout: const Duration(seconds: 20),
        );
        expect(find.text('エピソード一覧'), findsOneWidget);
        expect(
          find.text(ConnectFixtureServer.seedEpisodeTitle),
          findsOneWidget,
        );
      });
    });

    testWidgets('missing public id is not found on the live API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-not-found', () async {
        await pumpLive(tester, initialLocation: '/series/ZZZZZZZZZZZZ');
        await pumpUntilFound(
          tester,
          find.textContaining('シリーズが見つかりません'),
          timeout: const Duration(seconds: 20),
        );
      });
    });
  });
}
