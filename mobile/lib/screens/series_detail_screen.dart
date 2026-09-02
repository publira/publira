import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';

/// Series detail. Loads the published series and its episodes from the API.
class SeriesDetailScreen extends StatefulWidget {
  const SeriesDetailScreen({super.key, required this.seriesId});

  final String seriesId;

  @override
  State<SeriesDetailScreen> createState() => _SeriesDetailScreenState();
}

class _SeriesDetailScreenState extends State<SeriesDetailScreen> {
  late Future<SeriesDetail?> _future;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = CatalogScope.of(context).getSeries(widget.seriesId);
  }

  void _reload() {
    setState(() {
      _future = CatalogScope.of(context).getSeries(widget.seriesId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SeriesDetail?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Scaffold(
            appBar: AppBar(title: const Text('シリーズ')),
            body: const Center(
              key: ValueKey('series-detail-loading'),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            appBar: AppBar(title: const Text('シリーズ')),
            body: _DetailMessage(
              key: const ValueKey('series-detail-error'),
              message: _errorCopy(snapshot.error),
              actionLabel: '再試行',
              onAction: _reload,
            ),
          );
        }
        final detail = snapshot.data;
        if (detail == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('シリーズ')),
            body: _DetailMessage(
              key: const ValueKey('series-not-found'),
              message: 'シリーズが見つかりません (${widget.seriesId})',
              actionLabel: 'カタログへ戻る',
              onAction: () => context.goNamed('catalog'),
            ),
          );
        }
        return _SeriesDetailBody(detail: detail);
      },
    );
  }

  String _errorCopy(Object? error) {
    if (error is! CatalogFailure) {
      return 'ページを表示できませんでした';
    }
    return switch (error.kind) {
      CatalogFailureKind.network => 'ページを表示できませんでした。通信状況を確認して再試行してください。',
      CatalogFailureKind.notSaved || CatalogFailureKind.saveExpired =>
        'オフラインのため、このシリーズを表示できません。端末に保存されたデータがありません。',
      CatalogFailureKind.unexpected => 'ページを表示できませんでした',
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
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onAction, child: Text(actionLabel)),
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

  /// Which episodes are readable depends on who is signed in, so a sign-in or
  /// a sign-out asks the library again rather than keeping the last answer.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    if (_started && readerId == _readerId) {
      return;
    }
    _started = true;
    _readerId = readerId;
    final library = OfflineScope.maybeOf(context);
    if (library == null) {
      return;
    }
    unawaited(_loadSaved(library, readerId));
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
    final series = widget.detail.series;

    return Scaffold(
      appBar: AppBar(title: Text(series.title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(series.title, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(
            '${series.episodeCount} 話',
            style: theme.textTheme.labelLarge?.copyWith(
              color: theme.colorScheme.primary,
            ),
          ),
          if (series.description.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(series.description, style: theme.textTheme.bodyLarge),
          ],
          const SizedBox(height: 24),
          Text('エピソード一覧', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (widget.detail.episodes.isEmpty)
            const Text('公開中のエピソードはありません')
          else
            for (final episode in widget.detail.episodes)
              ListTile(
                key: ValueKey('episode-tile-${episode.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(episode.title),
                trailing: _EpisodeTrailing(
                  price: episode.price,
                  saved: _saved.contains(episode.id),
                ),
                onTap: () {
                  context.push(
                    AppRoutes.episodeViewerPath(series.id, episode.id),
                  );
                },
              ),
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
  const _EpisodeTrailing({required this.price, required this.saved});

  final int price;
  final bool saved;

  @override
  Widget build(BuildContext context) {
    if (!saved && price <= 0) {
      return const SizedBox.shrink();
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (saved)
          const Padding(
            key: ValueKey('episode-saved-offline'),
            padding: EdgeInsets.only(right: 8),
            child: Icon(
              Icons.offline_pin_outlined,
              size: 20,
              // The mark is the only thing that says this episode still opens
              // without a network, so it has to reach a screen reader too.
              semanticLabel: '保存済み',
            ),
          ),
        if (price > 0) Text('¥$price'),
      ],
    );
  }
}
