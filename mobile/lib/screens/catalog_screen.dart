import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/data/sample_series.dart';
import 'package:publira/router.dart';

/// Home / catalog list. Placeholder until public API catalog is wired.
class CatalogScreen extends StatelessWidget {
  const CatalogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Publira')),
      body: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: sampleSeries.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final series = sampleSeries[index];
          return ListTile(
            key: ValueKey('series-tile-${series.id}'),
            title: Text(series.title),
            subtitle: Text(
              series.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Text(
              '${series.episodeCount} 話',
              style: theme.textTheme.labelMedium,
            ),
            onTap: () {
              context.push(AppRoutes.seriesDetailPath(series.id));
            },
          );
        },
      ),
    );
  }
}
