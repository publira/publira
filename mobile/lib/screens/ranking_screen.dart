import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/paged_list.dart';
import 'package:publira/catalog/ranked_series_tile.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// How many positions one page of the ranking holds, as many as a page of the
/// storefront's `/ranking` does.
const rankingPageLimit = 20;

/// The whole of the tenant's all-ages ranking for one period, or of one
/// genre's, one cursor page at a time, each position a way into its series.
///
/// The app offers no rated chart, for the reason the catalog's ranking shelf
/// gives, so the periods are the one choice on this screen. A genre is ranked
/// among all-ages series alone, so every genre's chart is one the app shows.
class RankingScreen extends StatefulWidget {
  const RankingScreen({
    super.key,
    this.period = RankingPeriod.daily,
    this.genreId = '',
  });

  /// The chart on screen. The route is what holds it, so a switch on the
  /// screen and a link arriving while it is open both change it the same way.
  final RankingPeriod period;

  /// The public id of the genre the chart is narrowed to, and empty for the
  /// tenant-wide chart. The route holds it beside [period].
  final String genreId;

  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  CatalogRepository? _catalog;
  CatalogPager<RankedSeriesItem, PublishedGenre>? _pager;

  /// The genre the chart is narrowed to once read, which a switch of period
  /// keeps rather than reading again: only the positions under it change.
  PublishedGenre? _genre;

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
    _genre = null;
    _read();
  }

  /// A link to another chart lands on this same page rather than on a new
  /// one, so the chart follows the route here.
  @override
  void didUpdateWidget(covariant RankingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.genreId != oldWidget.genreId) {
      _genre = null;
    }
    if (widget.period != oldWidget.period ||
        widget.genreId != oldWidget.genreId) {
      _read();
    }
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  /// Starts the chart of [RankingScreen.period] and [RankingScreen.genreId]
  /// from its first position. A token belongs to the period and the genre it
  /// was issued for, so a switch never carries one across.
  void _read() {
    _walks++;
    final catalog = _catalog!;
    final period = widget.period;
    final genreId = widget.genreId;
    final known = _genre;
    Future<CatalogPageRead<RankedSeriesItem, PublishedGenre>?> read(
      String token,
    ) async {
      // A genre the ranking batch has not reached answers with no positions,
      // just as one the tenant does not curate would, so the genre list is
      // what tells them apart. It is read before the chart rather than beside
      // it, so a value no genre carries never reaches the API as one.
      PublishedGenre? genre;
      if (genreId.isNotEmpty && token.isEmpty) {
        genre =
            known ??
            (await catalog.listGenres())
                .where((genre) => genre.id == genreId)
                .firstOrNull;
        if (genre == null) {
          return null;
        }
      }
      final page = await catalog.listRankedSeries(
        limit: rankingPageLimit,
        period: period,
        ageRating: SeriesAgeRating.all,
        genreId: genreId,
        token: token,
      );
      return CatalogPageRead(
        items: page.rankedSeries,
        nextToken: page.nextToken,
        header: genre,
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
      context.replaceInTab(
        AppRoutes.rankingPath(period: period, genreId: widget.genreId),
      );
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
    final pager = _pager!;
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final genre = _genre ??= pager.header;
        return Scaffold(
          appBar: AppBar(
            title: AutospacedText(
              genre == null
                  ? messages.rankingTitle
                  : messages.rankingTitleGenre(genre: genre.name),
            ),
          ),
          body: pager.notFound
              ? CatalogMessage(
                  key: const ValueKey('ranking-not-found'),
                  message: messages.genreNotFound(id: widget.genreId),
                  actionLabel: messages.commonBackToCatalog,
                  onAction: () => context.goNamed('catalog'),
                )
              : child,
        );
      },
      child: Column(
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
              pager: pager,
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
