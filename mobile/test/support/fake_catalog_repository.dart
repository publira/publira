import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// In-memory [CatalogRepository] for widget tests.
class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.series = const [],
    this.details = const {},
    this.episodes = const {},
    this.recentSeries = const [],
    this.readingPositions = const {},
    this.listError,
    this.detailError,
    this.episodeError,
    this.readingPositionError,
    this.recentSeriesError,
  });

  List<SeriesItem> series;
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
  CatalogFailure? detailError;
  CatalogFailure? episodeError;
  CatalogFailure? readingPositionError;
  CatalogFailure? recentSeriesError;

  /// Limits [listRecentSeries] was called with, in order.
  final List<int> recentSeriesLimits = <int>[];

  @override
  Future<List<SeriesItem>> listSeries() async {
    final error = listError;
    if (error != null) {
      throw error;
    }
    return List<SeriesItem>.from(series);
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

final fixtureSeries = <SeriesItem>[
  SeriesItem(
    id: 'SeedSERSAAA1',
    title: 'Seed Series 001',
    description: 'A published series of Seed Tenant.',
    episodeCount: 10,
    labelName: 'Seed Label 01',
    eyeCatchVariants: fixtureEyeCatchVariants,
    imageRequestHeaders: fixtureImageHeaders,
  ),
  const SeriesItem(
    id: 'series-kitchen',
    title: 'The Little Kitchen',
    description: 'Everyday cooking, one plate at a time.',
    episodeCount: 8,
  ),
];

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

/// A readable body for the first episode of every fixture series.
Map<String, EpisodeDetail> fixtureEpisodes({
  EpisodeAccess access = EpisodeAccess.free,
  int pageCount = 3,
}) {
  return {
    for (final item in fixtureSeries)
      episodeKey(item.id, '${item.id}-ep-1'): EpisodeDetail(
        episode: fixtureDetail(item).episodes.first,
        seriesId: item.id,
        seriesTitle: item.title,
        access: access,
        images: [
          for (var page = 1; page <= pageCount; page++)
            EpisodeImageItem(
              id: '${item.id}-ep-1-page-$page',
              url: Uri.parse(
                'http://127.0.0.1:8200/images/episodes/${item.id}-ep-1-page-$page',
              ),
              displayOrder: page,
              width: 800,
              height: 1200,
            ),
        ],
      ),
  };
}
