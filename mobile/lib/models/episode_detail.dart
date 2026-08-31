import 'package:publira/models/series_item.dart';

/// Whether the reader may see an episode body, as `GetEpisodeDetail` reports
/// it.
enum EpisodeAccess {
  /// The episode is free, so the body is public.
  free,

  /// The episode is paid and this reader holds no purchase or ticket.
  locked,

  /// The episode is paid and this reader holds a purchase or an active ticket.
  entitled,

  /// The server named an access state this build does not know.
  unknown,
}

/// One body image of an episode, in reading order.
class EpisodeImageItem {
  const EpisodeImageItem({
    required this.id,
    required this.url,
    required this.displayOrder,
    this.width = 0,
    this.height = 0,
  });

  final String id;

  /// Absolute image-server URL, already resolved against the configured image
  /// base and carrying whatever media token the API attached.
  final Uri url;

  final int displayOrder;

  /// Stored pixel size. `0` means the record predates the size columns, not a
  /// zero-pixel page, so the reader falls back to the decoded image instead of
  /// reserving an empty box.
  final int width;
  final int height;
}

/// An episode body plus the series it was read under.
class EpisodeDetail {
  const EpisodeDetail({
    required this.episode,
    required this.seriesId,
    required this.seriesTitle,
    required this.access,
    required this.images,
    this.imageRequestHeaders = const {},
  });

  final EpisodeItem episode;
  final String seriesId;
  final String seriesTitle;
  final EpisodeAccess access;

  /// Body pages in `displayOrder`. Empty while access is [EpisodeAccess.locked].
  final List<EpisodeImageItem> images;

  /// Headers [images] must be fetched with. They travel with the pages because
  /// the same read decided both which pages exist and who is asking for them.
  final Map<String, String> imageRequestHeaders;
}
