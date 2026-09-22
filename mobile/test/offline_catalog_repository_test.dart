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

/// What this build sends with a cover request, which is configuration rather
/// than anything the device saved.
const _imageHeaders = {'x-forwarded-host': 'localhost'};

/// A cover as the API resolved it, which the device keeps but the headers do
/// not travel with.
final _coverVariant = EyeCatchVariant(
  variantType: 'portrait',
  url: Uri.parse('http://images.test/images/series/IMG/portrait/800'),
  width: 800,
  height: 1066,
);

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
  ReadingDirection readingDirection = ReadingDirection.rtl,
  int spreadStartIndex = 1,
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
    nextEpisode: const EpisodeNeighbor(
      id: 'SeedEPSDAAA2',
      title: 'Seed Episode 001-02',
      orderIndex: 2,
      price: 500,
      isFree: false,
    ),
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
    readingDirection: readingDirection,
    spreadStartIndex: spreadStartIndex,
  );
}

SeriesDetail _seriesDetail() {
  return SeriesDetail(
    series: SeriesItem(
      id: _seriesId,
      title: 'Seed Series 001',
      description: 'synopsis',
      eyeCatchVariants: [_coverVariant],
      imageRequestHeaders: _imageHeaders,
    ),
    episodes: const [
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
      series: [
        SeriesItem(
          id: _seriesId,
          title: 'Seed Series 001',
          description: '',
          eyeCatchVariants: [_coverVariant],
          imageRequestHeaders: _imageHeaders,
        ),
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
      imageRequestHeaders: _imageHeaders,
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

    expect(library.series!.series, hasLength(1));
    expect(library.series!.series.single.id, _seriesId);
  });

  test(
    'listSeries answers from the device when the API is unreachable',
    () async {
      await build().listSeries();
      origin.listError = _network;

      final page = await build().listSeries();

      expect(page.series.single.id, _seriesId);
    },
  );

  test(
    'listSeries reports an unreachable API the device cannot cover',
    () async {
      origin.listError = _network;

      expect(await failureOf(build().listSeries), CatalogFailureKind.notSaved);
    },
  );

  test('a catalog read off the device can still address its covers', () async {
    await build().listSeries();
    origin.listError = _network;

    // An unreachable API is not an unreachable image-server: the saved catalog
    // has to come back with the headers a cover request needs.
    final page = await build().listSeries();

    expect(page.series.single.eyeCatchVariants.single.url, _coverVariant.url);
    expect(page.series.single.imageRequestHeaders, _imageHeaders);
  });

  test('a series read off the device can still address its cover', () async {
    await build().getSeries(_seriesId);
    origin.detailError = _network;

    final detail = await build().getSeries(_seriesId);

    expect(detail!.series.eyeCatchVariants.single.url, _coverVariant.url);
    expect(detail.series.imageRequestHeaders, _imageHeaders);
    expect(detail.episodes.single.id, _episodeId);
  });

  test('the catalog kept on the device carries its next token', () async {
    origin
      ..series = fixtureCatalog(3)
      ..seriesPageSize = 2;

    final page = await build().listSeries();

    expect(library.series!.series, hasLength(2));
    expect(page.nextToken, isNotEmpty);
    expect(library.series!.nextToken, page.nextToken);
  });

  test('a page under the first one does not replace the saved one', () async {
    origin
      ..series = fixtureCatalog(3)
      ..seriesPageSize = 2;
    final catalog = build();
    final first = await catalog.listSeries();

    await catalog.listSeries(token: first.nextToken);

    // The device keeps the page a launch without a network opens on, which is
    // the first one however far the reader scrolled past it.
    expect(library.series!.series, hasLength(2));
    expect(library.series!.series.first.id, first.series.first.id);
  });

  test('the saved catalog comes back with the page left to read', () async {
    origin
      ..series = fixtureCatalog(3)
      ..seriesPageSize = 2;
    final saved = await build().listSeries();
    origin.listError = _network;

    final page = await build().listSeries();

    expect(page.series, hasLength(2));
    expect(page.nextToken, saved.nextToken);
  });

  test('a page under the saved one is reported, not answered', () async {
    origin
      ..series = fixtureCatalog(3)
      ..seriesPageSize = 2;
    final saved = await build().listSeries();
    origin.listMoreError = _network;

    // The device holds the first page and nothing under it, so scrolling past
    // it reaches the API or nothing at all.
    expect(
      await failureOf(() => build().listSeries(token: saved.nextToken)),
      CatalogFailureKind.network,
    );
  });

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

  test('a name read neither saves a series nor drops a saved one', () async {
    await build().getEpisode(_seriesId, _episodeId);
    library.details.clear();

    expect(await build().getSeriesTitle(_seriesId), 'Seed Series 001');
    expect(library.details, isEmpty);

    // A series the API stopped publishing between the follow and the list is
    // still not a reason to take what the reader downloaded off the device.
    origin.details = const {};

    expect(await build().getSeriesTitle(_seriesId), isNull);
    expect(library.episodes, hasLength(1));
  });

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

  test(
    'an entitled body stays with the reader who fetched it when another signs '
    'in before it arrives',
    () async {
      readerId = _reader;
      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.entitled,
        ),
      };

      final read = build().getEpisode(_seriesId, _episodeId);
      readerId = 'SeedMMBRAAA2';
      await read;

      expect(library.episodes.values.single.ownerId, _reader);
    },
  );

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

  test('a saved body keeps the layout it was saved with', () async {
    origin.episodes = {
      episodeKey(_seriesId, _episodeId): _detail(
        readingDirection: ReadingDirection.ltr,
        spreadStartIndex: 0,
      ),
    };
    await build().getEpisode(_seriesId, _episodeId);
    origin.episodeError = _network;

    final detail = await build().getEpisode(_seriesId, _episodeId);

    expect(detail!.readingDirection, ReadingDirection.ltr);
    expect(detail.spreadStartIndex, 0);
  });

  test('a saved body keeps the episode after it', () async {
    await build().getEpisode(_seriesId, _episodeId);
    origin.episodeError = _network;

    final detail = await build().getEpisode(_seriesId, _episodeId);

    // The offer at the end of a body read without a network is the same one
    // the API made when the body was saved.
    expect(detail!.nextEpisode!.id, 'SeedEPSDAAA2');
    expect(detail.nextEpisode!.price, 500);
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

  test(
    'a body withheld over the reader\'s age is taken off the device',
    () async {
      readerId = _reader;
      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.entitled,
        ),
      };
      await build().getEpisode(_seriesId, _episodeId);

      origin.episodes = {
        episodeKey(_seriesId, _episodeId): _detail(
          access: EpisodeAccess.ageRestricted,
        ),
      };
      await build().getEpisode(_seriesId, _episodeId);

      expect(library.episodes, isEmpty);
    },
  );

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

  test('the position the API holds is what the reader resumes at', () async {
    readerId = _reader;
    await build().saveReadingPosition(_seriesId, _episodeId, 3);
    // What the reader left on another device, which is what a position saved
    // on the website looks like from here.
    origin.readingPositions = {episodeKey(_seriesId, _episodeId): 11};

    expect(await build().getReadingPosition(_seriesId, _episodeId), 11);
    // And the device is brought up to date with it, so the next launch
    // without a network resumes there too.
    expect(
      await library.readReadingPosition(
        _seriesId,
        _episodeId,
        readerId: _reader,
      ),
      11,
    );
  });

  test('a page turned with the API gone is answered from the device', () async {
    readerId = _reader;
    await build().saveReadingPosition(_seriesId, _episodeId, 3);
    origin.readingPositionError = _network;

    expect(await build().getReadingPosition(_seriesId, _episodeId), 3);
  });

  test(
    'a position only the device holds is not overruled by silence',
    () async {
      readerId = _reader;
      await build().saveReadingPosition(_seriesId, _episodeId, 3);

      // The API knows of no position in this episode, which says nothing about
      // the page the reader turned to while it was unreachable.
      expect(await build().getReadingPosition(_seriesId, _episodeId), 3);
    },
  );

  test('a recorded page reaches the API as well as the device', () async {
    readerId = _reader;

    await build().saveReadingPosition(_seriesId, _episodeId, 3);

    expect(origin.readingPositions[episodeKey(_seriesId, _episodeId)], 3);
  });

  test('a page recorded with the API gone stays on the device', () async {
    readerId = _reader;
    origin.readingPositionError = _network;

    await build().saveReadingPosition(_seriesId, _episodeId, 3);

    expect(
      await library.readReadingPosition(
        _seriesId,
        _episodeId,
        readerId: _reader,
      ),
      3,
    );
  });

  test('an unexpected failure recording a page is reported', () async {
    readerId = _reader;
    origin.readingPositionError = _unexpected;

    expect(
      await failureOf(
        () => build().saveReadingPosition(_seriesId, _episodeId, 3),
      ),
      CatalogFailureKind.unexpected,
    );
  });

  test('a guest has no position, and records none', () async {
    readerId = _reader;
    await build().saveReadingPosition(_seriesId, _episodeId, 3);

    readerId = '';
    await build().saveReadingPosition(_seriesId, _episodeId, 7);

    expect(await build().getReadingPosition(_seriesId, _episodeId), isNull);
    expect(
      await library.readReadingPosition(
        _seriesId,
        _episodeId,
        readerId: _reader,
      ),
      3,
    );
  });

  test('a second reader on the device resumes nowhere', () async {
    readerId = _reader;
    await build().saveReadingPosition(_seriesId, _episodeId, 3);

    readerId = 'SeedMMBRAAA2';
    origin.readingPositionError = _network;

    expect(await build().getReadingPosition(_seriesId, _episodeId), isNull);
  });

  test('the continue-reading row is answered by the API alone', () async {
    origin.recentSeries = [
      RecentSeriesItem(
        series: origin.series.single,
        episode: _seriesDetail().episodes.single,
      ),
    ];

    final items = (await build().listRecentSeries(limit: 10)).series;

    expect(items.single.episode.id, _episodeId);
    expect(origin.recentSeriesLimits, [10]);
  });

  test('the new-arrivals shelf does not replace the saved catalog', () async {
    final catalog = build();
    await catalog.listSeries();
    origin.newestSeries = const [
      SeriesItem(
        id: 'series-kitchen',
        title: 'The Little Kitchen',
        description: '',
      ),
    ];

    final shelf = await catalog.listNewestSeries(limit: 10);

    expect(shelf.single.id, 'series-kitchen');
    expect(origin.newestSeriesLimits, [10]);
    // The device still holds the catalog page rather than the few rows the
    // shelf asked for.
    expect((await library.readSeriesList())!.series.single.id, _seriesId);
  });

  test(
    'a shelf the API cannot answer is not answered from the device',
    () async {
      final catalog = build();
      await catalog.listSeries();
      origin
        ..newestSeriesError = _network
        ..rankedSeriesError = _network;

      expect(() => catalog.listNewestSeries(limit: 10), throwsA(_network));
      expect(
        () => catalog.listRankedSeries(limit: 10, period: RankingPeriod.weekly),
        throwsA(_network),
      );
    },
  );

  test('a search is answered by the API alone', () async {
    final catalog = build();
    await catalog.listSeries();
    origin.searchResults = const [
      SeriesItem(
        id: 'series-kitchen',
        title: 'The Little Kitchen',
        description: '',
      ),
    ];

    final results = await catalog.searchSeries(query: 'Kitchen');

    expect(results.series.single.id, 'series-kitchen');
    expect(origin.searchRequests.single.query, 'Kitchen');
    // The results are another read over the catalog, so they do not replace
    // the page the device keeps for reading without a network.
    expect((await library.readSeriesList())!.series.single.id, _seriesId);
  });

  test('a search the API cannot answer is not answered from the device', () {
    final catalog = build();
    origin.searchError = _network;

    expect(() => catalog.searchSeries(query: 'Seed'), throwsA(_network));
  });

  test('the ranking shelf is answered by the API alone', () async {
    origin.rankedSeries = [
      RankedSeriesItem(rank: 1, series: origin.series.single),
    ];

    final ranked = await build().listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
    );

    expect(ranked.single.rank, 1);
    expect(origin.rankedSeriesPeriods, [RankingPeriod.weekly]);
  });
}
