import 'dart:async';

import 'package:publira/api/episode_page_store.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/progress_outbox.dart';

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
    required this._origin,
    required this.library,
    required this._readerId,
    required this.imageRequestHeaders,
    this._clock = DateTime.now,
    this.grace = offlineGracePeriod,
  });

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

  /// The reading progress the API could not take when it was made.
  ///
  /// It is flushed after every read the API answers here, since that is the
  /// moment the API is known to be reachable again; the app flushes it on
  /// launch and on resume as well.
  late final ProgressOutbox outbox = ProgressOutbox(
    origin: _origin,
    library: library,
    readerId: _readerId,
  );

  /// The catalog list, of which the device keeps the first page.
  ///
  /// A page under it is the API's to answer: the reader asks for one by
  /// scrolling, which they can only do having reached the end of what is on
  /// screen, so the failure lands under rows they are already reading rather
  /// than on an empty screen. Keeping more would also mean keeping a snapshot
  /// of the whole catalog, which is not what a device without a network needs.
  @override
  Future<SeriesPage> listSeries({String token = ''}) async {
    try {
      final page = await _origin.listSeries(token: token);
      _reached();
      if (token.isEmpty) {
        await library.writeSeriesList(page);
      }
      return page;
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network || token.isNotEmpty) {
        rethrow;
      }
      final saved = await library.readSeriesList();
      if (saved == null) {
        throw const CatalogFailure(
          CatalogFailureKind.notSaved,
          message: 'the device holds no catalog',
        );
      }
      return SeriesPage(
        series: [for (final series in saved.series) _addressable(series)],
        nextToken: saved.nextToken,
      );
    }
  }

  /// The search results, which only the API can answer: matching a keyword
  /// against every published title and synopsis is a read of the whole
  /// catalog, and the device holds one page of it.
  @override
  Future<SeriesPage> searchSeries({required String query, String token = ''}) =>
      _origin.searchSeries(query: query, token: token);

  /// The authors a keyword names, which only the API can answer for the reason
  /// [searchSeries] gives.
  @override
  Future<CreatorPage> searchCreators({
    required String query,
    String token = '',
  }) => _origin.searchCreators(query: query, token: token);

  /// The labels a keyword names, which only the API can answer for the reason
  /// [searchSeries] gives.
  @override
  Future<LabelPage> searchLabels({required String query, String token = ''}) =>
      _origin.searchLabels(query: query, token: token);

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
      _reached();
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

  /// The two name reads, which go straight to the API and leave the device
  /// alone: they name a row of what the reader follows rather than a screen
  /// they opened, so neither may save a series here nor take the episodes
  /// saved under one away.
  @override
  Future<String?> getSeriesTitle(String publicId) =>
      _origin.getSeriesTitle(publicId);

  @override
  Future<SeriesCreator?> getCreator(String publicId) =>
      _origin.getCreator(publicId);

  /// An author's page, which only the API can answer: the device keeps the
  /// series a reader opened, not every series an author is credited on.
  @override
  Future<CreatorDetail?> getCreatorDetail(
    String publicId, {
    String token = '',
  }) => _origin.getCreatorDetail(publicId, token: token);

  /// A label's page, which only the API can answer for the reason
  /// [getCreatorDetail] gives.
  @override
  Future<LabelDetail?> getLabelDetail(String publicId, {String token = ''}) =>
      _origin.getLabelDetail(publicId, token: token);

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    // Read in the same turn as the origin reads its session token, so the body
    // is filed under the reader it was fetched for even when the account
    // changes before the answer arrives.
    final reader = _readerId();
    try {
      final detail = await _origin.getEpisode(seriesPublicId, episodePublicId);
      _reached();
      if (detail == null) {
        await library.removeEpisode(seriesPublicId, episodePublicId);
        return null;
      }
      await _remember(detail, reader);
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
  /// A page [outbox] has yet to send wins over the API too, because sending it
  /// is what will make it the API's answer.
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
      // Read before the flush this answer starts, which may send it.
      final queued = await outbox.queuedPage(reader, episodePublicId);
      _reached();
      if (queued != null) {
        return queued;
      }
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

  /// Records the page on the device first, then at the API, and queues it for
  /// [outbox] to send when the API cannot be reached.
  ///
  /// The device is written first because it is the record that survives the
  /// API being unreachable, which is what the viewer resumes from while it
  /// stays so.
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
    final progress = UnsentProgress(
      readerId: reader,
      episodeId: episodePublicId,
      seriesId: seriesPublicId,
      pageIndex: pageIndex,
    );
    try {
      // Through the outbox, which drops the older page queued while the API
      // was unreachable: sending that one later would move the reader back.
      await outbox.send(
        progress,
        () => _origin.saveReadingPosition(
          seriesPublicId,
          episodePublicId,
          pageIndex,
        ),
      );
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      await outbox.queue(progress);
      return;
    }
    _reached();
  }

  /// Sends the finish to the API, and queues it for [outbox] to send when the
  /// API cannot be reached.
  @override
  Future<void> markEpisodeAsRead(String episodePublicId) async {
    final reader = _readerId();
    // A guest's finish is recorded nowhere, and the API is asked nothing.
    if (reader.isEmpty) {
      return _origin.markEpisodeAsRead(episodePublicId);
    }
    final progress = UnsentProgress(
      readerId: reader,
      episodeId: episodePublicId,
      finished: true,
    );
    try {
      await outbox.send(
        progress,
        () => _origin.markEpisodeAsRead(episodePublicId),
      );
    } on CatalogFailure catch (failure) {
      if (failure.kind != CatalogFailureKind.network) {
        rethrow;
      }
      await outbox.queue(progress);
      return;
    }
    _reached();
  }

  // Reactions are account-specific and immediately visible on the website, so
  // unlike catalog reads they are never served from or queued into offline
  // storage.
  @override
  Future<EpisodeReaction?> getEpisodeReaction(String episodePublicId) =>
      _origin.getEpisodeReaction(episodePublicId);

  @override
  Future<EpisodeReaction> reactToEpisode(String episodePublicId) =>
      _origin.reactToEpisode(episodePublicId);

  /// The reader's continue-reading row, which only the API can answer.
  ///
  /// Nothing about it is kept on the device: it is an offer to open something
  /// the reader has not read yet, and what a reader without a network can open
  /// is what the series screen already marks as saved.
  @override
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    String token = '',
  }) => _origin.listRecentSeries(limit: limit, token: token);

  /// The reader's history across every device, which only the API holds.
  @override
  Future<EpisodeReadPage> listEpisodeReads({
    required int limit,
    String token = '',
  }) => _origin.listEpisodeReads(limit: limit, token: token);

  /// What arrived in the reader's follows, which only the API can answer.
  @override
  Future<FollowUpdatePage> listFollowUpdates({
    required int limit,
    String token = '',
  }) => _origin.listFollowUpdates(limit: limit, token: token);

  /// The API just answered, so what was queued while it could not be reached
  /// goes out now.
  void _reached() {
    unawaited(outbox.flush());
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

  /// Records what the API just said about [detail] for [reader], which is as
  /// much about taking a body away as about keeping one.
  Future<void> _remember(EpisodeDetail detail, String reader) async {
    // An entitled body is kept only when there is a reader to hold it against:
    // a grant the device cannot name again is a grant it could never re-check.
    final keep = switch (detail.access) {
      EpisodeAccess.free => true,
      EpisodeAccess.entitled => reader.isNotEmpty,
      EpisodeAccess.ageRestricted ||
      EpisodeAccess.locked ||
      EpisodeAccess.unknown => false,
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
    return series.copyWith(imageRequestHeaders: imageRequestHeaders);
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
      ageRating: detail.ageRating,
      creators: detail.creators,
      readingDirection: detail.readingDirection,
      spreadStartIndex: detail.spreadStartIndex,
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
