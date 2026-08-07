import 'package:flutter/material.dart';
import 'package:publira/data/sample_series.dart';
import 'package:publira/models/series_item.dart';

/// Series detail placeholder. Viewer / episode list lands in later issues.
class SeriesDetailScreen extends StatelessWidget {
  const SeriesDetailScreen({super.key, required this.seriesId});

  final String seriesId;

  @override
  Widget build(BuildContext context) {
    final series = findSampleSeries(seriesId);

    if (series == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('シリーズ')),
        body: Center(
          child: Text('シリーズが見つかりません ($seriesId)'),
        ),
      );
    }

    return _SeriesDetailBody(series: series);
  }
}

class _SeriesDetailBody extends StatelessWidget {
  const _SeriesDetailBody({required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
          const SizedBox(height: 16),
          Text(series.description, style: theme.textTheme.bodyLarge),
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'エピソード一覧とビューアは今後の Issue で実装します。',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
