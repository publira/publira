import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_json.dart';
import 'package:publira/offline/offline_library.dart';

Map<String, Object?> _index(
  Map<String, Object?> episode, {
  List<Map<String, Object?>>? series,
}) => {
  'version': offlineIndexVersion,
  'series': ?series,
  'details': const <String, Object?>{},
  'episodes': {'SeedSERSAAA1/SeedEPSDAAA1': episode},
};

/// One saved series whose covers mix a resolved URL with a relative one.
List<Map<String, Object?>> _series() => [
  {
    'id': 'SeedSERSAAA1',
    'title': 'Seed Series 001',
    'description': 'synopsis',
    'eyeCatchVariants': [
      {
        'variantType': 'portrait',
        'url': 'http://images.test/images/series/IMG/portrait/800',
        'width': 800,
        'height': 1066,
      },
      {
        'variantType': 'portrait',
        'url': 'images/series/IMG/portrait/400',
        'width': 400,
        'height': 533,
      },
    ],
  },
];

Map<String, Object?> _episode({
  required String access,
  String? ownerId = 'SeedMMBRAAA1',
}) => {
  'ownerId': ?ownerId,
  'checkedAt': '2026-09-01T00:00:00.000Z',
  'seriesId': 'SeedSERSAAA1',
  'seriesTitle': 'Seed Series 001',
  'access': access,
  'episode': const {
    'id': 'SeedEPSDAAA1',
    'title': 'Seed Episode 001-01',
    'orderIndex': 1,
    'price': 500,
  },
  'images': const <Object?>[],
};

void main() {
  test('an index written under another version is dropped whole', () {
    final decoded = OfflineIndex.fromJson({
      ..._index(_episode(access: 'free')),
      'version': offlineIndexVersion + 1,
    });

    expect(decoded, isNull);
  });

  test('an entitled record keeps the reader it was granted to', () {
    final decoded = OfflineIndex.fromJson(_index(_episode(access: 'entitled')));

    expect(decoded!.episodes.values.single.ownerId, 'SeedMMBRAAA1');
    expect(
      decoded.episodes.values.single.detail.access,
      EpisodeAccess.entitled,
    );
  });

  test('an entitled record naming no reader is dropped, not opened up', () {
    // An empty owner is what marks a free body, so reading this leniently
    // would turn a paid body into one a signed-out device may open.
    final decoded = OfflineIndex.fromJson(
      _index(_episode(access: 'entitled', ownerId: null)),
    );

    expect(decoded!.episodes, isEmpty);
  });

  test('a free record needs no reader', () {
    final decoded = OfflineIndex.fromJson(
      _index(_episode(access: 'free', ownerId: '')),
    );

    expect(decoded!.episodes.values.single.detail.access, EpisodeAccess.free);
  });

  test('a record with an access this build cannot read is dropped', () {
    final decoded = OfflineIndex.fromJson(
      _index(_episode(access: 'EPISODE_ACCESS_SOMETHING_NEW', ownerId: null)),
    );

    expect(decoded!.episodes, isEmpty);
  });

  test('a cover rendition this build cannot address is dropped', () {
    // A cover is written down already resolved against the image base, so a
    // relative reference names no server to ask.
    final decoded = OfflineIndex.fromJson(
      _index(
        _episode(access: 'free', ownerId: ''),
        series: _series(),
      ),
    );

    final variants = decoded!.series!.single.eyeCatchVariants;
    expect(variants, hasLength(1));
    expect(
      variants.single.url.toString(),
      'http://images.test/images/series/IMG/portrait/800',
    );
  });

  test('a reading position survives the round trip', () {
    final written = OfflineIndex(
      positions: {
        'SeedSERSAAA1/SeedEPSDAAA1': const SavedReadingPosition(
          readerId: 'SeedMMBRAAA1',
          pageIndex: 11,
        ),
      },
    ).toJson();

    final decoded = OfflineIndex.fromJson(written);

    final position = decoded!.positions['SeedSERSAAA1/SeedEPSDAAA1']!;
    expect(position.readerId, 'SeedMMBRAAA1');
    expect(position.pageIndex, 11);
  });

  test('a position naming no reader is dropped', () {
    // A position belongs to the member who left it, so one that names nobody
    // is not a page to answer whoever is holding the phone with.
    final decoded = OfflineIndex.fromJson({
      ..._index(_episode(access: 'free', ownerId: '')),
      'positions': const {
        'SeedSERSAAA1/SeedEPSDAAA1': {'readerId': '', 'pageIndex': 11},
      },
    });

    expect(decoded!.positions, isEmpty);
  });

  test('an index written before positions existed still reads', () {
    final decoded = OfflineIndex.fromJson(
      _index(_episode(access: 'free', ownerId: '')),
    );

    expect(decoded!.episodes, hasLength(1));
    expect(decoded.positions, isEmpty);
  });
}
