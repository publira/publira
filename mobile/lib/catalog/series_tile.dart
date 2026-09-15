import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/series_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

/// Who a series is credited to, as one line, and empty for a series credited
/// to nobody — which is what leaves the line off a card.
String creditLine(AppMessages messages, SeriesItem series) {
  if (series.creators.isEmpty) {
    return '';
  }
  return messages.formatList([
    for (final creator in series.creators) creator.name,
  ]);
}

/// One row of a vertical list of series: the catalog itself, and the search
/// results, which are the same catalog answered for a keyword.
class SeriesTile extends StatelessWidget {
  const SeriesTile({super.key, required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final credits = creditLine(messages, series);
    final classification = _classification(messages, series);
    return ListTile(
      key: ValueKey('series-tile-${series.id}'),
      // 42 is the widest a 3:4 box can be and still stand inside the 56 pixels
      // ListTile allows its leading widget; a taller one is squeezed back to
      // this width anyway.
      leading: SizedBox(
        width: 42,
        child: SeriesCover(
          series: series,
          preferredTypes: const [eyeCatchPortrait],
          aspectRatio: 3 / 4,
        ),
      ),
      title: Text(series.title),
      subtitle:
          credits.isEmpty &&
              classification.isEmpty &&
              series.description.isEmpty
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (credits.isNotEmpty)
                  Text(credits, maxLines: 1, overflow: TextOverflow.ellipsis),
                if (classification.isNotEmpty)
                  Text(
                    key: ValueKey('series-tile-classification-${series.id}'),
                    classification,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (series.description.isNotEmpty)
                  Text(
                    series.description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
      trailing: series.labelName.isEmpty ? null : Text(series.labelName),
      onTap: () => context.push(AppRoutes.seriesDetailPath(series.id)),
    );
  }
}

/// Status and the first genre, which is what a tile has room for. Empty when
/// the series carries neither, which leaves the line off.
String _classification(AppMessages messages, SeriesItem series) {
  final parts = <String>[
    if (series.status != null) messages.seriesStatusLabel(series.status!),
    if (series.genres.isNotEmpty) series.genres.first.name,
  ];
  return parts.join(' · ');
}
