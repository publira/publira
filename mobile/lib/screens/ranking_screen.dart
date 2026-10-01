import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/paged_list.dart';
import 'package:publira/catalog/ranked_series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// How many positions one page of the ranking holds, as many as a page of the
/// storefront's `/ranking` does.
const rankingPageLimit = 20;

/// The whole of the tenant's all-ages ranking for one period, one cursor page
/// at a time, each position a way into its series.
///
/// The app offers no rated chart, for the reason the catalog's ranking shelf
/// gives, so the periods are the one choice on this screen.
class RankingScreen extends StatefulWidget {
  const RankingScreen({super.key, this.period = RankingPeriod.daily});

  /// The chart on screen. The route is what holds it, so a switch on the
  /// screen and a link arriving while it is open both change it the same way.
  final RankingPeriod period;

  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  CatalogRepository? _catalog;
  CatalogPager<RankedSeriesItem, Null>? _pager;

  /// Counts the walks through a chart started from its top, each of which is
  /// a list of its own: one that kept the scroll offset of the one before it
  /// would open on whichever positions sat there.
  var _walks = 0;

  /// Reads the chart again whenever the repository changes, for the reason the
  /// author screen does.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _read();
  }

  /// A link to the other period lands on this same page rather than on a new
  /// one, so the chart follows the route here.
  @override
  void didUpdateWidget(covariant RankingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.period != oldWidget.period) {
      _read();
    }
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  /// Starts the chart of [RankingScreen.period] from its first position. A
  /// token belongs to the period it was issued for, so a switch never carries
  /// one across.
  void _read() {
    _walks++;
    final catalog = _catalog!;
    final period = widget.period;
    Future<CatalogPageRead<RankedSeriesItem, Null>> read(String token) async {
      final page = await catalog.listRankedSeries(
        limit: rankingPageLimit,
        period: period,
        ageRating: SeriesAgeRating.all,
        token: token,
      );
      return CatalogPageRead(
        items: page.rankedSeries,
        nextToken: page.nextToken,
      );
    }

    (_pager ??= CatalogPager(read)).restart(read);
  }

  /// Moves the route to [period] in place, which [didUpdateWidget] then
  /// follows. Keeping the period in the screen's own state instead would let
  /// the route and the chart disagree, and a link naming the period the route
  /// still held would change nothing.
  void _switchPeriod(RankingPeriod period) {
    if (period != widget.period) {
      context.replaceInTab(AppRoutes.rankingPath(period: period));
    }
  }

  /// A later page the API refused will be refused again: its token names a
  /// snapshot the retention purge has dropped since, so the retry starts the
  /// current chart from the top instead.
  void _retryMore() {
    if (_pager!.moreFailure?.refused ?? false) {
      setState(_read);
    } else {
      _pager!.retryMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.rankingTitle)),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: SegmentedButton<RankingPeriod>(
              key: const ValueKey('ranking-period'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: RankingPeriod.daily,
                  label: AutospacedText(
                    key: const ValueKey('ranking-period-daily'),
                    messages.rankingPeriodDaily,
                  ),
                ),
                ButtonSegment(
                  value: RankingPeriod.weekly,
                  label: AutospacedText(
                    key: const ValueKey('ranking-period-weekly'),
                    messages.rankingPeriodWeekly,
                  ),
                ),
              ],
              selected: {widget.period},
              onSelectionChanged: (selection) =>
                  _switchPeriod(selection.single),
            ),
          ),
          Expanded(
            child: PagedList(
              key: ValueKey(_walks),
              pager: _pager!,
              sectionKey: 'ranking',
              emptyMessage: messages.rankingEmpty,
              failedMessage: messages.rankingLoadFailed,
              onRetryMore: _retryMore,
              itemBuilder: (item) => RankedSeriesTile(item: item),
            ),
          ),
        ],
      ),
    );
  }
}
