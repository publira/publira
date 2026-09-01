import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/config.dart';
import 'package:publira/offline/file_offline_library.dart';
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
    late Directory offlineRoot;

    setUp(() async {
      // Its own directory per test, so no test reads what another one saved.
      offlineRoot = await Directory.systemTemp.createTemp('publira-offline-');
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
      await removeDirectory(offlineRoot);
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
          offline: FileOfflineLibrary(root: () async => offlineRoot),
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
        // The fixture answers an authorized page the way image-server does
        // for an entitled body: encrypted. A frame on screen is therefore
        // proof the device decrypted it rather than drawing what it was sent.
        await pumpUntilTrue(
          tester,
          () => tester
              .widgetList<RawImage>(find.byType(RawImage))
              .any((raw) => raw.image != null),
          description: 'a decrypted page to reach the screen',
        );
        expect(find.byKey(const ValueKey('episode-page-error')), findsNothing);
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testWidgets('signing out locks the paid episode again', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-out-lock', () async {
        final seriesTile = find.byKey(
          const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
        );
        final paidEpisode = find.byKey(
          const ValueKey('episode-tile-${ConnectFixtureServer.paidEpisodeId}'),
        );

        // The catalog list is still in flight when its app bar arrives, and a
        // route below the one on screen stays in the tree, so each step waits
        // for the widget it is about to tap and then for the transition around
        // it to finish.
        Future<void> settleOn(Finder finder) async {
          await pumpUntilFound(tester, finder);
          await pumpUntilNoPendingFrameCallbacks(tester);
        }

        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await settleOn(find.byKey(const ValueKey('sign-in-submit')));
        await signIn(tester);
        await settleOn(seriesTile);

        await tester.tap(seriesTile);
        await settleOn(paidEpisode);
        await tester.tap(paidEpisode);
        await settleOn(find.byKey(const ValueKey('episode-page-view')));

        await tester.pageBack();
        await settleOn(paidEpisode);
        await tester.pageBack();
        await settleOn(find.byKey(const ValueKey('catalog-account')));

        await tester.tap(find.byKey(const ValueKey('catalog-account')));
        await settleOn(find.byKey(const ValueKey('account-sign-out')));
        await tester.tap(find.byKey(const ValueKey('account-sign-out')));
        await settleOn(find.text('サインインしていません'));
        await tester.pageBack();
        await settleOn(seriesTile);

        await tester.tap(seriesTile);
        await settleOn(paidEpisode);
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

    testWidgets('an unreachable API with nothing saved offers a retry', (
      tester,
    ) async {
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
        expect(find.textContaining('オフラインのため'), findsOneWidget);
        expect(find.byKey(const ValueKey('catalog-retry')), findsOneWidget);
      });
    });
  });

  group('live public API', skip: !_liveApi, () {
    late Directory offlineRoot;

    setUp(() async {
      offlineRoot = await Directory.systemTemp.createTemp('publira-offline-');
    });

    tearDown(() async {
      await removeDirectory(offlineRoot);
    });

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
          offline: FileOfflineLibrary(root: () async => offlineRoot),
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

  group('offline reading', () {
    late ConnectFixtureServer server;
    late Directory offlineRoot;
    late FileOfflineLibrary offline;
    var launch = 0;

    setUp(() async {
      offlineRoot = await Directory.systemTemp.createTemp('publira-offline-');
      offline = FileOfflineLibrary(root: () async => offlineRoot);
      launch = 0;
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
      await removeDirectory(offlineRoot);
    });

    /// Pumps the app the way a launch would.
    ///
    /// Each call carries its own key so the second one builds a fresh tree
    /// rather than updating the first: what is being tested is what survives
    /// between launches, which is only what reached the device.
    Future<void> pumpLaunch(
      WidgetTester tester, {
      required String apiBaseUrl,
      String? initialLocation,
      AuthSession? session,
    }) async {
      launch++;
      await tester.pumpWidget(
        PubliraApp.fromConfig(
          key: ValueKey('launch-$launch'),
          config: AppConfig(
            apiBaseUrl: apiBaseUrl,
            tenantHost: 'localhost',
            imageBaseUrl: apiBaseUrl,
          ),
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          store: InMemorySessionStore(session: session),
          offline: offline,
        ),
      );
      await tester.pump();
    }

    /// The name the library keeps page [page] of [episodeId] under.
    String pageKey(String episodeId, int page) => episodePageKey(
      Uri.parse('${server.baseUrl}/images/episodes/$episodeId-page-$page'),
    );

    Future<void> waitForSavedPage(WidgetTester tester, String key) {
      return pumpUntilTrueAsync(
        tester,
        () async => await offline.readPage(key) != null,
        description: 'the page to reach the device',
      );
    }

    AuthSession memberSession() => AuthSession(
      accessToken: ConnectFixtureServer.memberAccessToken,
      userPublicId: ConnectFixtureServer.memberPublicId,
      userName: ConnectFixtureServer.memberName,
      expiresAt: DateTime.now().toUtc().add(const Duration(hours: 24)),
    );

    testWidgets('a free episode read online turns again with the API gone', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-free-episode', () async {
        await pumpLaunch(
          tester,
          apiBaseUrl: server.baseUrl,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );
        await waitForSavedPage(
          tester,
          pageKey(ConnectFixtureServer.seedEpisodeId, 1),
        );

        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(
          tester,
          apiBaseUrl: closedBaseUrl,
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
          find.byKey(const ValueKey('episode-viewer-error')),
          findsNothing,
        );
        expect(
          find.text('1 / ${ConnectFixtureServer.seedEpisodePageCount}'),
          findsOneWidget,
        );
      });
    });

    testWidgets('the catalog opens from the device with the API gone', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-catalog', () async {
        await pumpLaunch(tester, apiBaseUrl: server.baseUrl);
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedSeriesTitle),
        );

        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(tester, apiBaseUrl: closedBaseUrl);
        await pumpUntilFound(
          tester,
          find.text(ConnectFixtureServer.seedSeriesTitle),
        );

        expect(find.byKey(const ValueKey('catalog-error')), findsNothing);
      });
    });

    testWidgets('an unsaved episode says so rather than failing blankly', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-unsaved-episode', () async {
        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(
          tester,
          apiBaseUrl: closedBaseUrl,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-viewer-error')),
        );

        // Scoped to the viewer: a deep link builds the series screen under it,
        // and that screen has nothing saved to show either.
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('episode-viewer-error')),
            matching: find.textContaining('オフラインのため'),
          ),
          findsOneWidget,
        );
      });
    });

    testWidgets('a paid episode saved by a member stops opening once they '
        'sign out', (tester) async {
      await withFailureScreenshot(tester, 'offline-signed-out', () async {
        await pumpLaunch(
          tester,
          apiBaseUrl: server.baseUrl,
          session: memberSession(),
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );
        await waitForSavedPage(
          tester,
          pageKey(ConnectFixtureServer.paidEpisodeId, 1),
        );

        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(
          tester,
          apiBaseUrl: closedBaseUrl,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-viewer-error')),
        );

        expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('episode-viewer-error')),
            matching: find.textContaining('オフラインのため'),
          ),
          findsOneWidget,
        );
      });
    });

    testWidgets('an episode the API takes back leaves the device', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-revoked', () async {
        await pumpLaunch(
          tester,
          apiBaseUrl: server.baseUrl,
          session: memberSession(),
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );
        await waitForSavedPage(
          tester,
          pageKey(ConnectFixtureServer.paidEpisodeId, 1),
        );

        // The access ticket has lapsed: the API answers the same reader with
        // the locked body it serves anyone without one.
        server.entitledEpisodes = const {};

        await pumpLaunch(
          tester,
          apiBaseUrl: server.baseUrl,
          session: memberSession(),
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );

        expect(
          await offline.readEpisode(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
          isNull,
        );
      });
    });
  });
}

/// Removes a temporary directory a test wrote under, if it is still there.
Future<void> removeDirectory(Directory directory) async {
  if (await directory.exists()) {
    await directory.delete(recursive: true);
  }
}
