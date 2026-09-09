/// One stored rendition of a series eye-catch image, as
/// `publira.types.v1.SeriesEyeCatchVariant` describes it.
///
/// The renditions of one series are independent images rather than sizes cut
/// from a master, so a series may carry some aspect ratios and not others.
class EyeCatchVariant {
  const EyeCatchVariant({
    required this.variantType,
    required this.url,
    required this.width,
    required this.height,
  });

  /// What the rendition is cut for: `portrait`, `square`, `landscape`, or
  /// `og`.
  final String variantType;

  /// Absolute image-server URL, already resolved against the configured image
  /// base.
  final Uri url;

  /// Stored pixel size, which is what a screen picks a rendition by.
  final int width;
  final int height;
}

/// One person credited on a series, as `publira.types.v1.Creator` describes
/// them.
class SeriesCreator {
  const SeriesCreator({required this.id, required this.name});

  /// Public id (`public_id`), which addresses the creator.
  final String id;
  final String name;
}

/// A published series as shown on the catalog list and detail screens.
class SeriesItem {
  const SeriesItem({
    required this.id,
    required this.title,
    required this.description,
    this.episodeCount = 0,
    this.labelName = '',
    this.creators = const [],
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String title;
  final String description;
  final int episodeCount;
  final String labelName;

  /// Who is credited on the series, in the order the API returned them, which
  /// is the order the tenant put them in. Empty for a series credited to
  /// nobody, which leaves the line off the screen entirely.
  final List<SeriesCreator> creators;

  /// Cover renditions in the order the API returned them. Empty for a series
  /// with no eye-catch, which is what puts the placeholder on screen.
  final List<EyeCatchVariant> eyeCatchVariants;

  /// Headers [eyeCatchVariants] must be fetched with. They travel with the
  /// series because the same read resolved both the URLs and the tenant they
  /// address.
  final Map<String, String> imageRequestHeaders;
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

/// One offer in the reader's continue-reading row, as `RecentSeries`
/// describes it.
class RecentSeriesItem {
  const RecentSeriesItem({required this.series, required this.episode});

  final SeriesItem series;

  /// The episode to open: the one the reader last moved in while it is still
  /// unfinished, and otherwise the next published one they have not finished.
  /// It is offered whatever they may do with its body, so a paid episode they
  /// have not bought is the episode they are sent to buy.
  final EpisodeItem episode;
}
