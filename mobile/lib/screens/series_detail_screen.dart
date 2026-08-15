import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/series_item.dart';

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
    if (error is CatalogFailure && error.kind == CatalogFailureKind.network) {
      return 'ページを表示できませんでした。通信状況を確認して再試行してください。';
    }
    return 'ページを表示できませんでした';
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

class _SeriesDetailBody extends StatelessWidget {
  const _SeriesDetailBody({required this.detail});

  final SeriesDetail detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final series = detail.series;

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
          if (detail.episodes.isEmpty)
            const Text('公開中のエピソードはありません')
          else
            for (final episode in detail.episodes)
              ListTile(
                key: ValueKey('episode-tile-${episode.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(episode.title),
                trailing: episode.price > 0 ? Text('¥${episode.price}') : null,
              ),
        ],
      ),
    );
  }
}
