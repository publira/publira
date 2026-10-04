import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/age_rating_gate.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/content_views/content_view_recorder.dart';
import 'package:publira/content_views/content_view_repository.dart';
import 'package:publira/follow/follow_control.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/offline/episode_downloader.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/purchase/buy_episode_button.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// Series detail. Loads the published series and its episodes from the API.
class SeriesDetailScreen extends StatefulWidget {
  const SeriesDetailScreen({super.key, required this.seriesId});

  final String seriesId;

  @override
  State<SeriesDetailScreen> createState() => _SeriesDetailScreenState();
}

/// One series as this screen opens it, with the rating the reader's birth
/// date already proves.
class _OpenSeries {
  const _OpenSeries({required this.detail, this.provenRating});

  final SeriesDetail detail;
  final SeriesAgeRating? provenRating;
}

class _SeriesDetailScreenState extends State<SeriesDetailScreen> {
  late Future<_OpenSeries?> _future;
  var _started = false;
  var _accessToken = '';

  /// Reloads whenever the reader signs in or out, because the rating a birth
  /// date proves belongs to the reader who was signed in when it was read.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = AuthScope.of(context);
    if (_started && auth.accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = auth.accessToken;
    _future = _load(CatalogScope.of(context), auth);
  }

  void _reload() {
    setState(() {
      _future = _load(CatalogScope.of(context), AuthScope.of(context));
    });
  }

  /// The series, and what the reader's birth date proves when it carries a
  /// rating to gate. A birth date that cannot be read proves nothing, which
  /// leaves the confirmation standing rather than failing the screen.
  Future<_OpenSeries?> _load(
    CatalogRepository catalog,
    AuthController auth,
  ) async {
    final detail = await catalog.getSeries(widget.seriesId);
    if (detail == null) {
      return null;
    }
    if (!isRestrictedAgeRating(detail.series.ageRating)) {
      return _OpenSeries(detail: detail);
    }
    try {
      final age = await auth.readReaderAge();
      return _OpenSeries(
        detail: detail,
        provenRating: age?.provenAgeRating(DateTime.now()),
      );
    } on AuthFailure {
      return _OpenSeries(detail: detail);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<_OpenSeries?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Scaffold(
            appBar: AppBar(title: AutospacedText(messages.seriesTitle)),
            body: const Center(
              key: ValueKey('series-detail-loading'),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            appBar: AppBar(title: AutospacedText(messages.seriesTitle)),
            body: _DetailMessage(
              key: const ValueKey('series-detail-error'),
              message: _errorCopy(messages, snapshot.error),
              actionLabel: messages.commonRetry,
              onAction: _reload,
            ),
          );
        }
        final open = snapshot.data;
        if (open == null) {
          return Scaffold(
            appBar: AppBar(title: AutospacedText(messages.seriesTitle)),
            body: _DetailMessage(
              key: const ValueKey('series-not-found'),
              message: messages.seriesNotFound(id: widget.seriesId),
              actionLabel: messages.commonBackToCatalog,
              onAction: () => context.goNamed('catalog'),
            ),
          );
        }
        final detail = open.detail;
        return Scaffold(
          appBar: AppBar(
            title: AutospacedText(detail.series.title),
            actions: [
              if (LinkScope.maybeOf(context)?.share != null)
                ShareAction(
                  key: const ValueKey('series-share'),
                  path: AppRoutes.seriesDetailPath(detail.series.id),
                  title: detail.series.title,
                  credits: detail.series.creators,
                ),
            ],
          ),
          body: AgeRatingGate(
            rating: detail.series.ageRating,
            seriesTitle: detail.series.title,
            provenRating: open.provenRating,
            child: ContentViewRecorder(
              kind: ContentViewKind.series,
              targetId: detail.series.internalId,
              child: _SeriesDetailBody(detail: detail),
            ),
          ),
        );
      },
    );
  }

  String _errorCopy(AppMessages messages, Object? error) {
    if (error is! CatalogFailure) {
      return messages.seriesLoadFailed;
    }
    return switch (error.kind) {
      CatalogFailureKind.network => messages.errorsRpcUnavailable,
      CatalogFailureKind.notSaved ||
      CatalogFailureKind.saveExpired => messages.seriesOfflineNotSaved,
      CatalogFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
      CatalogFailureKind.unexpected => messages.seriesLoadFailed,
    };
  }
}

