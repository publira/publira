import 'package:flutter/widgets.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// Public catalog reads. Implementations talk to the Connect API or a fake.
abstract class CatalogRepository {
  /// Published series for the configured tenant by title, first page.
  ///
  /// It is the whole catalog to browse, which is why it is ordered by title
  /// rather than by date: the newest of it stands above as its own shelf, and
  /// a list in the same order would be that shelf again.
  ///
  /// Returns an empty list when the tenant has no published series.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<List<SeriesItem>> listSeries();

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

  /// The series the signed-in reader was in the middle of, newest activity
  /// first, each with the episode to continue from.
  ///
  /// Empty for a reader who is signed out or in the middle of nothing.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<List<RecentSeriesItem>> listRecentSeries({required int limit});
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
