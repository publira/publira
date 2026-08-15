import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/series_item.dart';

/// In-memory [CatalogRepository] for widget tests.
class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.series = const [],
    this.details = const {},
    this.listError,
    this.detailError,
  });

  List<SeriesItem> series;
  Map<String, SeriesDetail> details;
  CatalogFailure? listError;
  CatalogFailure? detailError;

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
}

const fixtureSeries = <SeriesItem>[
  SeriesItem(
    id: 'SeedSERSAAA1',
    title: 'Seed Series 001',
    description: 'Seed Tenant の公開シリーズです。',
    episodeCount: 10,
    labelName: 'Seed Label 01',
  ),
  SeriesItem(
    id: 'series-kitchen',
    title: '小さな台所',
    description: '一皿から始まる日常料理。',
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
