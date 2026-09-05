import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';
import 'package:publira/viewer/episode_reader.dart';

/// Episode reader. Loads the body of one published episode and hands its pages
/// to [EpisodeReader].
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

class _EpisodeViewerScreenState extends State<EpisodeViewerScreen> {
  late Future<EpisodeDetail?> _future;
  var _started = false;
  var _accessToken = '';

  /// Reloads whenever the reader signs in or out, because who is asking is
  /// what decides whether this body comes back at all.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _future = _load();
  }

  Future<EpisodeDetail?> _load() =>
      CatalogScope.of(context).getEpisode(widget.seriesId, widget.episodeId);

  void _reload() {
    setState(() {
      _future = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<EpisodeDetail?>(
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
        final detail = snapshot.data;
        if (detail == null) {
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
          title: detail.episode.title,
          body: _body(messages, detail),
        );
      },
    );
  }

  Widget _body(AppMessages messages, EpisodeDetail detail) {
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
    return EpisodeReader(
      images: detail.images,
      imageHeaders: detail.imageRequestHeaders,
      pageStore: OfflineScope.maybeOf(context),
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
