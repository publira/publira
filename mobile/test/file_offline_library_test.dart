import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/device_key.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/offline/offline_cipher.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/tenant/tenant_brand.dart';

final _deviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 7 % 256),
);

final _otherDeviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 11 % 256),
);

const _seriesId = 'SeedSERSAAA1';

const _tenantHost = 'harbor.test';

/// A key the reader never fetched, so nothing but a sweep can remove it.
final _orphanPageKey = episodePageKey(Uri.parse('http://images.test/orphan'));

class _FixedDeviceKey implements DeviceKeyStore {
  const _FixedDeviceKey(this.key);

  final Uint8List key;

  @override
  Future<Uint8List> read() async => key;
}

class _NoDeviceKey implements DeviceKeyStore {
  const _NoDeviceKey();

  @override
  Future<Uint8List> read() async =>
      throw StateError('this platform has no credential store');
}

Uri _pageUrl(String episodeId, int page) =>
    Uri.parse('http://images.test/media/$episodeId-$page');

SavedEpisode _episode(
  String episodeId, {
  String ownerId = '',
  DateTime? checkedAt,
  int pages = 1,
  EpisodeAccess access = EpisodeAccess.free,
}) {
  return SavedEpisode(
    ownerId: ownerId,
    checkedAt: checkedAt ?? DateTime.utc(2026, 9),
    detail: EpisodeDetail(
      episode: EpisodeItem(
        id: episodeId,
        title: 'Episode $episodeId',
        orderIndex: 1,
        price: ownerId.isEmpty ? 0 : 500,
      ),
      seriesId: _seriesId,
      seriesTitle: 'Seed Series 001',
      access: access,
      images: [
        for (var page = 1; page <= pages; page++)
          EpisodeImageItem(
            id: '$episodeId-page-$page',
            url: _pageUrl(episodeId, page),
            displayOrder: page,
            width: 800,
            height: 1200,
          ),
      ],
    ),
  );
}

