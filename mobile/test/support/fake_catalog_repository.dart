import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// In-memory [CatalogRepository] for widget tests.
class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.series = const [],
    this.newestSeries = const [],
    this.rankedSeries = const [],
    this.details = const {},
    this.episodes = const {},
    this.recentSeries = const [],
    this.readingPositions = const {},
    this.listError,
    this.newestSeriesError,
    this.rankedSeriesError,
    this.detailError,
    this.episodeError,
    this.readingPositionError,
    this.recentSeriesError,
  });

  List<SeriesItem> series;

  /// What the new-arrivals shelf is answered with.
  List<SeriesItem> newestSeries;

  /// What the ranking shelf is answered with.
  List<RankedSeriesItem> rankedSeries;

  Map<String, SeriesDetail> details;

  /// Keyed by [episodeKey] so a fake can hold the same episode id under two
  /// series and still answer each pair separately.
  Map<String, EpisodeDetail> episodes;

  /// What the continue-reading row is answered with.
  List<RecentSeriesItem> recentSeries;

  /// Saved positions keyed by [episodeKey], which [saveReadingPosition] writes
  /// to so a test can assert what the viewer recorded.
  Map<String, int> readingPositions;

  CatalogFailure? listError;
  CatalogFailure? newestSeriesError;
  CatalogFailure? rankedSeriesError;
  CatalogFailure? detailError;
  CatalogFailure? episodeError;
  CatalogFailure? readingPositionError;
  CatalogFailure? recentSeriesError;

  /// Limits [listRecentSeries] was called with, in order.
  final List<int> recentSeriesLimits = <int>[];

  /// Limits [listNewestSeries] was called with, in order.
  final List<int> newestSeriesLimits = <int>[];

  /// Periods [listRankedSeries] was called with, in order.
  final List<RankingPeriod> rankedSeriesPeriods = <RankingPeriod>[];

  @override
  Future<List<SeriesItem>> listSeries() async {
    final error = listError;
    if (error != null) {
      throw error;
    }
    return List<SeriesItem>.from(series);
  }

  @override
  Future<List<SeriesItem>> listNewestSeries({required int limit}) async {
    newestSeriesLimits.add(limit);
    final error = newestSeriesError;
    if (error != null) {
      throw error;
    }
    // The API answers a page of at most [limit], so a fixture longer than the
    // shelf asked for must not reach it here either.
    return List<SeriesItem>.from(newestSeries.take(limit));
  }

  @override
  Future<List<RankedSeriesItem>> listRankedSeries({
    required int limit,
    required RankingPeriod period,
  }) async {
    rankedSeriesPeriods.add(period);
    final error = rankedSeriesError;
    if (error != null) {
      throw error;
    }
    return List<RankedSeriesItem>.from(rankedSeries.take(limit));
  }

  @override
  Future<SeriesDetail?> getSeries(String publicId) async {
    final error = detailError;
    if (error != null) {
      throw error;
    }
    return details[publicId];
  }

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final error = episodeError;
    if (error != null) {
      throw error;
    }
    return episodes[episodeKey(seriesPublicId, episodePublicId)];
  }

  @override
  Future<int?> getReadingPosition(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final error = readingPositionError;
    if (error != null) {
      throw error;
    }
    return readingPositions[episodeKey(seriesPublicId, episodePublicId)];
  }

  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  ) async {
    final error = readingPositionError;
    if (error != null) {
      throw error;
    }
    readingPositions = {
      ...readingPositions,
      episodeKey(seriesPublicId, episodePublicId): pageIndex,
    };
  }

  @override
  Future<List<RecentSeriesItem>> listRecentSeries({required int limit}) async {
    recentSeriesLimits.add(limit);
    final error = recentSeriesError;
    if (error != null) {
      throw error;
    }
    // The API answers a page of at most [limit], so a fixture longer than the
    // screen asked for must not reach it here either.
    return List<RecentSeriesItem>.from(recentSeries.take(limit));
  }
}

String episodeKey(String seriesPublicId, String episodePublicId) =>
    '$seriesPublicId/$episodePublicId';

/// Headers the repository resolves for a public image request.
const fixtureImageHeaders = {'x-forwarded-host': 'localhost'};

/// Cover renditions of [fixtureSeries]' first series, in the widths the server
/// stores. The second series carries none, which is what shows the
/// placeholder.
final fixtureEyeCatchVariants = <EyeCatchVariant>[
  for (final width in [400, 800, 1200])
    EyeCatchVariant(
      variantType: 'portrait',
      url: Uri.parse(
        'http://images.test/images/series/SeedSIMGAAA1/portrait/$width',
      ),
      width: width,
      height: width * 4 ~/ 3,
    ),
  for (final width in [800, 1600])
    EyeCatchVariant(
      variantType: 'landscape',
      url: Uri.parse(
        'http://images.test/images/series/SeedSIMGAAA1/landscape/$width',
      ),
      width: width,
      height: width * 9 ~/ 16,
    ),
];

