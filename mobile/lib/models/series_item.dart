/// A published series as shown on the catalog list and detail screens.
class SeriesItem {
  const SeriesItem({
    required this.id,
    required this.title,
    required this.description,
    this.episodeCount = 0,
    this.labelName = '',
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String title;
  final String description;
  final int episodeCount;
  final String labelName;
}

/// One published episode on a series detail page.
class EpisodeItem {
  const EpisodeItem({
    required this.id,
    required this.title,
    required this.orderIndex,
    required this.price,
  });

  final String id;
  final String title;
  final int orderIndex;
  final int price;
}

/// Series plus its published episodes.
class SeriesDetail {
  const SeriesDetail({required this.series, required this.episodes});

  final SeriesItem series;
  final List<EpisodeItem> episodes;
}
