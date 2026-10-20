import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/age_rating_gate.dart';
import 'package:publira/catalog/campaign_price_note.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_shelf.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/episode_cover.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/catalog/free_until_badge.dart';
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
import 'package:publira/purchase/buy_bundle_button.dart';
import 'package:publira/purchase/buy_episode_button.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// Series detail. Loads the published series and its episodes from the API.
class SeriesDetailScreen extends StatefulWidget {
  const SeriesDetailScreen({super.key, required this.seriesId, this.checkout});

  final String seriesId;

  /// How a checkout of one of the series' volumes or of the rest of it ended,
  /// when the browser has just handed one back.
  final CheckoutOutcome? checkout;

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

  /// The app's locale the series is read in, as a BCP 47 tag.
  var _locale = '';

  /// Reloads whenever the reader signs in or out, because the rating a birth
  /// date proves belongs to the reader who was signed in when it was read,
  /// and whenever the locale changes, which the title and synopsis are read
  /// in.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = AuthScope.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    if (_started && auth.accessToken == _accessToken && locale == _locale) {
      return;
    }
    _started = true;
    _accessToken = auth.accessToken;
    _locale = locale;
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
    final detail = await catalog.getSeries(widget.seriesId, locale: _locale);
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
            title: AutospacedText(
              detail.series.title,
              locale: detail.series.textLocale,
            ),
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
              child: _SeriesDetailBody(
                detail: detail,
                checkout: widget.checkout,
              ),
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
  const _SeriesDetailBody({required this.detail, this.checkout});

  final SeriesDetail detail;
  final CheckoutOutcome? checkout;

  @override
  State<_SeriesDetailBody> createState() => _SeriesDetailBodyState();
}

class _SeriesDetailBodyState extends State<_SeriesDetailBody> {
  /// Episodes this device could open right now without a network. Empty on a
  /// run with no library, which is what leaves the badge off.
  var _saved = const <String>{};
  var _readerId = '';
  var _started = false;

  /// What this reader holds of the series and what the rest of it would cost
  /// them. `null` until the API has answered, and for good when it cannot,
  /// which leaves every row, volume, and the rest of the series offering no
  /// purchase rather than one the reader may not need.
  SeriesPurchaseState? _holdings;

  /// Whether the latest read of [_holdings] failed, which the volumes and the
  /// offer of the rest of the series say where their purchase would be, as
  /// the storefront does: without it no volume can tell one already the
  /// reader's from one to buy.
  var _holdingsFailed = false;

  /// What this reader may do with each episode, keyed by public id.
  Map<String, EpisodeAccess> get _access => _holdings?.access ?? const {};

  /// Whether the tenant takes payments, which it has to before any row offers
  /// one.
  var _acceptsPayments = false;

  /// The tenant's currency, `null` until it is read or when it cannot be.
  String? _currency;

  /// Whether the tenant sells through its web checkout, which is the only way
  /// a rental, a volume, or the rest of a series is sold: the store sells the
  /// permanent copy of one episode alone.
  var _sellsOnWeb = false;

  /// How many reads of [_access] this screen has started, so that only the
  /// latest one's answer is shown: the read the screen opened with can answer
  /// after the one the return from the viewer made, with an episode locked
  /// that a ticket has since opened.
  var _purchaseReads = 0;

  /// Fires when the soonest free window or campaign open on an episode of this
  /// series closes, which is when its row is priced again and what the reader
  /// may do with it has to be asked again.
  Timer? _windowClose;

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
  void initState() {
    super.initState();
    _scheduleWindowClose();
  }

