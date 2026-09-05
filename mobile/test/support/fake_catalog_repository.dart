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
    this.listError,
    this.detailError,
    this.episodeError,
  });

  List<SeriesItem> series;
  Map<String, SeriesDetail> details;

  /// Keyed by [episodeKey] so a fake can hold the same episode id under two
  /// series and still answer each pair separately.
  Map<String, EpisodeDetail> episodes;
  CatalogFailure? listError;
  CatalogFailure? detailError;
  CatalogFailure? episodeError;

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
}

String episodeKey(String seriesPublicId, String episodePublicId) =>
    '$seriesPublicId/$episodePublicId';

const fixtureSeries = <SeriesItem>[
  SeriesItem(
    id: 'SeedSERSAAA1',
    title: 'Seed Series 001',
    description: 'A published series of Seed Tenant.',
    episodeCount: 10,
    labelName: 'Seed Label 01',
  ),
  SeriesItem(
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
