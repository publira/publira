import 'package:flutter/material.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// One row of a vertical list of series: the catalog itself, and the search
/// results, which are the same catalog answered for a keyword.
class SeriesTile extends StatelessWidget {
  const SeriesTile({super.key, required this.series});

  final SeriesItem series;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final classification = _classification(messages, series);
    return ListTile(
      key: ValueKey('series-tile-${series.id}'),
      // 42 is the widest a 3:4 box can be and still stand inside the 56 pixels
      // ListTile allows its leading widget; a taller one is squeezed back to
      // this width anyway.
      leading: SizedBox(
        width: 42,
        child: EyeCatchCover(
          kind: 'series',
          id: series.id,
          variants: series.eyeCatchVariants,
          requestHeaders: series.imageRequestHeaders,
          preferredTypes: const [eyeCatchPortrait],
          aspectRatio: 3 / 4,
        ),
      ),
      title: Text(series.title),
      subtitle:
          series.creators.isEmpty &&
              classification.isEmpty &&
              series.description.isEmpty
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (series.creators.isNotEmpty)
                  CreatorCredits(
                    key: ValueKey('series-tile-credits-${series.id}'),
                    credits: series.creators,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
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
      trailing: _label(context),
      onTap: () => context.pushInTab(AppRoutes.seriesDetailPath(series.id)),
    );
  }

  /// The label, as a way of its own out of the row to the label's other
  /// series. A copy saved before the label's id was kept names it and leads
  /// nowhere.
  Widget? _label(BuildContext context) {
    if (series.labelName.isEmpty) {
      return null;
    }
    if (series.labelId.isEmpty) {
      return Text(series.labelName);
    }
    return TextButton(
      key: ValueKey('series-tile-label-${series.id}'),
      onPressed: () =>
          context.pushInTab(AppRoutes.labelDetailPath(series.labelId)),
      child: Text(series.labelName),
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