Uint8List _bytes(int length, int seed) => Uint8List.fromList(
  List<int>.generate(length, (index) => (index + seed) % 256),
);

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('publira-offline-');
  });

  tearDown(() async {
    if (await root.exists()) {
      await root.delete(recursive: true);
    }
  });

  FileOfflineLibrary open({
    String tenantHost = _tenantHost,
    Uint8List? deviceKey,
    int byteLimit = offlineByteLimit,
  }) {
    return FileOfflineLibrary(
      tenantHost: tenantHost,
      keys: _FixedDeviceKey(deviceKey ?? _deviceKey),
      root: () async => root,
      byteLimit: byteLimit,
    );
  }

  test('a saved catalog is read back by the next launch', () async {
    await open().writeSeriesList(
      const SeriesPage(
        series: [
          SeriesItem(
            id: _seriesId,
            title: 'Seed Series 001',
            description: 'Summer holidays',
          ),
        ],
        nextToken: 'page-2',
      ),
    );

    // A second instance stands in for the next launch: nothing carries over in
    // memory, so what comes back came off the disk.
    final restored = await open().readSeriesList();

    expect(restored!.series, hasLength(1));
    expect(restored.series.single.id, _seriesId);
    expect(restored.series.single.description, 'Summer holidays');
    // The token comes back with the page, so a launch without a network still
    // knows there is a page under the saved one to ask for.
    expect(restored.nextToken, 'page-2');
  });

  test('the tenant brand is read back by the next launch', () async {
    await open().writeTenantBrand(
      _tenantHost,
      TenantBrand(
        name: 'Harbor Comics',
        palette: TenantPalette.fromWire(const {'primaryColor': '#0b6e4f'}),
        logo: TenantLogo(
          url: Uri.parse('http://images.test/images/tenants/LOGO/logo'),
          width: 320,
          height: 80,
        ),
      ),
    );

    final restored = await open().readTenantBrand(_tenantHost);

    expect(restored!.name, 'Harbor Comics');
    expect(restored.palette[TenantColor.primary], const Color(0xFF0B6E4F));
    expect(
      restored.palette[TenantColor.secondary],
      TenantColor.secondary.fallback,
    );
    expect(
      restored.logo?.url,
      Uri.parse('http://images.test/images/tenants/LOGO/logo'),
    );
    expect(restored.logo?.height, 80);
  });

  test('clearing the library forgets the tenant brand', () async {
    final library = open();
    await library.writeTenantBrand(
      _tenantHost,
      const TenantBrand(name: 'Harbor Comics'),
    );

    await library.clear();

    expect(await open().readTenantBrand(_tenantHost), isNull);
  });

  test('a brand saved for another tenant is not answered', () async {
    await open().writeTenantBrand(
      _tenantHost,
      const TenantBrand(name: 'Harbor Comics'),
    );

    expect(
      await open(tenantHost: 'ember.test').readTenantBrand('ember.test'),
      isNull,
    );
  });

  test('a library opened for another tenant answers nothing saved', () async {
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    final harbor = open();
    await harbor.writeTenantBrand(
      _tenantHost,
      const TenantBrand(name: 'Harbor Comics'),
    );
    await harbor.writeSeriesList(
      const SeriesPage(
        series: [
          SeriesItem(id: _seriesId, title: 'Seed Series 001', description: ''),
        ],
      ),
    );
    await harbor.writeSeriesDetail(
      const SeriesDetail(
        series: SeriesItem(
          id: _seriesId,
          title: 'Seed Series 001',
          description: '',
        ),
        episodes: [],
      ),
    );
    await harbor.writeEpisode(
      _episode('EP1', ownerId: 'SeedMMBRAAA1', access: EpisodeAccess.entitled),
    );
    await harbor.writePage(pageKey, _bytes(64, 3));
    await harbor.writeReadingPosition(
      _seriesId,
      'EP1',
      readerId: 'SeedMMBRAAA1',
      pageIndex: 11,
    );

    final ember = open(tenantHost: 'ember.test');

    expect(await ember.readSeriesList(), isNull);
    expect(await ember.readSeriesDetail(_seriesId), isNull);
    expect(await ember.readEpisode(_seriesId, 'EP1'), isNull);
    expect(
      await ember.readableEpisodeIds(_seriesId, readerId: 'SeedMMBRAAA1'),
      isEmpty,
    );
    expect(await ember.readPage(pageKey), isNull);
    expect(
      await ember.readReadingPosition(
        _seriesId,
        'EP1',
        readerId: 'SeedMMBRAAA1',
      ),
      isNull,
    );
    // The pages go with the index rather than sitting on the device under a
    // tenant this build will never read for.
    expect(await Directory('${root.path}/pages').list().toList(), isEmpty);
  });

  test('a page left on the disk without an index is not answered', () async {
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await open().writePage(pageKey, _bytes(64, 3));
    // A run that died before its index landed leaves the page behind alone.
    final index = File('${root.path}/index.json');
    if (await index.exists()) {
      await index.delete();
    }

    expect(await open(tenantHost: 'ember.test').readPage(pageKey), isNull);
    expect(await Directory('${root.path}/pages').list().toList(), isEmpty);
  });

  test('what a build saves after a tenant switch stays its own', () async {
    await open().writeEpisode(_episode('EP1'));
    await open(tenantHost: 'ember.test').writeEpisode(_episode('EP2'));

    final ember = open(tenantHost: 'ember.test');
    expect(await ember.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await ember.readEpisode(_seriesId, 'EP2'), isNotNull);
    expect(await open().readEpisode(_seriesId, 'EP2'), isNull);
  });

  test('a saved catalog that ended keeps no token', () async {
    await open().writeSeriesList(
      const SeriesPage(
        series: [
          SeriesItem(id: _seriesId, title: 'Seed Series 001', description: ''),
        ],
      ),
    );

    expect((await open().readSeriesList())!.nextToken, isEmpty);
  });

  test('a saved catalog keeps the cover renditions of its series', () async {
    await open().writeSeriesList(
      SeriesPage(
        series: [
          SeriesItem(
            id: _seriesId,
            title: 'Seed Series 001',
            description: 'Summer holidays',
            eyeCatchVariants: [
              EyeCatchVariant(
                variantType: 'portrait',
                url: Uri.parse(
                  'http://images.test/images/series/IMG/portrait/800',
                ),
                width: 800,
                height: 1066,
              ),
            ],
          ),
        ],
      ),
    );

    final restored = await open().readSeriesList();

    final cover = restored!.series.single.eyeCatchVariants.single;
    expect(cover.variantType, 'portrait');
    expect(
      cover.url.toString(),
      'http://images.test/images/series/IMG/portrait/800',
    );
    expect(cover.width, 800);
    expect(cover.height, 1066);
  });

  test('a catalog that was never saved reads as absent', () async {
    expect(await open().readSeriesList(), isNull);
  });

  test('a saved episode keeps its pages in reading order', () async {
    final library = open();
    await library.writeEpisode(_episode('EP1', pages: 2));

    final restored = await open().readEpisode(_seriesId, 'EP1');

    expect(restored, isNotNull);
    expect(restored!.detail.episode.title, 'Episode EP1');
    expect(restored.detail.images.map((image) => image.url), [
      _pageUrl('EP1', 1),
      _pageUrl('EP1', 2),
    ]);
  });

  test('a saved page comes back as the bytes that went in', () async {
    final page = _bytes(64, 3);
    await open().writePage('page-key', page);

    expect(await open().readPage('page-key'), page);
  });

  test('a page is not left on the disk in the clear', () async {
    final page = _bytes(64, 3);
    await open().writePage('page-key', page);

    final onDisk = await File('${root.path}/pages/page-key.bin').readAsBytes();

    // The nonce rides in front of the ciphertext, so the file is longer than
    // the page by exactly that much.
    expect(onDisk, hasLength(offlineNonceLength + page.length));
    expect(onDisk.sublist(offlineNonceLength), isNot(page));
  });

  test('a library whose device key is gone starts empty', () async {
    final library = open();
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(episodePageKey(_pageUrl('EP1', 1)), _bytes(64, 3));

    final reopened = open(deviceKey: _otherDeviceKey);

    expect(await reopened.readEpisode(_seriesId, 'EP1'), isNull);
    // Nothing under the old key reads, so the pages go with the index rather
    // than sitting on the device unreadable.
    expect(await reopened.readPage(episodePageKey(_pageUrl('EP1', 1))), isNull);
  });

  test('a reading position is read back by the next launch', () async {
    await open().writeReadingPosition(
      _seriesId,
      'EP1',
      readerId: 'SeedMMBRAAA1',
      pageIndex: 11,
    );

    expect(
      await open().readReadingPosition(
        _seriesId,
        'EP1',
        readerId: 'SeedMMBRAAA1',
      ),
      11,
    );
  });

  test('a reading position is closed to a second reader', () async {
    final library = open();
    await library.writeReadingPosition(
      _seriesId,
      'EP1',
      readerId: 'SeedMMBRAAA1',
      pageIndex: 11,
    );

    expect(
      await library.readReadingPosition(
        _seriesId,
        'EP1',
        readerId: 'SeedMMBRAAA2',
      ),
      isNull,
    );
  });

  test('a position is dropped with the episode it points into', () async {
    final library = open();
    await library.writeEpisode(_episode('EP1'));
    await library.writeReadingPosition(
      _seriesId,
      'EP1',
      readerId: 'SeedMMBRAAA1',
      pageIndex: 11,
    );

    await library.removeEpisode(_seriesId, 'EP1');

    expect(
      await library.readReadingPosition(
        _seriesId,
        'EP1',
        readerId: 'SeedMMBRAAA1',
      ),
      isNull,
    );
  });

  test('a series the API dropped takes its positions with it', () async {
    final library = open();
    await library.writeEpisode(_episode('EP1'));
    await library.writeReadingPosition(
      _seriesId,
      'EP1',
      readerId: 'SeedMMBRAAA1',
      pageIndex: 11,
    );

    await library.removeSeries(_seriesId);

    expect(
      await library.readReadingPosition(
        _seriesId,
        'EP1',
        readerId: 'SeedMMBRAAA1',
      ),
      isNull,
    );
  });

  test('removing an episode takes its pages with it', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(pageKey, _bytes(64, 3));

    await library.removeEpisode(_seriesId, 'EP1');

    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readPage(pageKey), isNull);
  });

  test('storage counts the pages each saved episode holds', () async {
    final library = open(byteLimit: 4096);
    await library.writeEpisode(
      _episode('OLD', pages: 2, checkedAt: DateTime.utc(2026, 8)),
    );
    await library.writePage(episodePageKey(_pageUrl('OLD', 1)), _bytes(64, 1));
    await library.writePage(episodePageKey(_pageUrl('OLD', 2)), _bytes(64, 2));
    await library.writeEpisode(
      _episode('NEW', checkedAt: DateTime.utc(2026, 9)),
    );
    await library.writePage(episodePageKey(_pageUrl('NEW', 1)), _bytes(64, 3));
    await library.writePage(_orphanPageKey, _bytes(64, 4));

    final storage = await library.readStorage();

    expect(storage.byteLimit, 4096);
    expect(
      [for (final stored in storage.episodes) stored.episode.detail.episode.id],
      ['NEW', 'OLD'],
    );
    final newBytes = storage.episodes.first.bytes;
    final oldBytes = storage.episodes.last.bytes;
    // Every page is sealed the same way, so two pages weigh twice one.
    expect(newBytes, greaterThan(64));
    expect(oldBytes, newBytes * 2);
    // A page no episode claims still takes room under the limit.
    expect(storage.bytes, newBytes * 4);
  });

  test('removing an episode frees the bytes storage reports', () async {
    final library = open();
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(episodePageKey(_pageUrl('EP1', 1)), _bytes(64, 1));
    await library.writeEpisode(_episode('EP2'));
    await library.writePage(episodePageKey(_pageUrl('EP2', 1)), _bytes(64, 2));
    final before = await library.readStorage();

    await library.removeEpisode(_seriesId, 'EP1');

    final after = await library.readStorage();
    expect(after.bytes, before.bytes - before.episodes.first.bytes);
    expect(after.episodes.single.episode.detail.episode.id, 'EP2');
  });

  test('storage on a device with nowhere to write is empty', () async {
    final library = FileOfflineLibrary(
      tenantHost: _tenantHost,
      keys: const _NoDeviceKey(),
      root: () async => root,
    );

    final storage = await library.readStorage();

    expect(storage.bytes, 0);
    expect(storage.episodes, isEmpty);
  });

  test('a change to the saved episodes is announced', () async {
    final library = open(byteLimit: 100);
    var changes = 0;
    final subscription = library.changes.listen((_) => changes++);
    addTearDown(subscription.cancel);

    Future<int> countAfter(Future<void> Function() action) async {
      final before = changes;
      await action();
      // A broadcast stream delivers on a later microtask.
      await Future<void>.delayed(Duration.zero);
      return changes - before;
    }

    expect(await countAfter(() => library.writeEpisode(_episode('OLD'))), 1);
    expect(
      await countAfter(
        () => library.writePage(
          episodePageKey(_pageUrl('OLD', 1)),
          _bytes(80, 1),
        ),
      ),
      0,
    );
    expect(await countAfter(() => library.writeEpisode(_episode('NEW'))), 1);
    // Over the limit, so the first episode is evicted.
    expect(
      await countAfter(
        () => library.writePage(
          episodePageKey(_pageUrl('NEW', 1)),
          _bytes(80, 2),
        ),
      ),
      1,
    );
    expect(await countAfter(() => library.removeEpisode(_seriesId, 'NEW')), 1);
    expect(await countAfter(library.clear), 1);
  });

  test('the byte limit drops the least recently confirmed episode', () async {
    final library = open(byteLimit: 100);
    await library.writeEpisode(
      _episode('OLD', checkedAt: DateTime.utc(2026, 8)),
    );
    await library.writePage(episodePageKey(_pageUrl('OLD', 1)), _bytes(80, 1));
    await library.writeEpisode(
      _episode('NEW', checkedAt: DateTime.utc(2026, 9)),
    );
    await library.writePage(episodePageKey(_pageUrl('NEW', 1)), _bytes(80, 2));

    expect(await library.readEpisode(_seriesId, 'OLD'), isNull);
    expect(await library.readPage(episodePageKey(_pageUrl('OLD', 1))), isNull);
    expect(await library.readEpisode(_seriesId, 'NEW'), isNotNull);
    expect(
      await library.readPage(episodePageKey(_pageUrl('NEW', 1))),
      hasLength(80),
    );
  });

  test('a page no episode claims is swept before any episode is', () async {
    final library = open(byteLimit: 100);
    await library.writePage(_orphanPageKey, _bytes(80, 1));
    await library.writeEpisode(_episode('KEPT'));
    await library.writePage(episodePageKey(_pageUrl('KEPT', 1)), _bytes(80, 2));

    expect(await library.readPage(_orphanPageKey), isNull);
    expect(await library.readEpisode(_seriesId, 'KEPT'), isNotNull);
  });

  test(
    'readableEpisodeIds leaves out a body granted to another reader',
    () async {
      final library = open();
      await library.writeEpisode(_episode('FREE'));
      await library.writeEpisode(
        _episode('MINE', ownerId: 'READER1', access: EpisodeAccess.entitled),
      );
      await library.writeEpisode(
        _episode('THEIRS', ownerId: 'READER2', access: EpisodeAccess.entitled),
      );

      expect(
        await library.readableEpisodeIds(
          _seriesId,
          readerId: 'READER1',
          now: DateTime.utc(2026, 9),
        ),
        {'FREE', 'MINE'},
      );
    },
  );

  test(
    'readableEpisodeIds leaves out a body past its offline window',
    () async {
      final library = open();
      await library.writeEpisode(
        _episode(
          'MINE',
          ownerId: 'READER1',
          access: EpisodeAccess.entitled,
          checkedAt: DateTime.utc(2026, 9),
        ),
      );

      expect(
        await library.readableEpisodeIds(
          _seriesId,
          readerId: 'READER1',
          now: DateTime.utc(2026, 9).add(offlineGracePeriod * 2),
        ),
        isEmpty,
      );
    },
  );

  test('dropping a series takes its episodes and pages with it', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await library.writeSeriesDetail(
      const SeriesDetail(
        series: SeriesItem(
          id: _seriesId,
          title: 'Seed Series 001',
          description: '',
        ),
        episodes: [],
      ),
    );
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(pageKey, _bytes(64, 3));

    await library.removeSeries(_seriesId);

    expect(await library.readSeriesDetail(_seriesId), isNull);
    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readPage(pageKey), isNull);
  });

  test('rewriting a page does not reuse its keystream', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    final file = File('${root.path}/pages/$pageKey.bin');

    await library.writePage(pageKey, _bytes(64, 3));
    final first = await file.readAsBytes();
    await library.writePage(pageKey, _bytes(64, 3));
    final second = await file.readAsBytes();

    expect(first, isNot(second));
    expect(await library.readPage(pageKey), _bytes(64, 3));
  });

  test(
    'readableEpisodeIds refuses a confirmation dated in the future',
    () async {
      final library = open();
      await library.writeEpisode(
        _episode(
          'MINE',
          ownerId: 'READER1',
          access: EpisodeAccess.entitled,
          checkedAt: DateTime.utc(2026, 10),
        ),
      );

      // A clock pushed forward and back would otherwise leave the body inside a
      // window that has not started yet.
      expect(
        await library.readableEpisodeIds(
          _seriesId,
          readerId: 'READER1',
          now: DateTime.utc(2026, 9),
        ),
        isEmpty,
      );
    },
  );

  test('clear leaves nothing behind', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await library.writeSeriesList(
      const SeriesPage(
        series: [
          SeriesItem(id: _seriesId, title: 'Seed Series 001', description: ''),
        ],
      ),
    );
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(pageKey, _bytes(64, 3));

    await library.clear();

    expect(await library.readSeriesList(), isNull);
    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readPage(pageKey), isNull);
  });

  test('a device with nowhere to keep a key reads as empty', () async {
    final library = FileOfflineLibrary(
      tenantHost: _tenantHost,
      keys: const _NoDeviceKey(),
      root: () async => root,
    );

    await library.writeEpisode(_episode('EP1'));

    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readSeriesList(), isNull);
    expect(await library.readableEpisodeIds(_seriesId, readerId: ''), isEmpty);
  });

  test('a device with nowhere to write reads as empty', () async {
    final library = FileOfflineLibrary(
      tenantHost: _tenantHost,
      keys: _FixedDeviceKey(_deviceKey),
      root: () async => throw const FileSystemException('no such directory'),
    );

    await library.writePage('page-key', _bytes(64, 3));

    expect(await library.readPage('page-key'), isNull);
  });
}
