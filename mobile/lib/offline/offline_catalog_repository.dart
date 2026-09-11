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
    required this.imageRequestHeaders,
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

  /// Headers a cover request carries, put back on every series read off the
  /// device.
  ///
  /// They name the tenant this build was pointed at rather than anything the
  /// API said, which is why they are not written down. Restoring them matters
  /// because the API being unreachable does not mean image-server is: an
  /// api-server outage leaves a device that is otherwise online reading the
  /// saved catalog, and its covers still load.
  final Map<String, String> imageRequestHeaders;

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
      return [for (final series in saved) _addressable(series)];
    }
  }

  /// The new-arrivals shelf, which only the API can answer.
  ///
  /// It is another order over the same series, and keeping it too would
  /// replace the catalog page the device holds with its own few rows. The
  /// shelf stands above that page, so a reader without a network still has the
  /// catalog itself.
  @override
  Future<List<SeriesItem>> listNewestSeries({required int limit}) =>
      _origin.listNewestSeries(limit: limit);

  /// The ranking shelf, which only the API can answer: a snapshot describes a
  /// window that has closed, and a stale one would name positions the tenant
  /// has moved on from.
  @override
  Future<List<RankedSeriesItem>> listRankedSeries({
    required int limit,
    required RankingPeriod period,
  }) => _origin.listRankedSeries(limit: limit, period: period);

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
      return SeriesDetail(
        series: _addressable(saved.series),
        episodes: saved.episodes,
      );
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

  /// Where the reader stopped, from the API when it answers and from the
  /// device when it cannot.
  ///
  /// The API wins wherever both hold a page: it is the one place a position
  /// saved on the website reaches, and the reader who left one there expects
  /// the app to open on it. It wins only over a position it actually has,
  /// though — an episode it knows nothing about leaves whatever the device
  /// recorded while it was unreachable as the only page the reader stopped on.
  @override
  Future<int?> getReadingPosition(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final reader = _readerId();
    // A position belongs to a member, so there is neither one to ask for nor
    // one to answer with while nobody is signed in.
    if (reader.isEmpty) {
      return null;
    }
    try {
      final position = await _origin.getReadingPosition(
        seriesPublicId,
        episodePublicId,
      );
      if (position == null) {
        return await library.readReadingPosition(
          seriesPublicId,
          episodePublicId,
          readerId: reader,
        );
      }
      await library.writeReadingPosition(
        seriesPublicId,
        episodePublicId,
        readerId: reader,
        pageIndex: position,
      );
      return position;
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      return library.readReadingPosition(
        seriesPublicId,
        episodePublicId,
        readerId: reader,
      );
    }
  }

  /// Records the page on the device first, then at the API.
  ///
  /// The device is written first because it is the record that survives the
  /// API being unreachable, which is the whole of what a reader turning pages
  /// offline leaves behind.
  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  ) async {
    final reader = _readerId();
    if (reader.isEmpty) {
      return;
    }
    await library.writeReadingPosition(
      seriesPublicId,
      episodePublicId,
      readerId: reader,
      pageIndex: pageIndex,
    );
    try {
      await _origin.saveReadingPosition(
        seriesPublicId,
        episodePublicId,
        pageIndex,
      );
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      // The device holds the page until the API can be reached again.
    }
  }

  /// The reader's continue-reading row, which only the API can answer.
  ///
  /// Nothing about it is kept on the device: it is an offer to open something
  /// the reader has not read yet, and what a reader without a network can open
  /// is what the series screen already marks as saved.
  @override
  Future<List<RecentSeriesItem>> listRecentSeries({required int limit}) =>
      _origin.listRecentSeries(limit: limit);

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

  /// The same series with the headers its cover has to be requested with.
  ///
  /// The counterpart of [_forStorage]: what the device holds is stripped of
  /// everything that addresses a live server, so reading it back is what puts
  /// that part on again.
  SeriesItem _addressable(SeriesItem series) {
    return SeriesItem(
      id: series.id,
      title: series.title,
      description: series.description,
      episodeCount: series.episodeCount,
      labelName: series.labelName,
      eyeCatchVariants: series.eyeCatchVariants,
      imageRequestHeaders: imageRequestHeaders,
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
      previousEpisode: detail.previousEpisode,
      nextEpisode: detail.nextEpisode,
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
