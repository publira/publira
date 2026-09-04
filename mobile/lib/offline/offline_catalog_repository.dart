import 'package:publira/api/episode_page_store.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';

/// Reads the public catalog, and keeps what it read so the same screens open
/// again without a network.
///
/// Every call goes to [origin] first, because the API is what decides whether
/// a body may still be read: only its answer refreshes what the device holds,
/// and an answer that takes a body away drops it. The saved copy is reached
/// only when the network is, which is what keeps a lapsed purchase from
/// reading forever behind airplane mode.
class OfflineCatalogRepository implements CatalogRepository {
  OfflineCatalogRepository({
    required CatalogRepository origin,
    required this.library,
    required ReaderIdReader readerId,
    DateTime Function() clock = DateTime.now,
    this.grace = offlineGracePeriod,
  }) : _origin = origin,
       _readerId = readerId,
       _clock = clock;

  final CatalogRepository _origin;

  /// What the device holds. Public so the screens can ask it which episodes
  /// they may mark as saved.
  final OfflineLibrary library;

  /// How long an entitled body reads without the API confirming the grant.
  final Duration grace;

  final ReaderIdReader _readerId;
  final DateTime Function() _clock;

  @override
  Future<List<SeriesItem>> listSeries() async {
    try {
      final series = await _origin.listSeries();
      await library.writeSeriesList(series);
      return series;
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      final saved = await library.readSeriesList();
      if (saved == null) {
        throw const CatalogFailure(
          CatalogFailureKind.notSaved,
          message: 'the device holds no catalog',
        );
      }
      return saved;
    }
  }

  @override
  Future<SeriesDetail?> getSeries(String publicId) async {
    try {
      final detail = await _origin.getSeries(publicId);
      if (detail == null) {
        await library.removeSeries(publicId);
        return null;
      }
      await library.writeSeriesDetail(detail);
      return detail;
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      final saved = await library.readSeriesDetail(publicId);
      if (saved == null) {
        throw const CatalogFailure(
          CatalogFailureKind.notSaved,
          message: 'the device holds no detail for this series',
        );
      }
      return saved;
    }
  }

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    try {
      final detail = await _origin.getEpisode(seriesPublicId, episodePublicId);
      if (detail == null) {
        await library.removeEpisode(seriesPublicId, episodePublicId);
        return null;
      }
      await _remember(detail);
      return detail;
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      return _openSaved(seriesPublicId, episodePublicId);
    }
  }

  /// Answers an episode the network could not, from what the device holds.
  Future<EpisodeDetail> _openSaved(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final saved = await library.readEpisode(seriesPublicId, episodePublicId);
    if (saved == null) {
      throw const CatalogFailure(
        CatalogFailureKind.notSaved,
        message: 'the device holds no body for this episode',
      );
    }
    final reader = _readerId();
    if (isReadableOffline(
      saved,
      readerId: reader,
      now: _clock(),
      grace: grace,
    )) {
      return saved.detail;
    }
    if (saved.ownerId == reader) {
      // The grant was this reader's, and the API has not confirmed it inside
      // the window. Drop it rather than keep an unreadable body on the device.
      await library.removeEpisode(seriesPublicId, episodePublicId);
      throw const CatalogFailure(
        CatalogFailureKind.saveExpired,
        message: 'the saved body outlived its offline window',
      );
    }
    // Saved for another reader, or for one who has since signed out. There is
    // nothing here for whoever is holding the device now.
    throw const CatalogFailure(
      CatalogFailureKind.notSaved,
      message: 'the saved body belongs to another reader',
    );
  }

  /// Records what the API just said about [detail], which is as much about
  /// taking a body away as about keeping one.
  Future<void> _remember(EpisodeDetail detail) async {
    final reader = _readerId();
    // An entitled body is kept only when there is a reader to hold it against:
    // a grant the device cannot name again is a grant it could never re-check.
    final keep = switch (detail.access) {
      EpisodeAccess.free => true,
      EpisodeAccess.entitled => reader.isNotEmpty,
      EpisodeAccess.locked || EpisodeAccess.unknown => false,
    };
    if (!keep) {
      await library.removeEpisode(detail.seriesId, detail.episode.id);
      return;
    }
    await library.writeEpisode(
      SavedEpisode(
        detail: _forStorage(detail),
        ownerId: detail.access == EpisodeAccess.entitled ? reader : '',
        checkedAt: _clock(),
      ),
    );
  }

  /// The same body with everything that authorizes a request taken out.
  ///
  /// The request headers carry the reader's bearer token, and a page's URL
  /// carries the media token that decodes it. Neither belongs on the device,
  /// and neither is needed: a saved page is read off disk under a name that
  /// leaves the media token out.
  EpisodeDetail _forStorage(EpisodeDetail detail) {
    return EpisodeDetail(
      episode: detail.episode,
      seriesId: detail.seriesId,
      seriesTitle: detail.seriesTitle,
      access: detail.access,
      images: [
        for (final image in detail.images)
          EpisodeImageItem(
            id: image.id,
            url: episodePageAddress(image.url),
            displayOrder: image.displayOrder,
            width: image.width,
            height: image.height,
          ),
      ],
    );
  }
}

/// Reads the public id of the signed-in reader, empty when there is none.
///
/// Called on every read rather than captured, so a sign-in or a sign-out
/// reaches the next one without rebuilding the repository.
typedef ReaderIdReader = String Function();
