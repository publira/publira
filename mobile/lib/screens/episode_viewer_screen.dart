import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';
import 'package:publira/viewer/episode_end_panel.dart';
import 'package:publira/viewer/episode_reader.dart';
import 'package:publira/viewer/reading_position.dart';

/// One episode as this screen opens it: its body, and the page the reader
/// stopped on last time.
class _OpenEpisode {
  const _OpenEpisode({required this.detail, required this.startPage});

  final EpisodeDetail detail;
  final int startPage;
}

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
  });

  final String seriesId;
  final String episodeId;

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

  /// Records the page the reader rests on, for the session that is signed in
  /// now. It holds the repository rather than the context, because the last
  /// page is recorded as the screen goes away, when an inherited widget can no
  /// longer be looked up.
  ReadingPositionSaver? _saver;

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
    if (_started && accessToken == _accessToken) {
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
    _future = _load(catalog);
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
  Future<_OpenEpisode?> _load(CatalogRepository catalog) async {
    final position = _savedPageIndex(catalog);
    final detail = await catalog.getEpisode(widget.seriesId, widget.episodeId);
    final saved = await position;
    if (detail == null) {
      return null;
    }
    return _OpenEpisode(
      detail: detail,
      startPage: resumePageIndex(saved, detail.images.length),
    );
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
      _future = _load(CatalogScope.of(context));
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
              actionLabel: messages.commonRetry,
              onAction: _reload,
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
              actionLabel: messages.viewerBackToSeries,
              onAction: () =>
                  context.go(AppRoutes.seriesDetailPath(widget.seriesId)),
            ),
          );
        }
        return _shell(
          title: open.detail.episode.title,
          body: _body(messages, open),
        );
      },
    );
  }

  Widget _body(AppMessages messages, _OpenEpisode open) {
    final detail = open.detail;
    if (detail.access == EpisodeAccess.locked) {
      if (AuthScope.of(context).isSignedIn) {
        return _ViewerMessage(
          key: const ValueKey('episode-locked'),
          message: messages.viewerLocked,
        );
      }
      return _ViewerMessage(
        key: const ValueKey('episode-locked'),
        message: messages.viewerLockedSignedOut,
        actionLabel: messages.commonSignIn,
        onAction: () => context.push(AppRoutes.signIn),
      );
    }
    if (detail.images.isEmpty) {
      return _ViewerMessage(
        key: const ValueKey('episode-empty'),
        message: messages.viewerNoPages,
      );
    }
    final next = detail.nextEpisode;
    final previous = detail.previousEpisode;
    return EpisodeReader(
      images: detail.images,
      imageHeaders: detail.imageRequestHeaders,
      initialPageIndex: open.startPage,
      onPageChanged: (pageIndex) => _saver?.save(pageIndex),
      endScreen: EpisodeEndPanel(
        detail: detail,
        nextSavedOffline: next != null && _saved.contains(next.id),
        onOpenNext: _open,
        onOpenComments: _commentsOffered ? _openComments : null,
        onBackToSeries: () =>
            context.go(AppRoutes.seriesDetailPath(widget.seriesId)),
      ),
      onNextEpisode: next == null ? null : () => _open(next),
      onPreviousEpisode: previous == null ? null : () => _open(previous),
      pageStore: OfflineScope.maybeOf(context),
    );
  }

  /// Opens what the other readers of this episode had to say about it, which
  /// the reader reaches once they have read it themselves.
  void _openComments() {
    context.push(
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
    context.pushReplacement(
      AppRoutes.episodeViewerPath(widget.seriesId, episode.id),
    );
  }

  /// The reader is dark so a page carries the screen; every state of this
  /// route shares that shell to keep the transition from one to the next from
  /// flashing.
  Widget _shell({required String title, required Widget body}) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(title),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
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
      CatalogFailureKind.unexpected => messages.viewerLoadFailed,
    };
  }
}

class _ViewerMessage extends StatelessWidget {
  const _ViewerMessage({
    super.key,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

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
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}
