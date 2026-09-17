import 'package:publira/models/series_item.dart';

/// A label of the tenant, as `publira.types.v1.Label` and
/// `publira.v1.PublishedLabel` describe it.
class PublishedLabel {
  const PublishedLabel({
    required this.id,
    required this.name,
    this.eyeCatchVariants = const [],
    this.imageRequestHeaders = const {},
    this.seriesCount,
  });

  /// Public id (`public_id`), used as the route parameter.
  final String id;
  final String name;

  /// Artwork renditions, in the order the API returned them. Empty for a
  /// label with none, which is what puts the placeholder on screen.
  final List<EyeCatchVariant> eyeCatchVariants;

  /// Headers [eyeCatchVariants] must be fetched with.
  final Map<String, String> imageRequestHeaders;

  /// How many of its series are published right now. `null` on a search
  /// result, which `Label` answers without a count.
  final int? seriesCount;
}

/// One page of labels, as `SearchPublishedLabelsResponse` answers it.
class LabelPage {
  const LabelPage({required this.labels, this.nextToken = ''});

  final List<PublishedLabel> labels;

  /// What the API calls the page after this one. Empty at the end of it.
  final String nextToken;
}

/// A label and one page of its published series, as
/// `GetPublishedLabelDetailResponse` answers them.
class LabelDetail {
  const LabelDetail({required this.label, required this.series});

  final PublishedLabel label;

  /// Title order, one cursor page at a time.
  final SeriesPage series;
}
