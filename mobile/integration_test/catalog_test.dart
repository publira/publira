import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/config.dart';
import 'package:publira/router.dart';

import '../test/support/connect_fixture_server.dart';
import '../test/support/fake_auth.dart';
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
        episodes: ConnectFixtureServer.populatedEpisodes(),
        entitledEpisodes: ConnectFixtureServer.populatedEntitledEpisodes(),
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
        PubliraApp.fromConfig(
          config:
              config ??
              AppConfig(
                apiBaseUrl: server.baseUrl,
                tenantHost: 'localhost',
                // The fixture server answers the image routes too, so the
                // reader fetches real bytes over a real socket.
                imageBaseUrl: server.baseUrl,
              ),
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          store: InMemorySessionStore(),
        ),
      );
      await tester.pump();
    }

    Future<void> signIn(WidgetTester tester) async {
      await tester.enterText(
        find.byKey(const ValueKey('sign-in-email')),
        ConnectFixtureServer.memberEmail,
      );
      await tester.enterText(
        find.byKey(const ValueKey('sign-in-password')),
        ConnectFixtureServer.memberPassword,
      );
      await tester.tap(find.byKey(const ValueKey('sign-in-submit')));
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

    testWidgets('opens the reader on a free episode body', (tester) async {
      await withFailureScreenshot(tester, 'fixture-viewer', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );

        expect(
          find.text('1 / ${ConnectFixtureServer.seedEpisodePageCount}'),
          findsOneWidget,
        );
        // The page request is issued once the reader is on screen, so wait for
        // it instead of reading the header on the frame the viewer appears.
        await pumpUntilTrue(
          tester,
          () => server.lastImageRequestHeaders != null,
          description: 'an image-server request',
        );
        expect(
          server.lastImageRequestHeaders?.value('x-forwarded-host'),
          'localhost',
        );
      });
    });

    testWidgets('turns to the next page from the reader controls', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-viewer-next', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );

        await tester.tap(find.byKey(const ValueKey('episode-next-page')));
        await pumpUntilFound(
          tester,
          find.text('2 / ${ConnectFixtureServer.seedEpisodePageCount}'),
        );
        // The page number turns over halfway through the animation, so the
        // reader is still scrolling here and the incoming page's image is
        // still waiting on a frame callback.
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testWidgets('a paid episode stays locked without a purchase', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-viewer-locked', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );
      });
    });

    testWidgets('signing in unlocks a paid episode body', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-in-unlock', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );

        await tester.tap(find.text('サインイン'));
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await signIn(tester);

        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );
        expect(
          find.text('1 / ${ConnectFixtureServer.seedEpisodePageCount}'),
          findsOneWidget,
        );
        await pumpUntilTrue(
          tester,
          () =>
              server.lastImageRequestHeaders?.value('authorization') ==
              'Bearer ${ConnectFixtureServer.memberAccessToken}',
          description: 'an authorized image-server request',
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testWidgets('signing out locks the paid episode again', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-out-lock', () async {
        final paidEpisode = find.byKey(
          const ValueKey('episode-tile-${ConnectFixtureServer.paidEpisodeId}'),
        );

        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await signIn(tester);
        await pumpUntilFound(tester, find.text('Publira'));

        await tester.tap(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await pumpUntilFound(tester, paidEpisode);
        await tester.tap(paidEpisode);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );
        await pumpUntilNoPendingFrameCallbacks(tester);

        await tester.pageBack();
        await pumpUntilFound(tester, paidEpisode);
        await tester.pageBack();
        await pumpUntilFound(tester, find.text('Publira'));

        await tester.tap(find.byKey(const ValueKey('catalog-account')));
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('account-sign-out')),
        );
        await tester.tap(find.byKey(const ValueKey('account-sign-out')));
        await pumpUntilFound(tester, find.text('サインインしていません'));
        await tester.pageBack();
        await pumpUntilFound(tester, find.text('Publira'));

        await tester.tap(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await pumpUntilFound(tester, paidEpisode);
        await tester.tap(paidEpisode);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );
      });
    });

    testWidgets('rejected credentials keep the reader on the form', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-sign-in-error', () async {
        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          ConnectFixtureServer.memberEmail,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          'wrong-password',
        );
        await tester.tap(find.byKey(const ValueKey('sign-in-submit')));

        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-error')),
        );
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
        PubliraApp.fromConfig(
          config: const AppConfig(
            apiBaseUrl: liveBaseUrl,
            tenantHost: liveTenantHost,
          ),
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          store: InMemorySessionStore(),
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

    testWidgets('a free seed episode reaches the reader on the live API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-viewer', () async {
        await pumpLive(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        // The dev seed publishes the episode without body images, so the
        // reader's empty state is what a working round trip looks like here.
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-empty')),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testWidgets('a paid seed episode is locked for an anonymous reader', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-viewer-locked', () async {
        await pumpLive(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
          timeout: const Duration(seconds: 20),
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

    testWidgets('the seed member signs in and unlocks their ticketed episode', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-sign-in', () async {
        await pumpLive(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
          timeout: const Duration(seconds: 20),
        );

        await tester.tap(find.text('サインイン'));
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          ConnectFixtureServer.memberEmail,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          ConnectFixtureServer.memberPassword,
        );
        await tester.tap(find.byKey(const ValueKey('sign-in-submit')));

        // `db/seeds/dev/050_access_tickets.sql` gives this member an access
        // ticket for the episode, and the development seed publishes it
        // without body images, so the reader's empty state is what a granted
        // body looks like here.
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-empty')),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testWidgets('wrong credentials are rejected by the live API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-sign-in-error', () async {
        await pumpLive(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          ConnectFixtureServer.memberEmail,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          'wrong-password',
        );
        await tester.tap(find.byKey(const ValueKey('sign-in-submit')));

        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-error')),
          timeout: const Duration(seconds: 20),
        );
      });
    });
  });

  group('secure session store', () {
    const store = SecureSessionStore();

    tearDown(() async {
      await store.clear();
    });

    testWidgets('a written session survives a new store instance', (
      tester,
    ) async {
      const session = AuthSession(
        accessToken: 'stored-access-token',
        userPublicId: ConnectFixtureServer.memberPublicId,
        userName: ConnectFixtureServer.memberName,
      );

      await store.write(session);
      // A second instance stands in for the next launch: nothing is carried
      // over in memory, so what comes back came from the platform keychain.
      final restored = await const SecureSessionStore().read();

      expect(restored?.accessToken, session.accessToken);
      expect(restored?.userPublicId, session.userPublicId);
      expect(restored?.userName, session.userName);

      await store.clear();
      expect(await const SecureSessionStore().read(), isNull);
    });
  });
}
