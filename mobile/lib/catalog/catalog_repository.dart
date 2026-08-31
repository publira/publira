import 'package:flutter/widgets.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// Public catalog reads. Implementations talk to the Connect API or a fake.
abstract class CatalogRepository {
  /// Published series for the configured tenant, first page.
  ///
  /// Returns an empty list when the tenant has no published series.
  /// Throws [CatalogFailure] on a transport or unexpected server error.
  Future<List<SeriesItem>> listSeries();

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
