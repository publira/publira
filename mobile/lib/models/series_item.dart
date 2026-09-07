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

/// A published series as shown on the catalog list and detail screens.
class SeriesItem {
  const SeriesItem({
    required this.id,
    required this.title,
    required this.description,
    this.episodeCount = 0,
    this.labelName = '',
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String title;
  final String description;
  final int episodeCount;
  final String labelName;

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
