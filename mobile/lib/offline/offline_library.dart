import 'package:publira/api/episode_page_store.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// How long an episode that needed an entitlement stays readable without the
/// API confirming the reader still holds it.
///
/// The device cannot see a purchase lapse or a ticket expire, so a body saved
/// under one would otherwise read forever as long as the reader stays offline.
const offlineGracePeriod = Duration(days: 7);

/// How many bytes of saved pages one device keeps before the least recently
/// confirmed episodes are dropped.
const offlineByteLimit = 512 * 1024 * 1024;

/// One episode kept on the device, with what decides whether it may still be
/// opened.
class SavedEpisode {
  const SavedEpisode({
    required this.detail,
    required this.ownerId,
    required this.checkedAt,
  });

  /// What the reader saw when the API last answered for this episode. Its
  /// [EpisodeDetail.imageRequestHeaders] is empty, because the bearer token
  /// they carried is not something to write to the device and the saved pages
  /// are read off disk rather than fetched.
  final EpisodeDetail detail;

  /// Public id of the reader this body was saved for, empty for a free one.
  ///
  /// A paid body is readable by whoever the API granted it to, so it stays
  /// closed to a signed-out device and to a second reader on the same phone.
  final String ownerId;

  /// When the API last confirmed this reader may read this body.
  final DateTime checkedAt;

  String get key => savedEpisodeKey(detail.seriesId, detail.episode.id);

  /// Names of the page files this episode owns, in reading order.
  List<String> get pageKeys => [
    for (final image in detail.images) episodePageKey(image.url),
  ];
}

/// Index key of the episode [episodePublicId] under [seriesPublicId].
String savedEpisodeKey(String seriesPublicId, String episodePublicId) =>
    '$seriesPublicId/$episodePublicId';

/// Whether [episode] may still be opened by [readerId] at [now] without the
/// API being reachable.
///
/// A free body has no owner and no window: it stays until the byte limit
/// reaches it. A body that needed an entitlement is closed to anyone but the
/// reader it was granted to, and closes to them too once
/// [offlineGracePeriod] has passed since the API last confirmed the grant.
bool isReadableOffline(
  SavedEpisode episode, {
  required String readerId,
  required DateTime now,
  Duration grace = offlineGracePeriod,
}) {
  if (episode.ownerId.isEmpty) {
    return true;
  }
  if (episode.ownerId != readerId) {
    return false;
  }
  return now.difference(episode.checkedAt) <= grace;
}

/// What one device holds for reading without a network.
///
/// Every read answers `null` rather than throwing when the device holds
/// nothing, or holds something this build cannot read, so a damaged library
/// degrades to an online-only app instead of failing the screen. Every write
/// is best effort for the same reason.
abstract class OfflineLibrary implements EpisodePageStore {
  /// The saved catalog snapshot, or `null` when the device has none.
  Future<List<SeriesItem>?> readSeriesList();

  Future<void> writeSeriesList(List<SeriesItem> series);

  Future<SeriesDetail?> readSeriesDetail(String seriesPublicId);

  Future<void> writeSeriesDetail(SeriesDetail detail);

  Future<void> removeSeriesDetail(String seriesPublicId);

  Future<SavedEpisode?> readEpisode(
    String seriesPublicId,
    String episodePublicId,
  );

  Future<void> writeEpisode(SavedEpisode episode);

  Future<void> removeEpisode(String seriesPublicId, String episodePublicId);

  /// Episodes of [seriesPublicId] this device could open right now for
  /// [readerId], which is what the series screen marks as saved.
  Future<Set<String>> readableEpisodeIds(
    String seriesPublicId, {
    required String readerId,
    DateTime? now,
  });

  /// Drops everything, pages included.
  Future<void> clear();
}
