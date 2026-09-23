import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/catalog/age_rating_gate.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/content_views/content_view_recorder.dart';
import 'package:publira/content_views/content_view_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/purchase/buy_episode_button.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/viewer/episode_end_panel.dart';
import 'package:publira/viewer/episode_read_recorder.dart';
import 'package:publira/viewer/episode_reader.dart';
import 'package:publira/viewer/reading_position.dart';
import 'package:publira/viewer/screen_capture_notice.dart';

/// One episode as this screen opens it: its body, and the page the reader
/// stopped on last time.
class _OpenEpisode {
  const _OpenEpisode({
    required this.detail,
    required this.startPage,
    this.readerHasBirthDate = false,
    this.provenRating,
  });

  final EpisodeDetail detail;
  final int startPage;

  /// Whether the reader has a birth date on their account, which tells "we
  /// hold no date for you" apart from "the date we hold is too recent".
  final bool readerHasBirthDate;

  /// What that date proves, which opens the rating gate without asking.
  final SeriesAgeRating? provenRating;
}

/// How long the viewer waits before each re-read of an episode the browser
/// reported paid for and the API still reports locked. The webhook that
/// records the purchase races the browser's return, so the first read after it
/// can be too early.
const checkoutConfirmationDelays = [Duration(seconds: 2), Duration(seconds: 4)];

/// Episode reader. Loads the body of one published episode and hands its pages
/// to [EpisodeReader].
///
/// The reading position is the screen's rather than the pager's: it is read
/// beside the body, and the page the reader leaves on is recorded as the
/// screen goes away, which the pager inside it is not there to see.
class EpisodeViewerScreen extends StatefulWidget {
  const EpisodeViewerScreen({
    super.key,
    required this.seriesId,
    required this.episodeId,
    this.checkout,
  });

  final String seriesId;
  final String episodeId;

  /// How a checkout of this episode ended, when the browser has just handed
  /// one back.
  final CheckoutOutcome? checkout;

  @override
  State<EpisodeViewerScreen> createState() => _EpisodeViewerScreenState();
}

