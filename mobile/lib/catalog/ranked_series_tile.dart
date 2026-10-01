import 'package:flutter/material.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// One row of a ranking: the position, the cover, the title, and who the work
/// is credited to, which opens the series.
class RankedSeriesTile extends StatelessWidget {
  const RankedSeriesTile({super.key, required this.item});

  final RankedSeriesItem item;

  /// Wide enough for three digits in the position's type, so the covers stand
  /// in one column from the first position to the hundredth.
  static const _rankWidth = 40.0;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final series = item.series;
    return ListTile(
      key: ValueKey('ranking-tile-${series.id}'),
      leading: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: _rankWidth,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: AutospacedText(
                messages.formatInteger(item.rank),
                // The figure alone is what fits the column, and a screen
                // reader is told what it counts.
                semanticsLabel: messages.rankingRankPosition(
                  rank: messages.formatInteger(item.rank),
                ),
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // The width SeriesTile gives its cover, for the reason it gives.
          SizedBox(
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
        ],
      ),
      title: AutospacedText(
        series.title,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: series.creators.isEmpty
          ? null
          : CreatorCredits(
              credits: series.creators,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
      onTap: () => context.pushInTab(AppRoutes.seriesDetailPath(series.id)),
    );
  }
}