/// The people credited on [fixtureSeries]' first series. The second series is
/// credited to nobody, which is what leaves its credit line off the screen.
const fixtureCreators = <SeriesCreator>[
  SeriesCreator(id: 'SeedAUTHAAA1', name: 'Seed Author 001'),
  SeriesCreator(id: 'SeedAUTHAAA2', name: 'Seed Author 002'),
  SeriesCreator(id: 'SeedAUTHAAA3', name: 'Seed Author 003'),
];

/// The first genre of the development seed, which [fixtureSeries]' first
/// series carries so a catalog tile has a genre to show.
const fixtureGenres = <SeriesGenre>[
  SeriesGenre(id: 'SeedGENRAAA1', name: 'Fantasy'),
];

final fixtureSeries = <SeriesItem>[
  SeriesItem(
    id: 'SeedSERSAAA1',
    title: 'Seed Series 001',
    description: 'A published series of Seed Tenant.',
    episodeCount: 10,
    labelName: 'Seed Label 01',
    creators: fixtureCreators,
    eyeCatchVariants: fixtureEyeCatchVariants,
    imageRequestHeaders: fixtureImageHeaders,
    status: SeriesStatus.ongoing,
    scheduleWeekdays: const [1, 4],
    genres: fixtureGenres,
  ),
  const SeriesItem(
    id: 'series-kitchen',
    title: 'The Little Kitchen',
    description: 'Everyday cooking, one plate at a time.',
    episodeCount: 8,
  ),
];

/// A restricted series used to exercise the confirmation before the body
/// opens. It is not part of [fixtureSeries], so catalog tests that tap the
/// first tile do not hit the gate.
const fixtureRatedSeries = SeriesItem(
  id: 'series-rated',
  title: 'After Dark',
  description: 'A series rated R15.',
  episodeCount: 3,
  status: SeriesStatus.ongoing,
  ageRating: SeriesAgeRating.r15,
  genres: [SeriesGenre(id: 'SeedGENRAAA2', name: 'Romance')],
);

/// An R18 series, used to check that an R15 confirmation does not open it.
const fixtureR18Series = SeriesItem(
  id: 'series-r18',
  title: 'Midnight',
  description: 'A series rated R18.',
  episodeCount: 2,
  ageRating: SeriesAgeRating.r18,
);

SeriesDetail fixtureDetail(SeriesItem item) {
  return SeriesDetail(
    series: item,
    episodes: [
      for (var i = 1; i <= item.episodeCount; i++)
        EpisodeItem(
          id: '${item.id}-ep-$i',
          title: '${item.title} #$i',
          orderIndex: i,
          price: i == item.episodeCount ? 500 : 0,
        ),
    ],
  );
}

Map<String, SeriesDetail> fixtureDetails() {
  return {for (final item in fixtureSeries) item.id: fixtureDetail(item)};
}

/// A continue-reading row over the fixture series, each offering the first
/// episode of its own series.
List<RecentSeriesItem> fixtureRecentSeries() {
  return [
    for (final item in fixtureSeries)
      RecentSeriesItem(
        series: item,
        episode: fixtureDetail(item).episodes.first,
      ),
  ];
}

/// A week's chart over the fixture series. The positions run 1 and 3 because
/// they are a snapshot's own: a series ranked second and unpublished since
/// leaves the gap behind.
List<RankedSeriesItem> fixtureRankedSeries() {
  return [
    RankedSeriesItem(rank: 1, series: fixtureSeries.first),
    RankedSeriesItem(rank: 3, series: fixtureSeries.last),
  ];
}

/// A readable body for every published episode of every fixture series, each
/// carrying the episodes either side of it the way `GetEpisodeDetail` does.
Map<String, EpisodeDetail> fixtureEpisodes({
  EpisodeAccess access = EpisodeAccess.free,
  int pageCount = 3,
}) {
  final bodies = <String, EpisodeDetail>{};
  for (final item in fixtureSeries) {
    final episodes = fixtureDetail(item).episodes;
    for (var index = 0; index < episodes.length; index++) {
      final episode = episodes[index];
      bodies[episodeKey(item.id, episode.id)] = EpisodeDetail(
        episode: episode,
        seriesId: item.id,
        seriesTitle: item.title,
        access: access,
        previousEpisode: index == 0
            ? null
            : fixtureNeighbor(episodes[index - 1]),
        nextEpisode: index == episodes.length - 1
            ? null
            : fixtureNeighbor(episodes[index + 1]),
        images: [
          for (var page = 1; page <= pageCount; page++)
            EpisodeImageItem(
              id: '${episode.id}-page-$page',
              url: Uri.parse(
                'http://127.0.0.1:8200/images/episodes/${episode.id}-page-$page',
              ),
              displayOrder: page,
              width: 800,
              height: 1200,
            ),
        ],
      );
    }
  }
  return bodies;
}

/// The offer an episode beside [episode] makes to open it. A fixture episode
/// is free exactly while it costs nothing, because no free window is open on
/// any of them.
EpisodeNeighbor fixtureNeighbor(EpisodeItem episode) => EpisodeNeighbor(
  id: episode.id,
  title: episode.title,
  orderIndex: episode.orderIndex,
  price: episode.price,
  isFree: episode.price == 0,
);