class _EpisodeViewerScreenState extends State<EpisodeViewerScreen>
    with WidgetsBindingObserver {
  late Future<_OpenEpisode?> _future;
  var _started = false;
  var _accessToken = '';
  var _readerId = '';

  /// Episodes of this series the device could open right now, which is what
  /// marks the next one as saved. Empty on a run with no library, which is
  /// what leaves the mark off.
  var _saved = const <String>{};

  /// Whether the end of the episode offers its comments.
  ///
  /// It starts off and is turned on by the tenant's answer, which is read
  /// beside the body so it is in hand long before the reader has finished
  /// reading. A lookup that fails still offers them: the answer that takes the
  /// offer away is the tenant having turned commenting off, and a reader whose
  /// connection dropped is told that on the comments screen rather than
  /// quietly losing the way to it.
  var _commentsOffered = false;

  /// Whether a locked body offers a purchase. It starts off and is turned on
  /// only by the tenant saying it takes payments, so a lookup that fails
  /// offers nothing it could not complete.
  var _acceptsPayments = false;

  /// Records the page the reader rests on, for the session that is signed in
  /// now. It holds the repository rather than the context, because the last
  /// page is recorded as the screen goes away, when an inherited widget can no
  /// longer be looked up.
  ReadingPositionSaver? _saver;

  /// Records that the reader finished the episode, for the session that is
  /// signed in now.
  EpisodeReadRecorder? _recorder;

  /// Whether the reader asked to give a birth date, which the account tab
  /// takes, and whether this tab has since gone off screen for it. The date is
  /// read back once the tab is on screen again.
  var _awaitingBirthDate = false;
  var _leftForBirthDate = false;

  @override
  void initState() {
    super.initState();
    // A reader who leaves the app on a page never pops this screen, and the
    // page they left on is the one they expect to come back to.
    WidgetsBinding.instance.addObserver(this);
  }

  /// Reloads whenever the reader signs in or out, because who is asking is
  /// what decides whether this body comes back at all — and where they last
  /// stopped in it.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    final accessToken = AuthScope.of(context).accessToken;
    final active = AppTabScope.isActive(context);
    if (_awaitingBirthDate && !active) {
      _leftForBirthDate = true;
    }
    final returned = _leftForBirthDate && active;
    if (returned) {
      _awaitingBirthDate = false;
      _leftForBirthDate = false;
    }
    if (_started && accessToken == _accessToken) {
      if (returned) {
        _future = _load(catalog, AuthScope.of(context));
      }
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _readerId = AuthScope.of(context).session?.userPublicId ?? '';
    // A saver belongs to the session it records against. The page the reader
    // before this one was on is theirs and cannot be written with this
    // session, so a waiting page is dropped rather than carried over, and the
    // pages this reader turns to are recorded from nothing.
    _saver?.dispose();
    _saver = ReadingPositionSaver(
      send: (pageIndex) => catalog.saveReadingPosition(
        widget.seriesId,
        widget.episodeId,
        pageIndex,
      ),
    );
    _recorder = EpisodeReadRecorder(
      send: () => catalog.markEpisodeAsRead(widget.episodeId),
    );
    _future = _load(
      catalog,
      AuthScope.of(context),
      confirmPurchase: widget.checkout == CheckoutOutcome.success,
    );
    final purchase = PurchaseScope.maybeOf(context)?.repository;
    if (purchase != null) {
      unawaited(_loadAcceptsPayments(purchase));
    }
    final comments = CommentScope.maybeOf(context);
    if (comments != null) {
      unawaited(_loadCommentMode(comments));
    }
    final library = OfflineScope.maybeOf(context);
    if (library != null) {
      unawaited(_loadSaved(library, _readerId));
    }
  }

  /// Asks the device which episodes of this series it holds, so the offer at
  /// the end of the body can say whether the next one is already there.
  ///
  /// Which episodes are readable depends on who is signed in, so this is asked
  /// again whenever the session changes rather than kept from the last reader.
  Future<void> _loadSaved(OfflineLibrary library, String readerId) async {
    final saved = await library.readableEpisodeIds(
      widget.seriesId,
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

  /// Asks the tenant whether it takes comments at all, which is what decides
  /// that the end of the episode offers them.
  Future<void> _loadCommentMode(CommentRepository comments) async {
    bool offered;
    try {
      offered = (await comments.commentMode()).takesComments;
    } on CommentFailure {
      // Nobody could be asked, which is not the tenant saying no.
      offered = true;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _commentsOffered = offered;
    });
  }

  Future<void> _loadAcceptsPayments(PurchaseRepository purchase) async {
    bool accepts;
    try {
      accepts = await purchase.acceptsPayments();
    } on PurchaseFailure {
      accepts = false;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _acceptsPayments = accepts;
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _saver?.flush();
    _saver?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _saver?.flush();
    }
  }

  /// The body and the page to open it on.
  ///
  /// Both reads are started before either is awaited: the position does not
  /// depend on the body, and a reader made to wait out two round trips in a
  /// row would see the first page later for it.
  ///
  /// [confirmPurchase] reads a body that is still locked again after each of
  /// [checkoutConfirmationDelays], for a reader the browser has just sent
  /// back from paying.
  Future<_OpenEpisode?> _load(
    CatalogRepository catalog,
    AuthController auth, {
    bool confirmPurchase = false,
  }) async {
    final position = _savedPageIndex(catalog);
    var detail = await catalog.getEpisode(widget.seriesId, widget.episodeId);
    if (confirmPurchase) {
      for (final delay in checkoutConfirmationDelays) {
        if (detail?.access != EpisodeAccess.locked) {
          break;
        }
        await Future<void>.delayed(delay);
        if (!mounted) {
          break;
        }
        detail = await catalog.getEpisode(widget.seriesId, widget.episodeId);
      }
    }
    final saved = await position;
    if (detail == null) {
      return null;
    }
    // Asked only where the answer decides what is shown: a rating to gate, or
    // a body withheld over an age.
    final age =
        detail.access == EpisodeAccess.ageRestricted ||
            isRestrictedAgeRating(detail.ageRating)
        ? await _readerAge(auth)
        : null;
    return _OpenEpisode(
      detail: detail,
      startPage: resumePageIndex(saved, detail.images.length),
      readerHasBirthDate: age?.hasBirthDate ?? false,
      provenRating: age?.provenAgeRating(DateTime.now()),
    );
  }

  /// A read that fails answers as an account holding no date. The gate then
  /// points at the one thing the reader can still do rather than telling them
  /// their age is the problem.
  Future<ReaderAge?> _readerAge(AuthController auth) async {
    try {
      return await auth.readReaderAge();
    } on AuthFailure {
      return null;
    }
  }

  /// Where the reader stopped, or `null` when nothing says.
  ///
  /// A position that could not be read is not what makes an episode
  /// unreadable: the reader opens at the first page, which is where they
  /// opened before there were positions at all.
  Future<int?> _savedPageIndex(CatalogRepository catalog) async {
    try {
      return await catalog.getReadingPosition(
        widget.seriesId,
        widget.episodeId,
      );
    } on CatalogFailure {
      return null;
    }
  }

  void _reload() {
    setState(() {
      _future = _load(CatalogScope.of(context), AuthScope.of(context));
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<_OpenEpisode?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _shell(
            title: messages.viewerTitle,
            body: const Center(
              key: ValueKey('episode-viewer-loading'),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return _shell(
            title: messages.viewerTitle,
            body: _ViewerMessage(
              key: const ValueKey('episode-viewer-error'),
              message: _errorCopy(messages, snapshot.error),
              action: FilledButton(
                onPressed: _reload,
                child: Text(messages.commonRetry),
              ),
            ),
          );
        }
        final open = snapshot.data;
        if (open == null) {
          return _shell(
            title: messages.viewerTitle,
            body: _ViewerMessage(
              key: const ValueKey('episode-not-found'),
              message: messages.viewerNotFound(id: widget.episodeId),
              action: FilledButton(
                onPressed: () => context.goInTab(
                  AppRoutes.seriesDetailPath(widget.seriesId),
                ),
                child: Text(messages.viewerBackToSeries),
              ),
            ),
          );
        }
        return _shell(
          title: open.detail.episode.title,
          credits: open.detail.creators,
          share: LinkScope.maybeOf(context)?.share == null
              ? null
              : ShareAction(
                  key: const ValueKey('episode-share'),
                  path: AppRoutes.episodeViewerPath(
                    widget.seriesId,
                    widget.episodeId,
                  ),
                  title: open.detail.episode.title,
                  workTitle: open.detail.seriesTitle,
                  credits: open.detail.creators,
                ),
          // A reader the tenant's age rule stops is told so first: a rating
          // they declared here would not open the pages for them.
          body: open.detail.access == EpisodeAccess.ageRestricted
              ? _ageRestricted(messages, open)
              : AgeRatingGate(
                  rating: open.detail.ageRating,
                  seriesTitle: open.detail.seriesTitle,
                  provenRating: open.provenRating,
                  child: ContentViewRecorder(
                    kind: ContentViewKind.episode,
                    publicId: open.detail.episode.id,
                    child: _body(messages, open),
                  ),
                ),
        );
      },
    );
  }

  Widget _body(AppMessages messages, _OpenEpisode open) {
    final detail = open.detail;
    if (detail.access == EpisodeAccess.locked) {
      return _locked(messages, detail);
    }
    if (detail.images.isEmpty) {
      return _ViewerMessage(
        key: const ValueKey('episode-empty'),
        message: messages.viewerNoPages,
      );
    }
    final next = detail.nextEpisode;
    final previous = detail.previousEpisode;
    return ScreenCaptureNotice(
      episodeId: widget.episodeId,
      child: EpisodeReader(
        images: detail.images,
        imageHeaders: detail.imageRequestHeaders,
        readingDirection: detail.readingDirection,
        spreadStartIndex: detail.spreadStartIndex,
        initialPageIndex: open.startPage,
        onPageChanged: (pageIndex) => _saver?.save(pageIndex),
        onFinished: () => _recorder?.record(),
        endScreen: EpisodeEndPanel(
          detail: detail,
          nextSavedOffline: next != null && _saved.contains(next.id),
          acceptsPayments: _acceptsPayments,
          onOpenNext: _open,
          onOpenComments: _commentsOffered ? _openComments : null,
          onBackToSeries: () =>
              context.goInTab(AppRoutes.seriesDetailPath(widget.seriesId)),
        ),
        onNextEpisode: next == null ? null : () => _open(next),
        onPreviousEpisode: previous == null ? null : () => _open(previous),
        pageStore: OfflineScope.maybeOf(context),
      ),
    );
  }

  /// What stands where the pages would be while the episode is not the
  /// reader's: why, and the purchase that opens it where the tenant takes one.
  Widget _locked(AppMessages messages, EpisodeDetail detail) {
    final signedIn = AuthScope.of(context).isSignedIn;
    // The browser reported the payment and the API has not recorded it yet.
    if (signedIn && widget.checkout == CheckoutOutcome.success) {
      return _ViewerMessage(
        key: const ValueKey('episode-purchase-confirming'),
        message: messages.purchaseConfirming,
        action: OutlinedButton(
          key: const ValueKey('episode-purchase-check-again'),
          style: OutlinedButton.styleFrom(foregroundColor: Colors.white),
          onPressed: _reload,
          child: Text(messages.purchaseCheckAgain),
        ),
      );
    }
    final sold =
        _acceptsPayments &&
        detail.episode.price > 0 &&
        PurchaseScope.maybeOf(context) != null;
    // The app must not steer the reader to an outside checkout, so it names
    // the website without linking to it.
    final soldOnWeb =
        sold && detail.episode.purchaseSurface == EpisodePurchaseSurface.web;
    final buy = sold && !soldOnWeb
        ? BuyEpisodeButton(
            episodeId: widget.episodeId,
            price: detail.episode.price,
            onAlreadyPurchased: _reload,
          )
        : null;
    final String message;
    if (widget.checkout == CheckoutOutcome.cancelled) {
      message = messages.purchaseCancelled;
    } else if (soldOnWeb) {
      message = signedIn
          ? messages.viewerLockedSoldOnWeb
          : messages.viewerLockedSoldOnWebSignedOut;
    } else if (signedIn) {
      message = messages.viewerLocked;
    } else {
      message = messages.viewerLockedSignedOut;
    }
    if (buy == null && !signedIn) {
      return _ViewerMessage(
        key: const ValueKey('episode-locked'),
        message: message,
        action: FilledButton(
          onPressed: () => context.pushInTab(AppRoutes.signIn),
          child: Text(messages.commonSignIn),
        ),
      );
    }
    return _ViewerMessage(
      key: const ValueKey('episode-locked'),
      message: message,
      action: buy,
    );
  }

  /// What stands where the pages would be when the tenant makes a reader
  /// prove an age for this series and they have not.
  ///
  /// Its three states are the three things that can be missing: the session,
  /// the birth date, or the years themselves.
  Widget _ageRestricted(AppMessages messages, _OpenEpisode open) {
    if (!AuthScope.of(context).isSignedIn) {
      return _ViewerMessage(
        key: const ValueKey('episode-age-restricted'),
        message: messages.viewerAgeRestrictedGuest,
        action: FilledButton(
          onPressed: () => context.pushInTab(AppRoutes.signIn),
          child: Text(messages.commonSignIn),
        ),
      );
    }
    if (open.readerHasBirthDate) {
      return _ViewerMessage(
        key: const ValueKey('episode-age-restricted'),
        message: messages.viewerAgeRestrictedTooYoung,
      );
    }
    return _ViewerMessage(
      key: const ValueKey('episode-age-restricted'),
      message: messages.viewerAgeRestrictedNoBirthDate,
      action: FilledButton(
        onPressed: _addBirthDate,
        child: Text(messages.viewerAgeRestrictedAddBirthDate),
      ),
    );
  }

  /// Opens the account tab, where the date is recorded, and reads the episode
  /// again once the reader comes back to this one.
  void _addBirthDate() {
    _awaitingBirthDate = true;
    context.go(AppRoutes.account);
  }

  /// Opens what the other readers of this episode had to say about it, which
  /// the reader reaches once they have read it themselves.
  void _openComments() {
    context.pushInTab(
      AppRoutes.episodeCommentsPath(widget.seriesId, widget.episodeId),
    );
  }

  /// Opens [episode] in place of this one.
  ///
  /// The viewer replaces itself rather than stacking, so a reader who has gone
  /// through several episodes leaves the last of them for the series screen
  /// they opened the first from, instead of walking back through every episode
  /// they read.
  void _open(EpisodeNeighbor episode) {
    context.pushReplacementInTab(
      AppRoutes.episodeViewerPath(widget.seriesId, episode.id),
    );
  }

  /// The reader is dark so a page carries the screen; every state of this
  /// route shares that shell to keep the transition from one to the next from
  /// flashing.
  Widget _shell({
    required String title,
    required Widget body,
    List<SeriesCreator> credits = const [],
    Widget? share,
  }) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        // The episode's own credits under its title, never the series': an
        // artist who took over part way through is on the episodes they drew.
        title: credits.isEmpty
            ? Text(title)
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  CreatorCredits(
                    key: const ValueKey('episode-credits'),
                    credits: credits,
                    style: Theme.of(context).textTheme.bodySmall,
                    roleColor: Colors.white70,
                    nameColor: Colors.white,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [?share],
      ),
      body: body,
    );
  }

  String _errorCopy(AppMessages messages, Object? error) {
    if (error is! CatalogFailure) {
      return messages.viewerLoadFailed;
    }
    return switch (error.kind) {
      CatalogFailureKind.network => messages.errorsRpcUnavailable,
      CatalogFailureKind.notSaved => messages.viewerOfflineNotSaved,
      CatalogFailureKind.saveExpired => messages.viewerSaveExpired,
      CatalogFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
      CatalogFailureKind.unexpected => messages.viewerLoadFailed,
    };
  }
}

class _ViewerMessage extends StatelessWidget {
  const _ViewerMessage({super.key, required this.message, this.action});

  final String message;

  /// The one thing the reader can do about [message], if there is one.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white),
            ),
            if (action case final action?) ...[
              const SizedBox(height: 16),
              action,
            ],
          ],
        ),
      ),
    );
  }
}
