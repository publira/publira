import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/announcements/dismissed_announcement_store.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/config.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/router.dart';

import '../test/support/connect_fixture_server.dart';
import '../test/support/fake_auth.dart';
import '../test/support/fake_links.dart';
import '../test/support/fake_purchase.dart';
import '../test/support/live_api_precondition.dart';
import '../test/support/pump_until.dart';
import '../test/support/tap.dart';
import 'support/artifacts.dart';
import 'support/test_app.dart';

/// Live public API, used when CI / `task mobile:e2e` starts api-server.
const _liveApi = bool.fromEnvironment('PUBLIRA_LIVE_API');

/// The seed member's session, as a launch that restores one from the keychain
/// hands it over.
AuthSession memberSession() => AuthSession(
  accessToken: ConnectFixtureServer.memberAccessToken,
  userPublicId: ConnectFixtureServer.memberPublicId,
  userName: ConnectFixtureServer.memberName,
  expiresAt: DateTime.now().toUtc().add(const Duration(hours: 24)),
);

/// The account tab as only a signed-in reader sees it.
///
/// A guest gets the same tab with an outlined icon, so its key alone only
/// proves the bar is on screen.
Finder signedInAccountEntry() => find.descendant(
  of: find.byKey(const ValueKey('tab-account')),
  matching: find.byIcon(Icons.person),
);

/// The signed-in account screen's list, whose rows a finder matches only while
/// they are on screen.
Finder accountList() => find.descendant(
  of: find.byKey(const ValueKey('account-list')),
  matching: find.byType(Scrollable),
);

/// Waits for the reader to draw the pages it built.
///
/// [pumpUntilFound] on the page view returns on the first frame the reader
/// exists, which is while its pages are still being fetched.
Future<void> pumpUntilPagesDrawn(
  WidgetTester tester, {
  // Longer than the waits that only cover a request: a page is fetched,
  // decrypted, and then decoded, and an emulator decodes in software.
  Duration timeout = const Duration(seconds: 30),
}) async {
  await pumpUntilFound(
    tester,
    find.byKey(const ValueKey('episode-page-view')),
    timeout: timeout,
  );
  await pumpUntilTrue(
    tester,
    () {
      final pages = tester.widgetList<RawImage>(
        find.descendant(
          of: find.byKey(const ValueKey('episode-page-view')),
          matching: find.byType(RawImage),
        ),
      );
      return pages.isNotEmpty && pages.every((page) => page.image != null);
    },
    description: 'the reader to draw the pages it built',
    timeout: timeout,
  );
}