  @override
  void didUpdateWidget(_SeriesDetailBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.detail, widget.detail)) {
      _scheduleWindowClose();
    }
    // A return link to the series the reader bought from differs only in its
    // query, which go_router answers with this same state, still scrolled to
    // the purchase the reader tapped. The notice of how it ended stands at the
    // top, so the list is taken back there.
    if (widget.checkout != oldWidget.checkout) {
      if (widget.checkout != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final top = _topKey.currentContext;
          if (top != null) {
            Scrollable.maybeOf(top)?.position.jumpTo(0);
          }
        });
      }
      final purchase = PurchaseScope.maybeOf(context)?.repository;
      if (purchase != null) {
        unawaited(_loadPurchase(purchase, _readerId));
        unawaited(_confirmCheckout(purchase));
      }
    }
  }

  /// The list's first sliver, whose context reaches the scroll position. It is
  /// laid out at any offset, unlike the rows inside it.
  final _topKey = GlobalKey();

  /// Reads what the reader holds again after each of
  /// [checkoutConfirmationDelays], for a reader the browser has just sent back
  /// from paying: the webhook that records the purchase races the return.
  Future<void> _confirmCheckout(PurchaseRepository purchase) async {
    if (widget.checkout != CheckoutOutcome.success || _readerId.isEmpty) {
      return;
    }
    for (final delay in checkoutConfirmationDelays) {
      await Future<void>.delayed(delay);
      if (!mounted || widget.checkout != CheckoutOutcome.success) {
        return;
      }
      await _loadPurchase(purchase, _readerId);
    }
  }

  /// Sets [_windowClose] for the soonest free window or campaign still open,
  /// or for none when no episode has one. A row is drawn free, discounted, or
  /// priced at build time, so without it a screen left open past the close
  /// would keep saying the episode is free or cheaper than it is.
  void _scheduleWindowClose() {
    _windowClose?.cancel();
    final now = DateTime.now();
    DateTime? soonest;
    for (final episode in widget.detail.episodes) {
      for (final end in [episode.freeUntil, episode.campaign?.endsAt]) {
        if (end != null &&
            end.isAfter(now) &&
            (soonest == null || end.isBefore(soonest))) {
          soonest = end;
        }
      }
    }
    if (soonest == null) {
      _windowClose = null;
      return;
    }
    _windowClose = Timer(soonest.difference(now), () {
      if (!mounted) {
        return;
      }
      setState(_scheduleWindowClose);
      final purchase = PurchaseScope.maybeOf(context)?.repository;
      if (purchase != null) {
        unawaited(_loadPurchase(purchase, _readerId));
      }
    });
  }

  @override
  void dispose() {
    _windowClose?.cancel();
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
      unawaited(_confirmCheckout(purchase));
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
    final read = ++_purchaseReads;
    // Either read failing offers no purchase, not a failed screen.
    final (holdings, acceptsPayments, currency, route) = await (
      purchase
          .seriesEpisodeAccess(widget.detail.series.internalId)
          .then<SeriesPurchaseState?>((holdings) => holdings)
          .onError<PurchaseFailure>((_, _) => null),
      purchase.acceptsPayments().onError<PurchaseFailure>((_, _) => false),
      purchase
          .currency()
          .then<String?>((currency) => currency)
          .onError<PurchaseFailure>((_, _) => null),
      purchase
          .appPurchaseRoute()
          .then<AppPurchaseRoute?>((route) => route)
          .onError<PurchaseFailure>((_, _) => null),
    ).wait;
    if (!mounted || read != _purchaseReads || readerId != _readerId) {
      return;
    }
    setState(() {
      _holdings = holdings;
      _holdingsFailed = holdings == null;
      // A price nobody can read is no purchase to offer.
      _acceptsPayments = acceptsPayments && currency != null;
      _currency = currency;
      _sellsOnWeb = route == AppPurchaseRoute.externalCheckout;
    });
  }

  /// Takes the outcome of the last checkout out of the screen's location as
  /// the reader starts another. Every successful return lands on the same
  /// location, which a screen still showing the last one would not see as a
  /// change, and so would neither read what the reader holds again nor say
  /// the new payment is being confirmed.
  void _checkoutOpened() {
    if (widget.checkout != null) {
      context.go(AppRoutes.seriesDetailPath(widget.detail.series.id));
    }
  }

  /// Reads what the reader holds again, for an offer the API turned down
  /// because it was out of date.
  void _reloadPurchase() {
    final purchase = PurchaseScope.maybeOf(context)?.repository;
    if (purchase != null) {
      unawaited(_loadPurchase(purchase, _readerId));
    }
  }

  /// Whether this reader would buy [episode], since the API has answered that
  /// they cannot open it and the tenant sells it in the app.
  bool _buyable(EpisodeItem episode) =>
      _acceptsPayments &&
      episode.price > 0 &&
      episode.purchaseSurface != EpisodePurchaseSurface.web &&
      _access[episode.id] == EpisodeAccess.locked;

  /// The campaign open on [episode] at [now], for a row that quotes its price,
  /// and `null` for any other row. A free window open over a campaign still
  /// opens the episode to everyone, so it wins; a row of an episode sold on
  /// the website alone names that instead of a price, and a row with no
  /// currency shows none.
  EpisodeCampaign? _quotedCampaign(EpisodeItem episode, DateTime now) {
    if (episode.isFreeAt(now) ||
        _currency == null ||
        _acceptsPayments &&
            episode.purchaseSurface == EpisodePurchaseSurface.web) {
      return null;
    }
    return episode.campaignAt(now);
  }

  /// What renting [episode] costs and for how long, for a row the reader
  /// could rent it from at [now], and `null` for any other row. Such a row
  /// offers no purchase of its own: the reader picks one of the two at the
  /// episode, where both are offered side by side.
  String? _rentalOffer(
    AppMessages messages,
    EpisodeItem episode,
    DateTime now,
  ) {
    if (episode.isFreeAt(now) ||
        !_sellsOnWeb ||
        !episode.isRented ||
        !_buyable(episode)) {
      return null;
    }
    return messages.purchaseRentFor(
      period: messages.purchaseRentalPeriod(hours: episode.rentalPeriodHours),
      price: messages.formatPrice(episode.rentalPrice, _currency!),
    );
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
      progress = await catalog.getSeriesProgress(
        seriesId,
        locale: Localizations.localeOf(context).toLanguageTag(),
      );
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

  /// Opens [location] in the viewer, and asks where the reader stands, how
  /// they rate the series, and which episodes they may open again once they
  /// come back: the viewer is where all three move, the last through a
  /// wait-for-free ticket used on its gate.
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
    final purchase = PurchaseScope.maybeOf(context)?.repository;
    await (
      _loadProgress(catalog, _readerId),
      _loadOwnRating(catalog, _readerId),
      purchase == null
          ? Future<void>.value()
          : _loadPurchase(purchase, _readerId),
    ).wait;
  }

  /// Saves [episode] with every page, and tells the reader how that ended.
  Future<void> _saveOffline(
    EpisodeDownloader downloader,
    EpisodeItem episode,
  ) async {
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    String copy;
    try {
      await downloader.save(
        widget.detail.series.id,
        episode.id,
        locale: locale,
      );
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

  /// What the screen says to a reader the browser has just sent back from a
  /// checkout of a volume or of the rest of the series, and `null` for any
  /// other reader.
  ///
  /// A success is worded as a payment still being applied, and stays up: the
  /// purchase is recorded by the payment provider's notification, which the
  /// screen reads again for without knowing what was bought.
  Widget? _checkoutNotice(AppMessages messages) {
    final theme = Theme.of(context);
    return switch (widget.checkout) {
      CheckoutOutcome.success when AuthScope.of(context).isSignedIn => Column(
        key: const ValueKey('series-checkout-confirming'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AutospacedText(
            messages.seriesCheckoutSuccess,
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            key: const ValueKey('series-checkout-check-again'),
            onPressed: _reloadPurchase,
            child: AutospacedText(messages.purchaseCheckAgain),
          ),
        ],
      ),
      CheckoutOutcome.cancelled => AutospacedText(
        key: const ValueKey('series-checkout-cancelled'),
        messages.purchaseCancelled,
        style: theme.textTheme.bodyMedium,
      ),
      _ => null,
    };
  }

  /// What a volume's card offers this reader: that they already own every
  /// episode in it, which is said whether or not the tenant sells it; the
  /// purchase where the app sells through the web checkout; and the website
  /// named without a link where it sells through the store, which has no
  /// product for a volume. `null` while what the reader owns is unknown.
  Widget? _volumeControl(AppMessages messages, VolumeItem volume) {
    final holdings = _holdings;
    if (holdings == null) {
      return null;
    }
    if (holdings.owns(volume)) {
      return AutospacedText(
        key: ValueKey('volume-owned-${volume.publicId}'),
        messages.seriesVolumeOwned,
      );
    }
    if (!_acceptsPayments) {
      return null;
    }
    if (!_sellsOnWeb) {
      return AutospacedText(
        key: ValueKey('volume-sold-on-web-${volume.publicId}'),
        messages.purchaseSoldOnWeb,
      );
    }
    return BuyBundleButton(
      key: ValueKey('volume-buy-${volume.publicId}'),
      label: messages.seriesVolumeBuy,
      start: (repository, _) => repository.startVolumeCheckout(volume.id),
      onRefused: _reloadPurchase,
      onOpened: _checkoutOpened,
    );
  }

  /// Every episode of the series the reader does not own yet, in one checkout,
  /// where the app sells through the web checkout and the API quotes a sale:
  /// how many, at what price, and what the series takes off buying them one
  /// by one. A quote that could not be read says so in its place.
  Widget? _remainderOffer(AppMessages messages) {
    final currency = _currency;
    if (!_acceptsPayments || !_sellsOnWeb || currency == null) {
      return null;
    }
    if (_holdingsFailed) {
      return _PurchaseStateFailure(
        key: const ValueKey('series-remainder-failed'),
        message: messages.seriesRemainderFailed,
      );
    }
    final remainder = _holdings?.remainder;
    if (remainder == null) {
      return null;
    }
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          BuyBundleButton(
            key: const ValueKey('series-remainder-buy'),
            label: messages.seriesRemainderBuy(
              count: remainder.episodeCount,
              price: messages.formatPrice(remainder.price, currency),
            ),
            start: (repository, locale) =>
                repository.startSeriesRemainderCheckout(
                  widget.detail.series.internalId,
                  locale: locale,
                ),
            onRefused: _reloadPurchase,
            onOpened: _checkoutOpened,
          ),
          if (remainder.discountPercent > 0) ...[
            const SizedBox(height: 4),
            AutospacedText(
              key: const ValueKey('series-remainder-discount'),
              messages.seriesRemainderDiscount(
                listPrice: messages.formatPrice(remainder.listPrice, currency),
                percent: messages.formatPercent(remainder.discountPercent),
              ),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final series = widget.detail.series;
    final fallbackLanguage = series.fallbackLanguage(
      Localizations.localeOf(context),
    );
    // A build with no follow repository offers none of this, so neither the
    // control nor the author rows it would sit in are put on the screen.
    final follows = FollowScope.maybeOf(context) != null;
    final downloader = OfflineScope.downloaderOf(context);
    final offer = _progress.offerIn(widget.detail.episodes);
    // A window that closed since the series was read leaves the row priced
    // again the next time the screen is drawn.
    final now = DateTime.now();

    return CustomScrollView(
      key: const ValueKey('series-detail-body'),
      slivers: [
        SliverPadding(
          key: _topKey,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          sliver: SliverList.list(
            children: [
              if (_checkoutNotice(messages) case final notice?)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: notice,
                ),
              if (fallbackLanguage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: AutospacedText(
                    messages.seriesFallbackNotice(language: fallbackLanguage),
                    key: const ValueKey('series-fallback-notice'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
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
              AutospacedText(
                series.title,
                locale: series.textLocale,
                style: theme.textTheme.headlineSmall,
              ),
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
                  onCreatorTap: (creator) => context.pushInTab(
                    AppRoutes.creatorDetailPath(creator.id),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              AutospacedText(
                messages.seriesEpisodeCount(count: series.episodeCount),
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
                    if (series.labelName.isNotEmpty)
                      _SeriesLabel(series: series),
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
                        label: AutospacedText(
                          genre.name,
                          locale: genre.textLocale,
                        ),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => context.pushInTab(
                          AppRoutes.genreDetailPath(genre.id),
                        ),
                      ),
                    for (final tag in series.tags)
                      ActionChip(
                        key: ValueKey('series-tag-${tag.slug}'),
                        avatar: const Icon(Icons.tag),
                        label: AutospacedText(tag.name),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => context.pushInTab(
                          AppRoutes.tagDetailPath(tag.slug),
                        ),
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
                AutospacedText(
                  series.description,
                  locale: series.textLocale,
                  style: theme.textTheme.bodyLarge,
                ),
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
                    onTap: () => context.pushInTab(
                      AppRoutes.creatorDetailPath(creator.id),
                    ),
                  ),
              ],
              if (widget.detail.volumes.isNotEmpty) ...[
                const SizedBox(height: 24),
                AutospacedText(
                  messages.seriesVolumesHeading,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                if (_holdingsFailed)
                  _PurchaseStateFailure(
                    key: const ValueKey('series-volumes-ownership-failed'),
                    message: messages.seriesVolumeOwnershipFailed,
                  ),
                for (final volume in widget.detail.volumes)
                  _VolumeTile(
                    volume: volume,
                    series: series,
                    currency: _currency,
                    control: _volumeControl(messages, volume),
                  ),
              ],
              const SizedBox(height: 24),
              AutospacedText(
                messages.seriesEpisodesHeading,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ?_remainderOffer(messages),
              if (widget.detail.episodes.isEmpty)
                AutospacedText(messages.seriesEpisodesEmpty)
              else
                for (final (episode, freeUntil, campaign, rental) in [
                  for (final episode in widget.detail.episodes)
                    (
                      episode,
                      episode.isFreeAt(now) ? episode.freeUntil : null,
                      _quotedCampaign(episode, now),
                      _rentalOffer(messages, episode, now),
                    ),
                ])
                  ListTile(
                    key: ValueKey('episode-tile-${episode.id}'),
                    contentPadding: EdgeInsets.zero,
                    // A finished row steps back, so the episodes still ahead are the
                    // ones that stand out.
                    textColor: _progress.finishedEpisodeIds.contains(episode.id)
                        ? theme.colorScheme.onSurfaceVariant
                        : null,
                    leading: EpisodeCover(
                      episodeId: episode.id,
                      variants: episode.eyeCatchVariants,
                      seriesVariants: series.eyeCatchVariants,
                      requestHeaders: series.imageRequestHeaders,
                    ),
                    title: AutospacedText(
                      episode.title,
                      locale: episode.textLocale,
                    ),
                    // Any subtitle makes the row two lines tall, so a row with
                    // nothing to say under its title is given none.
                    subtitle:
                        freeUntil == null &&
                            campaign == null &&
                            rental == null &&
                            !_progress.finishedEpisodeIds.contains(episode.id)
                        ? null
                        : _EpisodeSubtitle(
                            episodeId: episode.id,
                            finished: _progress.finishedEpisodeIds.contains(
                              episode.id,
                            ),
                            freeUntil: freeUntil,
                            campaign: campaign == null
                                ? null
                                : CampaignPriceNote(
                                    key: ValueKey(
                                      'episode-campaign-${episode.id}',
                                    ),
                                    price: episode.price,
                                    currency: _currency!,
                                    endsAt: campaign.endsAt,
                                  ),
                            rental: rental,
                          ),
                    trailing: _EpisodeTrailing(
                      // An open window makes the episode free to read, so the
                      // row shows until when in its subtitle rather than a
                      // price nobody is charged.
                      price: freeUntil == null ? episode.priceAt(now) : 0,
                      currency: _currency,
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
                      buy: rental == null && _buyable(episode)
                          ? BuyEpisodeButton(
                              episodeId: episode.id,
                              episodeInternalId: episode.internalId,
                              price: episode.priceAt(now),
                              currency: _currency!,
                              compact: true,
                              signInReturnTo: AppRoutes.episodeViewerPath(
                                series.id,
                                episode.id,
                              ),
                              onAlreadyPurchased: () => unawaited(
                                _openEpisode(
                                  AppRoutes.episodeViewerPath(
                                    series.id,
                                    episode.id,
                                  ),
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
          ),
        ),
        // A shelf runs to the edges of the screen, as every one on the catalog
        // does, so the covers scroll out from under the side rather than
        // stopping short of it.
        SliverPadding(
          padding: const EdgeInsets.only(bottom: 8),
          sliver: SliverToBoxAdapter(
            child: _RelatedSeriesShelf(series: series),
          ),
        ),
      ],
    );
  }
}

/// As many related series as every shelf of the catalog holds, so the row
/// scrolls the same distance as they do.
const _relatedSeriesLimit = 10;

/// The tenant's other series, most related first, as the storefront's series
/// page lists them under the series: where a reader goes on to once this one
/// is not, or no longer, the one.
///
/// A suggestion is worth nothing to say nothing about, so the row and its
/// heading are drawn only when the API answers with series. A tenant with this
/// one series alone is shown no row, and neither is a reader whose read
/// failed: the screen they came for is whole without it, as the storefront's
/// page is.
class _RelatedSeriesShelf extends StatelessWidget {
  const _RelatedSeriesShelf({required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return CatalogShelf<SeriesItem>(
      sectionKey: 'series-related',
      heading: messages.seriesRelatedHeading,
      // Nothing in the row depends on who is reading, so a sign-in or a
      // sign-out leaves it as it is.
      reloadToken: series.internalId,
      // A copy saved on this device before the internal id was kept names no
      // series the API can score against.
      load: (catalog, locale) async => series.internalId.isEmpty
          ? const []
          : catalog.listRelatedSeries(
              series.internalId,
              limit: _relatedSeriesLimit,
              locale: locale,
            ),
      cardBuilder: (context, item) => SeriesShelfCard(
        key: ValueKey('series-related-${item.id}'),
        series: item,
        subtitle: item.creators.isEmpty
            ? null
            : CreatorCredits(credits: item.creators),
        onTap: () => context.pushInTab(AppRoutes.seriesDetailPath(item.id)),
      ),
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
          messages.seriesRating(
            average: series.ratingAverage.toStringAsFixed(1),
            count: series.ratingCount,
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

/// Why a purchase that depends on what the reader holds is not offered: the
/// read of it failed.
class _PurchaseStateFailure extends StatelessWidget {
  const _PurchaseStateFailure({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AutospacedText(
        message,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.error,
        ),
      ),
    );
  }
}

/// One volume of the series: its cover, its title, how many episodes it holds
/// and what it costs, and [control] under them.
class _VolumeTile extends StatelessWidget {
  const _VolumeTile({
    required this.volume,
    required this.series,
    required this.currency,
    required this.control,
  });

  final VolumeItem volume;
  final SeriesItem series;

  /// The currency the price is shown in, or `null` while the tenant's could
  /// not be read, when the card shows no price.
  final String? currency;

  /// What the reader can do about the volume, or `null` for nothing.
  final Widget? control;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final currency = this.currency;
    final control = this.control;
    return Padding(
      key: ValueKey('series-volume-${volume.publicId}'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // A volume is a book, so its cover stands upright, and the series'
          // eye-catch stands in where it has none.
          SizedBox(
            width: 64,
            child: EyeCatchCover(
              kind: 'volume',
              id: volume.publicId,
              variants: volume.coverVariants.isEmpty
                  ? series.eyeCatchVariants
                  : volume.coverVariants,
              requestHeaders: series.imageRequestHeaders,
              preferredTypes: const [eyeCatchPortrait, eyeCatchSquare],
              aspectRatio: 3 / 4,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AutospacedText(volume.title, style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                AutospacedText(
                  [
                    messages.seriesEpisodeCount(
                      count: volume.episodeIds.length,
                    ),
                    if (currency != null)
                      messages.formatPrice(volume.price, currency),
                  ].join(' · '),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (control != null) ...[const SizedBox(height: 8), control],
              ],
            ),
          ),
        ],
      ),
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

/// What stands under an episode's title: until when a free window keeps it
/// free, or a campaign undercuts its price, what renting it costs, and whether
/// the reader has finished it.
class _EpisodeSubtitle extends StatelessWidget {
  const _EpisodeSubtitle({
    required this.episodeId,
    required this.finished,
    required this.freeUntil,
    required this.campaign,
    required this.rental,
  });

  final String episodeId;
  final bool finished;

  /// The end of the window open on the episode, or `null` when none is.
  final DateTime? freeUntil;

  /// The regular price and the end of the campaign the row quotes, or `null`
  /// when it quotes none.
  final Widget? campaign;

  /// The rental the reader could take, worded, or `null` when there is none.
  final String? rental;

  @override
  Widget build(BuildContext context) {
    final freeUntil = this.freeUntil;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (freeUntil != null)
            FreeUntilBadge(
              key: ValueKey('episode-free-until-$episodeId'),
              freeUntil: freeUntil,
            ),
          ?campaign,
          if (rental case final rental?)
            AutospacedText(key: ValueKey('episode-rental-$episodeId'), rental),
          if (finished) _FinishedMark(episodeId: episodeId),
        ],
      ),
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
    required this.currency,
    required this.soldOnWeb,
    required this.saved,
    required this.download,
    required this.buy,
  });

  final int price;

  /// The currency [price] is shown in, or `null` while the tenant's could not
  /// be read, when the row shows no price.
  final String? currency;

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
        else if (price > 0 && currency != null)
          AutospacedText(messages.formatPrice(price, currency!)),
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
