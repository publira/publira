import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/episode_image_client.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/device_key.dart';
import 'package:publira/offline/episode_downloader.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/offline/offline_catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';

final _series = fixtureSeries.last;
final _freeEpisode = fixtureDetail(_series).episodes.first;
final _secondEpisode = fixtureDetail(_series).episodes[1];
final _paidEpisode = fixtureDetail(_series).episodes.last;

class _FixedDeviceKey implements DeviceKeyStore {
  const _FixedDeviceKey();

  @override
  Future<Uint8List> read() async =>
      Uint8List.fromList(List<int>.generate(32, (index) => index * 5 % 256));
}

Uint8List _page(int seed) => Uint8List.fromList(
  List<int>.generate(256, (index) => (index + seed) % 256),
);

void main() {
  late Directory root;
  late FileOfflineLibrary library;
  late FakeCatalogRepository origin;
  late GoRouter router;
  late List<Uri> imageRequests;

  /// Holds every image response back until it completes, so a test can look
  /// at a save while it runs.
  Completer<void>? imageGate;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('publira-downloads-');
    library = FileOfflineLibrary(
      tenantHost: 'harbor.test',
      keys: const _FixedDeviceKey(),
      root: () async => root,
    );
    origin = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    imageRequests = [];
    imageGate = null;
  });

  tearDown(() async {
    if (await root.exists()) {
      await root.delete(recursive: true);
    }
  });

  /// Real file I/O only runs inside [WidgetTester.runAsync], so every wait on
  /// the library alternates a slice of real time with a frame.
  Future<void> pumpUntilFound(
    WidgetTester tester,
    Finder finder, {
    bool present = true,
  }) async {
    final end = DateTime.now().add(const Duration(seconds: 10));
    while (DateTime.now().isBefore(end)) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 50));
      if (finder.evaluate().isNotEmpty == present) {
        return;
      }
    }
    fail('Timed out waiting for $finder to be ${present ? '' : 'not '}found');
  }

  /// Opens the library's downloads from whichever tab is on screen.
  Future<void> openDownloads(WidgetTester tester) async {
    await tester.tap(find.byKey(const ValueKey('tab-library')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('library-tab-downloads')),
    );
    await tester.tap(find.byKey(const ValueKey('library-tab-downloads')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('downloads-usage')));
  }

  /// [pumpUntilFound] for what only the rendered copy reveals.
  Future<void> pumpUntilTrue(
    WidgetTester tester,
    bool Function() condition, {
    String description = 'condition',
  }) async {
    final end = DateTime.now().add(const Duration(seconds: 10));
    while (DateTime.now().isBefore(end)) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 50));
      if (condition()) {
        return;
      }
    }
    fail('Timed out waiting for $description');
  }

  /// Puts [episode] on the device the way reading it would have: the body
  /// filed under [ownerId], and every page it names, or the first [pages] of
  /// them for a reader who stopped partway.
  Future<void> seed(
    WidgetTester tester,
    EpisodeDetail episode, {
    String ownerId = '',
    DateTime? checkedAt,
    int? pages,
  }) async {
    await tester.runAsync(() async {
      await library.writeEpisode(
        SavedEpisode(
          detail: episode,
          ownerId: ownerId,
          checkedAt: checkedAt ?? DateTime.now(),
        ),
      );
      for (final (index, image)
          in episode.images.take(pages ?? episode.images.length).indexed) {
        await library.writePage(episodePageKey(image.url), _page(index));
      }
    });
  }

  EpisodeDetail body(String episodeId) =>
      fixtureEpisodes()[episodeKey(_series.id, episodeId)]!;

  Future<void> pumpApp(
    WidgetTester tester, {
    required String initialLocation,
  }) async {
    tester.view.physicalSize = const Size(1000, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    router = createAppRouter(initialLocation: initialLocation);
    final AuthController auth = fakeAuthController(session: fakeSession);
    final catalog = OfflineCatalogRepository(
      origin: origin,
      library: library,
      readerId: () => auth.session?.userPublicId ?? '',
      imageRequestHeaders: fixtureImageHeaders,
    );
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: auth,
        offline: library,
        downloader: EpisodeDownloader(
          catalog: catalog,
          library: library,
          openImages: () => EpisodeImageClient(
            pages: library,
            httpClient: MockClient((request) async {
              imageRequests.add(request.url);
              await imageGate?.future;
              return http.Response.bytes(_page(imageRequests.length), 200);
            }),
          ),
        ),
      ),
    );
  }

  String usage(WidgetTester tester) =>
      tester.widget<Text>(find.byKey(const ValueKey('downloads-usage'))).data!;

  testWidgets('the library leads to the downloads', (tester) async {
    await pumpApp(tester, initialLocation: AppRoutes.catalog);
    await openDownloads(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('downloads-empty')));

    expect(router.state.uri.path, AppRoutes.library);
    expect(usage(tester), '0 B of 512 MB used');
    expect(find.byKey(const ValueKey('downloads-clear')), findsNothing);
  });

  testWidgets(
    'saved episodes are listed by series with the window of a paid one',
    (tester) async {
      await seed(tester, body(_freeEpisode.id));
      await seed(
        tester,
        body(_secondEpisode.id),
        ownerId: fakeSession.userPublicId,
      );
      await seed(tester, body(_paidEpisode.id), ownerId: 'SomeoneElse01');

      await pumpApp(tester, initialLocation: AppRoutes.library);
      await openDownloads(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('downloads-episode-${_freeEpisode.id}')),
      );

      expect(find.byKey(ValueKey('downloads-series-${_series.id}')), findsOne);
      expect(find.text(_series.title), findsOne);
      expect(
        find.byKey(ValueKey('downloads-expiry-${_freeEpisode.id}')),
        findsNothing,
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(ValueKey('downloads-expiry-${_secondEpisode.id}')),
            )
            .data,
        startsWith('Readable offline until'),
      );
      // A body bought by another account is not this reader's to see.
      expect(
        find.byKey(ValueKey('downloads-episode-${_paidEpisode.id}')),
        findsNothing,
      );
      expect(usage(tester), isNot(startsWith('0 B')));
    },
  );

  testWidgets('a paid episode past its offline window says so', (tester) async {
    await seed(
      tester,
      body(_secondEpisode.id),
      ownerId: fakeSession.userPublicId,
      checkedAt: DateTime.now().subtract(const Duration(days: 8)),
    );

    await pumpApp(tester, initialLocation: AppRoutes.library);
    await openDownloads(tester);
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('downloads-expiry-${_secondEpisode.id}')),
    );

    expect(find.textContaining('Offline reading ended'), findsOne);
  });

  testWidgets(
    'a saved episode the app no longer shows is dropped rather than opened',
    (tester) async {
      await seed(tester, body(_freeEpisode.id));
      // The tenant has since kept the work to the storefront, which the API
      // answers the app as a work it does not have.
      origin.episodes = {
        for (final entry in fixtureEpisodes().entries)
          if (entry.value.episode.id != _freeEpisode.id) entry.key: entry.value,
      };

      await pumpApp(tester, initialLocation: AppRoutes.library);
      await openDownloads(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('downloads-episode-${_freeEpisode.id}')),
      );
      await tester.tap(
        find.byKey(ValueKey('downloads-episode-${_freeEpisode.id}')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-not-found')),
      );

      expect(find.byKey(const ValueKey('episode-page-view')), findsNothing);

      router.pop();
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('downloads-empty')),
      );
      expect(usage(tester), '0 B of 512 MB used');
    },
  );

  testWidgets(
    'deleting an episode frees its bytes and takes the mark off its row',
    (tester) async {
      await seed(tester, body(_freeEpisode.id));
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(_series.id),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-saved-offline')),
      );

      await openDownloads(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('downloads-delete-${_freeEpisode.id}')),
      );
      expect(usage(tester), isNot(startsWith('0 B')));

      await tester.tap(
        find.byKey(ValueKey('downloads-delete-${_freeEpisode.id}')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('downloads-empty')),
      );

      expect(usage(tester), '0 B of 512 MB used');
      expect(
        find.text('“${_freeEpisode.title}” was deleted from this device.'),
        findsOne,
      );

      // The series screen is still on the home tab.
      await tester.tap(find.byKey(const ValueKey('tab-home')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('episode-saved-offline')),
        present: false,
      );
      expect(
        find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
        findsOne,
      );
    },
  );

  testWidgets('clearing all empties the device once confirmed', (tester) async {
    await seed(tester, body(_freeEpisode.id));
    await seed(tester, body(_paidEpisode.id), ownerId: 'SomeoneElse01');
    await pumpApp(tester, initialLocation: AppRoutes.library);
    await openDownloads(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('downloads-clear')));

    await tester.tap(find.byKey(const ValueKey('downloads-clear')));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('downloads-clear-confirm')),
    );
    await tester.tap(find.byKey(const ValueKey('downloads-clear-confirm')));
    await pumpUntilFound(tester, find.byKey(const ValueKey('downloads-empty')));

    expect(usage(tester), '0 B of 512 MB used');
    final storage = await tester.runAsync(library.readStorage);
    expect(storage!.episodes, isEmpty);
  });

  testWidgets('saving an episode fetches every page and marks its row', (
    tester,
  ) async {
    final episode = body(_freeEpisode.id);
    imageGate = Completer<void>();
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(_series.id),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );

    await tester.tap(
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-saving-offline-${_freeEpisode.id}')),
    );
    // The body is on the device before its first page is, and the row keeps
    // saying the save is still running.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump(const Duration(milliseconds: 50));
    expect(
      find.byKey(ValueKey('episode-saving-offline-${_freeEpisode.id}')),
      findsOne,
    );
    expect(find.byKey(const ValueKey('episode-saved-offline')), findsNothing);
    imageGate!.complete();
    await pumpUntilFound(
      tester,
      find.text('“${_freeEpisode.title}” is saved on this device.'),
    );

    expect(imageRequests, [for (final image in episode.images) image.url]);
    expect(find.byKey(const ValueKey('episode-saved-offline')), findsOne);
    final pages = await tester.runAsync(
      () => Future.wait([
        for (final image in episode.images)
          library.readPage(episodePageKey(image.url)),
      ]),
    );
    expect(pages, everyElement(isNotNull));
  });

  testWidgets('a save that finishes under the screen grows the bytes shown', (
    tester,
  ) async {
    imageGate = Completer<void>();
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(_series.id),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );
    await tester.tap(
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-saving-offline-${_freeEpisode.id}')),
    );

    await openDownloads(tester);
    await pumpUntilFound(tester, find.byKey(const ValueKey('downloads-usage')));
    expect(usage(tester), '0 B of 512 MB used');

    imageGate!.complete();
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('downloads-episode-${_freeEpisode.id}')),
    );
    // The episode is listed as soon as its body is filed; the bytes follow
    // the pages, which is what the screen reads again once the save is done.
    await pumpUntilTrue(tester, () => !usage(tester).startsWith('0 B'));
    await pumpUntilFound(
      tester,
      find.text('“${_freeEpisode.title}” is saved on this device.'),
    );
  });

  testWidgets(
    'an episode read halfway offers its save and says it is partial',
    (tester) async {
      final episode = body(_freeEpisode.id);
      expect(episode.images.length, greaterThan(1));
      await seed(tester, episode, pages: 1);
      await pumpApp(
        tester,
        initialLocation: AppRoutes.seriesDetailPath(_series.id),
      );
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
      );
      expect(find.byKey(const ValueKey('episode-saved-offline')), findsNothing);

      await openDownloads(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('downloads-partial-${_freeEpisode.id}')),
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(ValueKey('downloads-partial-${_freeEpisode.id}')),
            )
            .data,
        startsWith('Partly saved: 1 of ${episode.images.length} pages.'),
      );

      // The series screen is still on the home tab.
      await tester.tap(find.byKey(const ValueKey('tab-home')));
      final saveAction = find.byKey(
        ValueKey('episode-save-offline-${_freeEpisode.id}'),
      );
      await pumpUntilFound(tester, saveAction);
      final saveActionBox = tester.getRect(saveAction);
      final saveActionIcon = tester.getRect(
        find.descendant(of: saveAction, matching: find.byType(Icon)),
      );
      await tester.tap(saveAction);
      final savedMark = find.byKey(const ValueKey('episode-saved-offline'));
      await pumpUntilFound(tester, savedMark);

      // The row turns from the save action into the mark without its icon
      // moving or changing size.
      expect(tester.getRect(savedMark), saveActionBox);
      expect(
        tester.getRect(
          find.descendant(of: savedMark, matching: find.byType(Icon)),
        ),
        saveActionIcon,
      );

      // The page already on the device is not fetched again.
      expect(imageRequests, [
        for (final image in episode.images.skip(1)) image.url,
      ]);
      await openDownloads(tester);
      await pumpUntilFound(
        tester,
        find.byKey(ValueKey('downloads-episode-${_freeEpisode.id}')),
      );
      expect(
        find.byKey(ValueKey('downloads-partial-${_freeEpisode.id}')),
        findsNothing,
      );
    },
  );

  testWidgets('a paid episode with no known access offers no save', (
    tester,
  ) async {
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(_series.id),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );

    expect(
      find.byKey(ValueKey('episode-save-offline-${_paidEpisode.id}')),
      findsNothing,
    );
  });

  testWidgets('a save the API refuses is reported and marks nothing', (
    tester,
  ) async {
    origin.episodes = fixtureEpisodes(access: EpisodeAccess.locked);
    await pumpApp(
      tester,
      initialLocation: AppRoutes.seriesDetailPath(_series.id),
    );
    await pumpUntilFound(
      tester,
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );

    await tester.tap(
      find.byKey(ValueKey('episode-save-offline-${_freeEpisode.id}')),
    );
    await pumpUntilFound(
      tester,
      find.text('“${_freeEpisode.title}” cannot be saved on this device.'),
    );

    expect(imageRequests, isEmpty);
    expect(find.byKey(const ValueKey('episode-saved-offline')), findsNothing);
  });
}
