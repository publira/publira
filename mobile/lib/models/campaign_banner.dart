import 'package:publira/models/series_item.dart';

/// A campaign banner showing now, as `publira.v1.CampaignBanner` describes it:
/// an image the tenant scheduled, linking wherever the operator pointed it.
class CampaignBanner {
  const CampaignBanner({
    required this.id,
    required this.linkUrl,
    this.imageVariants = const [],
    this.imageRequestHeaders = const {},
  });

  /// Public id (`public_id`).
  final String id;

  /// A path on the tenant's own site, or an absolute `http(s)` URL, as the
  /// operator wrote it. Whether the app may follow it is decided where the
  /// banner is drawn, against the site the app is showing.
  final String linkUrl;

  /// The image's renditions, in the order the API returned them.
  final List<EyeCatchVariant> imageVariants;

  /// Headers [imageVariants] must be fetched with.
  final Map<String, String> imageRequestHeaders;
}