class _DetailMessage extends StatelessWidget {
  const _DetailMessage({
    super.key,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AutospacedText(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: onAction,
              child: AutospacedText(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeriesDetailBody extends StatefulWidget {
  const _SeriesDetailBody({required this.detail});

  final SeriesDetail detail;

  @override
  State<_SeriesDetailBody> createState() => _SeriesDetailBodyState();
}

class _SeriesDetailBodyState extends State<_SeriesDetailBody> {
  /// Episodes this device could open right now without a network. Empty on a
  /// run with no library, which is what leaves the badge off.
  var _saved = const <String>{};
  var _readerId = '';
  var _started = false;

  /// What this reader may do with each episode, keyed by public id. Empty
  /// until the API has answered, and for good when it cannot, which leaves
  /// every row offering no purchase rather than one the reader may not need.
  var _access = const <String, EpisodeAccess>{};

  /// Whether the tenant takes payments, which it has to before any row offers
  /// one.
  var _acceptsPayments = false;

  /// Where this reader stands in the series. Nothing for a guest, until the
  /// API has answered, and for good when it cannot, which leaves the reading
  /// action on the first episode: what a failure costs is the reader's place,
  /// and "start here" is a better answer than a notice where the action was.
  var _progress = SeriesProgress.none;

  /// How many reads of [_progress] this screen has started. Only the latest
  /// one's answer is shown, since an earlier one may answer after it with a
  /// place the reader has moved on from.
  var _progressReads = 0;

  /// How many episodes this screen has opened that the reader has not come
  /// back from yet. Their writes are not read back while they are open: the
  /// return asks once for all of them, rather than one read per page turned.
  var _episodesOpen = 0;

  /// This reader's own rating of the series, the mean of the scores they gave
  /// its episodes. `null` for a guest, until the API has answered, and for a
  /// reader who has reacted to none of them.
  double? _ownRating;

  /// Whether the latest read of [_ownRating] failed, which the screen says
  /// where the rating would be, as the storefront does: unlike a place in the
  /// series, a rating has no stand-in that would not read as the reader's own.
  var _ownRatingFailed = false;

  /// How many reads of [_ownRating] this screen has started, so that only the
  /// latest one's answer is shown.
  var _ownRatingReads = 0;

  CatalogRepository? _catalog;

  /// The viewer sends what the reader read without waiting for it, the last
  /// page as it goes away after the return, so a write that lands once the
  /// reader is back is read back then rather than lost to the read the return
  /// made before it.
  StreamSubscription<void>? _progressWrites;

  /// A reaction pressed just before the reader came back can land after the
  /// return has read the rating, so it is read again once it has landed.
  StreamSubscription<void>? _reactionWrites;

  OfflineLibrary? _library;

  /// Saved episodes change under this screen too — a save it started that
  /// finishes, or a deletion on the downloads screen — so the marks follow the
  /// library rather than the moment the screen opened.
  StreamSubscription<void>? _libraryChanges;

  @override
  void dispose() {
    unawaited(_libraryChanges?.cancel());
    unawaited(_progressWrites?.cancel());
    unawaited(_reactionWrites?.cancel());
    super.dispose();
  }

  /// Which episodes are readable depends on who is signed in, so a sign-in or
  /// a sign-out asks the library again rather than keeping the last answer.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    final catalog = CatalogScope.of(context);
    final library = OfflineScope.maybeOf(context);
    // A library swapped under the screen is listened to and read again the
    // way a new reader is, so the marks never come from the library before it.
    final changedLibrary = library != _library;
    if (changedLibrary) {
      unawaited(_libraryChanges?.cancel());
      _library = library;
      _libraryChanges = library?.changes.listen(
        (_) => unawaited(_loadSaved(library, _readerId)),
      );
    }
    final changedCatalog = !identical(catalog, _catalog);
    if (changedCatalog) {
      unawaited(_progressWrites?.cancel());
      _progressWrites = catalog.readingProgressWrites.listen((_) {
        if (_episodesOpen == 0) {
          unawaited(_loadProgress(catalog, _readerId));
        }
      });
      unawaited(_reactionWrites?.cancel());
      _reactionWrites = catalog.reactionWrites.listen((_) {
        if (_episodesOpen == 0) {
          unawaited(_loadOwnRating(catalog, _readerId));
        }
      });
    }
    _catalog = catalog;
    if (_started && readerId == _readerId) {
      if (changedLibrary && library != null) {
        unawaited(_loadSaved(library, readerId));
      }
      if (changedCatalog) {
        unawaited(_loadProgress(catalog, readerId));
        unawaited(_loadOwnRating(catalog, readerId));
      }
      return;
    }
    _started = true;
    _readerId = readerId;
    // The last reader's place and rating are not this one's, whether or not
    // the API answers for the new one.
    _progress = SeriesProgress.none;
    _ownRating = null;
    _ownRatingFailed = false;
    unawaited(_loadProgress(catalog, readerId));
    unawaited(_loadOwnRating(catalog, readerId));
    final purchase = PurchaseScope.maybeOf(context)?.repository;
    if (purchase != null) {
      unawaited(_loadPurchase(purchase, readerId));
    }
    if (library == null) {
      return;
    }
    unawaited(_loadSaved(library, readerId));
  }

  /// Which episodes this reader would have to buy, and whether the tenant
  /// sells them. Both are asked again on a sign-in or a sign-out, because a
  /// purchase belongs to the reader who holds it.
  Future<void> _loadPurchase(
    PurchaseRepository purchase,
    String readerId,
  ) async {
    // Either read failing offers no purchase, not a failed screen.
    final (access, acceptsPayments) = await (
      purchase
          .seriesEpisodeAccess(widget.detail.series.internalId)
          .onError<PurchaseFailure>((_, _) => const {}),
      purchase.acceptsPayments().onError<PurchaseFailure>((_, _) => false),
    ).wait;
    if (!mounted || readerId != _readerId) {
      return;
    }
    setState(() {
      _access = access;
      _acceptsPayments = acceptsPayments;
    });
  }

  /// Where [readerId] stands in the series. A guest has no place to keep, so
  /// nothing is asked for one.
  Future<void> _loadProgress(CatalogRepository catalog, String readerId) async {
    final seriesId = widget.detail.series.internalId;
    if (readerId.isEmpty || seriesId.isEmpty) {
      return;
    }
    final read = ++_progressReads;
    final SeriesProgress progress;
    try {
      progress = await catalog.getSeriesProgress(seriesId);
    } on CatalogFailure {
      return;
    }
    if (!mounted ||
        read != _progressReads ||
        readerId != _readerId ||
        !identical(catalog, _catalog)) {
      return;
    }
    setState(() {
      _progress = progress;
    });
  }

  /// This reader's own rating of the series. A guest has reacted to nothing,
  /// so nothing is asked for one.
  Future<void> _loadOwnRating(
    CatalogRepository catalog,
    String readerId,
  ) async {
    final seriesId = widget.detail.series.internalId;
    if (readerId.isEmpty || seriesId.isEmpty) {
      return;
    }
    final read = ++_ownRatingReads;
    double? rating;
    var failed = false;
    try {
      rating = await catalog.getMySeriesRating(seriesId);
    } on CatalogFailure catch (failure) {
      // A session the API no longer takes is answered as the guest it now
      // is, with no rating rather than a failure to show one.
      failed = failure.kind != CatalogFailureKind.sessionExpired;
    }
    if (!mounted ||
        read != _ownRatingReads ||
        readerId != _readerId ||
        !identical(catalog, _catalog)) {
      return;
    }
    setState(() {
      _ownRating = rating;
      _ownRatingFailed = failed;
    });
  }

  /// Opens [location] in the viewer, and asks where the reader stands and how
  /// they rate the series again once they come back: the viewer is where both
  /// move.
  Future<void> _openEpisode(String location) async {
    _episodesOpen++;
    try {
      await context.pushInTab<void>(location);
    } finally {
      _episodesOpen--;
    }
    final catalog = _catalog;
    if (!mounted || catalog == null) {
      return;
    }
    await (
      _loadProgress(catalog, _readerId),
      _loadOwnRating(catalog, _readerId),
    ).wait;
  }

  /// Saves [episode] with every page, and tells the reader how that ended.
  Future<void> _saveOffline(
    EpisodeDownloader downloader,
    EpisodeItem episode,
  ) async {
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    String copy;
    try {
      await downloader.save(widget.detail.series.id, episode.id);
      copy = messages.seriesSaveOfflineSaved(title: episode.title);
    } on EpisodeDownloadFailure catch (failure) {
      copy = switch (failure.kind) {
        EpisodeDownloadFailureKind.network => messages.seriesSaveOfflineFailed(
          title: episode.title,
        ),
        EpisodeDownloadFailureKind.notReadable =>
          messages.seriesSaveOfflineNotReadable(title: episode.title),
        EpisodeDownloadFailureKind.storage =>
          messages.seriesSaveOfflineNoStorage(title: episode.title),
      };
    }
    // The save outlives the screen, and so does the messenger it reports to,
    // unless the whole app was replaced while it ran.
    if (messenger.mounted) {
      messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    }
  }

  /// Whether [episode] is one this reader could keep, which is what a row
  /// offers to save.
  ///
  /// The access the API answered decides where there is one. Without it — a
  /// build with no purchases, or an answer that failed — only a free episode is
  /// offered, since a paid one would most likely be refused.
  bool _canSave(EpisodeItem episode) {
    return switch (_access[episode.id]) {
      EpisodeAccess.free || EpisodeAccess.entitled => true,
      null => episode.price <= 0,
      _ => false,
    };
  }

  Future<void> _loadSaved(OfflineLibrary library, String readerId) async {
    final saved = await library.readableEpisodeIds(
      widget.detail.series.id,
      readerId: readerId,
    );
    // The reader may have signed in or out while the library was answering,
    // in which case this answer is about somebody else.
    if (!mounted || readerId != _readerId) {
      return;
    }
    setState(() {
      _saved = saved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final series = widget.detail.series;
    // A build with no follow repository offers none of this, so neither the
    // control nor the author rows it would sit in are put on the screen.
    final follows = FollowScope.maybeOf(context) != null;
    final downloader = OfflineScope.downloaderOf(context);
    final offer = _progress.offerIn(widget.detail.episodes);

    return ListView(
      key: const ValueKey('series-detail-body'),
      padding: const EdgeInsets.all(16),
      children: [
        // 16:9 is the shape of the rendition, and on a phone it is what the
        // banner takes. The cap is for the wide screen a tablet or a
        // desktop window gives it, where the same ratio would push the
        // synopsis and the episodes off the first screen.
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 220),
          child: EyeCatchCover(
            kind: 'series',
            id: series.id,
            variants: series.eyeCatchVariants,
            requestHeaders: series.imageRequestHeaders,
            preferredTypes: const [eyeCatchLandscape, eyeCatchPortrait],
            aspectRatio: 16 / 9,
          ),
        ),
        const SizedBox(height: 16),
        AutospacedText(series.title, style: theme.textTheme.headlineSmall),
        const SizedBox(height: 8),
        _SeriesRating(
          series: series,
          ownRating: _ownRating,
          ownRatingFailed: _ownRatingFailed,
        ),
        if (series.creators.isNotEmpty) ...[
          const SizedBox(height: 4),
          CreatorCredits(
            key: const ValueKey('series-creators'),
            credits: series.creators,
            style: theme.textTheme.bodyMedium,
            onCreatorTap: (creator) =>
                context.pushInTab(AppRoutes.creatorDetailPath(creator.id)),
          ),
        ],
        const SizedBox(height: 8),
        AutospacedText(
          messages.seriesEpisodeCount(
            count: messages.formatInteger(series.episodeCount),
          ),
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.primary,
          ),
        ),
        if (series.labelName.isNotEmpty ||
            series.status != null ||
            series.scheduleWeekdays.isNotEmpty ||
            messages.seriesAgeRatingLabel(series.ageRating) != null) ...[
          const SizedBox(height: 8),
          Wrap(
            key: const ValueKey('series-classification'),
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (series.labelName.isNotEmpty) _SeriesLabel(series: series),
              if (series.status != null)
                AutospacedText(
                  key: const ValueKey('series-status'),
                  messages.seriesStatusLabel(series.status!),
                  style: theme.textTheme.labelLarge,
                ),
              if (messages.seriesAgeRatingLabel(series.ageRating)
                  case final rating?)
                AutospacedText(
                  key: const ValueKey('series-age-rating'),
                  rating,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              if (series.scheduleWeekdays.isNotEmpty)
                AutospacedText(
                  key: const ValueKey('series-schedule'),
                  messages.seriesSchedule(
                    weekdays: messages.formatList([
                      for (final weekday in series.scheduleWeekdays)
                        messages.formatWeekday(weekday),
                    ]),
                  ),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ],
        // Where a reader goes next when this work is not the one: the
        // tenant's own genres first, then the words an editor wrote on the
        // series, told apart by the mark in front of a tag.
        if (series.genres.isNotEmpty || series.tags.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            key: const ValueKey('series-genres-tags'),
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final genre in series.genres)
                ActionChip(
                  key: ValueKey('series-genre-${genre.id}'),
                  label: AutospacedText(genre.name),
                  visualDensity: VisualDensity.compact,
                  onPressed: () =>
                      context.pushInTab(AppRoutes.genreDetailPath(genre.id)),
                ),
              for (final tag in series.tags)
                ActionChip(
                  key: ValueKey('series-tag-${tag.slug}'),
                  avatar: const Icon(Icons.tag),
                  label: AutospacedText(tag.name),
                  visualDensity: VisualDensity.compact,
                  onPressed: () =>
                      context.pushInTab(AppRoutes.tagDetailPath(tag.slug)),
                ),
            ],
          ),
        ],
        // The way into the work: the episode this reader stopped in or is due
        // next, and the first one for a guest and for a reader who has read
        // nothing yet. It takes the tenant's secondary colour, as the
        // storefront's does, so it is not one more button like the follow
        // control under it.
        if (offer != null) ...[
          const SizedBox(height: 16),
          FilledButton(
            key: const ValueKey('series-reading-action'),
            style: FilledButton.styleFrom(
              backgroundColor: theme.colorScheme.secondary,
              foregroundColor: theme.colorScheme.onSecondary,
            ),
            onPressed: () => unawaited(
              _openEpisode(
                AppRoutes.episodeViewerPath(series.id, offer.episode.id),
              ),
            ),
            child: AutospacedText(
              offer.isContinuation
                  ? messages.seriesContinueReading
                  : messages.seriesReadFromFirst,
            ),
          ),
        ],
        if (follows) ...[
          const SizedBox(height: 16),
          FollowControl(
            kind: FollowTargetKind.series,
            targetId: series.internalId,
            targetName: series.title,
          ),
        ],
        if (series.description.isNotEmpty) ...[
          const SizedBox(height: 16),
          AutospacedText(series.description, style: theme.textTheme.bodyLarge),
        ],
        // Each author is followed on their own, and the row opens the author.
        if (follows && series.creators.isNotEmpty) ...[
          const SizedBox(height: 24),
          AutospacedText(
            messages.seriesCreatorsHeading,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          // A person credited in two roles is still one person to follow.
          for (final creator in {
            for (final credit in series.creators) credit.id: credit,
          }.values)
            ListTile(
              key: ValueKey('series-creator-${creator.id}'),
              contentPadding: EdgeInsets.zero,
              title: AutospacedText(creator.name),
              trailing: FollowControl(
                kind: FollowTargetKind.creator,
                targetId: creator.internalId,
                targetName: creator.name,
              ),
              onTap: () =>
                  context.pushInTab(AppRoutes.creatorDetailPath(creator.id)),
            ),
        ],
        const SizedBox(height: 24),
        AutospacedText(
          messages.seriesEpisodesHeading,
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        if (widget.detail.episodes.isEmpty)
          AutospacedText(messages.seriesEpisodesEmpty)
        else
          for (final episode in widget.detail.episodes)
            ListTile(
              key: ValueKey('episode-tile-${episode.id}'),
              contentPadding: EdgeInsets.zero,
              // A finished row steps back, so the episodes still ahead are the
              // ones that stand out.
              textColor: _progress.finishedEpisodeIds.contains(episode.id)
                  ? theme.colorScheme.onSurfaceVariant
                  : null,
              title: AutospacedText(episode.title),
              subtitle: _progress.finishedEpisodeIds.contains(episode.id)
                  ? _FinishedMark(episodeId: episode.id)
                  : null,
              trailing: _EpisodeTrailing(
                price: episode.price,
                soldOnWeb:
                    _acceptsPayments &&
                    episode.purchaseSurface == EpisodePurchaseSurface.web,
                saved: _saved.contains(episode.id),
                download: downloader == null || !_canSave(episode)
                    ? null
                    : _SaveOfflineButton(
                        downloader: downloader,
                        seriesId: series.id,
                        episode: episode,
                        saved: _saved.contains(episode.id),
                        onSave: () =>
                            unawaited(_saveOffline(downloader, episode)),
                      ),
                buy:
                    _acceptsPayments &&
                        episode.price > 0 &&
                        episode.purchaseSurface != EpisodePurchaseSurface.web &&
                        _access[episode.id] == EpisodeAccess.locked
                    ? BuyEpisodeButton(
                        episodeId: episode.id,
                        episodeInternalId: episode.internalId,
                        price: episode.price,
                        compact: true,
                        signInReturnTo: AppRoutes.episodeViewerPath(
                          series.id,
                          episode.id,
                        ),
                        onAlreadyPurchased: () => unawaited(
                          _openEpisode(
                            AppRoutes.episodeViewerPath(series.id, episode.id),
                          ),
                        ),
                        onStorePurchase: () => unawaited(
                          _openEpisode(
                            AppRoutes.episodeViewerPath(
                              series.id,
                              episode.id,
                              checkout: CheckoutOutcome.success,
                            ),
                          ),
                        ),
                      )
                    : null,
              ),
              onTap: () => unawaited(
                _openEpisode(
                  AppRoutes.episodeViewerPath(series.id, episode.id),
                ),
              ),
            ),
      ],
    );
  }
}

/// The label a series is published under, which leads to the label's other
/// series. A copy saved on this device before the label's public id was kept
/// names it and leads nowhere, since the screen is addressed by that id.
class _SeriesLabel extends StatelessWidget {
  const _SeriesLabel({required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (series.labelId.isEmpty) {
      return AutospacedText(
        key: const ValueKey('series-label'),
        series.labelName,
        style: theme.textTheme.labelLarge,
      );
    }
    return TextButton(
      key: const ValueKey('series-label'),
      style: TextButton.styleFrom(
        padding: EdgeInsets.zero,
        textStyle: theme.textTheme.labelLarge,
        visualDensity: VisualDensity.compact,
      ),
      onPressed: () =>
          context.pushInTab(AppRoutes.labelDetailPath(series.labelId)),
      child: AutospacedText(series.labelName),
    );
  }
}

/// The series' rating from every reader who reacted to it, this reader's own
/// beside it, and how a rating comes about, which the storefront says under
/// both too: a series is rated through its episodes, never directly.
class _SeriesRating extends StatelessWidget {
  const _SeriesRating({
    required this.series,
    required this.ownRating,
    required this.ownRatingFailed,
  });

  final SeriesItem series;
  final double? ownRating;
  final bool ownRatingFailed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final style = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final figures = [
      if (series.ratingCount > 0)
        AutospacedText(
          key: const ValueKey('series-rating'),
          series.ratingCount == 1
              ? messages.seriesRatingSingle(
                  average: series.ratingAverage.toStringAsFixed(1),
                  count: messages.formatInteger(series.ratingCount),
                )
              : messages.seriesRating(
                  average: series.ratingAverage.toStringAsFixed(1),
                  count: messages.formatInteger(series.ratingCount),
                ),
          style: style,
        ),
      if (ownRating case final rating?)
        AutospacedText(
          key: const ValueKey('series-rating-own'),
          messages.seriesRatingOwn(average: rating.toStringAsFixed(1)),
          style: style,
        ),
      if (ownRatingFailed)
        AutospacedText(
          key: const ValueKey('series-rating-own-failed'),
          messages.seriesRatingOwnFailed,
          style: style,
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (figures.isNotEmpty) ...[
          Wrap(spacing: 16, runSpacing: 4, children: figures),
          const SizedBox(height: 4),
        ],
        AutospacedText(
          key: const ValueKey('series-rating-explanation'),
          messages.seriesRatingExplanation,
          style: style,
        ),
      ],
    );
  }
}

/// The mark on an episode row this reader has finished, in words as well as
/// ink, so a screen reader says it too.
class _FinishedMark extends StatelessWidget {
  const _FinishedMark({required this.episodeId});

  final String episodeId;

  @override
  Widget build(BuildContext context) {
    return Row(
      key: ValueKey('episode-finished-$episodeId'),
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.check_circle_outline, size: 16),
        const SizedBox(width: 4),
        AutospacedText(AppMessages.of(context).seriesEpisodeFinished),
      ],
    );
  }
}

/// Price and offline mark of one episode row.
///
/// The mark is what tells a reader, before they lose their connection, which
/// episodes this device can still open once they have.
class _EpisodeTrailing extends StatelessWidget {
  const _EpisodeTrailing({
    required this.price,
    required this.soldOnWeb,
    required this.saved,
    required this.download,
    required this.buy,
  });

  final int price;

  /// Whether the episode is sold on the website alone, which the row says in
  /// place of a price the app cannot take.
  final bool soldOnWeb;
  final bool saved;

  /// The way to save the episode, which stands in for the mark where there is
  /// one.
  final Widget? download;

  /// The purchase this reader is offered, which names the price itself and so
  /// stands in place of it.
  final Widget? buy;

  @override
  Widget build(BuildContext context) {
    final buy = this.buy;
    final download = this.download;
    if (!saved && download == null && price <= 0) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (download != null)
          download
        else if (saved)
          const _SavedOfflineMark(),
        if (buy != null)
          buy
        else if (price > 0 && soldOnWeb)
          AutospacedText(
            key: const ValueKey('episode-sold-on-web'),
            messages.purchaseSoldOnWeb,
          )
        else if (price > 0)
          AutospacedText('¥${messages.formatInteger(price)}'),
      ],
    );
  }
}

/// The mark on an episode this device can open without a network.
class _SavedOfflineMark extends StatelessWidget {
  const _SavedOfflineMark();

