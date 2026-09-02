import 'package:flutter_test/flutter_test.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_json.dart';

Map<String, Object?> _index(Map<String, Object?> episode) => {
  'version': offlineIndexVersion,
  'details': const <String, Object?>{},
  'episodes': {'SeedSERSAAA1/SeedEPSDAAA1': episode},
};

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
}
