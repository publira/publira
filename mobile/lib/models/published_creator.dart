import 'package:publira/models/series_item.dart';

/// A creator credited on at least one published series, as
/// `publira.v1.PublishedCreator` describes them.
class PublishedCreator {
  const PublishedCreator({
    required this.id,
    required this.name,
    this.profileText = '',
    this.iconUrl,
    this.imageRequestHeaders = const {},
    this.seriesCount = 0,
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String name;

  /// What the creator wrote about themselves. Empty when they have published
  /// nothing.
  final String profileText;

  /// Absolute image-server URL of the portrait, and `null` for a creator who
  /// has none.
  final Uri? iconUrl;

  /// Headers [iconUrl] must be fetched with.
  final Map<String, String> imageRequestHeaders;

  /// How many of the series credited to them are published right now.
  final int seriesCount;
}

/// One page of creators, as `SearchPublishedCreatorsResponse` answers it.
class CreatorPage {
  const CreatorPage({required this.creators, this.nextToken = ''});

  final List<PublishedCreator> creators;

  /// What the API calls the page after this one. Empty at the end of it.
  final String nextToken;
}

/// A creator and one page of the published series credited to them, as
/// `GetPublishedCreatorDetailResponse` answers them.
class CreatorDetail {
  const CreatorDetail({required this.creator, required this.series});

  final PublishedCreator creator;

  /// Title order, one cursor page at a time.
  final SeriesPage series;
}