  @override
  Widget build(BuildContext context) {
    // The save action's box and icon size, so a row that turns from one into
    // the other keeps its icon where it was.
    return SizedBox.square(
      key: const ValueKey('episode-saved-offline'),
      dimension: kMinInteractiveDimension,
      child: Center(
        child: Icon(
          Icons.offline_pin_outlined,
          // The mark is the only thing that says this episode still opens
          // without a network, so it has to reach a screen reader too.
          semanticLabel: AppMessages.of(context).seriesSavedOffline,
        ),
      ),
    );
  }
}

/// Saves one episode for offline reading, shows how far that has come while
/// it runs, and gives way to the saved mark once it is done.
class _SaveOfflineButton extends StatelessWidget {
  const _SaveOfflineButton({
    required this.downloader,
    required this.seriesId,
    required this.episode,
    required this.saved,
    required this.onSave,
  });

  final EpisodeDownloader downloader;
  final String seriesId;
  final EpisodeItem episode;
  final bool saved;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ListenableBuilder(
      listenable: downloader,
      builder: (context, _) {
        final progress = downloader.progressOf(seriesId, episode.id);
        // The body is filed before its pages arrive, so a save still running
        // keeps its progress up over the mark.
        if (progress != null) {
          return Padding(
            key: ValueKey('episode-saving-offline-${episode.id}'),
            padding: const EdgeInsets.all(12),
            child: SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(
                // Nothing is known until the episode has been read and its
                // pages counted.
                value: progress == 0 ? null : progress,
                strokeWidth: 2,
                semanticsLabel: messages.seriesSavingOffline(
                  title: episode.title,
                ),
              ),
            ),
          );
        }
        if (saved) {
          return const _SavedOfflineMark();
        }
        return AutospacedTooltip(
          message: messages.seriesSaveOfflineAria(title: episode.title),
          child: IconButton(
            key: ValueKey('episode-save-offline-${episode.id}'),
            icon: const Icon(Icons.download_outlined),
            onPressed: onSave,
          ),
        );
      },
    );
  }
}
