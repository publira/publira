import 'package:flutter_test/flutter_test.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';

import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';

const _seriesId = 'SeedSERSAAA1';
const _episodeId = 'SeedEPSDAAA1';
const _reader = 'SeedMMBRAAA1';

const _network = CatalogFailure(CatalogFailureKind.network);
const _unexpected = CatalogFailure(CatalogFailureKind.unexpected);

final _checkedAt = DateTime.utc(2026, 9);

/// A paid page as the API hands it over: the media token that reads it sits in
/// the query, and the reader's bearer travels beside it.
final _pageUrl = Uri.parse(
  'http://images.test/media/$_episodeId-1?t=media-token',
);

EpisodeDetail _detail({
  EpisodeAccess access = EpisodeAccess.free,
  Map<String, String> headers = const {'authorization': 'Bearer reader-token'},
}) {
  return EpisodeDetail(
    episode: const EpisodeItem(
      id: _episodeId,
      title: 'Seed Episode 001-01',
      orderIndex: 1,
      price: 0,
    ),
    seriesId: _seriesId,
    seriesTitle: 'Seed Series 001',
    access: access,
    images: [
      EpisodeImageItem(
        id: '$_episodeId-page-1',
        url: _pageUrl,
        displayOrder: 1,
        width: 800,
        height: 1200,
      ),
    ],
    imageRequestHeaders: headers,
  );
}

SeriesDetail _seriesDetail() {
  return const SeriesDetail(
    series: SeriesItem(
      id: _seriesId,
      title: 'Seed Series 001',
      description: 'synopsis',
    ),
    episodes: [
      EpisodeItem(
        id: _episodeId,
        title: 'Seed Episode 001-01',
        orderIndex: 1,
        price: 0,
      ),
    ],
  );
}

