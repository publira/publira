import 'package:publira/models/series_item.dart';

/// Static catalog samples for navigation scaffolding.
///
/// Replace with public API responses when #34 / API wiring is ready.
const sampleSeries = <SeriesItem>[
  SeriesItem(
    id: 'series-aurora',
    title: 'オーロラの先で',
    description: '北極圏を旅する写真家の記録。季節ごとの光と風景を辿る連載。',
    episodeCount: 12,
  ),
  SeriesItem(
    id: 'series-kitchen',
    title: '小さな台所',
    description: '一皿から始まる日常料理。材料を減らしても味を落とさない工夫。',
    episodeCount: 8,
  ),
  SeriesItem(
    id: 'series-signal',
    title: 'シグナル',
    description: '都市の片隅で拾った短編。電波と記憶をめぐるオムニバス。',
    episodeCount: 5,
  ),
];

SeriesItem? findSampleSeries(String id) {
  for (final series in sampleSeries) {
    if (series.id == id) {
      return series;
    }
  }
  return null;
}
