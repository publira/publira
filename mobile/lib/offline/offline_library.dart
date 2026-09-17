import 'package:publira/api/episode_page_store.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/tenant/tenant_brand.dart';

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

/// The last moment [episode] opens without the API confirming the grant again,
/// or `null` for a free body, which has no such moment.
DateTime? offlineReadableUntil(
  SavedEpisode episode, {
  Duration grace = offlineGracePeriod,
}) => episode.ownerId.isEmpty ? null : episode.checkedAt.add(grace);

/// One saved episode and the bytes its pages hold on the device.
class StoredEpisode {
  const StoredEpisode({required this.episode, required this.bytes});

  final SavedEpisode episode;

  /// Size of the page files on the device, which is less than the whole
  /// episode when the reader only turned through part of it.
  final int bytes;
}

/// What the device spends on saved pages, and the episodes they belong to.
class OfflineStorage {
  const OfflineStorage({
    required this.bytes,
    required this.byteLimit,
    required this.episodes,
  });

  static const empty = OfflineStorage(
    bytes: 0,
    byteLimit: offlineByteLimit,
    episodes: [],
  );

  /// Every page file on the device, counted the way the byte limit counts
  /// them: pages no episode claims any more included.
  final int bytes;

  final int byteLimit;

  /// Saved episodes, most recently confirmed first.
  final List<StoredEpisode> episodes;
}

/// Where one reader stopped inside one episode.
///
/// It is the device's copy of what the API keeps, so it names the reader it
/// belongs to: a position is per member there, and a device that answered one
/// to whoever holds the phone would hand a second reader the first one's page.
class SavedReadingPosition {
  const SavedReadingPosition({required this.readerId, required this.pageIndex});

  /// Public id of the reader who stopped there.
  final String readerId;

  /// Zero-based page of the episode.
  final int pageIndex;
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
///
/// The window is measured against the device's own clock, which the reader
/// controls. A confirmation dated after [now] is refused rather than trusted,
/// so a clock pushed forward and back cannot mint one; a clock simply held
/// back still reads, and closing that needs a time source the device cannot
/// rewrite. Like the image stream this is a boundary, not DRM: it stops a
/// grant from outliving itself on a device nobody is tampering with.
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
  final since = now.difference(episode.checkedAt);
  return !since.isNegative && since <= grace;
}

/// What one device holds for reading without a network.
///
/// Every read answers `null` rather than throwing when the device holds
/// nothing, or holds something this build cannot read, so a damaged library
/// degrades to an online-only app instead of failing the screen. Every write
/// is best effort for the same reason.
abstract class OfflineLibrary implements EpisodePageStore {
  /// Fires after the set of saved episodes changes: one saved, removed,
  /// evicted, or everything cleared.
  ///
  /// A screen marking episodes as saved listens here, because the change it
  /// has to show may come from another screen, such as a deletion on the
  /// downloads screen while the series screen waits under it.
  Stream<void> get changes;

  /// The saved catalog snapshot, or `null` when the device has none.
  ///
  /// It is the first page as the API last answered it, token and all, so a
  /// launch without a network opens on the same rows and still knows there is
  /// a page under them to ask for.
  Future<SeriesPage?> readSeriesList();

  Future<void> writeSeriesList(SeriesPage page);

  /// The brand of the tenant at [tenantHost] as the API last answered it, or
  /// `null` when the device holds none for that tenant.
  ///
  /// A build pointed at another tenant can be installed over this one under
  /// the same application id, and must not open in the previous tenant's brand.
  Future<TenantBrand?> readTenantBrand(String tenantHost);

  Future<void> writeTenantBrand(String tenantHost, TenantBrand brand);

  Future<SeriesDetail?> readSeriesDetail(String seriesPublicId);

  Future<void> writeSeriesDetail(SeriesDetail detail);

  /// Drops the series screen and every episode saved under it, pages
  /// included.
  ///
  /// A series the API no longer publishes takes its episodes with it. Leaving
  /// them would keep an unpublished body opening offline, and hold its pages
  /// against the byte limit with no screen left to reach them from.
  Future<void> removeSeries(String seriesPublicId);

  Future<SavedEpisode?> readEpisode(
    String seriesPublicId,
    String episodePublicId,
  );

  Future<void> writeEpisode(SavedEpisode episode);

  Future<void> removeEpisode(String seriesPublicId, String episodePublicId);

  /// The page [readerId] stopped on in [episodePublicId], or `null` when the
  /// device holds none of theirs.
  ///
  /// It is what the viewer resumes at while the API cannot be reached, and it
  /// outlives nothing: a position is dropped with the episode it points into.
  Future<int?> readReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
  });

  Future<void> writeReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String readerId,
    required int pageIndex,
  });

  /// Episodes of [seriesPublicId] this device could open right now for
  /// [readerId], which is what the series screen marks as saved.
  Future<Set<String>> readableEpisodeIds(
    String seriesPublicId, {
    required String readerId,
    DateTime? now,
  });

  /// What the saved pages spend on the device, for the downloads screen.
  ///
  /// It answers [OfflineStorage.empty] rather than `null` on a device that
  /// cannot read its library, which holds nothing as far as the reader can
  /// tell.
  Future<OfflineStorage> readStorage();

  /// Drops everything, pages included.
  Future<void> clear();
}
