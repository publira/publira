import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

/// How many rows before the end of a list the page under them is asked for,
/// the same read-ahead the catalog list uses.
const readAheadRows = 5;

/// The series a [pager] has read, as rows of a scroll view, with the page
/// under them at the bottom.
///
/// The screen above it owns the first page's loading and failure, which are
/// the whole screen; this is what stands once that page has arrived.
class PagedSeriesSliver extends StatelessWidget {
  const PagedSeriesSliver({
    super.key,
    required this.pager,
    required this.sectionKey,
    required this.emptyMessage,
  });

  final CatalogPager<SeriesItem, Object?> pager;

  /// Names the list on screen: `<sectionKey>-empty`, and the footer as
  /// `<sectionKey>-more`.
  final String sectionKey;

  /// What stands in place of the rows when there are none.
  final String emptyMessage;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final series = pager.items ?? const <SeriesItem>[];
    final hasFooter = pager.hasFooter;
    if (series.isEmpty && !hasFooter) {
      return SliverToBoxAdapter(
        child: Padding(
          key: ValueKey('$sectionKey-empty'),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Text(emptyMessage),
        ),
      );
    }
    return SliverList.separated(
      itemCount: series.length + (hasFooter ? 1 : 0),
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index >= series.length - readAheadRows) {
          pager.readMore();
        }
        if (index == series.length) {
          return PageFooter(
            sectionKey: '$sectionKey-more',
            message: pager.moreFailure == null
                ? null
                : catalogFailureCopy(
                    messages,
                    pager.moreFailure,
                    messages.commonMoreSeriesFailed,
                  ),
            onRetry: pager.retryMore,
          );
        }
        return SeriesTile(series: series[index]);
      },
    );
  }
}
