import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/episode_page_store.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/device_key.dart';
import 'package:publira/offline/file_offline_library.dart';
import 'package:publira/offline/offline_library.dart';

final _deviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 7 % 256),
);

final _otherDeviceKey = Uint8List.fromList(
  List<int>.generate(32, (index) => index * 11 % 256),
);

const _seriesId = 'SeedSERSAAA1';

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
    Uint8List? deviceKey,
    int byteLimit = offlineByteLimit,
  }) {
    return FileOfflineLibrary(
      keys: _FixedDeviceKey(deviceKey ?? _deviceKey),
      root: () async => root,
      byteLimit: byteLimit,
    );
  }

  test('a saved catalog is read back by the next launch', () async {
    await open().writeSeriesList(const [
      SeriesItem(id: _seriesId, title: 'Seed Series 001', description: 'なつやすみ'),
    ]);

    // A second instance stands in for the next launch: nothing carries over in
    // memory, so what comes back came off the disk.
    final restored = await open().readSeriesList();

    expect(restored, hasLength(1));
    expect(restored!.single.id, _seriesId);
    expect(restored.single.description, 'なつやすみ');
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

    expect(onDisk, hasLength(page.length));
    expect(onDisk, isNot(page));
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

  test('removing an episode takes its pages with it', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(pageKey, _bytes(64, 3));

    await library.removeEpisode(_seriesId, 'EP1');

    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readPage(pageKey), isNull);
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

  test('clear leaves nothing behind', () async {
    final library = open();
    final pageKey = episodePageKey(_pageUrl('EP1', 1));
    await library.writeSeriesList(const [
      SeriesItem(id: _seriesId, title: 'Seed Series 001', description: ''),
    ]);
    await library.writeEpisode(_episode('EP1'));
    await library.writePage(pageKey, _bytes(64, 3));

    await library.clear();

    expect(await library.readSeriesList(), isNull);
    expect(await library.readEpisode(_seriesId, 'EP1'), isNull);
    expect(await library.readPage(pageKey), isNull);
  });

  test('a device with nowhere to keep a key reads as empty', () async {
    final library = FileOfflineLibrary(
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
      keys: _FixedDeviceKey(_deviceKey),
      root: () async => throw const FileSystemException('no such directory'),
    );

    await library.writePage('page-key', _bytes(64, 3));

    expect(await library.readPage('page-key'), isNull);
  });
}