void main() {
  late FakeCatalogRepository origin;
  late InMemoryOfflineLibrary library;
  late String readerId;
  late DateTime now;

  setUp(() {
    origin = FakeCatalogRepository(
      series: const [
        SeriesItem(id: _seriesId, title: 'Seed Series 001', description: ''),
      ],
      details: {_seriesId: _seriesDetail()},
      episodes: {episodeKey(_seriesId, _episodeId): _detail()},
    );
    library = InMemoryOfflineLibrary();
    readerId = '';
    now = _checkedAt;
  });

  OfflineCatalogRepository build() {
    return OfflineCatalogRepository(
      origin: origin,
      library: library,
      readerId: () => readerId,
      clock: () => now,
    );
  }

  Future<CatalogFailureKind> failureOf(Future<Object?> Function() read) async {
    try {
      await read();
    } on CatalogFailure catch (failure) {
      return failure.kind;
    }
    fail('expected the read to fail');
  }

  test('listSeries keeps the catalog the API answered', () async {
    await build().listSeries();

    expect(library.series, hasLength(1));
    expect(library.series!.single.id, _seriesId);
  });

  test(
    'listSeries answers from the device when the API is unreachable',
    () async {
      await build().listSeries();
      origin.listError = _network;

      final series = await build().listSeries();

      expect(series.single.id, _seriesId);
    },
  );

  test(
    'listSeries reports an unreachable API the device cannot cover',
    () async {
      origin.listError = _network;

      expect(await failureOf(build().listSeries), CatalogFailureKind.notSaved);
    },
  );

  test('listSeries does not cover a failure that is not the network', () async {
    await build().listSeries();
    origin.listError = _unexpected;

    expect(await failureOf(build().listSeries), CatalogFailureKind.unexpected);
  });

  test(
    'getSeries answers from the device when the API is unreachable',
    () async {
      await build().getSeries(_seriesId);
      origin.detailError = _network;

      final detail = await build().getSeries(_seriesId);

      expect(detail?.series.id, _seriesId);
      expect(detail?.episodes, hasLength(1));
    },
  );

  test('getSeries drops a series the API no longer has', () async {
    await build().getSeries(_seriesId);
    origin.details = const {};

    expect(await build().getSeries(_seriesId), isNull);
    expect(library.details, isEmpty);
  });

  test('a series the API drops takes its saved episodes with it', () async {
    await build().getSeries(_seriesId);
    await build().getEpisode(_seriesId, _episodeId);
    origin.details = const {};

    expect(await build().getSeries(_seriesId), isNull);
    expect(library.details, isEmpty);
    expect(library.episodes, isEmpty);
  });

  test('a free body is kept without an owner', () async {
    await build().getEpisode(_seriesId, _episodeId);

    final saved = library.episodes.values.single;
    expect(saved.ownerId, isEmpty);
    expect(saved.checkedAt, _checkedAt);
  });

  test('an entitled body is kept for the reader it was granted to', () async {
    readerId = _reader;
    origin.episodes = {
      episodeKey(_seriesId, _episodeId): _detail(
        access: EpisodeAccess.entitled,
      ),
    };

    await build().getEpisode(_seriesId, _episodeId);

    expect(library.episodes.values.single.ownerId, _reader);
  });

  test('an entitled body with nobody signed in is not kept', () async {
    origin.episodes = {
      episodeKey(_seriesId, _episodeId): _detail(
        access: EpisodeAccess.entitled,
      ),
    };

    await build().getEpisode(_seriesId, _episodeId);

    expect(library.episodes, isEmpty);
  });

  test('a saved body carries no credential to the device', () async {
    await build().getEpisode(_seriesId, _episodeId);

    final saved = library.episodes.values.single;
    expect(saved.detail.imageRequestHeaders, isEmpty);
    expect(saved.detail.images.single.url.hasQuery, isFalse);
    expect(
      saved.detail.images.single.url.toString(),
      isNot(contains('media-token')),
    );
  });

  test('a body that came back locked is taken off the device', () async {
    readerId = _reader;
    origin.episodes = {
      episodeKey(_seriesId, _episodeId): _detail(
        access: EpisodeAccess.entitled,
      ),
    };
    await build().getEpisode(_seriesId, _episodeId);

    origin.episodes = {
      episodeKey(_seriesId, _episodeId): _detail(access: EpisodeAccess.locked),
    };
    await build().getEpisode(_seriesId, _episodeId);

    expect(library.episodes, isEmpty);
  });

  test('a body the API no longer has is taken off the device', () async {
    await build().getEpisode(_seriesId, _episodeId);
    origin.episodes = const {};

    expect(await build().getEpisode(_seriesId, _episodeId), isNull);
    expect(library.episodes, isEmpty);
  });

  test('a saved free body opens without the API', () async {
    await build().getEpisode(_seriesId, _episodeId);
    origin.episodeError = _network;

    final detail = await build().getEpisode(_seriesId, _episodeId);

    expect(detail?.episode.id, _episodeId);
    expect(detail?.images, hasLength(1));
  });

  test(
    'a saved entitled body opens for the reader it was granted to',
    () async {
      readerId = _reader;
      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.entitled,
        ),
      };
      await build().getEpisode(_seriesId, _episodeId);
      origin.episodeError = _network;

      final detail = await build().getEpisode(_seriesId, _episodeId);

      expect(detail?.access, EpisodeAccess.entitled);
    },
  );

  test(
    'a saved entitled body stays closed once the reader signs out',
    () async {
      readerId = _reader;
      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.entitled,
        ),
      };
      await build().getEpisode(_seriesId, _episodeId);

      origin.episodeError = _network;
      readerId = '';

      expect(
        await failureOf(() => build().getEpisode(_seriesId, _episodeId)),
        CatalogFailureKind.notSaved,
      );
    },
  );

  test(
    'a saved body outliving its offline window is reported and dropped',
    () async {
      readerId = _reader;
      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.entitled,
        ),
      };
      await build().getEpisode(_seriesId, _episodeId);

      origin.episodeError = _network;
      now = _checkedAt.add(offlineGracePeriod + const Duration(seconds: 1));

      expect(
        await failureOf(() => build().getEpisode(_seriesId, _episodeId)),
        CatalogFailureKind.saveExpired,
      );
      expect(library.episodes, isEmpty);
    },
  );

  test(
    'an unreachable API over a body nothing saved reports notSaved',
    () async {
      origin.episodeError = _network;

      expect(
        await failureOf(() => build().getEpisode(_seriesId, _episodeId)),
        CatalogFailureKind.notSaved,
      );
    },
  );
}
