import 'package:publira/models/series_item.dart';

/// A genre the tenant curates, as `publira.v1.PublishedGenre` describes it.
class PublishedGenre {
  const PublishedGenre({
    required this.id,
    required this.name,
    required this.seriesCount,
    this.featuredSeries = const [],
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String name;

  /// How many of its series are published right now. A genre whose last
  /// series was taken down stays listed, at zero.
  final int seriesCount;

  /// The series its tile draws covers from, in the order the API returned
  /// them. Empty for a genre with none, which is what puts its name in the
  /// tile instead.
  final List<GenreFeaturedSeries> featuredSeries;

  /// The eye-catch the console uploaded for the genre, in the order the API
  /// returned its renditions. Empty for a genre with none, which is what
  /// leaves its tile to the covers of [featuredSeries].
  final List<EyeCatchVariant> eyeCatchVariants;

  /// Headers [eyeCatchVariants] and the covers of [featuredSeries] must be
  /// fetched with.
  final Map<String, String> imageRequestHeaders;
}

/// A series on a genre's tile, as `publira.v1.PublishedGenreFeaturedSeries`
/// describes it.
class GenreFeaturedSeries {
  const GenreFeaturedSeries({
    required this.id,
    this.eyeCatchVariants = const [],
  });

  /// Public id (`public_id`) of the series.
  final String id;

  /// Artwork renditions. Empty for a series with none, which leaves its cell
  /// flat.
  final List<EyeCatchVariant> eyeCatchVariants;
}

/// A tag at least one published series carries, as `publira.v1.PublishedTag`
/// describes it.
class PublishedTag {
  const PublishedTag({
    required this.slug,
    required this.name,
    required this.seriesCount,
  });

  /// What addresses the tag, used as the route parameter.
  final String slug;
  final String name;
  final int seriesCount;
}

/// How a genre's or a tag's series are ordered, as the storefront's sort
/// offers it.
enum SeriesListOrder {
  newest,
  updated,
  title;

  /// The `publira.v1.SeriesOrder` name the API is asked for.
  String get wireName => switch (this) {
    SeriesListOrder.newest => 'SERIES_ORDER_PUBLISHED_AT_DESC',
    SeriesListOrder.updated => 'SERIES_ORDER_LATEST_EPISODE_AT_DESC',
    SeriesListOrder.title => 'SERIES_ORDER_TITLE_ASC',
  };
}

/// The sort and the filters a reader narrows a genre or a tag with.
///
/// A cursor token is bound to the order and filters it was built for, so a
/// changed filter reads the list again from its first page.
class SeriesListFilter {
  const SeriesListFilter({
    this.order = SeriesListOrder.newest,
    this.status,
    this.freeOnly = false,
  });

  final SeriesListOrder order;

  /// `null` keeps every serialization state.
  final SeriesStatus? status;

  /// Keeps only the series a reader can start without paying.
  final bool freeOnly;

  /// Whether a filter, rather than the sort alone, narrows the list, which is
  /// what an empty result has to say.
  bool get narrows => status != null || freeOnly;

  SeriesListFilter copyWith({
    SeriesListOrder? order,
    SeriesStatus? Function()? status,
    bool? freeOnly,
  }) {
    return SeriesListFilter(
      order: order ?? this.order,
      status: status == null ? this.status : status(),
      freeOnly: freeOnly ?? this.freeOnly,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is SeriesListFilter &&
      other.order == order &&
      other.status == status &&
      other.freeOnly == freeOnly;

  @override
  int get hashCode => Object.hash(order, status, freeOnly);
}
