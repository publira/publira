import 'package:flutter/widgets.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_item.dart';

/// How long a search keyword may be, as every `SearchPublished*` RPC measures
/// it: Unicode code points rather than UTF-16 units.
const searchQueryMaxRunes = 100;

/// Public catalog reads. Implementations talk to the Connect API or a fake.
abstract class CatalogRepository {
  /// One page of the configured tenant's published series, by title.
  ///
  /// It is the whole catalog to browse, which is why it is ordered by title
  /// rather than by date: the newest of it stands above as its own shelf, and
  /// a list in the same order would be that shelf again.
  ///
  /// [token] is empty for the first page, and otherwise the
  /// [SeriesPage.nextToken] of the page above the one wanted, passed back
  /// unchanged. Returns an empty page when the tenant has no published series.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<SeriesPage> listSeries({String token});

  /// One page of the published series whose title or synopsis contains
  /// [query], by title.
  ///
  /// [query] is what the reader typed, trimmed and at most
  /// [searchQueryMaxRunes] long; the API refuses an empty one. [token] is
  /// empty for the first page, and otherwise the [SeriesPage.nextToken] of the
  /// page above the one wanted. A token belongs to the query it was built for,
  /// so a changed keyword starts again at the first page.
  ///
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<SeriesPage> searchSeries({required String query, String token});

  /// One page of the creators whose name contains [query], by name, narrowed
  /// to those credited on a published series.
  ///
  /// [query] and [token] follow [searchSeries].
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<CreatorPage> searchCreators({required String query, String token});

  /// One page of the labels whose name contains [query], by name, narrowed to
  /// those holding a published series.
  ///
  /// [query] and [token] follow [searchSeries].
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<LabelPage> searchLabels({required String query, String token});

  /// The newest published series, at most [limit] of them.
  ///
  /// A read of its own rather than a slice of [listSeries]: the new-arrivals
  /// shelf is in another order, and it loads, fails, and retries on its own.
  /// What a device keeps for reading without a network is the catalog page
  /// rather than this shelf.
  ///
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<List<SeriesItem>> listNewestSeries({required int limit});

  /// One page of the tenant's latest ranking snapshot for [period], in the
  /// positions that snapshot recorded.
  ///
  /// Empty for a tenant the ranking batch has not run for yet, which is an
  /// answer rather than a failure: nothing has been computed.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<List<RankedSeriesItem>> listRankedSeries({
    required int limit,
    required RankingPeriod period,
  });

  /// Detail for [publicId]. Returns `null` when the series is missing,
  /// unpublished, or not in this tenant (same 404 policy as web-host).
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<SeriesDetail?> getSeries(String publicId);

  /// What the series [publicId] is called, or `null` when it is missing,
  /// unpublished, or not in this tenant (same 404 policy as [getSeries]).
  ///
  /// `ListMyFollows` answers with public ids alone, so a row of what a reader
  /// follows is named by a read of its own. It is a name rather than the
  /// series because the reader has not opened the series: reading one through
  /// [getSeries] writes it to the device, and a series the API has stopped
  /// publishing takes the episodes saved under it away, which is not for a
  /// list of names to do.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<String?> getSeriesTitle(String publicId);

  /// What the creator [publicId] is called, or `null` when they are missing,
  /// credited on nothing published, or not in this tenant.
  ///
  /// This is the name a row shows for an author the reader follows, read the
  /// way [getSeriesTitle] reads a series name.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<SeriesCreator?> getCreator(String publicId);

  /// The creator [publicId] and one page of the published series credited to
  /// them, by title, or `null` when they are missing or not in this tenant.
  ///
  /// [token] is empty for the first page, and otherwise the
  /// [SeriesPage.nextToken] of the page above the one wanted.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<CreatorDetail?> getCreatorDetail(String publicId, {String token});

  /// The label [publicId] and one page of its published series, by title, or
  /// `null` when it is missing or not in this tenant.
  ///
  /// A label whose last series was taken down still answers, with no series,
  /// so a link kept from before keeps opening it.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<LabelDetail?> getLabelDetail(String publicId, {String token});

  /// Body of [episodePublicId] for the reader. Returns `null` when the episode
  /// is missing, unpublished, not in this tenant, or belongs to a series other
  /// than [seriesPublicId] (same 404 policy as web-host).
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  );

  /// The zero-based page the signed-in reader stopped on in
  /// [episodePublicId], or `null` when they stopped nowhere.
  ///
  /// A reader who is signed out has no position: the API keeps one per member
  /// and answers a guest nothing, so the viewer opens at the first page.
  /// [seriesPublicId] addresses nothing at the API, which knows the episode by
  /// itself, and is here because the device keys its own copy by both.
  ///
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<int?> getReadingPosition(
    String seriesPublicId,
    String episodePublicId,
  );

  /// Records that the signed-in reader stopped on [pageIndex], zero-based over
  /// the episode's pages in reading order.
  ///
  /// A page the episode does not hold is refused by the API, and a guest is
  /// left alone the way [getReadingPosition] leaves them.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  );

  /// Records that the signed-in reader finished [episodePublicId]. A re-read
  /// keeps the first record, and a guest is left alone.
  ///
  /// Throws [CatalogFailure] on a transport or unexpected server error, and
  /// on an episode the reader may not read.
  Future<void> markEpisodeAsRead(String episodePublicId);

  /// This signed-in reader's reaction state for an episode. A signed-out
  /// reader has no private state, so this returns `null` without a request.
  Future<EpisodeReaction?> getEpisodeReaction(String episodePublicId);

  /// Adds one reaction press for the signed-in reader. A reaction is never
  /// removed or lowered; the server applies the series' press mode.
  Future<EpisodeReaction> reactToEpisode(String episodePublicId);

  /// The series the signed-in reader was in the middle of, newest activity
  /// first, each with the episode to continue from.
  ///
  /// [token] is the cursor from a previous page; empty for the first page.
  /// Empty for a reader who is signed out or in the middle of nothing.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    String token = '',
  });
}

/// Looks up the [CatalogRepository] installed by [CatalogScope].
class CatalogScope extends InheritedWidget {
  const CatalogScope({
    super.key,
    required this.repository,
    required super.child,
  });

  final CatalogRepository repository;

  static CatalogRepository of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<CatalogScope>();
    assert(scope != null, 'CatalogScope not found');
    return scope!.repository;
  }

  @override
  bool updateShouldNotify(CatalogScope oldWidget) =>
      repository != oldWidget.repository;
}
