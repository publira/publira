import 'dart:async';

import 'package:publira/api/episode_page_store.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/progress_outbox.dart';
import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

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
    this._waitFree,
  });

  final CatalogRepository _origin;

  /// Where the reader's wait-for-free tickets are read, which is the one place
  /// the API says when a ticket closes the body it opened again. `null` in a
  /// build without the rule, where a ticketed body keeps the grace window.
  final WaitFreeRepository? _waitFree;

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
  /// because a catalog call that failed does not mean a cover request will:
  /// the device reads the saved catalog after any failed call, and its covers
  /// still load.
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

  /// The latest read started of each record the device keeps, keyed by what
  /// it reads, so only the answer to the newest one is written down.
  ///
  /// Two reads of one record can be in flight at once — a screen asks again
  /// in the language the device has just switched to while the read in the
  /// old one is still on its way — and they can answer in either order.
  /// Writing whichever answered last would let the older one replace what the
  /// newer one wrote.
  final _latestReads = <String, int>{};
  var _readsStarted = 0;

  int _startRead(String key) => _latestReads[key] = ++_readsStarted;

  bool _isLatest(String key, int read) => _latestReads[key] == read;

  /// The catalog list, of which the device keeps the first page.
  ///
  /// A page under it is the API's to answer: the reader asks for one by
  /// scrolling, which they can only do having reached the end of what is on
  /// screen, so the failure lands under rows they are already reading rather
  /// than on an empty screen. Keeping more would also mean keeping a snapshot
  /// of the whole catalog, which is not what a device without a network needs.
  @override
  Future<SeriesPage> listSeries({
    required String locale,
    String token = '',
  }) async {
    const key = 'series-list';
    final read = token.isEmpty ? _startRead(key) : null;
    try {
      final page = await _origin.listSeries(locale: locale, token: token);
      _reached();
      if (read != null && _isLatest(key, read)) {
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
  Future<SeriesPage> searchSeries({
    required String query,
    required String locale,
    String token = '',
  }) => _origin.searchSeries(query: query, locale: locale, token: token);

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

  /// The author list, read from the API alone for the reason [listGenres]
  /// gives.
  @override
  Future<CreatorPage> listCreators({
    int limit = directoryPageLimit,
    String token = '',
  }) => _origin.listCreators(limit: limit, token: token);

  /// The label list, read from the API alone for the reason [listGenres]
  /// gives.
  @override
  Future<LabelPage> listLabels({
    int limit = directoryPageLimit,
    String token = '',
  }) => _origin.listLabels(limit: limit, token: token);

  /// The new-arrivals shelf, which only the API can answer.
  ///
  /// It is another order over the same series, and keeping it too would
  /// replace the catalog page the device holds with its own few rows. The
  /// shelf stands above that page, so a reader without a network still has the
  /// catalog itself.
  @override
  Future<List<SeriesItem>> listNewestSeries({
    required int limit,
    required String locale,
  }) => _origin.listNewestSeries(limit: limit, locale: locale);

  /// The ranking, which only the API can answer: a snapshot describes a
  /// window that has closed, and a stale one would name positions the tenant
  /// has moved on from.
  @override
  Future<RankedSeriesPage> listRankedSeries({
    required int limit,
    required RankingPeriod period,
    required SeriesAgeRating ageRating,
    required String locale,
    String genreId = '',
    String token = '',
  }) => _origin.listRankedSeries(
    limit: limit,
    period: period,
    ageRating: ageRating,
    locale: locale,
    genreId: genreId,
    token: token,
  );

  /// The related row under a series, which only the API can answer: it is
  /// scored over the whole published catalog, of which the device keeps only
  /// what the reader opened.
  @override
  Future<List<SeriesItem>> listRelatedSeries(
    String seriesInternalId, {
    required int limit,
    required String locale,
  }) =>
      _origin.listRelatedSeries(seriesInternalId, limit: limit, locale: locale);

  /// The recommendation orders, which only the API can answer: each is the
  /// whole catalog ranked from signals the device does not hold.
  @override
  Future<SeriesPage> listRecommendedSeries({
    required int limit,
    required String locale,
    String token = '',
  }) =>
      _origin.listRecommendedSeries(limit: limit, locale: locale, token: token);

  @override
  Future<SeriesPage> listMyRecommendedSeries({
    required int limit,
    required String locale,
    String token = '',
  }) => _origin.listMyRecommendedSeries(
    limit: limit,
    locale: locale,
    token: token,
  );

  @override
  Future<SeriesDetail?> getSeries(
    String publicId, {
    required String locale,
  }) async {
    final key = 'series/$publicId';
    final read = _startRead(key);
    try {
      final detail = await _origin.getSeries(publicId, locale: locale);
      _reached();
      if (!_isLatest(key, read)) {
        return detail;
      }
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
  Future<SeriesTitle?> getSeriesTitle(
    String publicId, {
    required String locale,
  }) => _origin.getSeriesTitle(publicId, locale: locale);

  @override
  Future<SeriesCreator?> getCreator(String publicId) =>
      _origin.getCreator(publicId);

  /// An author's page, which only the API can answer: the device keeps the
  /// series a reader opened, not every series an author is credited on.
  @override
  Future<CreatorDetail?> getCreatorDetail(
    String publicId, {
    required String locale,
    String token = '',
  }) => _origin.getCreatorDetail(publicId, locale: locale, token: token);

  /// A label's page, which only the API can answer for the reason
  /// [getCreatorDetail] gives.
  @override
  Future<LabelDetail?> getLabelDetail(
    String publicId, {
    required String locale,
    String token = '',
  }) => _origin.getLabelDetail(publicId, locale: locale, token: token);

  /// The classification is read from the API alone: the device keeps what a
  /// reader opened, not the lists they browsed through.
  @override
  Future<List<PublishedGenre>> listGenres() => _origin.listGenres();

  @override
  Future<PublishedTag?> getTag(String slug) => _origin.getTag(slug);

  @override
  Future<SeriesPage?> listGenreSeries(
    String genreId, {
    required String locale,
    SeriesListFilter filter = const SeriesListFilter(),
    String token = '',
  }) => _origin.listGenreSeries(
    genreId,
    locale: locale,
    filter: filter,
    token: token,
  );

  @override
  Future<SeriesPage?> listTagSeries(
    String slug, {
    required String locale,
    SeriesListFilter filter = const SeriesListFilter(),
    String token = '',
  }) =>
      _origin.listTagSeries(slug, locale: locale, filter: filter, token: token);

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId, {
    required String locale,
  }) async {
    // Read in the same turn as the origin reads its session token, so the body
    // is filed under the reader it was fetched for even when the account
    // changes before the answer arrives.
    final reader = _readerId();
    final key = 'episode/${savedEpisodeKey(seriesPublicId, episodePublicId)}';
    final read = _startRead(key);
    bool isLatest() => _isLatest(key, read);
    try {
      final detail = await _origin.getEpisode(
        seriesPublicId,
        episodePublicId,
        locale: locale,
      );
      _reached();
      if (!isLatest()) {
        return detail;
      }
      if (detail == null) {
        await library.removeEpisode(seriesPublicId, episodePublicId);
        return null;
      }
      await _remember(detail, reader, locale, isLatest);
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
    String episodePublicId, {
    required String episodeInternalId,
  }) async {
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
        episodeInternalId: episodeInternalId,
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
    int pageIndex, {
    required String episodeInternalId,
  }) async {
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
      episodeInternalId: episodeInternalId,
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
          episodeInternalId: episodeInternalId,
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
  Future<void> markEpisodeAsRead(
    String episodePublicId, {
    required String episodeInternalId,
  }) async {
    final reader = _readerId();
    // A guest's finish is recorded nowhere, and the API is asked nothing.
    if (reader.isEmpty) {
      return _origin.markEpisodeAsRead(
        episodePublicId,
        episodeInternalId: episodeInternalId,
      );
    }
    final progress = UnsentProgress(
      readerId: reader,
      episodeId: episodePublicId,
      episodeInternalId: episodeInternalId,
      finished: true,
    );
    try {
      await outbox.send(
        progress,
        () => _origin.markEpisodeAsRead(
          episodePublicId,
          episodeInternalId: episodeInternalId,
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

  // Reactions are account-specific and immediately visible on the website, so
  // unlike catalog reads they are never served from or queued into offline
  // storage.
  @override
  Future<EpisodeReaction?> getEpisodeReaction(String episodeInternalId) =>
      _origin.getEpisodeReaction(episodeInternalId);

  @override
  Future<EpisodeReaction> reactToEpisode(String episodeInternalId) =>
      _origin.reactToEpisode(episodeInternalId);

  @override
  Stream<void> get reactionWrites => _origin.reactionWrites;

  /// Every write lands through the API, whether it is sent at once or later
  /// from the outbox, so the API's own notice is the one there is.
  @override
  Stream<void> get readingProgressWrites => _origin.readingProgressWrites;

  /// Where the reader stands in a series, across every device, which only the
  /// API holds. A screen that cannot reach it offers the first episode, the
  /// way it does a guest.
  @override
  Future<SeriesProgress> getSeriesProgress(
    String seriesInternalId, {
    required String locale,
  }) => _origin.getSeriesProgress(seriesInternalId, locale: locale);

  /// The reader's own rating, made of reactions that are never kept on the
  /// device either, so only the API can answer it.
  @override
  Future<double?> getMySeriesRating(String seriesInternalId) =>
      _origin.getMySeriesRating(seriesInternalId);

  /// The reader's continue-reading row, which only the API can answer.
  ///
  /// Nothing about it is kept on the device: it is an offer to open something
  /// the reader has not read yet, and what a reader without a network can open
  /// is what the series screen already marks as saved.
  @override
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    required String locale,
    String token = '',
  }) => _origin.listRecentSeries(limit: limit, locale: locale, token: token);

  /// The reader's history across every device, which only the API holds.
  @override
  Future<EpisodeReadPage> listEpisodeReads({
    required int limit,
    required String locale,
    String token = '',
  }) => _origin.listEpisodeReads(limit: limit, locale: locale, token: token);

  /// What arrived in the reader's follows, which only the API can answer.
  @override
  Future<FollowUpdatePage> listFollowUpdates({
    required int limit,
    required String locale,
    String token = '',
  }) => _origin.listFollowUpdates(limit: limit, locale: locale, token: token);

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
    final now = _clock();
    if (isReadableOffline(saved, readerId: reader, now: now, grace: grace)) {
      return saved.detail;
    }
    final ended = saved.expiresAt?.isAfter(now) == false;
    // A grant that has ended is over for whoever holds the device, a free
    // window included, so the body goes whoever it was saved for.
    if (ended || saved.ownerId == reader) {
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
  /// much about taking a body away as about keeping one. [locale] is the one
  /// [detail] was read in, which a second read of it asks in again, and
  /// [isLatest] whether a newer read of it has started since.
  Future<void> _remember(
    EpisodeDetail detail,
    String reader,
    String locale,
    bool Function() isLatest,
  ) async {
    // An entitled body is kept only when there is a reader to hold it against:
    // a grant the device cannot name again is a grant it could never re-check.
    final keep = switch (detail.access) {
      EpisodeAccess.free => true,
      EpisodeAccess.entitled => reader.isNotEmpty,
      EpisodeAccess.ageRestricted ||
      EpisodeAccess.locked ||
      EpisodeAccess.unknown => false,
    };
    final grant = keep ? await _grantEnd(detail, locale) : null;
    if (!isLatest()) {
      return;
    }
    if (!keep || grant == _GrantEnd.lapsed) {
      await library.removeEpisode(detail.seriesId, detail.episode.id);
      return;
    }
    await library.writeEpisode(
      SavedEpisode(
        detail: _forStorage(detail),
        ownerId: detail.access == EpisodeAccess.entitled ? reader : '',
        checkedAt: _clock(),
        expiresAt: grant?.end,
      ),
    );
  }

  /// When the grant [detail] was read under ends, where the API names an end,
  /// [_GrantEnd.lapsed] when it ended while that was being asked, and `null`
  /// when nothing names an end.
  ///
  /// A priced episode free to everyone is free until its window closes, which
  /// the read itself says. A body a ticket opened says nothing of the ticket,
  /// so the reader's wait-for-free tickets on the series are asked. A ticket
  /// they do not list is either one staff granted, whose end the app is never
  /// told, or a wait-free ticket that closed between the two reads; the
  /// episode is read again to tell them apart, since only the first still
  /// opens it after the tickets were listed. A staff ticket is bounded by the
  /// grace window alone, as a purchase is, and so is a ticket whose end could
  /// not be read, since the body was just confirmed.
  Future<_GrantEnd?> _grantEnd(EpisodeDetail detail, String locale) async {
    switch (detail.access) {
      case EpisodeAccess.free:
        final freeUntil = detail.episode.freeUntil;
        return freeUntil == null ? null : _GrantEnd(freeUntil);
      case EpisodeAccess.entitled
          when detail.entitlementSource ==
              EpisodeEntitlementSource.accessTicket:
        final waitFree = _waitFree;
        if (waitFree == null || detail.seriesInternalId.isEmpty) {
          return null;
        }
        try {
          final state = await waitFree.ticketState(detail.seriesInternalId);
          final expiresAt = state.expiryOf(detail.episode.internalId);
          if (expiresAt != null) {
            return _GrantEnd(expiresAt);
          }
          final again = await _origin.getEpisode(
            detail.seriesId,
            detail.episode.id,
            locale: locale,
          );
          return switch (again?.access) {
            EpisodeAccess.free || EpisodeAccess.entitled => null,
            _ => _GrantEnd.lapsed,
          };
        } on WaitFreeFailure {
          return null;
        } on CatalogFailure {
          return null;
        }
      case _:
        return null;
    }
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
      entitlementSource: detail.entitlementSource,
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

/// The end of the grant a body was read under, as [OfflineCatalogRepository]
/// files it.
class _GrantEnd {
  const _GrantEnd(this.end);

  /// The grant ended between the read that returned the body and the read
  /// that asked when it ends, so the body is not the reader's any more.
  static const lapsed = _GrantEnd(null);

  final DateTime? end;
}

/// Reads the public id of the signed-in reader, empty when there is none.
///
/// Called on every read rather than captured, so a sign-in or a sign-out
/// reaches the next one without rebuilding the repository.
typedef ReaderIdReader = String Function();