/// Scrolls the series screen until [finder] is on it.
///
/// The screen carries the follow controls and a row per author above its
/// episodes, so an episode sits below the fold on a phone, and a lazy list
/// neither builds nor hit-tests what no viewport has reached. Reaching a row
/// therefore includes scrolling to it; one already on screen stays where it
/// is. The list is named so the drag cannot land on the catalog behind it.
Future<void> scrollSeriesTo(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    200,
    scrollable: find.descendant(
      of: find.byKey(const ValueKey('series-detail-body')),
      matching: find.byType(Scrollable),
    ),
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // A tap whose offset does not land on the widget it was given is delivered
  // to whatever is drawn there, and every wait after it then times out on a
  // finder that has nothing to do with the miss. Failing at the tap is what
  // names the row that was not on screen.
  WidgetController.hitTestWarningShouldBeFatal = true;

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
      AuthSession? session,
      FakeCheckoutLauncher? checkoutLauncher,
      FakeIncomingLinks? incomingLinks,
    }) async {
      await tester.pumpWidget(
        PubliraApp.fromConfig(
          checkoutLauncher: checkoutLauncher,
          incomingLinks: incomingLinks,
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
          store: InMemorySessionStore(session: session),
          dismissedAnnouncements: MemoryDismissedAnnouncementStore(),
          offline: FileOfflineLibrary(
            tenantHost: 'localhost',
            root: () async => offlineRoot,
          ),
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
      await tapReachable(tester, find.byKey(const ValueKey('sign-in-submit')));
    }

    testApp('launches onto a catalog populated from the public API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-launch', () async {
        await pumpApp(tester);
        // The tile rather than the title: the shelves above the list name the
        // same series, and they are answered by reads of their own.
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        expect(find.text(ConnectFixtureServer.seedTenantName), findsOneWidget);
        expect(find.text(ConnectFixtureServer.seedSeriesTitle), findsWidgets);
      });
    });

    testApp('the shelves of the catalog stand above the whole of it', (
      tester,
    ) async {
      server.rankedSeries = ConnectFixtureServer.populatedRankedSeries();
      await withFailureScreenshot(tester, 'fixture-shelves', () async {
        await pumpApp(tester);
        // Each shelf is answered by a read of its own, so each is waited for
        // on its own.
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey(
              'catalog-ranking-${ConnectFixtureServer.seedSeriesId}',
            ),
          ),
        );
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey(
              'catalog-new-arrivals-${ConnectFixtureServer.seedSeriesId}',
            ),
          ),
        );

        expect(
          find.byKey(const ValueKey('catalog-ranking-error')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('catalog-new-arrivals-error')),
          findsNothing,
        );
      });
    });

    testApp('opens series detail from the catalog list', (tester) async {
      await withFailureScreenshot(tester, 'fixture-detail', () async {
        await pumpApp(tester);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await tapVisible(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await pumpUntilRouteSettled(tester, find.text('2 episodes'));
        await scrollSeriesTo(
          tester,
          find.text(ConnectFixtureServer.seedEpisodeTitle),
        );

        expect(find.text(ConnectFixtureServer.seedSeriesTitle), findsWidgets);
        expect(
          find.text(ConnectFixtureServer.seedSeriesSynopsis),
          findsOneWidget,
        );
        expect(find.text('2 episodes'), findsOneWidget);
        expect(find.text('¥500'), findsOneWidget);
      });
    });

    testApp('returns to the catalog with the system back gesture', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-back', () async {
        await pumpApp(tester);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        await tapVisible(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
        // The episode count, rather than the heading over the episodes, which
        // the follow controls and the authors above it push off a phone.
        await pumpUntilRouteSettled(tester, find.text('2 episodes'));
        await tapBack(tester);
        // The catalog names the series on its new-arrivals shelf as well as in
        // its list, so the screen that has to be gone is the detail one.
        await pumpUntilRouteSettled(
          tester,
          find.text(ConnectFixtureServer.seedTenantName),
        );
        expect(find.text('Episodes'), findsNothing);
        expect(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          findsOneWidget,
        );
      });
    });

    testApp('finds a series by part of its title and opens it', (tester) async {
      await withFailureScreenshot(tester, 'fixture-search', () async {
        await pumpApp(tester);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('tab-search')),
        );
        await tapReachable(tester, find.byKey(const ValueKey('tab-search')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Series',
        );
        final tile = find.byKey(
          const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
        );
        await pumpUntilRouteSettled(tester, tile);
        await tapVisible(tester, tile);
        await pumpUntilRouteSettled(tester, find.text('2 episodes'));
        await scrollSeriesTo(
          tester,
          find.text(ConnectFixtureServer.seedEpisodeTitle),
        );

        expect(find.text(ConnectFixtureServer.seedSeriesTitle), findsWidgets);
      });
    });

    testApp('switches tabs and finds each where it was left', (tester) async {
      await withFailureScreenshot(tester, 'fixture-tabs', () async {
        final seriesTile = find.byKey(
          const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
        );
        final tabBar = find.byKey(const ValueKey('tab-bar'));
        await pumpApp(tester);
        await pumpUntilRouteSettled(tester, seriesTile);
        await tapVisible(tester, seriesTile);
        await pumpUntilRouteSettled(tester, find.text('2 episodes'));

        await tapReachable(tester, find.byKey(const ValueKey('tab-search')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );
        await tapReachable(tester, find.byKey(const ValueKey('tab-library')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('library-continue-signed-out')),
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('tab-notifications')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('notifications-signed-out')),
        );
        await tapReachable(tester, find.byKey(const ValueKey('tab-account')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('account-sign-in')),
        );

        // The home tab is still on the series it was left on.
        await tapReachable(tester, find.byKey(const ValueKey('tab-home')));
        await pumpUntilRouteSettled(tester, find.text('2 episodes'));

        // The page takes the whole screen, and the bar is back once the
        // reader leaves it.
        final episode = find.text(ConnectFixtureServer.seedEpisodeTitle);
        await scrollSeriesTo(tester, episode);
        await tapVisible(tester, episode);
        await pumpUntilPagesDrawn(tester);
        expect(tabBar, findsNothing);

        await tapBack(tester);
        await pumpUntilRouteSettled(tester, episode);
        expect(tabBar, findsOneWidget);
      });
    });

    testApp('clearing the keyword takes the results away', (tester) async {
      await withFailureScreenshot(tester, 'fixture-search-cleared', () async {
        await pumpApp(tester, initialLocation: AppRoutes.search);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Series',
        );
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );

        await tapReachable(tester, find.byKey(const ValueKey('search-clear')));
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('search-prompt')),
        );

        expect(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          findsNothing,
        );
      });
    });

    testApp('finds an author by name and opens their series', (tester) async {
      await withFailureScreenshot(tester, 'fixture-search-author', () async {
        await pumpApp(tester, initialLocation: AppRoutes.search);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Author 001',
        );
        final author = find.byKey(const ValueKey('creator-tile-SeedAUTHAAA1'));
        await pumpUntilRouteSettled(tester, author);
        await tapVisible(tester, author);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('creator-body')),
        );

        expect(find.text('Profile text for Seed Author 001'), findsOneWidget);
        expect(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          findsOneWidget,
        );
      });
    });

    testApp('finds a label by name and opens its series', (tester) async {
      await withFailureScreenshot(tester, 'fixture-search-label', () async {
        await pumpApp(tester, initialLocation: AppRoutes.search);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Label',
        );
        final label = find.byKey(const ValueKey('label-tile-SeedLABLAAA1'));
        await pumpUntilRouteSettled(tester, label);
        await tapVisible(tester, label);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('label-body')),
        );

        expect(
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          findsOneWidget,
        );
      });
    });

    testApp('opens the reader on a free episode body', (tester) async {
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
        // Nobody is signed in, so the fixture encrypts this page under the
        // media token on its own URL, the way image-server does for a free
        // body. A frame on screen is therefore proof the device derived the
        // key from that token rather than drawing what it was sent.
        expect(server.lastImageRequestHeaders?.value('authorization'), isNull);
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

    testApp('a free body draws while the server encrypts nothing', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-viewer-plain', () async {
        // What an image-server instance a rolling deploy has not replaced
        // yet answers with: the image itself, under no stream to reverse.
        server.encryptImages = false;
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

        await pumpUntilTrue(
          tester,
          () => tester
              .widgetList<RawImage>(find.byType(RawImage))
              .any((raw) => raw.image != null),
          description: 'a page to reach the screen',
        );
        expect(find.byKey(const ValueKey('episode-page-error')), findsNothing);
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('turns to the next page from the reader controls', (tester) async {
      await withFailureScreenshot(tester, 'fixture-viewer-next', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('episode-next-page')),
        );
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

    testApp('a paid episode stays locked without a purchase', (tester) async {
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

    testApp('signing in unlocks a paid episode body', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-in-unlock', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );

        await tapReachable(tester, find.text('Sign in'));
        await pumpUntilRouteSettled(
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

    testApp('signing out locks the paid episode again', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-out-lock', () async {
        final seriesTile = find.byKey(
          const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
        );
        final paidEpisode = find.byKey(
          const ValueKey('episode-tile-${ConnectFixtureServer.paidEpisodeId}'),
        );

        // Every step here taps what the step before it opened, so each one
        // waits for its screen's route to come to rest and then for the frame
        // callbacks the reader's images leave behind.
        Future<void> settleOn(Finder finder) async {
          await pumpUntilRouteSettled(tester, finder);
          await pumpUntilNoPendingFrameCallbacks(tester);
        }

        /// The series screen, scrolled down to the paid episode it opens.
        Future<void> settleOnPaidEpisode() async {
          await settleOn(find.text('2 episodes'));
          await scrollSeriesTo(tester, paidEpisode);
          await pumpUntilNoPendingFrameCallbacks(tester);
        }

        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await settleOn(find.byKey(const ValueKey('sign-in-submit')));
        await signIn(tester);
        await settleOn(seriesTile);

        await tapVisible(tester, seriesTile);
        await settleOnPaidEpisode();
        await tapVisible(tester, paidEpisode);
        await settleOn(find.byKey(const ValueKey('episode-page-view')));

        await tapBack(tester);
        await settleOn(paidEpisode);
        await tapBack(tester);
        await settleOn(seriesTile);

        await tapReachable(tester, find.byKey(const ValueKey('tab-account')));
        await settleOn(find.byKey(const ValueKey('account-sign-out')));
        await tapReachable(
          tester,
          find.byKey(const ValueKey('account-sign-out')),
        );
        await settleOn(find.text('You are not signed in.'));
        await tapReachable(tester, find.byKey(const ValueKey('tab-home')));
        await settleOn(seriesTile);

        await tapVisible(tester, seriesTile);
        await settleOnPaidEpisode();
        await tapVisible(tester, paidEpisode);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('episode-locked')),
        );
      });
    });

    testApp('a purchase made in the browser opens the episode', (tester) async {
      server
        ..acceptsPayments = true
        ..entitledEpisodes = const {};
      final links = FakeIncomingLinks();
      addTearDown(links.close);
      // The browser: the payment goes through, the webhook records it, and
      // the success page hands the reader back through the app link.
      final launcher = _BrowserThatPays(() {
        server.entitledEpisodes =
            ConnectFixtureServer.populatedEntitledEpisodes();
        links.deliver(
          Uri.parse(
            'https://localhost/en/checkout/return'
            '?episode=${ConnectFixtureServer.paidEpisodeId}&status=success',
          ),
        );
      });
      await withFailureScreenshot(tester, 'fixture-purchase', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.paidEpisodeId,
          ),
          session: memberSession(),
          checkoutLauncher: launcher,
          incomingLinks: links,
        );
        final buy = find.byKey(
          const ValueKey('episode-buy-${ConnectFixtureServer.paidEpisodeId}'),
        );
        await pumpUntilRouteSettled(tester, buy);

        await tapReachable(tester, buy);
        await pumpUntilPagesDrawn(tester);

        expect(launcher.opened, [
          ConnectFixtureServer.checkoutUrlFor(
            ConnectFixtureServer.paidEpisodeId,
          ),
        ]);
        expect(
          server.requestsTo('StartEpisodeCheckout').single.body['client'],
          'CLIENT_MOBILE',
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('rejected credentials keep the reader on the form', (tester) async {
      await withFailureScreenshot(tester, 'fixture-sign-in-error', () async {
        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilRouteSettled(
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
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-error')),
        );
      });
    });

    testApp('a reader signs up, opens the confirmation link, and signs in', (
      tester,
    ) async {
      const email = 'new-reader@example.test';
      const password = 'new-reader-password';
      // The mailbox: the confirmation link the API would have sent arrives
      // as an app link, the way the OS hands one over on a tap.
      final links = FakeIncomingLinks();
      addTearDown(links.close);
      await withFailureScreenshot(tester, 'fixture-sign-up', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.signUp,
          incomingLinks: links,
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
        );

        await tester.enterText(
          find.byKey(const ValueKey('sign-up-name')),
          'New Reader',
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-email')),
          email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password')),
          password,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password-confirm')),
          password,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-up-pending')),
        );

        links.deliver(
          Uri.parse(
            'https://localhost/en/verify'
            '?token=${ConnectFixtureServer.verificationToken}',
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('verify-email-verified')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('verify-email-sign-in')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          password,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        await pumpUntilFound(tester, signedInAccountEntry());
        expect(server.signups[email]!.verified, isTrue);
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('an unconfirmed address is sent a fresh confirmation link', (
      tester,
    ) async {
      const email = 'unconfirmed@example.test';
      const password = 'unconfirmed-password';
      await withFailureScreenshot(tester, 'fixture-resend', () async {
        await pumpApp(tester, initialLocation: AppRoutes.signUp);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-name')),
          'Unconfirmed Reader',
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-email')),
          email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password')),
          password,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password-confirm')),
          password,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-up-pending')),
        );

        // The first mail never arrived, so the reader asks for another.
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-up-pending-resend')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-up-pending-resent')),
        );

        expect(
          server.requestsTo('RequestEmailVerification').single.body['email'],
          email,
        );
      });
    });

    testApp('signing in before confirming says to open the mail', (
      tester,
    ) async {
      const email = 'waiting@example.test';
      const password = 'waiting-password';
      server.signups[email] = FixtureSignup(
        name: 'Waiting Reader',
        password: password,
        birthDate: '',
      );
      await withFailureScreenshot(
        tester,
        'fixture-unverified-sign-in',
        () async {
          await pumpApp(tester, initialLocation: AppRoutes.signIn);
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('sign-in-submit')),
          );

          await tester.enterText(
            find.byKey(const ValueKey('sign-in-email')),
            email,
          );
          await tester.enterText(
            find.byKey(const ValueKey('sign-in-password')),
            password,
          );
          await tapReachable(
            tester,
            find.byKey(const ValueKey('sign-in-submit')),
          );
          await pumpUntilFound(
            tester,
            find.byKey(const ValueKey('sign-in-resend-verification')),
          );

          expect(
            find.text(
              'Your email address has not been confirmed yet. '
              'Open the link in the confirmation email.',
            ),
            findsOneWidget,
          );
        },
      );
    });

    testApp('a member who forgot their password sets a new one and signs in', (
      tester,
    ) async {
      const newPassword = 'replaced-member-password';
      // The mailbox: the reset link the API would have sent arrives as an
      // app link, the way the OS hands one over on a tap.
      final links = FakeIncomingLinks();
      addTearDown(links.close);
      await withFailureScreenshot(tester, 'fixture-password-reset', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.signIn,
          incomingLinks: links,
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          ConnectFixtureServer.memberEmail,
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-forgot-password')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('reset-password-submit')),
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('reset-password-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('reset-password-sent')),
        );
        expect(
          server.requestsTo('RequestPasswordReset').single.body['email'],
          ConnectFixtureServer.memberEmail,
        );

        links.deliver(
          Uri.parse(
            'https://localhost/ja/confirm-password'
            '?token=${ConnectFixtureServer.passwordResetToken}',
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password')),
          newPassword,
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password-confirm')),
          newPassword,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('confirm-password-done')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('confirm-password-sign-in')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          ConnectFixtureServer.memberEmail,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          newPassword,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        await pumpUntilFound(tester, signedInAccountEntry());
        expect(server.memberCurrentPassword, newPassword);
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp(
      'a member renames the account and changes the password in the app',
      (tester) async {
        const newPassword = 'replaced-member-password';
        await withFailureScreenshot(tester, 'fixture-account-edit', () async {
          await pumpApp(tester, initialLocation: AppRoutes.signIn);
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('sign-in-submit')),
          );
          await signIn(tester);
          await pumpUntilFound(tester, signedInAccountEntry());
          await tapReachable(tester, find.byKey(const ValueKey('tab-account')));
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('account-name')),
          );

          await tapReachable(
            tester,
            find.byKey(const ValueKey('account-name')),
          );
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('edit-name-submit')),
          );
          await tester.enterText(
            find.byKey(const ValueKey('edit-name-name')),
            'Renamed Member',
          );
          await tapReachable(
            tester,
            find.byKey(const ValueKey('edit-name-submit')),
          );
          await pumpUntilRouteSettled(
            tester,
            find.descendant(
              of: find.byKey(const ValueKey('account-name')),
              matching: find.text('Renamed Member'),
            ),
          );
          expect(server.memberCurrentName, 'Renamed Member');

          await tapVisible(
            tester,
            find.byKey(const ValueKey('account-change-password')),
            scrollable: accountList(),
          );
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('change-password-submit')),
          );
          await tester.enterText(
            find.byKey(const ValueKey('change-password-current')),
            ConnectFixtureServer.memberPassword,
          );
          await tester.enterText(
            find.byKey(const ValueKey('change-password-new')),
            newPassword,
          );
          await tester.enterText(
            find.byKey(const ValueKey('change-password-confirm')),
            newPassword,
          );
          await tapReachable(
            tester,
            find.byKey(const ValueKey('change-password-submit')),
          );
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('account-sign-out')),
          );
          expect(server.memberCurrentPassword, newPassword);

          // The change ended the token the member signed in with, so a
          // request that still goes through proves the app moved to the one
          // the API handed back.
          await tapVisible(
            tester,
            find.byKey(const ValueKey('account-change-email')),
            scrollable: accountList(),
          );
          await pumpUntilRouteSettled(
            tester,
            find.byKey(const ValueKey('change-email-current')),
          );
          expect(find.text(ConnectFixtureServer.memberEmail), findsOneWidget);
          await pumpUntilNoPendingFrameCallbacks(tester);
        });
      },
    );

    testApp('an email change is requested and its link opens the app', (
      tester,
    ) async {
      final links = FakeIncomingLinks();
      addTearDown(links.close);
      await withFailureScreenshot(tester, 'fixture-email-change', () async {
        await pumpApp(
          tester,
          initialLocation: AppRoutes.signIn,
          incomingLinks: links,
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await signIn(tester);
        await pumpUntilFound(tester, signedInAccountEntry());
        await tapReachable(tester, find.byKey(const ValueKey('tab-account')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('account-change-email')),
        );
        await tapVisible(
          tester,
          find.byKey(const ValueKey('account-change-email')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('change-email-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('change-email-new')),
          'moved@example.com',
        );
        await tester.enterText(
          find.byKey(const ValueKey('change-email-password')),
          ConnectFixtureServer.memberPassword,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('change-email-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('change-email-requested')),
        );
        expect(server.requestedEmailChanges, ['moved@example.com']);

        links.deliver(
          Uri.parse(
            'https://localhost/en/confirm-email'
            '?token=${ConnectFixtureServer.emailChangeToken}',
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.text('Your email address has been changed.'),
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('deleting the account signs the device out for good', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-account-delete', () async {
        await pumpApp(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await signIn(tester);
        await pumpUntilFound(tester, signedInAccountEntry());
        await tapReachable(tester, find.byKey(const ValueKey('tab-account')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('account-delete')),
        );
        await tapVisible(tester, find.byKey(const ValueKey('account-delete')));
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('delete-account-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('delete-account-password')),
          ConnectFixtureServer.memberPassword,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('delete-account-submit')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('delete-account-confirm-delete')),
        );
        expect(server.memberDeleted, isFalse);

        await tapReachable(
          tester,
          find.byKey(const ValueKey('delete-account-confirm-delete')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.text(
            'Your account has been deleted. Thank you for using the site.',
          ),
        );
        expect(server.memberDeleted, isTrue);
        // The catalog's account entry leads to sign-in once nobody is.
        expect(find.byIcon(Icons.person_outline), findsOneWidget);
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('an expired reset link leads to a fresh request', (tester) async {
      await withFailureScreenshot(tester, 'fixture-reset-expired', () async {
        await pumpApp(
          tester,
          initialLocation:
              '${AppRoutes.confirmPassword}'
              '?token=${ConnectFixtureServer.expiredPasswordResetToken}',
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password')),
          'replaced-member-password',
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password-confirm')),
          'replaced-member-password',
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('confirm-password-link-error')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('confirm-password-request-again')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('reset-password-submit')),
        );
        expect(
          server.memberCurrentPassword,
          ConnectFixtureServer.memberPassword,
        );
      });
    });

    testApp('missing series shows the not-found state', (tester) async {
      await withFailureScreenshot(tester, 'fixture-not-found', () async {
        await pumpApp(tester, initialLocation: '/series/ZZZZZZZZZZZZ');
        await pumpUntilRouteSettled(
          tester,
          find.textContaining('Series not found'),
        );
        await tapReachable(tester, find.text('Back to the catalog'));
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
        );
      });
    });

    testApp('empty catalog shows the empty-state copy', (tester) async {
      server.series = const [];
      await withFailureScreenshot(tester, 'fixture-empty', () async {
        await pumpApp(tester);
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('catalog-empty')),
        );
        expect(find.text('No series have been published yet.'), findsOneWidget);
      });
    });

    testApp('an unreachable API with nothing saved offers a retry', (
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
        expect(find.textContaining('You are offline'), findsOneWidget);
        expect(find.byKey(const ValueKey('catalog-retry')), findsOneWidget);
      });
    });

    testApp('an episode opens on the page the member stopped on', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-resume', () async {
        // A position this install never wrote, which is what one saved on the
        // website looks like to the app opening the episode afterwards.
        server.readingPositions = {ConnectFixtureServer.seedEpisodeId: 1};
        await pumpApp(
          tester,
          session: memberSession(),
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
          find.text('2 / ${ConnectFixtureServer.seedEpisodePageCount}'),
          findsOneWidget,
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('the page a member turns to is recorded at the API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'fixture-record-position', () async {
        await pumpApp(
          tester,
          session: memberSession(),
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('episode-next-page')),
        );
        await pumpUntilTrue(
          tester,
          () =>
              server.readingPositions[ConnectFixtureServer.seedEpisodeId] == 1,
          description: 'the position to reach the API',
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
      });
    });

    testApp('a notification no push delivered is found in the inbox', (
      tester,
    ) async {
      // The fixture app carries no Firebase project, so nothing but the inbox
      // can tell the reader about this episode.
      server.notifications = [
        {
          'id': 'fixture-notification-1',
          'notificationType': 'episode_published',
          'payload':
              '{"series_id":"${ConnectFixtureServer.seedSeriesId}",'
              '"episode_id":"${ConnectFixtureServer.seedEpisodeId}",'
              '"series_title":"${ConnectFixtureServer.seedSeriesTitle}",'
              '"episode_title":"${ConnectFixtureServer.seedEpisodeTitle}"}',
          'createdAt': '2026-09-08T10:30:00Z',
        },
        {
          'id': 'fixture-notification-2',
          'notificationType': 'comment_approved',
          'payload': '{}',
          'isRead': true,
          'createdAt': '2026-09-01T10:30:00Z',
        },
      ];
      await withFailureScreenshot(tester, 'fixture-notifications', () async {
        await pumpApp(tester, session: memberSession());
        await pumpUntilFound(tester, find.byTooltip('Notifications, 1 unread'));

        await tapReachable(
          tester,
          find.byKey(const ValueKey('tab-notifications')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('notification-unread-fixture-notification-1'),
          ),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('notification-fixture-notification-1')),
        );
        await pumpUntilPagesDrawn(tester);
        await pumpUntilTrue(
          tester,
          () => server.notifications.every((item) => item['isRead'] == true),
          description: 'the read mark to reach the API',
        );
      });
    });

    testApp('a pinned announcement is read, closed, and marked read', (
      tester,
    ) async {
      server
        ..announcements = [
          {
            'id': 'fixture-announcement-1',
            'announcementType': 'system',
            'title': 'Scheduled maintenance',
            'body': 'The site pauses for an hour tonight.',
            'createdAt': '2026-09-20T09:00:00Z',
            'pinned': true,
          },
          {
            'id': 'fixture-announcement-2',
            'announcementType': 'system',
            'title': 'A new series has started',
            'body': 'Read the first episode today.',
            'linkUrl': '/series/${ConnectFixtureServer.seedSeriesId}',
            'createdAt': '2026-09-19T09:00:00Z',
          },
        ]
        ..pinnedAnnouncementId = 'fixture-announcement-1';
      await withFailureScreenshot(tester, 'fixture-announcements', () async {
        await pumpApp(tester, session: memberSession());
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('pinned-announcement-fixture-announcement-1'),
          ),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('pinned-announcement-open')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('announcement-fixture-announcement-1')),
        );
        await pumpUntilTrue(
          tester,
          () => server.announcements.first['isRead'] == true,
          description: 'the opened announcement to be marked read',
        );
        await tapBack(tester);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('pinned-announcement-dismiss')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('pinned-announcement-dismiss')),
        );
        await tester.pump();
        expect(
          find.byKey(
            const ValueKey('pinned-announcement-fixture-announcement-1'),
          ),
          findsNothing,
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('catalog-announcements')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('announcement-unread-fixture-announcement-2'),
          ),
        );
        // Closing the banner took nothing out of the list.
        expect(
          find.byKey(const ValueKey('announcement-row-fixture-announcement-1')),
          findsOneWidget,
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('announcements-mark-all-read')),
        );
        await pumpUntilTrue(
          tester,
          () => server.announcements.every((item) => item['isRead'] == true),
          description: 'mark all read to reach the API',
        );
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
    // Every seeded episode carries a body, so the reader fetches pages from
    // image-server as soon as it opens one, and it has to be told where that
    // is for the same reason as the API: loopback inside an emulator is the
    // emulator.
    const liveImageBaseUrl = String.fromEnvironment(
      'PUBLIRA_IMAGE_BASE_URL',
      defaultValue: AppConfig.androidEmulatorImageBaseUrl,
    );

    // A failing setUpAll skips the rest of the group, so a run with nothing
    // to read fails once, here, instead of once per test.
    setUpAll(
      () => expectLiveSeed(
        apiBaseUrl: liveBaseUrl,
        tenantHost: liveTenantHost,
        seriesPublicId: ConnectFixtureServer.seedSeriesId,
      ),
    );

    Future<void> pumpLive(
      WidgetTester tester, {
      String? initialLocation,
    }) async {
      await tester.pumpWidget(
        PubliraApp.fromConfig(
          config: const AppConfig(
            apiBaseUrl: liveBaseUrl,
            imageBaseUrl: liveImageBaseUrl,
            tenantHost: liveTenantHost,
          ),
          router: createAppRouter(
            initialLocation: initialLocation ?? AppRoutes.catalog,
          ),
          store: InMemorySessionStore(),
          dismissedAnnouncements: MemoryDismissedAnnouncementStore(),
          offline: FileOfflineLibrary(
            tenantHost: liveTenantHost,
            root: () async => offlineRoot,
          ),
        ),
      );
      await tester.pump();
    }

    testApp('catalog lists series from the seed tenant', (tester) async {
      await withFailureScreenshot(tester, 'live-catalog', () async {
        await pumpLive(tester);
        await pumpUntilFound(
          tester,
          find.byType(ListTile),
          timeout: const Duration(seconds: 20),
        );
        expect(find.text(ConnectFixtureServer.seedTenantName), findsOneWidget);
        expect(find.byKey(const ValueKey('catalog-error')), findsNothing);
      });
    });

    testApp('the seed tenant chart reaches the catalog', (tester) async {
      await withFailureScreenshot(tester, 'live-ranking', () async {
        await pumpLive(tester);
        // `db/seeds/scenarios/170_ranking.sql` is the snapshot the engagement
        // batch would have written for this tenant, and the E2E stack applies
        // it, so the weekly chart has positions to show here.
        // Each shelf is answered by a read of its own, so each is waited for
        // on its own.
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('catalog-ranking')),
          timeout: const Duration(seconds: 20),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('catalog-new-arrivals')),
          timeout: const Duration(seconds: 20),
        );
        expect(
          find.byKey(const ValueKey('catalog-ranking-error')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('catalog-new-arrivals-error')),
          findsNothing,
        );
      });
    });

    testApp('a keyword finds the seed series on the live API', (tester) async {
      await withFailureScreenshot(tester, 'live-search', () async {
        await pumpLive(tester, initialLocation: AppRoutes.search);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
          timeout: const Duration(seconds: 20),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Series',
        );
        await pumpUntilFound(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          timeout: const Duration(seconds: 20),
        );

        expect(find.byKey(const ValueKey('search-series-error')), findsNothing);
      });
    });

    testApp('a name reaches the seed author and label on the live API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-search-author-label', () async {
        await pumpLive(tester, initialLocation: AppRoutes.search);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
          timeout: const Duration(seconds: 20),
        );

        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Author 001',
        );
        final author = find.byKey(const ValueKey('creator-tile-SeedAUTHAAA1'));
        await pumpUntilRouteSettled(
          tester,
          author,
          timeout: const Duration(seconds: 20),
        );
        await tapVisible(tester, author);
        // The seed credits its first author on its first series.
        await pumpUntilRouteSettled(
          tester,
          find.byKey(
            const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
          ),
          timeout: const Duration(seconds: 20),
        );

        await tapBack(tester);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('search-field')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('search-field')),
          'Seed Label 01',
        );
        final label = find.byKey(const ValueKey('label-tile-SeedLABLAAA1'));
        await pumpUntilRouteSettled(
          tester,
          label,
          timeout: const Duration(seconds: 20),
        );
        await tapVisible(tester, label);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('label-body')),
          timeout: const Duration(seconds: 20),
        );

        expect(find.byKey(const ValueKey('label-error')), findsNothing);
      });
    });

    testApp('seed series detail is reachable by public id', (tester) async {
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
        await scrollSeriesTo(
          tester,
          find.text(ConnectFixtureServer.seedEpisodeTitle),
        );

        expect(find.text('Episodes'), findsOneWidget);
        expect(
          find.text(ConnectFixtureServer.seedEpisodeTitle),
          findsOneWidget,
        );
      });
    });

    testApp('a free seed episode reaches the reader on the live API', (
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
        // The dev seed gives every episode a body, so a drawn page is what a
        // working round trip looks like here.
        await pumpUntilPagesDrawn(tester);
      });
    });

    testApp('a paid seed episode is locked for an anonymous reader', (
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

    testApp('missing public id is not found on the live API', (tester) async {
      await withFailureScreenshot(tester, 'live-not-found', () async {
        await pumpLive(tester, initialLocation: '/series/ZZZZZZZZZZZZ');
        await pumpUntilFound(
          tester,
          find.textContaining('Series not found'),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testApp('the seed member signs in and unlocks their ticketed episode', (
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
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('episode-locked')),
          timeout: const Duration(seconds: 20),
        );

        await tapReachable(tester, find.text('Sign in'));
        await pumpUntilRouteSettled(
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
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        // `db/seeds/dev/050_access_tickets.sql` gives this member an access
        // ticket for the episode, so the pages the development seed gave it
        // are what a granted body looks like here.
        await pumpUntilPagesDrawn(tester);
      });
    });

    testApp('the live API takes a sign-up and holds the account back', (
      tester,
    ) async {
      // A fresh address per run, because the account the last one created is
      // still in the seeded database and every sign-up is answered the same
      // way whether or not the address is taken.
      final email =
          'live-signup-${DateTime.now().microsecondsSinceEpoch}'
          '@example.test';
      await withFailureScreenshot(tester, 'live-sign-up', () async {
        await pumpLive(tester, initialLocation: AppRoutes.signUp);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
          timeout: const Duration(seconds: 20),
        );

        await tester.enterText(
          find.byKey(const ValueKey('sign-up-name')),
          'Live Signup Reader',
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-email')),
          email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password')),
          'live-signup-password',
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-up-password-confirm')),
          'live-signup-password',
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-up-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-up-pending')),
          timeout: const Duration(seconds: 20),
        );

        // The link is in a mailbox this test cannot read, so what it can
        // prove is the half the API owns: the account exists and Login keeps
        // refusing it until the address is confirmed.
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-up-pending-sign-in')),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-email')),
          email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('sign-in-password')),
          'live-signup-password',
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('sign-in-resend-verification')),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testApp('the live API takes a password reset request', (tester) async {
      // An address nobody has signed up with, which the API answers exactly
      // like a registered one, so the seed member's password and mail
      // allowance are left alone.
      final email =
          'live-reset-${DateTime.now().microsecondsSinceEpoch}'
          '@example.test';
      await withFailureScreenshot(tester, 'live-password-reset', () async {
        await pumpLive(tester, initialLocation: AppRoutes.resetPassword);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('reset-password-submit')),
          timeout: const Duration(seconds: 20),
        );
        await tester.enterText(
          find.byKey(const ValueKey('reset-password-email')),
          email,
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('reset-password-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('reset-password-sent')),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testApp('the live API refuses a reset link it never issued', (
      tester,
    ) async {
      // The real link is in a mailbox this test cannot read, so what it can
      // prove of that half is that a stray token is answered as a dead link
      // with the way back.
      await withFailureScreenshot(tester, 'live-reset-invalid', () async {
        await pumpLive(
          tester,
          initialLocation: '${AppRoutes.confirmPassword}?token=never-issued',
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
          timeout: const Duration(seconds: 20),
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password')),
          'live-reset-password',
        );
        await tester.enterText(
          find.byKey(const ValueKey('confirm-password-password-confirm')),
          'live-reset-password',
        );
        await tapReachable(
          tester,
          find.byKey(const ValueKey('confirm-password-submit')),
        );
        await pumpUntilFound(
          tester,
          find.byKey(const ValueKey('confirm-password-request-again')),
          timeout: const Duration(seconds: 20),
        );
      });
    });

    testApp('the seed member reads their inbox from the live API', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'live-notifications', () async {
        await pumpLive(tester, initialLocation: AppRoutes.notifications);
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('notifications-sign-in')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('notifications-sign-in')),
        );
        await pumpUntilRouteSettled(
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
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

        // The development seed delivers the member no notification, so what
        // this proves is that both inbox reads are answered, not what they
        // hold.
        await pumpUntilRouteSettled(
          tester,
          find.byWidgetPredicate(
            (widget) =>
                widget.key == const ValueKey('notifications-empty') ||
                widget.key == const ValueKey('notifications-list'),
          ),
          timeout: const Duration(seconds: 20),
        );
        expect(find.byKey(const ValueKey('notifications-error')), findsNothing);
      });
    });

    testApp('a visitor reads the live announcements', (tester) async {
      await withFailureScreenshot(tester, 'live-announcements', () async {
        await pumpLive(tester, initialLocation: AppRoutes.announcements);
        // The development seed posts no announcement for this tenant, so what
        // this proves is that the list is answered without a session and with
        // one, not what it holds.
        final answered = find.byWidgetPredicate(
          (widget) =>
              widget.key == const ValueKey('announcements-empty') ||
              widget.key == const ValueKey('announcements-list'),
        );
        await pumpUntilRouteSettled(
          tester,
          answered,
          timeout: const Duration(seconds: 20),
        );
        expect(find.byKey(const ValueKey('announcements-error')), findsNothing);
      });
    });

    testApp('wrong credentials are rejected by the live API', (tester) async {
      await withFailureScreenshot(tester, 'live-sign-in-error', () async {
        await pumpLive(tester, initialLocation: AppRoutes.signIn);
        await pumpUntilRouteSettled(
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
        await tapReachable(
          tester,
          find.byKey(const ValueKey('sign-in-submit')),
        );

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

    testApp('a written session survives a new store instance', (tester) async {
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
      offline = FileOfflineLibrary(
        tenantHost: 'localhost',
        root: () async => offlineRoot,
      );
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
          dismissedAnnouncements: MemoryDismissedAnnouncementStore(),
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

    testApp('a free episode read online turns again with the API gone', (
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

    testApp('the catalog opens from the device with the API gone', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-catalog', () async {
        // The list rather than the shelves above it: what the device keeps is
        // the catalog page, and the API has to have answered it before it can
        // be taken away.
        final tile = find.byKey(
          const ValueKey('series-tile-${ConnectFixtureServer.seedSeriesId}'),
        );
        await pumpLaunch(tester, apiBaseUrl: server.baseUrl);
        await pumpUntilFound(tester, tile);

        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(tester, apiBaseUrl: closedBaseUrl);
        await pumpUntilFound(tester, tile);

        expect(find.byKey(const ValueKey('catalog-error')), findsNothing);
      });
    });

    testApp('an unsaved episode says so rather than failing blankly', (
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
            matching: find.textContaining('You are offline'),
          ),
          findsOneWidget,
        );
      });
    });

    testApp('a paid episode saved by a member stops opening once they '
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
            matching: find.textContaining('You are offline'),
          ),
          findsOneWidget,
        );
      });
    });

    testApp('an episode the API takes back leaves the device', (tester) async {
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

    testApp('an episode reopens on its saved page with the API gone', (
      tester,
    ) async {
      await withFailureScreenshot(tester, 'offline-resume', () async {
        await pumpLaunch(
          tester,
          apiBaseUrl: server.baseUrl,
          session: memberSession(),
          initialLocation: AppRoutes.episodeViewerPath(
            ConnectFixtureServer.seedSeriesId,
            ConnectFixtureServer.seedEpisodeId,
          ),
        );
        await pumpUntilRouteSettled(
          tester,
          find.byKey(const ValueKey('episode-page-view')),
        );

        await tapReachable(
          tester,
          find.byKey(const ValueKey('episode-next-page')),
        );
        await pumpUntilTrue(
          tester,
          () =>
              server.readingPositions[ConnectFixtureServer.seedEpisodeId] == 1,
          description: 'the position to reach the API',
        );
        await waitForSavedPage(
          tester,
          pageKey(ConnectFixtureServer.seedEpisodeId, 2),
        );

        final closedBaseUrl = server.baseUrl;
        await server.close();

        await pumpLaunch(
          tester,
          apiBaseUrl: closedBaseUrl,
          session: memberSession(),
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
          find.text('2 / ${ConnectFixtureServer.seedEpisodePageCount}'),
          findsOneWidget,
        );
        await pumpUntilNoPendingFrameCallbacks(tester);
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

/// A browser that completes the payment it is handed, then runs [onPaid] the
/// way a real one returns through the checkout's success URL.
class _BrowserThatPays extends FakeCheckoutLauncher {
  _BrowserThatPays(this.onPaid);

  final void Function() onPaid;

  @override
  Future<bool> open(Uri url) async {
    final opened = await super.open(url);
    onPaid();
    return opened;
  }
}
